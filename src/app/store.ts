// UI state (Zustand). The CAD document itself is plain data mutated only
// through commands; this store wires commands, solver and kernel together.

import { create } from "zustand";
import {
  CommandStack,
  addFeature,
  composite,
  moveFeature,
  removeFeatures,
  renameDocument,
  updateBody,
  updateFeature,
  type Command,
  type Label,
} from "../core/commands";
import { BODY_COLORS, createDocument, nextName } from "../core/document";
import { dependentsOf, liveBodiesAt, validateReferences } from "../core/graph";
import { newId } from "../core/ids";
import { emptySketch } from "../core/sketch/model";
import type { ConstraintSolver, DragTarget } from "../core/sketch/solver";
import type {
  BodyMeta,
  CadDocument,
  EdgeFinishFeature,
  ExtrudeFeature,
  Feature,
  Id,
  OriginPlane,
  RevolveFeature,
  SketchData,
  SketchFeature,
  BooleanFeature,
} from "../core/types";
import type { BodyMesh, KernelProblem } from "../kernel/protocol";
import { detectLang, L, pick, type Lang } from "./i18n";
import { setPref } from "./storage";

export type SketchTool = "select" | "line" | "rect" | "circle" | "arc" | "dimension";

export type Selection =
  | { kind: "none" }
  | { kind: "plane"; plane: OriginPlane }
  | { kind: "feature"; ids: Id[] }
  | { kind: "body"; id: Id }
  | { kind: "sketch"; points: Id[]; entities: Id[]; constraints: Id[] };

export interface SketchStatus {
  dof: number;
  status: "ok" | "failed" | "conflicting" | "redundant";
  conflicting: Id[];
  redundant: Id[];
}

export interface Toast {
  id: number;
  text: string;
  bad?: boolean;
}

interface State {
  doc: CadDocument;
  /** Bumps on every command so components can show undo/redo state. */
  rev: number;
  lang: Lang;
  mode: { kind: "part" } | { kind: "sketch"; featureId: Id };
  tool: SketchTool;
  construction: boolean;
  selection: Selection;
  /** Feature open in the properties panel. */
  editing: Id | null;
  /** Fillet/chamfer currently picking edges (geometry is shown rolled back to before it). */
  pickingEdges: Id | null;

  bodies: BodyMesh[];
  problems: KernelProblem[];
  rebuilding: boolean;
  /** The feature list (by reference) the current geometry was built from. */
  builtFrom: Feature[] | null;
  kernelReady: boolean;
  kernelError: string | null;
  lastRebuildMs: number;

  sketchStatus: SketchStatus | null;
  solverReady: boolean;

  dialog: null | "settings" | "shortcuts" | "about" | "start";
  toasts: Toast[];
  ortho: boolean;
  viewRequest: { view: ViewName; n: number } | null;
}

export type ViewName = "iso" | "top" | "front" | "right" | "bottom" | "back" | "left" | "fit" | "normal";

const stack = new CommandStack();
let solver: ConstraintSolver | null = null;
let toastSeq = 0;

export const useApp = create<State>(() => ({
  doc: createDocument(),
  rev: 0,
  lang: detectLang(),
  mode: { kind: "part" },
  tool: "select",
  construction: false,
  selection: { kind: "none" },
  editing: null,
  pickingEdges: null,
  bodies: [],
  problems: [],
  rebuilding: false,
  builtFrom: null,
  kernelReady: false,
  kernelError: null,
  lastRebuildMs: 0,
  sketchStatus: null,
  solverReady: false,
  dialog: "start",
  toasts: [],
  ortho: false,
  viewRequest: null,
}));

const set = useApp.setState;
const get = useApp.getState;

/** True once the geometry shown matches the current document. */
export const isUpToDate = (s: { builtFrom: Feature[] | null; doc: CadDocument; rebuilding: boolean }) => !s.rebuilding && s.builtFrom === s.doc.features;

export const t = (en: string, ru: string) => (get().lang === "ru" ? ru : en);

/* ───────── setup ───────── */

export function setSolver(s: ConstraintSolver) {
  solver = s;
  set({ solverReady: true });
}

export function setLang(lang: Lang) {
  setPref("lang", lang);
  document.documentElement.lang = lang;
  set({ lang });
}

export function toast(text: string, bad = false) {
  const id = ++toastSeq;
  set((s) => ({ toasts: [...s.toasts, { id, text, bad }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), bad ? 5200 : 2600);
}

export function requestView(view: ViewName) {
  set((s) => ({ viewRequest: { view, n: (s.viewRequest?.n ?? 0) + 1 } }));
}

/* ───────── commands ───────── */

export function exec(cmd: Command) {
  set((s) => ({ doc: stack.exec(s.doc, cmd), rev: s.rev + 1 }));
  afterDocChange();
}

export function undo() {
  const d = stack.undo(get().doc);
  if (!d) return;
  set((s) => ({ doc: d, rev: s.rev + 1 }));
  afterDocChange();
}

export function redo() {
  const d = stack.redo(get().doc);
  if (!d) return;
  set((s) => ({ doc: d, rev: s.rev + 1 }));
  afterDocChange();
}

export const undoState = () => ({
  canUndo: stack.canUndo,
  canRedo: stack.canRedo,
  undoLabel: stack.undoLabel,
  redoLabel: stack.redoLabel,
});

/** Keep UI state consistent with the document after any change (incl. undo). */
function afterDocChange() {
  const { doc, mode, editing, selection, pickingEdges } = get();
  const has = (id: Id) => doc.features.some((f) => f.id === id);
  const patch: Partial<State> = {};
  if (mode.kind === "sketch" && !has(mode.featureId)) {
    patch.mode = { kind: "part" };
    patch.sketchStatus = null;
  }
  if (editing && !has(editing)) patch.editing = null;
  if (pickingEdges && !has(pickingEdges)) patch.pickingEdges = null;
  if (selection.kind === "feature" && !selection.ids.every(has)) patch.selection = { kind: "none" };
  if (selection.kind === "body" && !doc.bodies[selection.id]) patch.selection = { kind: "none" };
  if (selection.kind === "sketch" && mode.kind === "sketch") {
    const sk = doc.features.find((f) => f.id === mode.featureId) as SketchFeature | undefined;
    if (sk) {
      const pts = new Set(sk.sketch.points.map((p) => p.id));
      const ents = new Set(sk.sketch.entities.map((e) => e.id));
      const cons = new Set(sk.sketch.constraints.map((c) => c.id));
      patch.selection = {
        kind: "sketch",
        points: selection.points.filter((p) => pts.has(p)),
        entities: selection.entities.filter((e) => ents.has(e)),
        constraints: selection.constraints.filter((c) => cons.has(c)),
      };
    }
  }
  if (Object.keys(patch).length) set(patch);
  if (get().mode.kind === "sketch") refreshSketchStatus();
}

export function featureById<F extends Feature = Feature>(id: Id): F | undefined {
  return get().doc.features.find((f) => f.id === id) as F | undefined;
}

/* ───────── document lifecycle ───────── */

export function loadDocument(doc: CadDocument) {
  stack.clear();
  set((s) => ({
    doc,
    rev: s.rev + 1,
    mode: { kind: "part" },
    selection: { kind: "none" },
    editing: null,
    pickingEdges: null,
    sketchStatus: null,
    bodies: [],
    problems: [],
    builtFrom: null,
    dialog: null,
  }));
  requestView("fit");
}

export function newDocument() {
  loadDocument(createDocument(t("Untitled part", "Новая деталь")));
}

export function renameDoc(name: string) {
  const before = get().doc.name;
  if (name.trim() && name !== before) exec(renameDocument(before, name.trim()));
}

/* ───────── features ───────── */

const names = () => get().doc.features.map((f) => f.name);

export function startSketch(plane: OriginPlane) {
  const f: SketchFeature = {
    id: newId("s"),
    type: "sketch",
    name: nextName(names(), "sketch", get().lang),
    plane: { base: plane, offset: 0 },
    sketch: emptySketch(),
  };
  exec(addFeature(f, { label: L("New sketch", "Новый эскиз") }));
  enterSketch(f.id);
}

export function enterSketch(id: Id) {
  set({ mode: { kind: "sketch", featureId: id }, tool: "line", selection: { kind: "sketch", points: [], entities: [], constraints: [] }, editing: null, pickingEdges: null });
  refreshSketchStatus();
  requestView("normal");
}

export function finishSketch() {
  const m = get().mode;
  set({ mode: { kind: "part" }, tool: "select", sketchStatus: null, selection: m.kind === "sketch" ? { kind: "feature", ids: [m.featureId] } : { kind: "none" } });
}

export function activeSketch(): SketchFeature | null {
  const m = get().mode;
  return m.kind === "sketch" ? (featureById<SketchFeature>(m.featureId) ?? null) : null;
}

function refreshSketchStatus() {
  const sk = activeSketch();
  if (!sk || !solver) return set({ sketchStatus: null });
  const r = solver.solve(sk.sketch);
  set({ sketchStatus: { dof: r.dof, status: r.status, conflicting: r.conflicting, redundant: r.redundant } });
}

/**
 * Commit an edit to the active sketch: solve, then record one command.
 * Rejects edits that over-constrain the sketch, keeping the previous state.
 */
export function commitSketch(next: SketchData, label: Label, opts: { mergeKey?: string; drag?: DragTarget[] } = {}): boolean {
  const sk = activeSketch();
  if (!sk) return false;
  let data = next;
  if (solver) {
    const r = solver.solve(next, opts.drag);
    if (r.status === "conflicting" || r.status === "failed") {
      if (!opts.drag)
        toast(
          r.status === "conflicting"
            ? t("That would over-constrain the sketch, so it was not applied.", "Это переопределит эскиз, изменение не применено.")
            : t("The sketch could not be solved with that change.", "С этим изменением эскиз не решается."),
          true,
        );
      return false;
    }
    data = r.data;
    set({ sketchStatus: { dof: r.dof, status: r.status, conflicting: r.conflicting, redundant: r.redundant } });
  }
  exec(updateFeature(sk, { ...sk, sketch: data }, label, opts.mergeKey));
  return true;
}

/** Most recent sketch, preferring the selected one. */
function targetSketch(): SketchFeature | undefined {
  const { selection, doc } = get();
  if (selection.kind === "feature") {
    const f = doc.features.find((x) => x.id === selection.ids[0]);
    if (f?.type === "sketch") return f;
  }
  return [...doc.features].reverse().find((f): f is SketchFeature => f.type === "sketch");
}

function newBodyMeta(id: Id): BodyMeta {
  const n = Object.keys(get().doc.bodies).length;
  return {
    id,
    name: nextName(Object.values(get().doc.bodies).map((b) => b.name), "body", get().lang),
    color: BODY_COLORS[n % BODY_COLORS.length]!,
    visible: true,
  };
}

export function createExtrude() {
  const sk = targetSketch();
  if (!sk) return toast(t("Draw a sketch first, then extrude it.", "Сначала нарисуйте эскиз, затем выдавите его."), true);
  const f: ExtrudeFeature = {
    id: newId("x"),
    type: "extrude",
    name: nextName(names(), "extrude", get().lang),
    sketchId: sk.id,
    profiles: [],
    distance: 10,
    direction: "normal",
    op: "new",
  };
  exec(addFeature(f, { body: newBodyMeta(f.id), label: L("Extrude", "Выдавливание") }));
  set({ editing: f.id, selection: { kind: "feature", ids: [f.id] } });
}

export function createRevolve() {
  const sk = targetSketch();
  if (!sk) return toast(t("Draw a sketch first, then revolve it.", "Сначала нарисуйте эскиз, затем вращайте его."), true);
  const axisLine = sk.sketch.entities.find((e) => e.type === "line" && e.construction);
  const f: RevolveFeature = {
    id: newId("r"),
    type: "revolve",
    name: nextName(names(), "revolve", get().lang),
    sketchId: sk.id,
    profiles: [],
    axis: axisLine ? { kind: "sketchLine", lineId: axisLine.id } : { kind: "sketchAxis", axis: "y" },
    angle: 360,
    op: "new",
  };
  exec(addFeature(f, { body: newBodyMeta(f.id), label: L("Revolve", "Вращение") }));
  set({ editing: f.id, selection: { kind: "feature", ids: [f.id] } });
}

export function createBoolean() {
  const live = liveBodiesAt(get().doc);
  if (live.length < 2) return toast(t("A Boolean needs at least two bodies.", "Для булевой операции нужно минимум два тела."), true);
  const sel = get().selection;
  const target = sel.kind === "body" ? sel.id : live[0]!;
  const f: BooleanFeature = {
    id: newId("b"),
    type: "boolean",
    name: nextName(names(), "boolean", get().lang),
    op: "union",
    target,
    tools: [live.find((b) => b !== target)!],
    keepTools: false,
  };
  exec(addFeature(f, { label: L("Boolean", "Булева операция") }));
  set({ editing: f.id, selection: { kind: "feature", ids: [f.id] } });
}

export function createEdgeFinish(kind: "fillet" | "chamfer") {
  const live = liveBodiesAt(get().doc);
  if (live.length === 0) return toast(t("Create a solid first.", "Сначала создайте тело."), true);
  const sel = get().selection;
  const body = sel.kind === "body" ? sel.id : live[live.length - 1]!;
  const f: EdgeFinishFeature = {
    id: newId(kind === "fillet" ? "f" : "c"),
    type: kind,
    name: nextName(names(), kind, get().lang),
    body,
    edges: [],
    size: 1,
  };
  exec(addFeature(f, { label: kind === "fillet" ? L("Fillet", "Скругление") : L("Chamfer", "Фаска") }));
  set({ editing: f.id, pickingEdges: f.id, selection: { kind: "feature", ids: [f.id] } });
}

export function editFeature<F extends Feature>(before: F, after: F, mergeKey?: string) {
  exec(updateFeature(before, after, L(`Edit ${after.name}`, `Изменить «${after.name}»`), mergeKey));
}

export function deleteFeatures(ids: Id[]) {
  const doc = get().doc;
  const deps = dependentsOf(doc, ids);
  if (deps.length)
    toast(
      t(
        `${deps.length} later feature(s) depend on this and are now flagged.`,
        `От этого зависят элементы (${deps.length}), они помечены.`,
      ),
    );
  exec(removeFeatures(doc, ids, L("Delete", "Удалить")));
  set({ selection: { kind: "none" } });
}

export function toggleSuppress(id: Id) {
  const f = featureById(id);
  if (!f) return;
  exec(updateFeature(f, { ...f, suppressed: !f.suppressed }, f.suppressed ? L("Unsuppress", "Включить") : L("Suppress", "Подавить")));
}

export function renameFeature(id: Id, name: string) {
  const f = featureById(id);
  if (!f || !name.trim() || name === f.name) return;
  exec(updateFeature(f, { ...f, name: name.trim() }, L("Rename", "Переименовать")));
}

export function reorderFeature(id: Id, to: number) {
  const from = get().doc.features.findIndex((f) => f.id === id);
  if (from < 0 || from === to) return;
  const moved = moveFeature(id, from, to).apply(get().doc);
  if (validateReferences(moved).length > validateReferences(get().doc).length)
    return toast(t("It can't move there: a feature it needs would come after it.", "Сюда нельзя: нужный элемент окажется ниже."), true);
  exec(moveFeature(id, from, to));
}

export function setBody(id: Id, patch: Partial<BodyMeta>) {
  const b = get().doc.bodies[id];
  if (b) exec(updateBody(b, { ...b, ...patch }, L("Edit body", "Изменить тело")));
}

export { composite, pick };
