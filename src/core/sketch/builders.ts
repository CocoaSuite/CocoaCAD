// Entity builders used by the sketch tools. Each returns the data to append
// plus the auto-constraints a user would expect (rectangle corners, H/V sides).

import { newId } from "../ids";
import type { SketchConstraint, SketchData, SketchEntity, SketchPoint, Vec2 } from "../types";

export interface Addition {
  points: SketchPoint[];
  entities: SketchEntity[];
  constraints: SketchConstraint[];
}

const pt = (p: Vec2): SketchPoint => ({ id: newId("p"), x: p[0], y: p[1] });
const k = (type: SketchConstraint["type"], refs: string[], value?: number): SketchConstraint =>
  value === undefined ? { id: newId("k"), type, refs } : { id: newId("k"), type, refs, value };

export function lineAdd(a: Vec2, b: Vec2, construction = false): Addition {
  const p1 = pt(a);
  const p2 = pt(b);
  const line: SketchEntity = { id: newId("e"), type: "line", p1: p1.id, p2: p2.id, ...(construction ? { construction } : {}) };
  return { points: [p1, p2], entities: [line], constraints: [] };
}

export function rectangleAdd(a: Vec2, b: Vec2, construction = false): Addition {
  const corners: Vec2[] = [
    [a[0], a[1]],
    [b[0], a[1]],
    [b[0], b[1]],
    [a[0], b[1]],
  ];
  const pts = corners.map(pt);
  const ents: SketchEntity[] = [];
  const cons: SketchConstraint[] = [];
  // each side owns its own two points; corners are joined by coincident constraints
  const sidePts: SketchPoint[] = [];
  for (let i = 0; i < 4; i++) {
    const s = { ...pts[i]!, id: newId("p") };
    const e = { ...pts[(i + 1) % 4]!, id: newId("p") };
    sidePts.push(s, e);
    ents.push({ id: newId("e"), type: "line", p1: s.id, p2: e.id, ...(construction ? { construction } : {}) });
  }
  for (let i = 0; i < 4; i++) cons.push(k("coincident", [sidePts[i * 2 + 1]!.id, sidePts[((i + 1) % 4) * 2]!.id]));
  cons.push(k("horizontal", [ents[0]!.id]), k("horizontal", [ents[2]!.id]));
  cons.push(k("vertical", [ents[1]!.id]), k("vertical", [ents[3]!.id]));
  return { points: sidePts, entities: ents, constraints: cons };
}

export function circleAdd(c: Vec2, r: number, construction = false): Addition {
  const cp = pt(c);
  return {
    points: [cp],
    entities: [{ id: newId("e"), type: "circle", c: cp.id, r, ...(construction ? { construction } : {}) }],
    constraints: [],
  };
}

/** Arc through three points (start, a point on the arc, end). Returns null if collinear. */
export function arc3Add(s: Vec2, m: Vec2, e: Vec2, construction = false): Addition | null {
  const c = circumcentre(s, m, e);
  if (!c) return null;
  const r = Math.hypot(s[0] - c[0], s[1] - c[1]);
  // orientation: our arcs run CCW start→end; swap if the 3 points are clockwise
  const cross = (m[0] - s[0]) * (e[1] - s[1]) - (m[1] - s[1]) * (e[0] - s[0]);
  const [a, b] = cross > 0 ? [s, e] : [e, s];
  const cp = pt(c);
  const sp = pt(a);
  const ep = pt(b);
  return {
    points: [cp, sp, ep],
    entities: [{ id: newId("e"), type: "arc", c: cp.id, start: sp.id, end: ep.id, r, ...(construction ? { construction } : {}) }],
    constraints: [],
  };
}

export function circumcentre(a: Vec2, b: Vec2, c: Vec2): Vec2 | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a[0] ** 2 + a[1] ** 2;
  const b2 = b[0] ** 2 + b[1] ** 2;
  const c2 = c[0] ** 2 + c[1] ** 2;
  return [(a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d, (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d];
}

export function applyAddition(data: SketchData, add: Addition, extra: SketchConstraint[] = []): SketchData {
  return {
    points: [...data.points, ...add.points],
    entities: [...data.entities, ...add.entities],
    constraints: [...data.constraints, ...add.constraints, ...extra],
  };
}
