// Pure helpers for reading and editing sketch data.

import { newId } from "../ids";
import type { Id, SketchConstraint, SketchData, SketchEntity, SketchPoint, Vec2 } from "../types";

export const emptySketch = (): SketchData => ({ points: [], entities: [], constraints: [] });

export class SketchView {
  readonly pts = new Map<Id, SketchPoint>();
  readonly ents = new Map<Id, SketchEntity>();
  constructor(readonly data: SketchData) {
    for (const p of data.points) this.pts.set(p.id, p);
    for (const e of data.entities) this.ents.set(e.id, e);
  }
  p(id: Id): Vec2 {
    const p = this.pts.get(id);
    if (!p) throw new Error(`Missing sketch point ${id}`);
    return [p.x, p.y];
  }
  /** Points owned by an entity (endpoints and centres). */
  entityPoints(e: SketchEntity): Id[] {
    if (e.type === "line") return [e.p1, e.p2];
    if (e.type === "circle") return [e.c];
    return [e.c, e.start, e.end];
  }
  isPoint(id: Id) {
    return this.pts.has(id);
  }
}

export function arcAngles(v: SketchView, e: Extract<SketchEntity, { type: "arc" }>) {
  const c = v.p(e.c);
  const s = v.p(e.start);
  const t = v.p(e.end);
  const a0 = Math.atan2(s[1] - c[1], s[0] - c[0]);
  let a1 = Math.atan2(t[1] - c[1], t[0] - c[0]);
  while (a1 <= a0) a1 += Math.PI * 2;
  return { c, a0, a1 };
}

export function arcMid(v: SketchView, e: Extract<SketchEntity, { type: "arc" }>): Vec2 {
  const { c, a0, a1 } = arcAngles(v, e);
  const m = (a0 + a1) / 2;
  return [c[0] + e.r * Math.cos(m), c[1] + e.r * Math.sin(m)];
}

/** Remove entities and any points / constraints left without an owner. */
export function deleteFromSketch(data: SketchData, ids: Id[]): SketchData {
  const kill = new Set(ids);
  const entities = data.entities.filter((e) => !kill.has(e.id));
  const view = new SketchView({ ...data, entities });
  const used = new Set<Id>();
  for (const e of entities) for (const p of view.entityPoints(e)) used.add(p);
  // Stand-alone points that were explicitly deleted go; others survive only if used.
  const points = data.points.filter((p) => used.has(p.id) && !kill.has(p.id));
  const alive = new Set<Id>([...points.map((p) => p.id), ...entities.map((e) => e.id)]);
  const constraints = data.constraints.filter((c) => !kill.has(c.id) && c.refs.every((r) => alive.has(r)));
  return { points, entities, constraints };
}

export function addConstraint(data: SketchData, c: Omit<SketchConstraint, "id">): SketchData {
  return { ...data, constraints: [...data.constraints, { ...c, id: newId("k") }] };
}

export function newPoint(x: number, y: number): SketchPoint {
  return { id: newId("p"), x, y };
}

export const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function lineLength(v: SketchView, e: Extract<SketchEntity, { type: "line" }>) {
  return dist(v.p(e.p1), v.p(e.p2));
}

/** Distance from p to segment ab. */
export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return dist(p, [a[0] + t * dx, a[1] + t * dy]);
}

export function distToEntity(v: SketchView, e: SketchEntity, p: Vec2): number {
  if (e.type === "line") return distToSegment(p, v.p(e.p1), v.p(e.p2));
  const c = v.p(e.c);
  const radial = Math.abs(dist(p, c) - e.r);
  if (e.type === "circle") return radial;
  const { a0, a1 } = arcAngles(v, e);
  let a = Math.atan2(p[1] - c[1], p[0] - c[0]);
  while (a < a0) a += Math.PI * 2;
  if (a <= a1) return radial;
  return Math.min(dist(p, v.p(e.start)), dist(p, v.p(e.end)));
}
