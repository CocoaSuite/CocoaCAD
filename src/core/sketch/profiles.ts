// Closed-region detection for sketches.
// 1. Merge coincident endpoints into graph vertices.
// 2. Prune dangling edges, then walk planar faces of each connected component
//    (half-edge traversal, outgoing edges sorted by tangent angle).
// 3. Bounded faces (positive area) become loops; circles are loops on their own.
// 4. Loops from different components nest by containment: a region is a loop
//    minus the loops directly inside it.

import type { Id, SketchArc, SketchData, SketchLine, Vec2 } from "../types";
import { arcAngles, arcMid, SketchView } from "./model";

export type Segment =
  | { kind: "line"; a: Vec2; b: Vec2; entity: Id }
  | { kind: "arc"; a: Vec2; b: Vec2; mid: Vec2; c: Vec2; r: number; entity: Id }
  | { kind: "circle"; c: Vec2; r: number; entity: Id };

export interface Loop {
  key: string;
  /** Ordered, oriented segments; counter-clockwise. */
  segments: Segment[];
  polygon: Vec2[];
  area: number;
  component: number;
}

export interface Region {
  key: string; // same as outer loop key
  outer: Loop;
  holes: Loop[];
  depth: number;
  area: number;
}

export interface ProfileResult {
  loops: Loop[];
  regions: Region[];
  /** Entity ids not part of any closed loop (open chains). */
  openEntities: Id[];
}

const TAU = Math.PI * 2;

interface HalfEdge {
  from: number;
  to: number;
  entity: Id;
  reversed: boolean;
  angle: number; // outgoing tangent angle at `from`
  twin: number;
  used: boolean;
}

export function findProfiles(data: SketchData, tol = 1e-6): ProfileResult {
  const v = new SketchView(data);

  // ── 1. vertices: union-find over endpoint ids (shared ids, coincident constraints, equal positions)
  const parent = new Map<Id, Id>();
  const find = (x: Id): Id => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (a: Id, b: Id) => parent.set(find(a), find(b));
  const curves = data.entities.filter((e): e is SketchLine | SketchArc => !e.construction && e.type !== "circle");
  const endpointIds: Id[] = [];
  for (const e of curves) {
    const ends = e.type === "line" ? [e.p1, e.p2] : [e.start, e.end];
    for (const id of ends) {
      if (!parent.has(id)) {
        parent.set(id, id);
        endpointIds.push(id);
      }
    }
  }
  for (const c of data.constraints)
    if (c.type === "coincident" && parent.has(c.refs[0]!) && parent.has(c.refs[1]!)) union(c.refs[0]!, c.refs[1]!);
  for (let i = 0; i < endpointIds.length; i++)
    for (let j = i + 1; j < endpointIds.length; j++) {
      const a = v.p(endpointIds[i]!);
      const b = v.p(endpointIds[j]!);
      if (Math.abs(a[0] - b[0]) < tol * 1000 && Math.abs(a[1] - b[1]) < tol * 1000) union(endpointIds[i]!, endpointIds[j]!);
    }
  const vIndex = new Map<Id, number>();
  const vPos: Vec2[] = [];
  for (const id of endpointIds) {
    const r = find(id);
    if (!vIndex.has(r)) {
      vIndex.set(r, vPos.length);
      vPos.push(v.p(id));
    }
    vIndex.set(id, vIndex.get(r)!);
  }

  // ── 2. edges and pruning
  type E = { id: Id; a: number; b: number };
  let edges: E[] = [];
  for (const e of curves) {
    const [s, t] = e.type === "line" ? [e.p1, e.p2] : [e.start, e.end];
    const a = vIndex.get(s)!;
    const b = vIndex.get(t)!;
    if (a === b && e.type === "line") continue; // zero-length
    edges.push({ id: e.id, a, b });
  }
  const allCurveIds = new Set(edges.map((e) => e.id));
  for (;;) {
    const deg = new Map<number, number>();
    for (const e of edges) {
      deg.set(e.a, (deg.get(e.a) ?? 0) + 1);
      deg.set(e.b, (deg.get(e.b) ?? 0) + 1);
    }
    const next = edges.filter((e) => (deg.get(e.a) ?? 0) > 1 && (deg.get(e.b) ?? 0) > 1);
    if (next.length === edges.length) break;
    edges = next;
  }

  // components (for nesting tests)
  const comp = new Map<number, number>();
  {
    const adj = new Map<number, number[]>();
    for (const e of edges) {
      adj.set(e.a, [...(adj.get(e.a) ?? []), e.b]);
      adj.set(e.b, [...(adj.get(e.b) ?? []), e.a]);
    }
    let n = 0;
    for (const start of adj.keys()) {
      if (comp.has(start)) continue;
      const stack = [start];
      comp.set(start, n);
      while (stack.length) {
        const x = stack.pop()!;
        for (const y of adj.get(x) ?? []) if (!comp.has(y)) (comp.set(y, n), stack.push(y));
      }
      n++;
    }
  }

  // ── 3. half-edges and face walk
  const he: HalfEdge[] = [];
  for (const e of edges) {
    const ent = v.ents.get(e.id)!;
    let angA: number;
    let angB: number;
    if (ent.type === "line") {
      const A = vPos[e.a]!;
      const B = vPos[e.b]!;
      angA = Math.atan2(B[1] - A[1], B[0] - A[0]);
      angB = Math.atan2(A[1] - B[1], A[0] - B[0]);
    } else if (ent.type === "arc") {
      const { a0, a1 } = arcAngles(v, ent);
      angA = a0 + Math.PI / 2; // leaving start CCW
      angB = a1 - Math.PI / 2; // leaving end clockwise
    } else continue;
    const i = he.length;
    he.push({ from: e.a, to: e.b, entity: e.id, reversed: false, angle: norm(angA), twin: i + 1, used: false });
    he.push({ from: e.b, to: e.a, entity: e.id, reversed: true, angle: norm(angB), twin: i, used: false });
  }
  const out = new Map<number, number[]>();
  he.forEach((h, i) => out.set(h.from, [...(out.get(h.from) ?? []), i]));
  for (const list of out.values()) list.sort((x, y) => he[x]!.angle - he[y]!.angle);

  const loops: Loop[] = [];
  for (let i = 0; i < he.length; i++) {
    if (he[i]!.used) continue;
    const cycle: number[] = [];
    let h = i;
    let guard = 0;
    while (!he[h]!.used && guard++ < he.length + 2) {
      he[h]!.used = true;
      cycle.push(h);
      const twin = he[h]!.twin;
      const list = out.get(he[h]!.to)!;
      const k = list.indexOf(twin);
      // next edge clockwise from the twin → interior on the left (CCW faces)
      h = list[(k - 1 + list.length) % list.length]!;
    }
    if (h !== i) continue; // malformed walk
    const segments = cycle.map((hi) => segmentOf(v, he[hi]!, vPos));
    const polygon = sampleSegments(segments);
    const area = signedArea(polygon);
    if (area <= 1e-9) continue; // outer face of a component, or degenerate
    loops.push({
      key: cycle.map((hi) => he[hi]!.entity).sort().join(","),
      segments,
      polygon,
      area,
      component: comp.get(he[i]!.from) ?? -1,
    });
  }

  // circles
  let compId = 1e6;
  for (const e of data.entities) {
    if (e.type !== "circle" || e.construction || e.r <= 0) continue;
    const seg: Segment = { kind: "circle", c: v.p(e.c), r: e.r, entity: e.id };
    const polygon = sampleSegments([seg]);
    loops.push({ key: e.id, segments: [seg], polygon, area: Math.PI * e.r * e.r, component: compId++ });
  }

  // ── 4. nesting
  const parentOf = new Map<Loop, Loop | null>();
  for (const L of loops) {
    let best: Loop | null = null;
    for (const M of loops) {
      if (M === L || M.component === L.component || M.area <= L.area) continue;
      if (pointInPolygon(L.polygon[0]!, M.polygon) && (!best || M.area < best.area)) best = M;
    }
    parentOf.set(L, best);
  }
  const depth = (L: Loop): number => {
    let d = 0;
    for (let p = parentOf.get(L); p; p = parentOf.get(p)) d++;
    return d;
  };
  const regions: Region[] = loops.map((L) => {
    const holes = loops.filter((M) => parentOf.get(M) === L);
    return { key: L.key, outer: L, holes, depth: depth(L), area: L.area - holes.reduce((s, h) => s + h.area, 0) };
  });

  const inLoop = new Set(loops.flatMap((l) => l.segments.map((s) => s.entity)));
  const openEntities = [...allCurveIds].filter((id) => !inLoop.has(id));
  return { loops, regions, openEntities };
}

/** Regions an Extrude/Revolve uses: explicit keys, or every even-depth region. */
export function selectRegions(result: ProfileResult, keys: string[]): Region[] {
  if (keys.length === 0) return result.regions.filter((r) => r.depth % 2 === 0);
  const set = new Set(keys);
  return result.regions.filter((r) => set.has(r.key));
}

/** Region under a sketch-space point (innermost wins). */
export function regionAt(result: ProfileResult, p: Vec2): Region | null {
  let best: Region | null = null;
  for (const r of result.regions) {
    if (!pointInPolygon(p, r.outer.polygon)) continue;
    if (r.holes.some((h) => pointInPolygon(p, h.polygon))) continue;
    if (!best || r.outer.area < best.outer.area) best = r;
  }
  return best;
}

/* ───────── geometry helpers ───────── */

function norm(a: number) {
  a %= TAU;
  return a < 0 ? a + TAU : a;
}

function segmentOf(v: SketchView, h: HalfEdge, vPos: Vec2[]): Segment {
  const ent = v.ents.get(h.entity)!;
  const a = vPos[h.from]!;
  const b = vPos[h.to]!;
  if (ent.type === "arc") return { kind: "arc", a, b, mid: arcMid(v, ent), c: v.p(ent.c), r: ent.r, entity: ent.id };
  return { kind: "line", a, b, entity: ent.id };
}

export function sampleSegments(segs: Segment[], maxStep = Math.PI / 24): Vec2[] {
  const pts: Vec2[] = [];
  for (const s of segs) {
    if (s.kind === "line") pts.push(s.a);
    else if (s.kind === "circle") {
      for (let i = 0; i < 64; i++) {
        const t = (i / 64) * TAU;
        pts.push([s.c[0] + s.r * Math.cos(t), s.c[1] + s.r * Math.sin(t)]);
      }
    } else {
      const t0 = Math.atan2(s.a[1] - s.c[1], s.a[0] - s.c[0]);
      const tm = Math.atan2(s.mid[1] - s.c[1], s.mid[0] - s.c[0]);
      const t1 = Math.atan2(s.b[1] - s.c[1], s.b[0] - s.c[0]);
      // direction: whichever way from t0 passes through tm first
      const ccw = norm(tm - t0) < norm(t1 - t0);
      const sweep = ccw ? norm(t1 - t0) || TAU : -(norm(t0 - t1) || TAU);
      const n = Math.max(2, Math.ceil(Math.abs(sweep) / maxStep));
      for (let i = 0; i < n; i++) {
        const t = t0 + (sweep * i) / n;
        pts.push([s.c[0] + s.r * Math.cos(t), s.c[1] + s.r * Math.sin(t)]);
      }
    }
  }
  return pts;
}

export function signedArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
