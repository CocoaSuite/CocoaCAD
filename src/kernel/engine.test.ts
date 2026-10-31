import { beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import opencascade from "replicad-opencascadejs";
import * as R from "replicad";
import { Engine } from "./engine";
import { matchFingerprint } from "./naming";
import { applyAddition, circleAdd, lineAdd, rectangleAdd } from "../core/sketch/builders";
import { emptySketch } from "../core/sketch/model";
import type { BooleanFeature, EdgeFinishFeature, ExtrudeFeature, Feature, RevolveFeature, SketchData, SketchFeature } from "../core/types";

const wasm = fileURLToPath(new URL("../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm", import.meta.url));

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({ locateFile: () => wasm });
  R.setOC(oc as never);
}, 60000);

const sk = (id: string, data: SketchData, base: SketchFeature["plane"]["base"] = "XY", offset = 0): SketchFeature => ({
  id,
  type: "sketch",
  name: id,
  plane: { base, offset },
  sketch: data,
});
const ex = (id: string, sketchId: string, distance: number, extra: Partial<ExtrudeFeature> = {}): ExtrudeFeature => ({
  id,
  type: "extrude",
  name: id,
  sketchId,
  profiles: [],
  distance,
  direction: "normal",
  op: "new",
  ...extra,
});
const rect = (a: [number, number], b: [number, number]) => applyAddition(emptySketch(), rectangleAdd(a, b));

describe("kernel engine", () => {
  it("extrudes a plate with a hole", () => {
    const e = new Engine(R);
    const plate = applyAddition(rect([0, 0], [40, 20]), circleAdd([20, 10], 5));
    const res = e.rebuild([sk("s1", plate), ex("x1", "s1", 10)]);
    expect(res.problems).toEqual([]);
    expect(res.bodies).toHaveLength(1);
    expect(res.bodies[0]!.volume).toBeCloseTo((800 - Math.PI * 25) * 10, 0);
    expect(res.bodies[0]!.triangles.length).toBeGreaterThan(0);
    expect(res.bodies[0]!.edgeGroups.length).toBe(res.bodies[0]!.edges.length);
  });

  it("supports reverse and symmetric directions", () => {
    const e = new Engine(R);
    const s = sk("s1", rect([0, 0], [10, 10]));
    const rev = e.rebuild([s, ex("x1", "s1", 5, { direction: "reverse" })]).bodies[0]!;
    expect(rev.bbox[0][2]).toBeCloseTo(-5);
    expect(rev.bbox[1][2]).toBeCloseTo(0);
    const sym = e.rebuild([s, ex("x1", "s1", 5, { direction: "symmetric" })]).bodies[0]!;
    expect(sym.bbox[0][2]).toBeCloseTo(-5);
    expect(sym.bbox[1][2]).toBeCloseTo(5);
  });

  it("recomputes only what changed", () => {
    const e = new Engine(R);
    const f1: Feature[] = [
      sk("s1", rect([0, 0], [10, 10])),
      ex("x1", "s1", 5),
      sk("s2", rect([20, 0], [30, 10])),
      ex("x2", "s2", 5),
    ];
    expect(e.rebuild(f1).recomputed).toEqual(["x1", "x2"]);
    const f2 = f1.map((f) => (f.id === "x2" ? { ...(f as ExtrudeFeature), distance: 8 } : f));
    const r2 = e.rebuild(f2);
    expect(r2.recomputed).toEqual(["x2"]);
    expect(r2.bodies.find((b) => b.id === "x2")!.bbox[1][2]).toBeCloseTo(8);
    // renaming does not trigger a rebuild
    const f3 = f2.map((f) => ({ ...f, name: f.name + "!" }));
    expect(e.rebuild(f3).recomputed).toEqual([]);
  });

  it("cuts, adds and combines bodies", () => {
    const e = new Engine(R);
    const res = e.rebuild([
      sk("s1", rect([0, 0], [20, 20])),
      ex("x1", "s1", 10),
      sk("s2", applyAddition(emptySketch(), circleAdd([10, 10], 4)), "XY", 10),
      ex("x2", "s2", 4, { direction: "reverse", op: "cut", target: "x1" }),
      sk("s3", rect([30, 0], [40, 10])),
      ex("x3", "s3", 10),
      { id: "b1", type: "boolean", name: "b1", op: "union", target: "x1", tools: ["x3"], keepTools: false } satisfies BooleanFeature,
    ]);
    expect(res.problems).toEqual([]);
    expect(res.bodies.map((b) => b.id)).toEqual(["x1"]);
    expect(res.bodies[0]!.volume).toBeCloseTo(4000 - Math.PI * 16 * 4 + 1000, 0);
  });

  it("revolves around a sketch axis", () => {
    const e = new Engine(R);
    const res = e.rebuild([
      sk("s1", rect([5, 0], [10, 20]), "XZ"),
      { id: "r1", type: "revolve", name: "r1", sketchId: "s1", profiles: [], axis: { kind: "sketchAxis", axis: "y" }, angle: 360, op: "new" } satisfies RevolveFeature,
    ]);
    expect(res.problems).toEqual([]);
    expect(res.bodies[0]!.volume).toBeCloseTo(Math.PI * (100 - 25) * 20, 0);
  });

  it("fillets edges picked by fingerprint and flags lost references", () => {
    const e = new Engine(R);
    const base: Feature[] = [sk("s1", rect([0, 0], [20, 20])), ex("x1", "s1", 10)];
    const first = e.rebuild(base).bodies[0]!;
    const vertical = first.edges.filter((x) => Math.abs(x.fp.dir[2]) > 0.99);
    expect(vertical).toHaveLength(4);
    const fillet: EdgeFinishFeature = { id: "f1", type: "fillet", name: "f1", body: "x1", edges: vertical.map((x) => ({ fp: x.fp })), size: 2 };
    const res = e.rebuild([...base, fillet]);
    expect(res.problems).toEqual([]);
    expect(res.bodies[0]!.volume).toBeCloseTo(4000 - 4 * (4 - Math.PI) * 10, 1);
    // moving the box breaks the references and is reported, not silently ignored
    const moved = [sk("s1", rect([100, 0], [120, 20])), ex("x1", "s1", 10), fillet];
    const bad = e.rebuild(moved);
    expect(bad.problems.map((p) => p.featureId)).toEqual(["f1"]);
    expect(bad.problems[0]!.en).toMatch(/Re-pick/);
    // but a height change keeps the vertical edges matchable within tolerance only if similar
    expect(matchFingerprint({ fp: vertical[0]!.fp }, first.edges)).toBeGreaterThanOrEqual(0);
  });

  it("keeps fillet edges through dimension changes via their generating sketch points", () => {
    const e = new Engine(R);
    const base = rect([0, 0], [20, 20]);
    // same sketch entities, with the right-hand points moved — as a dimension edit does
    const plate = (w: number) =>
      [sk("s1", { ...base, points: base.points.map((p) => (p.x === 20 ? { ...p, x: w } : p)) }), ex("x1", "s1", 10)] as Feature[];
    const first = e.rebuild(plate(20)).bodies[0]!;
    const vertical = first.edges.filter((x) => Math.abs(x.fp.dir[2]) > 0.99);
    expect(vertical.every((x) => x.src?.startsWith("x1:v:"))).toBe(true);
    const caps = first.edges.filter((x) => Math.abs(x.fp.dir[2]) < 0.01);
    expect(caps.every((x) => /^x1:c[01]:/.test(x.src ?? ""))).toBe(true);
    const fillet: EdgeFinishFeature = { id: "f1", type: "fillet", name: "f1", body: "x1", edges: vertical.map((x) => ({ fp: x.fp, src: x.src! })), size: 2 };
    // widen the plate by 30 mm: every corner moves, the fingerprints no longer match
    const res = e.rebuild([...plate(50), fillet]);
    expect(res.problems).toEqual([]);
    expect(res.bodies[0]!.volume).toBeCloseTo(50 * 20 * 10 - 4 * (4 - Math.PI) * 10, 1);
  });

  it("reports open sketches and empty results", () => {
    const e = new Engine(R);
    const open = applyAddition(emptySketch(), lineAdd([0, 0], [10, 0]));
    const r1 = e.rebuild([sk("s1", open), ex("x1", "s1", 5)]);
    expect(r1.problems[0]!.en).toMatch(/closed profile/);
    const r2 = e.rebuild([
      sk("s1", rect([0, 0], [10, 10])),
      ex("x1", "s1", 5),
      sk("s2", rect([50, 50], [60, 60])),
      ex("x2", "s2", 5, { op: "intersect", target: "x1" }),
    ]);
    expect(r2.problems.map((p) => p.featureId)).toEqual(["x2"]);
  });

  it("exports STL and STEP", async () => {
    const e = new Engine(R);
    e.rebuild([sk("s1", rect([0, 0], [10, 10])), ex("x1", "s1", 5)]);
    const stl = e.exportBodies("stl", ["x1"], { x1: "Body 1" });
    expect(stl.size).toBe(84 + 12 * 50); // binary STL of a box: 12 triangles
    const step = await e.exportBodies("step", ["x1"], { x1: "Body 1" }).text();
    expect(step).toContain("ISO-10303-21");
  });
});
