// Pointer handling for sketch mode. Turns clicks on the sketch plane into
// solved sketch edits via store.commitSketch (one command per edit).

import { newId } from "../core/ids";
import { applyAddition, circumcentre, rectangleAdd } from "../core/sketch/builders";
import { arcAngles, deleteFromSketch, dist, distToEntity, SketchView } from "../core/sketch/model";
import { dimensionFor } from "../core/sketch/rules";
import type { Id, SketchConstraint, SketchData, SketchEntity, SketchPoint, Vec2 } from "../core/types";
import { L } from "../app/i18n";
import { activeSketch, commitSketch, useApp, type SketchTool } from "../app/store";
import type { CadScene } from "./scene";

interface Snap {
  p: Vec2;
  pointId?: Id;
  kind: "point" | "origin" | "grid" | "free";
}

export interface LiveLabel {
  at: Vec2;
  text: string;
}

const SNAP_PX = 10;
const PICK_PX = 7;
const HV_DEG = 3;

export class SketchController {
  private clicks: Snap[] = [];
  private hoverSnap: Snap | null = null;
  private drag: { ids: Id[]; offsets: Vec2[]; start: Vec2; key: string; moved: boolean } | null = null;
  hoverPoint: Id | null = null;
  hoverEntity: Id | null = null;
  live: LiveLabel | null = null;
  /** Dimension just created and awaiting a typed value. */
  pendingDim: Id | null = null;
  onRedraw: () => void = () => {};

  constructor(private scene: CadScene) {}

  get tool(): SketchTool {
    return useApp.getState().tool;
  }

  reset() {
    this.clicks = [];
    this.live = null;
    this.drag = null;
    this.scene.setPreview([], [], []);
    this.onRedraw();
  }

  /* ───────── hit testing ───────── */

  private data(): SketchData | null {
    return activeSketch()?.sketch ?? null;
  }

  pick(p: Vec2): { point?: Id; entity?: Id } {
    const d = this.data();
    if (!d) return {};
    const upp = this.scene.unitsPerPx(p);
    let best: Id | undefined;
    let bd = PICK_PX * upp;
    for (const pt of d.points) {
      const dd = dist(p, [pt.x, pt.y]);
      if (dd < bd) {
        bd = dd;
        best = pt.id;
      }
    }
    if (best) return { point: best };
    const v = new SketchView(d);
    let be: Id | undefined;
    let bde = PICK_PX * upp;
    for (const e of d.entities) {
      try {
        const dd = distToEntity(v, e, p);
        if (dd < bde) {
          bde = dd;
          be = e.id;
        }
      } catch {
        /* skip */
      }
    }
    return be ? { entity: be } : {};
  }

  private snap(p: Vec2, exclude: Set<Id> = new Set()): Snap {
    const d = this.data();
    const upp = this.scene.unitsPerPx(p);
    let best: Snap | null = null;
    let bd = SNAP_PX * upp;
    for (const pt of d?.points ?? []) {
      if (exclude.has(pt.id)) continue;
      const dd = dist(p, [pt.x, pt.y]);
      if (dd < bd) {
        bd = dd;
        best = { p: [pt.x, pt.y], pointId: pt.id, kind: "point" };
      }
    }
    if (best) return best;
    if (dist(p, [0, 0]) < SNAP_PX * upp) return { p: [0, 0], kind: "origin" };
    if (gridSnapOn()) {
      const step = gridStep(upp);
      const g: Vec2 = [Math.round(p[0] / step) * step, Math.round(p[1] / step) * step];
      if (dist(g, p) < SNAP_PX * upp * 0.8) return { p: g, kind: "grid" };
    }
    return { p, kind: "free" };
  }

  /* ───────── pointer events (sketch-local coordinates) ───────── */

  down(p: Vec2, ev: { shiftKey: boolean; button: number; detail: number }) {
    if (ev.button !== 0) return;
    const tool = this.tool;
    if (tool === "select") return this.selectDown(p, ev.shiftKey);
    if (tool === "dimension") return this.dimensionClick(p, ev.shiftKey);
    const s = this.snap(p);
    if (tool === "line") return this.lineClick(s, ev.detail >= 2);
    if (tool === "rect") return this.rectClick(s);
    if (tool === "circle") return this.circleClick(s);
    if (tool === "arc") return this.arcClick(s);
  }

  move(p: Vec2, buttons: number) {
    if (this.drag && buttons & 1) return this.dragMove(p);
    const tool = this.tool;
    if (tool === "select" || tool === "dimension") {
      const h = this.pick(p);
      if (h.point !== this.hoverPoint || h.entity !== this.hoverEntity) {
        this.hoverPoint = h.point ?? null;
        this.hoverEntity = h.entity ?? null;
        this.onRedraw();
      }
      return;
    }
    const exclude = new Set<Id>();
    this.hoverSnap = this.snap(p, exclude);
    this.updatePreview();
  }

  up() {
    if (this.drag) {
      this.drag = null;
      this.onRedraw();
    }
  }

  /** Esc: finish the current chain / cancel the shape in progress. */
  cancel(): boolean {
    if (this.clicks.length || this.live) {
      this.reset();
      return true;
    }
    return false;
  }

  /* ───────── select & drag ───────── */

  private selectDown(p: Vec2, shift: boolean) {
    const h = this.pick(p);
    const sel = useApp.getState().selection;
    const cur = sel.kind === "sketch" ? sel : { kind: "sketch" as const, points: [], entities: [], constraints: [] };
    if (!h.point && !h.entity) {
      if (!shift) useApp.setState({ selection: { kind: "sketch", points: [], entities: [], constraints: [] } });
      return;
    }
    const toggle = (arr: Id[], id: Id) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
    let next = cur;
    if (shift) {
      next = h.point ? { ...cur, points: toggle(cur.points, h.point) } : { ...cur, entities: toggle(cur.entities, h.entity!) };
    } else {
      const already = h.point ? cur.points.includes(h.point) : cur.entities.includes(h.entity!);
      if (!already) next = { kind: "sketch", points: h.point ? [h.point] : [], entities: h.entity ? [h.entity] : [], constraints: [] };
    }
    useApp.setState({ selection: next });
    // start a drag on what was clicked
    const d = this.data()!;
    const v = new SketchView(d);
    const ids = h.point ? [h.point] : dragPointsOf(v.ents.get(h.entity!)!);
    this.drag = { ids, offsets: ids.map((id) => sub(v.p(id), p)), start: p, key: `drag:${newId()}`, moved: false };
  }

  private dragMove(p: Vec2) {
    const dr = this.drag!;
    if (!dr.moved && dist(p, dr.start) < 3 * this.scene.unitsPerPx(p)) return;
    dr.moved = true;
    const d = this.data();
    if (!d) return;
    commitSketch(d, L("Drag", "Перетаскивание"), {
      mergeKey: dr.key,
      drag: dr.ids.map((id, i) => ({ pointId: id, to: add(p, dr.offsets[i]!) })),
    });
  }

  /* ───────── drawing tools ───────── */

  private construction() {
    return useApp.getState().construction;
  }

  private lineClick(s: Snap, dbl: boolean) {
    if (dbl) return this.reset();
    if (this.clicks.length === 0) {
      this.clicks = [s];
      this.updatePreview();
      return;
    }
    const a = this.clicks[0]!;
    const b = this.hvAdjust(a.p, s);
    if (dist(a.p, b.p) < 1e-6) return;
    const d = this.data()!;
    const { data, endId } = addLine(d, a, b, this.construction());
    if (commitSketch(data, L("Line", "Линия"))) {
      // continue the chain from the new end point
      const sk = this.data()!;
      const end = sk.points.find((x) => x.id === endId);
      this.clicks = [{ p: end ? [end.x, end.y] : b.p, pointId: endId, kind: "point" }];
    }
    this.updatePreview();
  }

  /** Snap the end of a line to horizontal/vertical when close. */
  private hvAdjust(a: Vec2, s: Snap): Snap & { hv?: "horizontal" | "vertical" } {
    if (s.kind === "point" || s.kind === "origin") {
      return s;
    }
    const dx = s.p[0] - a[0];
    const dy = s.p[1] - a[1];
    const ang = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
    if (Math.min(ang, 180 - ang) < HV_DEG) return { ...s, p: [s.p[0], a[1]], hv: "horizontal" };
    if (Math.abs(ang - 90) < HV_DEG) return { ...s, p: [a[0], s.p[1]], hv: "vertical" };
    return s;
  }

  private rectClick(s: Snap) {
    if (this.clicks.length === 0) {
      this.clicks = [s];
      return this.updatePreview();
    }
    const a = this.clicks[0]!;
    if (Math.abs(a.p[0] - s.p[0]) < 1e-6 || Math.abs(a.p[1] - s.p[1]) < 1e-6) return;
    const add_ = rectangleAdd(a.p, s.p, this.construction());
    const extra: SketchConstraint[] = [];
    // corner points: side i starts at sidePts[2i]; corner 0 = a, corner 2 = s
    const c0 = add_.points[0]!.id;
    const c2 = add_.points[4]!.id;
    const pin = (snap: Snap, id: Id) => {
      if (snap.pointId) extra.push({ id: newId("k"), type: "coincident", refs: [id, snap.pointId] });
      else if (snap.kind === "origin") extra.push({ id: newId("k"), type: "fix", refs: [id] });
    };
    pin(a, c0);
    pin(s, c2);
    commitSketch(applyAddition(this.data()!, add_, extra), L("Rectangle", "Прямоугольник"));
    this.reset();
  }

  private circleClick(s: Snap) {
    if (this.clicks.length === 0) {
      this.clicks = [s];
      return this.updatePreview();
    }
    const c = this.clicks[0]!;
    const r = dist(c.p, s.p);
    if (r < 1e-6) return;
    const d = this.data()!;
    const { points, centreId } = ensurePoint(d.points, c);
    const ent: SketchEntity = { id: newId("e"), type: "circle", c: centreId, r, ...(this.construction() ? { construction: true } : {}) };
    const cons: SketchConstraint[] = c.kind === "origin" ? [{ id: newId("k"), type: "fix", refs: [centreId] }] : [];
    commitSketch({ points, entities: [...d.entities, ent], constraints: [...d.constraints, ...cons] }, L("Circle", "Окружность"));
    this.reset();
  }

  private arcClick(s: Snap) {
    this.clicks.push(s);
    if (this.clicks.length < 3) return this.updatePreview();
    const [a, b, m] = this.clicks as [Snap, Snap, Snap];
    const c = circumcentre(a.p, m.p, b.p);
    if (!c) {
      this.clicks.pop();
      return;
    }
    const d = this.data()!;
    // CCW from start to end: if a→m→b turns clockwise, swap ends
    const cross = (m.p[0] - a.p[0]) * (b.p[1] - a.p[1]) - (m.p[1] - a.p[1]) * (b.p[0] - a.p[0]);
    const [s0, s1] = cross < 0 ? [a, b] : [b, a];
    let pts = d.points;
    const e1 = ensurePoint(pts, s0);
    pts = e1.points;
    const e2 = ensurePoint(pts, s1);
    pts = e2.points;
    const cp: SketchPoint = { id: newId("p"), x: c[0], y: c[1] };
    pts = [...pts, cp];
    const r = dist(c, a.p);
    const ent: SketchEntity = { id: newId("e"), type: "arc", c: cp.id, start: e1.centreId, end: e2.centreId, r, ...(this.construction() ? { construction: true } : {}) };
    commitSketch({ points: pts, entities: [...d.entities, ent], constraints: d.constraints }, L("Arc", "Дуга"));
    this.reset();
  }

  private dimensionClick(p: Vec2, _shift: boolean) {
    const h = this.pick(p);
    const sel = useApp.getState().selection;
    const cur = sel.kind === "sketch" ? sel : { kind: "sketch" as const, points: [], entities: [], constraints: [] };
    if (!h.point && !h.entity) {
      useApp.setState({ selection: { kind: "sketch", points: [], entities: [], constraints: [] } });
      return;
    }
    // A lone selected point waits for a second pick (point → distance, line → point-to-line).
    const pairing = cur.points.length === 1 && cur.entities.length === 0 && (h.point ? h.point !== cur.points[0] : true);
    const picked = {
      points: pairing ? [...cur.points, ...(h.point ? [h.point] : [])] : h.point ? [h.point] : [],
      entities: h.entity ? [h.entity] : [],
    };
    const d = this.data()!;
    // A single point waits for a second pick; a single entity dimensions immediately.
    if (picked.points.length === 1 && picked.entities.length === 0) {
      useApp.setState({ selection: { kind: "sketch", points: picked.points, entities: [], constraints: [] } });
      return;
    }
    const dim = dimensionFor(picked, d);
    if (!dim) {
      useApp.setState({ selection: { kind: "sketch", points: h.point ? [h.point] : [], entities: h.entity ? [h.entity] : [], constraints: [] } });
      return;
    }
    if (commitSketch({ ...d, constraints: [...d.constraints, dim] }, L("Dimension", "Размер"))) {
      this.pendingDim = dim.id;
      useApp.setState({ selection: { kind: "sketch", points: [], entities: [], constraints: [dim.id] } });
    } else {
      useApp.setState({ selection: { kind: "sketch", points: [], entities: [], constraints: [] } });
    }
    this.onRedraw();
  }

  /* ───────── preview ───────── */

  private updatePreview() {
    const tool = this.tool;
    const h = this.hoverSnap;
    const segs: { a: Vec2; b: Vec2 }[] = [];
    const arcs: { c: Vec2; r: number; a0: number; a1: number }[] = [];
    const pts: Vec2[] = [];
    this.live = null;
    if (h && (h.kind === "point" || h.kind === "origin")) pts.push(h.p);
    const a = this.clicks[0];
    if (a && h) {
      if (tool === "line") {
        const b = this.hvAdjust(a.p, h);
        segs.push({ a: a.p, b: b.p });
        this.live = { at: mid(a.p, b.p), text: fmtLen(dist(a.p, b.p)) + (b.hv ? (b.hv === "horizontal" ? "  H" : "  V") : "") };
      } else if (tool === "rect") {
        const b = h.p;
        segs.push({ a: a.p, b: [b[0], a.p[1]] }, { a: [b[0], a.p[1]], b }, { a: b, b: [a.p[0], b[1]] }, { a: [a.p[0], b[1]], b: a.p });
        this.live = { at: mid(a.p, b), text: `${fmtNum(Math.abs(b[0] - a.p[0]))} × ${fmtNum(Math.abs(b[1] - a.p[1]))}` };
      } else if (tool === "circle") {
        const r = dist(a.p, h.p);
        arcs.push({ c: a.p, r, a0: 0, a1: Math.PI * 2 });
        segs.push({ a: a.p, b: h.p });
        this.live = { at: h.p, text: "⌀ " + fmtLen(r * 2) };
      } else if (tool === "arc") {
        if (this.clicks.length === 1) {
          segs.push({ a: a.p, b: h.p });
        } else {
          const b = this.clicks[1]!;
          const c = circumcentre(a.p, h.p, b.p);
          if (c) {
            const r = dist(c, a.p);
            const cross = (h.p[0] - a.p[0]) * (b.p[1] - a.p[1]) - (h.p[1] - a.p[1]) * (b.p[0] - a.p[0]);
            const [s, e] = cross < 0 ? [a.p, b.p] : [b.p, a.p];
            const a0 = Math.atan2(s[1] - c[1], s[0] - c[0]);
            let a1 = Math.atan2(e[1] - c[1], e[0] - c[0]);
            while (a1 <= a0) a1 += Math.PI * 2;
            arcs.push({ c, r, a0, a1 });
            this.live = { at: h.p, text: "R " + fmtLen(r) };
          }
        }
      }
      pts.push(...this.clicks.map((c) => c.p));
    }
    this.scene.setPreview(segs, arcs, pts);
    this.onRedraw();
  }

  /* ───────── keyboard ───────── */

  deleteSelection(): boolean {
    const sel = useApp.getState().selection;
    const d = this.data();
    if (!d || sel.kind !== "sketch") return false;
    if (!sel.points.length && !sel.entities.length && !sel.constraints.length) return false;
    const v = new SketchView(d);
    // a selected point removes the entities that use it
    const ents = new Set(sel.entities);
    for (const e of d.entities) if (v.entityPoints(e).some((p) => sel.points.includes(p))) ents.add(e.id);
    const next = deleteFromSketch(d, [...ents, ...sel.points, ...sel.constraints]);
    commitSketch(next, L("Delete", "Удалить"));
    useApp.setState({ selection: { kind: "sketch", points: [], entities: [], constraints: [] } });
    return true;
  }
}

/* ───────── helpers ───────── */

function gridSnapOn() {
  try {
    return localStorage.getItem("cocoacad.gridSnap") !== "false";
  } catch {
    return true;
  }
}

/** Snap step matched to the visible grid density (~12 px). */
export function gridStep(upp: number) {
  const raw = upp * 12;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
}

function ensurePoint(points: SketchPoint[], s: Snap): { points: SketchPoint[]; centreId: Id } {
  if (s.pointId) return { points, centreId: s.pointId };
  const p: SketchPoint = { id: newId("p"), x: s.p[0], y: s.p[1] };
  return { points: [...points, p], centreId: p.id };
}

function addLine(d: SketchData, a: Snap, b: Snap & { hv?: "horizontal" | "vertical" }, construction: boolean) {
  let pts = d.points;
  const e1 = ensurePoint(pts, a);
  pts = e1.points;
  const e2 = ensurePoint(pts, b);
  pts = e2.points;
  const line: SketchEntity = { id: newId("e"), type: "line", p1: e1.centreId, p2: e2.centreId, ...(construction ? { construction: true } : {}) };
  const cons: SketchConstraint[] = [];
  if (b.hv) cons.push({ id: newId("k"), type: b.hv, refs: [line.id] });
  for (const [s, id] of [[a, e1.centreId], [b, e2.centreId]] as const)
    if (s.kind === "origin" && !d.constraints.some((c) => c.type === "fix" && c.refs[0] === id)) cons.push({ id: newId("k"), type: "fix", refs: [id] });
  return { data: { points: pts, entities: [...d.entities, line], constraints: [...d.constraints, ...cons] }, endId: e2.centreId };
}

function dragPointsOf(e: SketchEntity): Id[] {
  if (e.type === "line") return [e.p1, e.p2];
  if (e.type === "circle") return [e.c];
  return [e.c, e.start, e.end];
}

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const mid = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const fmtNum = (v: number) => Number(v.toFixed(2)).toString();
const fmtLen = (v: number) => `${fmtNum(v)} mm`;

export { arcAngles };
