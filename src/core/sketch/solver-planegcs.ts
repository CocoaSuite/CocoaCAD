// planegcs implementation of ConstraintSolver (D5). planegcs is LGPL-2.1 and is
// loaded as a separate, replaceable .wasm file.

import type { GcsWrapper, SketchPrimitive } from "@salusoft89/planegcs";
import type { Id, SketchConstraint, SketchData, SketchEntity } from "../types";
import { SketchView, arcAngles } from "./model";
import type { ConstraintSolver, DragTarget, SolveResult } from "./solver";

type Prim = Record<string, unknown> & { id: string; type: string };

/** Translate one CocoaCAD constraint into planegcs primitives. Exported for tests. */
export function constraintPrimitives(c: SketchConstraint, v: SketchView): Prim[] {
  const r = c.refs;
  const ent = (id: Id | undefined): SketchEntity | undefined => (id ? v.ents.get(id) : undefined);
  const base = { driving: c.driving !== false };
  const id = c.id;
  const val = c.value ?? 0;
  const e0 = ent(r[0]);
  const e1 = ent(r[1]);
  switch (c.type) {
    case "coincident":
      return [{ id, type: "p2p_coincident", p1_id: r[0], p2_id: r[1], ...base }];
    case "horizontal":
      return e0
        ? [{ id, type: "horizontal_l", l_id: r[0], ...base }]
        : [{ id, type: "horizontal_pp", p1_id: r[0], p2_id: r[1], ...base }];
    case "vertical":
      return e0
        ? [{ id, type: "vertical_l", l_id: r[0], ...base }]
        : [{ id, type: "vertical_pp", p1_id: r[0], p2_id: r[1], ...base }];
    case "parallel":
      return [{ id, type: "parallel", l1_id: r[0], l2_id: r[1], ...base }];
    case "perpendicular":
      return [{ id, type: "perpendicular_ll", l1_id: r[0], l2_id: r[1], ...base }];
    case "equal": {
      if (e0?.type === "line" && e1?.type === "line")
        return [{ id, type: "equal_length", l1_id: r[0], l2_id: r[1], ...base }];
      const kind = (e: SketchEntity | undefined) => (e?.type === "arc" ? "a" : "c");
      const k = kind(e0) + kind(e1);
      if (k === "cc") return [{ id, type: "equal_radius_cc", c1_id: r[0], c2_id: r[1], ...base }];
      if (k === "aa") return [{ id, type: "equal_radius_aa", a1_id: r[0], a2_id: r[1], ...base }];
      const [c1, a2] = kind(e0) === "c" ? [r[0], r[1]] : [r[1], r[0]];
      return [{ id, type: "equal_radius_ca", c1_id: c1, a2_id: a2, ...base }];
    }
    case "fix": {
      const p = v.p(r[0]!);
      return [
        { id: `${id}#x`, type: "coordinate_x", p_id: r[0], x: c.value ?? p[0], ...base },
        { id: `${id}#y`, type: "coordinate_y", p_id: r[0], y: p[1], ...base },
      ];
    }
    case "pointOnLine":
      return [{ id, type: "point_on_line_pl", p_id: r[0], l_id: r[1], ...base }];
    case "pointOnCircle":
      return e1?.type === "arc"
        ? [{ id, type: "point_on_arc", p_id: r[0], a_id: r[1], ...base }]
        : [{ id, type: "point_on_circle", p_id: r[0], c_id: r[1], ...base }];
    case "midpoint":
      return [
        { id: `${id}#on`, type: "point_on_line_pl", p_id: r[0], l_id: r[1], ...base },
        { id: `${id}#bis`, type: "point_on_perp_bisector_pl", p_id: r[0], l_id: r[1], ...base },
      ];
    case "tangent":
      return e1?.type === "arc"
        ? [{ id, type: "tangent_la", l_id: r[0], a_id: r[1], ...base }]
        : [{ id, type: "tangent_lc", l_id: r[0], c_id: r[1], ...base }];
    case "distance": {
      if (e0?.type === "line" && r.length === 1)
        return [{ id, type: "p2p_distance", p1_id: e0.p1, p2_id: e0.p2, distance: val, ...base }];
      if (e1?.type === "line") return [{ id, type: "p2l_distance", p_id: r[0], l_id: r[1], distance: val, ...base }];
      return [{ id, type: "p2p_distance", p1_id: r[0], p2_id: r[1], distance: val, ...base }];
    }
    case "hdistance":
    case "vdistance": {
      const prop = c.type === "hdistance" ? "x" : "y";
      const [a, b] = e0?.type === "line" ? [e0.p1, e0.p2] : [r[0], r[1]];
      return [{ id, type: "difference", param1: { o_id: a, prop }, param2: { o_id: b, prop }, difference: val, ...base }];
    }
    case "radius":
      return e0?.type === "arc"
        ? [{ id, type: "arc_radius", a_id: r[0], radius: val, ...base }]
        : [{ id, type: "circle_radius", c_id: r[0], radius: val, ...base }];
    case "diameter":
      return e0?.type === "arc"
        ? [{ id, type: "arc_diameter", a_id: r[0], diameter: val, ...base }]
        : [{ id, type: "circle_diameter", c_id: r[0], diameter: val, ...base }];
    case "angle":
      return [{ id, type: "l2l_angle_ll", l1_id: r[0], l2_id: r[1], angle: val, ...base }];
  }
}

export function sketchToPrimitives(data: SketchData, drag: DragTarget[] = [], hold = true): Prim[] {
  const v = new SketchView(data);
  const prims: Prim[] = [];
  for (const p of data.points) prims.push({ id: p.id, type: "point", x: p.x, y: p.y, fixed: false });
  for (const e of data.entities) {
    if (e.type === "line") prims.push({ id: e.id, type: "line", p1_id: e.p1, p2_id: e.p2 });
    else if (e.type === "circle") prims.push({ id: e.id, type: "circle", c_id: e.c, radius: e.r });
    else {
      const { a0, a1 } = arcAngles(v, e);
      prims.push({
        id: e.id,
        type: "arc",
        c_id: e.c,
        radius: e.r,
        start_angle: a0,
        end_angle: a1,
        start_id: e.start,
        end_id: e.end,
      });
      prims.push({ id: `${e.id}#rules`, type: "arc_rules", a_id: e.id });
    }
  }
  for (const c of data.constraints) prims.push(...constraintPrimitives(c, v));
  if (drag.length) {
    for (const d of drag) {
      prims.push({ id: `drag#${d.pointId}#x`, type: "coordinate_x", p_id: d.pointId, x: d.to[0], temporary: true });
      prims.push({ id: `drag#${d.pointId}#y`, type: "coordinate_y", p_id: d.pointId, y: d.to[1], temporary: true });
    }
  } else if (hold) {
    // Least-movement solve: softly hold every point where it is, so a new
    // dimension changes only what it must (setting a width keeps the height).
    for (const p of data.points) {
      prims.push({ id: `hold#${p.id}#x`, type: "coordinate_x", p_id: p.id, x: p.x, temporary: true });
      prims.push({ id: `hold#${p.id}#y`, type: "coordinate_y", p_id: p.id, y: p.y, temporary: true });
    }
  }
  return prims;
}

const baseId = (s: string) => s.split("#")[0]!;

export class PlanegcsSolver implements ConstraintSolver {
  constructor(private gcs: GcsWrapper) {}

  solve(data: SketchData, drag: DragTarget[] = []): SolveResult {
    const first = this.run(data, drag, true);
    // The held (least-movement) solve uses SQP, which can fail to converge from
    // badly inconsistent geometry; the plain solve is the fallback.
    if (first.status === "failed" && drag.length === 0) return this.run(data, drag, false);
    return first;
  }

  private run(data: SketchData, drag: DragTarget[], hold: boolean): SolveResult {
    const w = this.gcs;
    w.clear_data();
    // Seed dragged points at the target so the solver starts close to the answer.
    const seeded: SketchData =
      drag.length === 0
        ? data
        : {
            ...data,
            points: data.points.map((p) => {
              const d = drag.find((x) => x.pointId === p.id);
              return d ? { ...p, x: d.to[0], y: d.to[1] } : p;
            }),
          };
    w.push_primitives_and_params(sketchToPrimitives(seeded, drag, hold) as unknown as SketchPrimitive[]);
    const status = w.solve();
    const conflicting = [...new Set(w.get_gcs_conflicting_constraints().map(baseId))];
    const redundant = [...new Set(w.get_gcs_redundant_constraints().map(baseId))];
    const dof = w.gcs.dof();
    // status: 0 Success, 1 Converged, 2 Failed, 3 SuccessfulSolutionInvalid
    if (status === 2 || status === 3 || conflicting.length) {
      return {
        status: conflicting.length ? "conflicting" : "failed",
        data,
        dof,
        conflicting,
        redundant,
      };
    }
    w.apply_solution();
    const solved = new Map<string, Record<string, unknown>>();
    for (const p of w.sketch_index.get_primitives() as unknown as Prim[]) solved.set(p.id, p);
    const next: SketchData = {
      points: data.points.map((p) => {
        const s = solved.get(p.id);
        return s ? { ...p, x: s.x as number, y: s.y as number } : p;
      }),
      entities: data.entities.map((e) => {
        if (e.type === "line") return e;
        const s = solved.get(e.id);
        return s ? { ...e, r: Math.abs(s.radius as number) } : e;
      }),
      constraints: data.constraints,
    };
    return { status: redundant.length ? "redundant" : "ok", data: next, dof, conflicting, redundant };
  }
}
