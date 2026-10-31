// Which constraint a toolbar button creates for the current selection.
// Pure, so the same rules drive button enablement and creation.

import { newId } from "../ids";
import type { ConstraintType, Id, SketchConstraint, SketchData, SketchEntity } from "../types";
import { arcAngles, SketchView, dist } from "./model";

export type ConstraintTool =
  | "coincident"
  | "horizontal"
  | "vertical"
  | "parallel"
  | "perpendicular"
  | "equal"
  | "tangent"
  | "midpoint"
  | "fix";

export interface Picked {
  points: Id[];
  entities: Id[];
}

export function constraintsFor(tool: ConstraintTool, sel: Picked, data: SketchData): SketchConstraint[] | null {
  const v = new SketchView(data);
  const ents = sel.entities.map((id) => v.ents.get(id)).filter((e): e is SketchEntity => !!e);
  const lines = ents.filter((e) => e.type === "line");
  const round = ents.filter((e) => e.type !== "line");
  const pts = sel.points;
  const mk = (type: ConstraintType, refs: Id[], value?: number): SketchConstraint =>
    value === undefined ? { id: newId("k"), type, refs } : { id: newId("k"), type, refs, value };

  switch (tool) {
    case "coincident":
      if (pts.length === 2 && ents.length === 0) return [mk("coincident", pts)];
      if (pts.length === 1 && ents.length === 1) {
        const e = ents[0]!;
        if (v.entityPoints(e).includes(pts[0]!)) return null;
        return [mk(e.type === "line" ? "pointOnLine" : "pointOnCircle", [pts[0]!, e.id])];
      }
      return null;
    case "horizontal":
    case "vertical":
      if (lines.length >= 1 && round.length === 0 && pts.length === 0) return lines.map((l) => mk(tool, [l.id]));
      if (pts.length === 2 && ents.length === 0) return [mk(tool, pts)];
      return null;
    case "parallel":
    case "perpendicular":
      if (lines.length === 2 && ents.length === 2 && pts.length === 0) return [mk(tool, [lines[0]!.id, lines[1]!.id])];
      if (tool === "parallel" && lines.length > 2 && ents.length === lines.length && pts.length === 0)
        return lines.slice(1).map((l) => mk("parallel", [lines[0]!.id, l.id]));
      return null;
    case "equal":
      if (pts.length) return null;
      if (lines.length >= 2 && round.length === 0) return lines.slice(1).map((l) => mk("equal", [lines[0]!.id, l.id]));
      if (round.length >= 2 && lines.length === 0) return round.slice(1).map((c) => mk("equal", [round[0]!.id, c.id]));
      return null;
    case "tangent":
      if (lines.length === 1 && round.length === 1 && pts.length === 0) return [mk("tangent", [lines[0]!.id, round[0]!.id])];
      return null;
    case "midpoint":
      if (pts.length === 1 && lines.length === 1 && ents.length === 1) {
        if (v.entityPoints(lines[0]!).includes(pts[0]!)) return null;
        return [mk("midpoint", [pts[0]!, lines[0]!.id])];
      }
      return null;
    case "fix":
      if (pts.length >= 1 && ents.length === 0) return pts.map((p) => mk("fix", [p]));
      if (pts.length === 0 && ents.length >= 1) {
        const all = [...new Set(ents.flatMap((e) => v.entityPoints(e)))];
        return all.map((p) => mk("fix", [p]));
      }
      return null;
  }
}

/** Driving dimension for a single picked item, measured from current geometry. */
export function dimensionFor(sel: Picked, data: SketchData): SketchConstraint | null {
  const v = new SketchView(data);
  const ents = sel.entities.map((id) => v.ents.get(id)).filter((e): e is SketchEntity => !!e);
  const id = newId("k");
  if (sel.points.length === 0 && ents.length === 1) {
    const e = ents[0]!;
    if (e.type === "line") return { id, type: "distance", refs: [e.id], value: dist(v.p(e.p1), v.p(e.p2)) };
    if (e.type === "circle") return { id, type: "diameter", refs: [e.id], value: e.r * 2 };
    return { id, type: "radius", refs: [e.id], value: e.r };
  }
  if (sel.points.length === 2 && ents.length === 0)
    return { id, type: "distance", refs: sel.points, value: dist(v.p(sel.points[0]!), v.p(sel.points[1]!)) };
  if (sel.points.length === 1 && ents.length === 1 && ents[0]!.type === "line") {
    const l = ents[0]!;
    const p = v.p(sel.points[0]!);
    const a = v.p(l.p1);
    const b = v.p(l.p2);
    const len = dist(a, b);
    if (len === 0) return null;
    const d = Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len;
    return { id, type: "distance", refs: [sel.points[0]!, l.id], value: d };
  }
  if (sel.points.length === 0 && ents.length === 2 && ents.every((e) => e.type === "line")) {
    const [l1, l2] = ents as Extract<SketchEntity, { type: "line" }>[];
    const d1 = sub(v.p(l1!.p2), v.p(l1!.p1));
    const d2 = sub(v.p(l2!.p2), v.p(l2!.p1));
    const ang = Math.atan2(d1[0] * d2[1] - d1[1] * d2[0], d1[0] * d2[0] + d1[1] * d2[1]);
    return { id, type: "angle", refs: [l1!.id, l2!.id], value: ang };
  }
  return null;
}

const sub = (a: [number, number], b: [number, number]): [number, number] => [a[0] - b[0], a[1] - b[1]];

/** Current measured value of a dimensional constraint (for display of reference dims). */
export function measure(c: SketchConstraint, data: SketchData): number | null {
  const v = new SketchView(data);
  const e0 = v.ents.get(c.refs[0]!);
  try {
    switch (c.type) {
      case "distance":
        if (e0?.type === "line" && c.refs.length === 1) return dist(v.p(e0.p1), v.p(e0.p2));
        if (c.refs.length === 2 && v.isPoint(c.refs[0]!) && v.isPoint(c.refs[1]!)) return dist(v.p(c.refs[0]!), v.p(c.refs[1]!));
        return c.value ?? null;
      case "radius":
        return e0 && e0.type !== "line" ? e0.r : null;
      case "diameter":
        return e0 && e0.type !== "line" ? e0.r * 2 : null;
      default:
        return c.value ?? null;
    }
  } catch {
    return null;
  }
}

export const isDimension = (c: SketchConstraint) =>
  c.type === "distance" || c.type === "hdistance" || c.type === "vdistance" || c.type === "radius" || c.type === "diameter" || c.type === "angle";

export { arcAngles };
