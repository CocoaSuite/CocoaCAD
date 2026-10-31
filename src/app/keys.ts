import {
  activeSketch,
  createBoolean,
  createEdgeFinish,
  createExtrude,
  createRevolve,
  deleteFeatures,
  finishSketch,
  redo,
  requestView,
  startSketch,
  undo,
  useApp,
  type SketchTool,
} from "./store";
import { openFromFile, saveToFile } from "./files";
import { applyConstraint, toggleConstruction } from "../ui/Toolbar";
import type { ConstraintTool } from "../core/sketch/rules";

/** Global shortcuts. `sketchCancel`/`sketchDelete` come from the viewport's controller. */
export function installKeys(hooks: { sketchCancel: () => boolean; sketchDelete: () => boolean }) {
  const onKey = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest("input, textarea, select, [contenteditable]")) return;
    const s = useApp.getState();
    if (s.dialog && s.dialog !== "start") return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();

    if (mod) {
      if (k === "z" && !e.shiftKey) return void (e.preventDefault(), undo());
      if ((k === "z" && e.shiftKey) || k === "y") return void (e.preventDefault(), redo());
      if (k === "s") return void (e.preventDefault(), saveToFile());
      if (k === "o") return void (e.preventDefault(), openFromFile());
      if (k === ",") return void (e.preventDefault(), useApp.setState({ dialog: "settings" }));
      return;
    }
    if (e.altKey) return;
    if (s.dialog) return;

    if (e.key === "?") return useApp.setState({ dialog: "shortcuts" });
    if (k === "o") return useApp.setState({ ortho: !s.ortho });
    if (k === "f" && !e.shiftKey) return requestView("fit");
    const views: Record<string, Parameters<typeof requestView>[0]> = { "0": "iso", "1": "top", "2": "front", "3": "right" };
    if (views[e.key]) return requestView(views[e.key]!);

    if (s.mode.kind === "sketch") {
      if (e.key === "Escape") {
        if (hooks.sketchCancel()) return;
        if (s.tool !== "select") return useApp.setState({ tool: "select" });
        return useApp.setState({ selection: { kind: "sketch", points: [], entities: [], constraints: [] } });
      }
      if (e.key === "Enter") return finishSketch();
      if (e.key === "Delete" || e.key === "Backspace") return void (hooks.sketchDelete() && e.preventDefault());
      if (k === "n") return requestView("normal");
      if (k === "x") return toggleConstruction();
      if (e.shiftKey) {
        const map: Record<string, ConstraintTool> = { h: "horizontal", v: "vertical", i: "coincident", e: "equal", t: "tangent", m: "midpoint", f: "fix" };
        if (map[k] && activeSketch()) return void applyConstraint(map[k]!);
        return;
      }
      const tools: Record<string, SketchTool> = { s: "select", l: "line", r: "rect", c: "circle", a: "arc", d: "dimension" };
      if (tools[k]) {
        hooks.sketchCancel();
        return useApp.setState({ tool: tools[k]! });
      }
      return;
    }

    // part mode
    if (e.key === "Escape") {
      if (s.pickingEdges) return useApp.setState({ pickingEdges: null });
      return useApp.setState({ selection: { kind: "none" }, editing: null });
    }
    if ((e.key === "Delete" || e.key === "Backspace") && s.selection.kind === "feature") return deleteFeatures(s.selection.ids);
    if (e.shiftKey) {
      if (k === "r") return createRevolve();
      if (k === "f") return createEdgeFinish("fillet");
      if (k === "c") return createEdgeFinish("chamfer");
      return;
    }
    if (k === "k") return startSketch(s.selection.kind === "plane" ? s.selection.plane : "XY");
    if (k === "e") return createExtrude();
    if (k === "b") return createBoolean();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
