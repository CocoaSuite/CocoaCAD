// Feature evaluation on OpenCASCADE (via replicad). Runs inside the geometry
// worker; kept free of worker plumbing so it can be unit-tested in Node.
//
// Incremental recompute: each feature's result is cached under a key built
// from its own parameters and the keys of everything it reads. Editing one
// feature changes only the keys downstream of it, so unrelated bodies and
// upstream features are reused, never rebuilt.

import type * as Replicad from "replicad";
import type {
  BodyOp,
  EdgeFinishFeature,
  Feature,
  Id,
  RevolveFeature,
  SketchFeature,
  Vec2,
  Vec3,
} from "../core/types";
import { featureBodyOutput, featureInputs } from "../core/graph";
import { planeFrame, toWorld } from "../core/sketch/plane";
import { findProfiles, selectRegions, type Loop, type Region } from "../core/sketch/profiles";
import { SketchView } from "../core/sketch/model";
import type { BodyMesh, EdgeInfo, KernelProblem, RebuildResult } from "./protocol";
import { edgeSource, resolveEdge, type SweepSource } from "./naming";

type R = typeof Replicad;
type Shape = Replicad.Shape3D;

interface CacheEntry {
  key: string;
  shape: Shape | null;
}

export class KernelError extends Error {
  constructor(
    readonly en: string,
    readonly ru: string,
  ) {
    super(en);
  }
}

export function hashString(s: string): string {
  // FNV-1a 52-bit-ish, as two 32-bit halves.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

export class Engine {
  private cache = new Map<Id, CacheEntry>();
  private meshCache = new Map<string, BodyMesh>();

  constructor(private r: R) {}

  rebuild(features: Feature[]): RebuildResult {
    const t0 = performance.now();
    const problems: KernelProblem[] = [];
    const recomputed: Id[] = [];
    const sketches = new Map<Id, SketchFeature>();
    /** Current state per body id: [key, shape]. */
    const bodies = new Map<Id, BodyState>();
    const order: Id[] = [];
    const live = new Set<Id>();

    for (const f of features) {
      if (f.suppressed) continue;
      if (f.type === "sketch") {
        sketches.set(f.id, f);
        continue;
      }
      const inputKeys: string[] = [];
      if (f.type === "extrude" || f.type === "revolve") {
        const s = sketches.get(f.sketchId);
        inputKeys.push(s ? JSON.stringify([s.plane, s.sketch]) : "missing");
      }
      const readBodies = featureInputs(f).filter((id) => !sketches.has(id) && id !== (f as { sketchId?: Id }).sketchId);
      for (const b of readBodies) inputKeys.push(bodies.get(b)?.key ?? "none");
      const key = hashString(JSON.stringify({ ...f, name: "" }) + "|" + inputKeys.join("|"));

      const outId = featureBodyOutput(f) ?? f.id;
      let entry = this.cache.get(f.id);
      if (!entry || entry.key !== key) {
        entry?.shape?.delete();
        let shape: Shape | null = null;
        try {
          shape = this.evaluate(f, sketches, bodies);
        } catch (e) {
          const err = toKernelError(e);
          problems.push({ featureId: f.id, en: err.en, ru: err.ru });
        }
        entry = { key, shape };
        this.cache.set(f.id, entry);
        recomputed.push(f.id);
      } else if (!entry.shape) {
        problems.push(this.lastProblem.get(f.id) ?? { featureId: f.id, en: "This feature failed.", ru: "Элемент не построен." });
      }
      if (entry.shape) {
        bodies.set(outId, { key, shape: entry.shape, sources: this.sourcesAfter(f, sketches, bodies) });
        if (!live.has(outId)) {
          live.add(outId);
          order.push(outId);
        }
        if (f.type === "boolean" && !f.keepTools)
          for (const t of f.tools) {
            live.delete(t);
            bodies.delete(t);
          }
      }
    }
    for (const p of problems) this.lastProblem.set(p.featureId, p);

    // Drop cache entries for features that no longer exist.
    const ids = new Set(features.map((f) => f.id));
    for (const [id, e] of this.cache)
      if (!ids.has(id)) {
        e.shape?.delete();
        this.cache.delete(id);
      }

    this.finalBodies = new Map([...bodies].filter(([id]) => live.has(id)));
    const out: BodyMesh[] = [];
    const usedKeys = new Set<string>();
    for (const id of order) {
      const b = bodies.get(id);
      if (!b || !live.has(id)) continue;
      const mkey = `${id}:${b.key}`;
      usedKeys.add(mkey);
      let m = this.meshCache.get(mkey);
      if (!m) {
        try {
          m = this.meshBody(id, b.key, b.shape, b.sources);
          this.meshCache.set(mkey, m);
        } catch (e) {
          const err = toKernelError(e);
          problems.push({ featureId: id, en: `Could not display this body: ${err.en}`, ru: `Не удалось отобразить тело: ${err.ru}` });
          continue;
        }
      }
      out.push(m);
    }
    for (const k of this.meshCache.keys()) if (!usedKeys.has(k)) this.meshCache.delete(k);

    return { bodies: out, problems, recomputed, ms: performance.now() - t0 };
  }

  private lastProblem = new Map<Id, KernelProblem>();
  private finalBodies = new Map<Id, BodyState>();

  /** Sweep features whose geometry an output body carries, for edge naming. */
  private sourcesAfter(f: Exclude<Feature, SketchFeature>, sketches: Map<Id, SketchFeature>, bodies: Map<Id, BodyState>): SweepSource[] {
    const of = (id: Id | undefined) => (id ? (bodies.get(id)?.sources ?? []) : []);
    switch (f.type) {
      case "extrude": {
        const prior = f.op === "new" ? [] : of(f.target);
        const sk = sketches.get(f.sketchId);
        if (!sk) return prior;
        const d = f.distance;
        const caps: [number, number] = f.direction === "symmetric" ? [-d, d] : f.direction === "reverse" ? [0, -d] : [0, d];
        const frame = planeFrame(sk.plane);
        return [...prior, { featureId: f.id, frame, caps, sketch: sk.sketch }];
      }
      case "revolve":
        return f.op === "new" ? [] : of(f.target);
      case "boolean":
        return [...of(f.target), ...f.tools.flatMap(of)];
      case "fillet":
      case "chamfer":
        return of(f.body);
    }
  }

  /* ───────── export ───────── */

  exportBodies(format: "stl" | "step", ids: Id[], names: Record<Id, string>): Blob {
    const shapes = ids.map((id) => this.finalBodies.get(id)?.shape).filter((s): s is Shape => !!s);
    if (shapes.length === 0) throw new KernelError("Nothing to export.", "Нечего экспортировать.");
    if (format === "step") {
      return this.r.exportSTEP(
        ids.filter((id) => this.finalBodies.has(id)).map((id) => ({ shape: this.finalBodies.get(id)!.shape, name: names[id] ?? id })),
      );
    }
    const compound = shapes.length === 1 ? shapes[0]! : (this.r.makeCompound(shapes) as Shape);
    return compound.blobSTL({ binary: true, tolerance: 0.01, angularTolerance: 0.1 } as never);
  }

  /* ───────── feature evaluation ───────── */

  private evaluate(f: Exclude<Feature, SketchFeature>, sketches: Map<Id, SketchFeature>, bodies: Map<Id, BodyState>): Shape {
    const r = this.r;
    switch (f.type) {
      case "extrude":
      case "revolve": {
        const sk = sketches.get(f.sketchId);
        if (!sk) throw new KernelError("Its sketch is missing.", "Отсутствует эскиз.");
        const regions = selectRegions(findProfiles(sk.sketch), f.profiles);
        if (regions.length === 0)
          throw new KernelError(
            "The sketch has no closed profile to use.",
            "В эскизе нет замкнутого контура.",
          );
        const frame = planeFrame(sk.plane);
        const plane = new r.Plane(frame.origin, frame.xDir, frame.normal);
        let tool: Shape | null = null;
        for (const region of regions) {
          const sketch = this.regionDrawing(region).sketchOnPlane(plane) as Replicad.Sketch;
          let solid: Shape;
          if (f.type === "extrude") {
            if (!(Math.abs(f.distance) > 1e-6)) throw new KernelError("Distance must be more than zero.", "Расстояние должно быть больше нуля.");
            const n = frame.normal;
            if (f.direction === "symmetric") {
              solid = sketch.extrude(f.distance * 2, { extrusionDirection: n });
              solid = solid.translate([-n[0] * f.distance, -n[1] * f.distance, -n[2] * f.distance]);
            } else {
              const dir: Vec3 = f.direction === "reverse" ? [-n[0], -n[1], -n[2]] : n;
              solid = sketch.extrude(f.distance, { extrusionDirection: dir });
            }
          } else {
            solid = this.revolve(sketch, f, sk);
          }
          if (tool) {
            const fused: Shape = tool.fuse(solid);
            tool.delete();
            solid.delete();
            tool = fused;
          } else tool = solid;
        }
        return this.applyOp(f.op, f.target, tool!, bodies);
      }
      case "boolean": {
        const target = bodies.get(f.target)?.shape;
        if (!target) throw new KernelError("Its target body is missing.", "Отсутствует целевое тело.");
        if (f.tools.length === 0) throw new KernelError("Pick at least one tool body.", "Выберите хотя бы одно тело-инструмент.");
        let out = target;
        for (const t of f.tools) {
          const tool = bodies.get(t)?.shape;
          if (!tool) {
            if (out !== target) out.delete();
            throw new KernelError("A tool body is missing.", "Отсутствует тело-инструмент.");
          }
          const next: Shape = f.op === "union" ? out.fuse(tool) : f.op === "subtract" ? out.cut(tool) : out.intersect(tool);
          if (out !== target) out.delete(); // intermediate result we own
          out = next;
        }
        assertSolid(out);
        return out;
      }
      case "fillet":
      case "chamfer":
        return this.edgeFinish(f, bodies);
    }
  }

  private applyOp(op: BodyOp, target: Id | undefined, tool: Shape, bodies: Map<Id, { shape: Shape }>): Shape {
    if (op === "new") return tool;
    const t = target ? bodies.get(target)?.shape : undefined;
    if (!t) {
      tool.delete();
      throw new KernelError("Pick a target body.", "Выберите целевое тело.");
    }
    // Booleans leave their inputs alive; the target belongs to an earlier cache entry, the tool is ours.
    const out = op === "add" ? t.fuse(tool) : op === "cut" ? t.cut(tool) : t.intersect(tool);
    tool.delete();
    assertSolid(out);
    return out;
  }

  private revolve(sketch: Replicad.Sketch, f: RevolveFeature, sk: SketchFeature): Shape {
    const frame = planeFrame(sk.plane);
    let origin: Vec3;
    let dir: Vec3;
    if (f.axis.kind === "sketchAxis") {
      origin = frame.origin;
      dir = f.axis.axis === "x" ? frame.xDir : frame.yDir;
    } else {
      const v = new SketchView(sk.sketch);
      const line = v.ents.get(f.axis.lineId);
      if (!line || line.type !== "line") throw new KernelError("Its axis line is missing.", "Отсутствует ось вращения.");
      const a = toWorld(frame, v.p(line.p1));
      const b = toWorld(frame, v.p(line.p2));
      origin = a;
      dir = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    }
    if (!(f.angle > 0 && f.angle <= 360)) throw new KernelError("Angle must be between 0° and 360°.", "Угол должен быть от 0° до 360°.");
    return sketch.revolve(dir, { origin, angle: f.angle });
  }

  private regionDrawing(region: Region): Replicad.Drawing {
    let d = this.loopDrawing(region.outer);
    for (const h of region.holes) d = d.cut(this.loopDrawing(h));
    return d;
  }

  private loopDrawing(loop: Loop): Replicad.Drawing {
    const r = this.r;
    const first = loop.segments[0]!;
    if (first.kind === "circle") return r.drawCircle(first.r).translate(first.c[0], first.c[1]);
    const pen = r.draw(first.a as Vec2);
    for (const s of loop.segments) {
      if (s.kind === "line") pen.lineTo(s.b as Vec2);
      else if (s.kind === "arc") pen.threePointsArcTo(s.b as Vec2, s.mid as Vec2);
    }
    return pen.close();
  }

  private edgeFinish(f: EdgeFinishFeature, bodies: Map<Id, BodyState>): Shape {
    const state = bodies.get(f.body);
    const body = state?.shape;
    if (!body) throw new KernelError("Its body is missing.", "Отсутствует тело.");
    if (!(f.size > 0)) throw new KernelError("Size must be more than zero.", "Размер должен быть больше нуля.");
    if (f.edges.length === 0) throw new KernelError("Pick at least one edge.", "Выберите хотя бы одно ребро.");
    const edges = body.edges;
    const infos = edges.map((e) => withSource(edgeInfo(e), state!.sources));
    const chosen = new Set<number>();
    let unresolved = 0;
    for (const ref of f.edges) {
      const i = resolveEdge(ref, infos);
      if (i < 0) unresolved++;
      else chosen.add(infos[i]!.hash);
    }
    if (unresolved > 0)
      throw new KernelError(
        `${unresolved} edge reference(s) no longer match the model. Re-pick the edges.`,
        `Ссылки на рёбра (${unresolved}) больше не совпадают с моделью. Выберите рёбра заново.`,
      );
    const pick = (e: Replicad.Edge) => (chosen.has(e.hashCode) ? f.size : null);
    const out = f.type === "fillet" ? body.fillet(pick) : body.chamfer(pick);
    assertSolid(out);
    return out;
  }

  /* ───────── meshing ───────── */

  private meshBody(id: Id, key: string, shape: Shape, sources: SweepSource[]): BodyMesh {
    const bb = shape.boundingBox;
    const [lo, hi] = bb.bounds;
    const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
    const tolerance = Math.max(0.005, diag * 0.0008);
    const m = shape.mesh({ tolerance, angularTolerance: 0.15 });
    const e = shape.meshEdges({ tolerance, angularTolerance: 0.15 });
    return {
      id,
      key,
      vertices: new Float32Array(m.vertices),
      normals: new Float32Array(m.normals),
      triangles: new Uint32Array(m.triangles),
      faceGroups: m.faceGroups,
      lines: new Float32Array(e.lines),
      edgeGroups: e.edgeGroups,
      edges: shape.edges.map((e) => withSource(edgeInfo(e), sources)),
      volume: this.r.measureVolume(shape),
      area: this.r.measureArea(shape),
      bbox: [lo as Vec3, hi as Vec3],
    };
  }
}

/* ───────── helpers ───────── */

function edgeInfo(e: Replicad.Edge): EdgeInfo {
  const mid = e.pointAt(0.5).toTuple() as Vec3;
  let dir: Vec3;
  try {
    dir = e.tangentAt(0.5).normalized().toTuple() as Vec3;
  } catch {
    dir = [0, 0, 0];
  }
  return { hash: e.hashCode, fp: { mid, dir, len: e.length } };
}

function withSource(info: EdgeInfo, sources: SweepSource[]): EdgeInfo {
  const src = edgeSource(info, sources);
  return src ? { ...info, src } : info;
}

interface BodyState {
  key: string;
  shape: Shape;
  sources: SweepSource[];
}

function assertSolid(s: Shape) {
  // An empty result (e.g. a cut that removes everything) has no faces.
  if (s.faces.length === 0)
    throw new KernelError("The result is empty — the bodies do not overlap.", "Результат пуст — тела не пересекаются.");
}

export function toKernelError(e: unknown): KernelError {
  if (e instanceof KernelError) return e;
  const msg = e instanceof Error ? e.message : typeof e === "number" ? `OpenCASCADE exception ${e}` : String(e);
  return new KernelError(
    `The geometry kernel could not build this feature (${msg}). Check that the profile is valid and the sizes fit.`,
    `Геометрическое ядро не смогло построить элемент (${msg}). Проверьте контур и размеры.`,
  );
}
