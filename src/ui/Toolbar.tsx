import { useState } from "react";
import { Icon } from "./icons";
import {
  activeSketch,
  commitSketch,
  createBoolean,
  createEdgeFinish,
  createExtrude,
  createRevolve,
  finishSketch,
  startSketch,
  t,
  toast,
  useApp,
  type SketchTool,
} from "../app/store";
import { L } from "../app/i18n";
import { constraintsFor, type ConstraintTool } from "../core/sketch/rules";
import type { OriginPlane } from "../core/types";

export const SKETCH_TOOLS: { id: SketchTool; icon: string; en: string; ru: string; key: string }[] = [
  { id: "select", icon: "select", en: "Select", ru: "Выбор", key: "S" },
  { id: "line", icon: "line", en: "Line", ru: "Линия", key: "L" },
  { id: "rect", icon: "rect", en: "Rectangle", ru: "Прямоугольник", key: "R" },
  { id: "circle", icon: "circle", en: "Circle", ru: "Окружность", key: "C" },
  { id: "arc", icon: "arc", en: "Arc (3 points)", ru: "Дуга (3 точки)", key: "A" },
  { id: "dimension", icon: "dimension", en: "Dimension", ru: "Размер", key: "D" },
];

export const CONSTRAINT_TOOLS: { id: ConstraintTool; en: string; ru: string; key?: string }[] = [
  { id: "coincident", en: "Coincident", ru: "Совпадение", key: "I" },
  { id: "horizontal", en: "Horizontal", ru: "Горизонтальность", key: "H" },
  { id: "vertical", en: "Vertical", ru: "Вертикальность", key: "V" },
  { id: "parallel", en: "Parallel", ru: "Параллельность" },
  { id: "perpendicular", en: "Perpendicular", ru: "Перпендикулярность" },
  { id: "equal", en: "Equal", ru: "Равенство", key: "E" },
  { id: "tangent", en: "Tangent", ru: "Касание", key: "T" },
  { id: "midpoint", en: "Midpoint", ru: "Середина", key: "M" },
  { id: "fix", en: "Fix", ru: "Фиксация", key: "F" },
];

/** Apply a constraint tool to the current sketch selection. */
export function applyConstraint(id: ConstraintTool): boolean {
  const sk = activeSketch();
  const sel = useApp.getState().selection;
  if (!sk || sel.kind !== "sketch") return false;
  const cons = constraintsFor(id, sel, sk.sketch);
  const meta = CONSTRAINT_TOOLS.find((c) => c.id === id)!;
  if (!cons) {
    toast(t(`${meta.en} doesn't apply to this selection.`, `«${meta.ru}» не подходит для выделения.`), true);
    return false;
  }
  return commitSketch({ ...sk.sketch, constraints: [...sk.sketch.constraints, ...cons] }, L(meta.en, meta.ru));
}

export function toggleConstruction() {
  const sk = activeSketch();
  const sel = useApp.getState().selection;
  if (sk && sel.kind === "sketch" && sel.entities.length) {
    const ids = new Set(sel.entities);
    const allOn = sk.sketch.entities.filter((e) => ids.has(e.id)).every((e) => e.construction);
    commitSketch(
      { ...sk.sketch, entities: sk.sketch.entities.map((e) => (ids.has(e.id) ? { ...e, construction: !allOn } : e)) },
      L("Construction", "Вспомогательная"),
    );
  } else useApp.setState((s) => ({ construction: !s.construction }));
}

export function Toolbar() {
  const mode = useApp((s) => s.mode);
  const tool = useApp((s) => s.tool);
  const construction = useApp((s) => s.construction);
  const selection = useApp((s) => s.selection);
  const doc = useApp((s) => s.doc);
  useApp((s) => s.lang);
  const [planeMenu, setPlaneMenu] = useState(false);

  if (mode.kind === "sketch") {
    const sk = activeSketch();
    const pick = selection.kind === "sketch" ? selection : { points: [], entities: [] };
    return (
      <div id="tbar" role="toolbar" aria-label={t("Sketch tools", "Инструменты эскиза")}>
        {SKETCH_TOOLS.map((x) => (
          <button key={x.id} className={`ic${tool === x.id ? " on" : ""}`} title={`${t(x.en, x.ru)} (${x.key})`} aria-pressed={tool === x.id} onClick={() => useApp.setState({ tool: x.id })}>
            <Icon name={x.icon} />
          </button>
        ))}
        <button className={`ic${construction ? " on" : ""}`} title={t("Construction geometry (X)", "Вспомогательная геометрия (X)")} aria-pressed={construction} onClick={toggleConstruction}>
          <Icon name="construction" />
        </button>
        <span className="vs" />
        {CONSTRAINT_TOOLS.map((c) => {
          const ok = !!sk && !!constraintsFor(c.id, pick, sk.sketch);
          return (
            <button key={c.id} className="ic" disabled={!ok} title={`${t(c.en, c.ru)}${c.key ? ` (Shift+${c.key})` : ""}`} onClick={() => applyConstraint(c.id)}>
              <Icon name={c.id} />
            </button>
          );
        })}
        <span className="vs" />
        <button className="pri lbl" onClick={finishSketch} title={t("Finish sketch (Enter)", "Завершить эскиз (Enter)")}>
          {t("Finish sketch", "Завершить эскиз")}
        </button>
      </div>
    );
  }

  const hasSketch = doc.features.some((f) => f.type === "sketch");
  const startOn = (p: OriginPlane) => {
    setPlaneMenu(false);
    startSketch(p);
  };
  return (
    <div id="tbar" role="toolbar" aria-label={t("Part tools", "Инструменты детали")} style={{ position: "relative" }}>
      <span style={{ position: "relative" }}>
        <button
          className="ic"
          title={t("New sketch (K)", "Новый эскиз (K)")}
          onClick={() => {
            if (selection.kind === "plane") startOn(selection.plane);
            else setPlaneMenu((v) => !v);
          }}
        >
          <Icon name="sketch" />
        </button>
        {planeMenu ? (
          <div className="tpop">
            <div className="dd" role="menu">
              <div className="hint" style={{ padding: "4px 10px" }}>{t("Sketch on…", "Эскиз на…")}</div>
              {(
                [
                  ["XY", t("Top plane (XY)", "Верхняя (XY)")],
                  ["XZ", t("Front plane (XZ)", "Фронтальная (XZ)")],
                  ["YZ", t("Right plane (YZ)", "Правая (YZ)")],
                ] as const
              ).map(([p, label]) => (
                <button key={p} role="menuitem" onClick={() => startOn(p)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </span>
      <span className="vs" />
      <button className="ic" disabled={!hasSketch} title={t("Extrude (E)", "Выдавливание (E)")} onClick={createExtrude}>
        <Icon name="extrude" />
      </button>
      <button className="ic" disabled={!hasSketch} title={t("Revolve (Shift+R)", "Вращение (Shift+R)")} onClick={createRevolve}>
        <Icon name="revolve" />
      </button>
      <span className="vs" />
      <button className="ic" title={t("Boolean: union, subtract, intersect (B)", "Булева операция (B)")} onClick={createBoolean}>
        <Icon name="boolean" />
      </button>
      <button className="ic" title={t("Fillet (Shift+F)", "Скругление (Shift+F)")} onClick={() => createEdgeFinish("fillet")}>
        <Icon name="fillet" />
      </button>
      <button className="ic" title={t("Chamfer (Shift+C)", "Фаска (Shift+C)")} onClick={() => createEdgeFinish("chamfer")}>
        <Icon name="chamfer" />
      </button>
    </div>
  );
}
