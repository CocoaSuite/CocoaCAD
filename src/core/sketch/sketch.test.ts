import { describe, expect, it, beforeAll } from "vitest";
import { fileURLToPath } from "node:url";
import { make_gcs_wrapper } from "@salusoft89/planegcs";
import { applyAddition, arc3Add, circleAdd, lineAdd, rectangleAdd } from "./builders";
import { emptySketch, SketchView, lineLength, deleteFromSketch } from "./model";
import { findProfiles, regionAt, selectRegions } from "./profiles";
import { PlanegcsSolver } from "./solver-planegcs";
import type { SketchData } from "../types";

const wasm = fileURLToPath(new URL("../../../node_modules/@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm", import.meta.url));
let solver: PlanegcsSolver;
beforeAll(async () => {
  solver = new PlanegcsSolver(await make_gcs_wrapper(wasm));
});

const rect = (a: [number, number], b: [number, number]) => applyAddition(emptySketch(), rectangleAdd(a, b));

describe("profiles", () => {
  it("finds a rectangle as one region", () => {
    const r = findProfiles(rect([0, 0], [20, 10]));
    expect(r.loops).toHaveLength(1);
    expect(r.loops[0]!.area).toBeCloseTo(200);
    expect(selectRegions(r, [])).toHaveLength(1);
  });

  it("treats a circle inside a rectangle as a hole", () => {
    const d = applyAddition(rect([0, 0], [20, 10]), circleAdd([10, 5], 2));
    const r = findProfiles(d);
    expect(r.loops).toHaveLength(2);
    const regions = selectRegions(r, []);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.holes).toHaveLength(1);
    expect(regions[0]!.area).toBeCloseTo(200 - Math.PI * 4, 3);
    expect(regionAt(r, [10, 5])?.outer.segments[0]!.kind).toBe("circle");
    expect(regionAt(r, [1, 1])?.holes).toHaveLength(1);
  });

  it("splits a rectangle crossed by a line into two faces", () => {
    // Outline as six edges so the divider meets it at real vertices.
    const corners: [number, number][] = [[0, 0], [10, 0], [20, 0], [20, 10], [10, 10], [0, 10]];
    let d: SketchData = emptySketch();
    corners.forEach((c, i) => (d = applyAddition(d, lineAdd(c, corners[(i + 1) % 6]!))));
    d = applyAddition(d, lineAdd([10, 0], [10, 10]));
    const r = findProfiles(d);
    expect(r.loops).toHaveLength(2);
    expect(r.loops.map((l) => Math.round(l.area))).toEqual([100, 100]);
  });

  it("closes a loop made of lines and an arc", () => {
    let d = applyAddition(emptySketch(), lineAdd([0, 0], [20, 0]));
    d = applyAddition(d, lineAdd([20, 0], [20, 10]));
    d = applyAddition(d, arc3Add([20, 10], [10, 20], [0, 10])!);
    d = applyAddition(d, lineAdd([0, 10], [0, 0]));
    const r = findProfiles(d);
    expect(r.loops).toHaveLength(1);
    expect(r.loops[0]!.area).toBeGreaterThan(200);
    expect(r.openEntities).toHaveLength(0);
  });

  it("reports open chains", () => {
    const d = applyAddition(applyAddition(emptySketch(), lineAdd([0, 0], [5, 0])), lineAdd([5, 0], [5, 5]));
    const r = findProfiles(d);
    expect(r.loops).toHaveLength(0);
    expect(r.openEntities).toHaveLength(2);
  });
});

describe("planegcs solver", () => {
  it("closes rectangle corners and keeps sides axis-aligned", () => {
    const d = rect([0, 0], [20, 10]);
    // knock a corner off position
    d.points[1] = { ...d.points[1]!, x: 21, y: 0.7 };
    const res = solver.solve(d);
    expect(res.status).toBe("ok");
    const v = new SketchView(res.data);
    for (const e of res.data.entities) {
      if (e.type !== "line") continue;
      const a = v.p(e.p1);
      const b = v.p(e.p2);
      const horizontal = Math.abs(a[1] - b[1]) < 1e-6;
      const vertical = Math.abs(a[0] - b[0]) < 1e-6;
      expect(horizontal || vertical).toBe(true);
    }
    expect(findProfiles(res.data).loops).toHaveLength(1);
  });

  it("drives dimensions and reports degrees of freedom", () => {
    let d = rect([0, 0], [20, 10]);
    const free = solver.solve(d);
    expect(free.dof).toBe(4); // position x/y + width + height
    const [bottom, right] = [d.entities[0]!, d.entities[1]!];
    d = {
      ...d,
      constraints: [
        ...d.constraints,
        { id: "w", type: "distance", refs: [bottom.id], value: 50 },
        { id: "h", type: "distance", refs: [right.id], value: 30 },
        { id: "f", type: "fix", refs: [(bottom as { p1: string }).p1] },
      ],
    };
    const res = solver.solve(d);
    expect(res.status).toBe("ok");
    expect(res.dof).toBe(0);
    const v = new SketchView(res.data);
    expect(lineLength(v, res.data.entities[0] as never)).toBeCloseTo(50, 6);
    expect(lineLength(v, res.data.entities[1] as never)).toBeCloseTo(30, 6);
  });

  it("changes only what a new dimension requires", () => {
    let d = rect([-30, -20], [30, 20]);
    const top = d.entities[2]!;
    d = { ...d, constraints: [...d.constraints, { id: "w", type: "distance", refs: [top.id], value: 80 }] };
    const res = solver.solve(d);
    expect(res.status).toBe("ok");
    const v = new SketchView(res.data);
    expect(lineLength(v, res.data.entities[2] as never)).toBeCloseTo(80, 6);
    expect(lineLength(v, res.data.entities[1] as never)).toBeCloseTo(40, 4); // height untouched
    expect(res.dof).toBe(3);
  });

  it("detects conflicting constraints", () => {
    let d = applyAddition(emptySketch(), lineAdd([0, 0], [10, 1]));
    const l = d.entities[0]!.id;
    d = { ...d, constraints: [{ id: "a", type: "horizontal", refs: [l] }, { id: "b", type: "vertical", refs: [l] }, { id: "c", type: "distance", refs: [l], value: 5 }] };
    const res = solver.solve(d);
    expect(res.status).toBe("conflicting");
    expect(res.conflicting.length).toBeGreaterThan(0);
  });

  it("drags a point while honouring constraints", () => {
    const d = rect([0, 0], [20, 10]);
    const corner = (d.entities[1] as { p2: string }).p2; // top-right
    const res = solver.solve(d, [{ pointId: corner, to: [30, 15] }]);
    expect(res.status).toBe("ok");
    const r = findProfiles(res.data);
    expect(r.loops).toHaveLength(1);
    const p = res.data.points.find((x) => x.id === corner)!;
    expect(p.x).toBeCloseTo(30, 3);
    expect(p.y).toBeCloseTo(15, 3);
  });

  it("solves circle radius and arc", () => {
    let d = applyAddition(emptySketch(), circleAdd([0, 0], 3));
    d = applyAddition(d, arc3Add([10, 0], [15, 5], [20, 0])!);
    const c = d.entities[0]!.id;
    const a = d.entities[1]!.id;
    d = { ...d, constraints: [{ id: "r", type: "diameter", refs: [c], value: 10 }, { id: "e", type: "equal", refs: [c, a] }] };
    const res = solver.solve(d);
    expect(res.status).toBe("ok");
    expect(res.data.entities.every((e) => e.type === "line" || Math.abs(e.r - 5) < 1e-6)).toBe(true);
  });

  it("cleans up constraints when entities are deleted", () => {
    const d = rect([0, 0], [20, 10]);
    const out = deleteFromSketch(d, [d.entities[0]!.id]);
    expect(out.entities).toHaveLength(3);
    expect(out.points).toHaveLength(6);
    expect(out.constraints.every((c) => c.refs.every((r) => out.points.some((p) => p.id === r) || out.entities.some((e) => e.id === r)))).toBe(true);
  });
});
