import { useState } from "react";
import { Icon } from "./icons";
import {
  deleteFeatures,
  enterSketch,
  renameFeature,
  reorderFeature,
  setBody,
  startSketch,
  t,
  toggleSuppress,
  useApp,
} from "../app/store";
import { liveBodiesAt } from "../core/graph";
import type { Feature, Id, OriginPlane } from "../core/types";

const ICON: Record<Feature["type"], string> = {
  sketch: "sketch",
  extrude: "extrude",
  revolve: "revolve",
  boolean: "boolean",
  fillet: "fillet",
  chamfer: "chamfer",
};

export interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export function ContextMenu({ at, items, onClose }: { at: { x: number; y: number }; items: (MenuItem | "-")[]; onClose: () => void }) {
  return (
    <div className="modal" style={{ background: "transparent", display: "block", padding: 0 }} onPointerDown={onClose} onContextMenu={(e) => (e.preventDefault(), onClose())}>
      <div className="ctx" style={{ left: Math.min(at.x, window.innerWidth - 220), top: Math.min(at.y, window.innerHeight - items.length * 32 - 16) }} onPointerDown={(e) => e.stopPropagation()}>
        <div className="dd" role="menu">
          {items.map((it, i) =>
            it === "-" ? (
              <hr key={i} />
            ) : (
              <button
                key={i}
                role="menuitem"
                disabled={it.disabled}
                className={it.danger ? "danger" : undefined}
                onClick={() => {
                  onClose();
                  it.onClick();
                }}
              >
                {it.label}
              </button>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

export function ModelTree({ hidden }: { hidden: boolean }) {
  const doc = useApp((s) => s.doc);
  const selection = useApp((s) => s.selection);
  const problems = useApp((s) => s.problems);
  const mode = useApp((s) => s.mode);
  const pickingEdges = useApp((s) => s.pickingEdges);
  useApp((s) => s.lang);
  const [renaming, setRenaming] = useState<Id | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: Id } | null>(null);
  const [drag, setDrag] = useState<{ id: Id; over: number; below: boolean } | null>(null);

  const problemOf = new Map(problems.map((p) => [p.featureId, p]));
  const lang = useApp.getState().lang;
  const selIds = new Set(selection.kind === "feature" ? selection.ids : []);
  const rollIndex = pickingEdges ? doc.features.findIndex((f) => f.id === pickingEdges) : -1;

  const select = (id: Id, e: React.MouseEvent) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      const ids = selIds.has(id) ? [...selIds].filter((x) => x !== id) : [...selIds, id];
      useApp.setState({ selection: ids.length ? { kind: "feature", ids } : { kind: "none" }, editing: null });
    } else useApp.setState({ selection: { kind: "feature", ids: [id] }, editing: id, pickingEdges: null });
  };

  const openFeature = (f: Feature) => {
    if (f.type === "sketch") enterSketch(f.id);
    else useApp.setState({ editing: f.id, selection: { kind: "feature", ids: [f.id] }, pickingEdges: f.type === "fillet" || f.type === "chamfer" ? f.id : null });
  };

  const planes: [OriginPlane, string][] = [
    ["XY", t("Top (XY)", "Верхняя (XY)")],
    ["XZ", t("Front (XZ)", "Фронтальная (XZ)")],
    ["YZ", t("Right (YZ)", "Правая (YZ)")],
  ];
  const live = liveBodiesAt(doc);
  const menuFeature = menu ? doc.features.find((f) => f.id === menu.id) : undefined;

  return (
    <aside id="tree" className={hidden ? "hide" : undefined} aria-label={t("Model tree", "Дерево модели")}>
      <div className="ph">
        <span>{t("Model", "Модель")}</span>
        <span className="mono" style={{ textTransform: "none", letterSpacing: 0 }}>{doc.units}</span>
      </div>
      <div className="scroll" role="tree">
        <div className="grp">{t("Origin", "Начало координат")}</div>
        {planes.map(([p, label]) => (
          <div
            key={p}
            role="treeitem"
            aria-selected={selection.kind === "plane" && selection.plane === p}
            className={`lr${selection.kind === "plane" && selection.plane === p ? " on" : ""}`}
            onClick={() => useApp.setState({ selection: { kind: "plane", plane: p }, editing: null })}
            onDoubleClick={() => mode.kind === "part" && startSketch(p)}
            title={t("Double-click to sketch on this plane", "Двойной щелчок — эскиз на плоскости")}
          >
            <Icon name="plane" />
            <span className="ln">{label}</span>
          </div>
        ))}

        <div className="grp">{t("History", "История")}</div>
        {doc.features.length === 0 ? <div className="empty">{t("Features you add appear here, in build order.", "Здесь по порядку появятся элементы построения.")}</div> : null}
        {doc.features.map((f, i) => {
          const prob = problemOf.get(f.id);
          const on = selIds.has(f.id) || (mode.kind === "sketch" && mode.featureId === f.id);
          const cls = ["lr", on ? "on" : "", f.suppressed ? "off" : "", rollIndex >= 0 && i > rollIndex ? "rolled" : "", drag && drag.over === i && drag.id !== f.id ? (drag.below ? "drop-below" : "drop-above") : ""].filter(Boolean).join(" ");
          return (
            <div
              key={f.id}
              role="treeitem"
              aria-selected={on}
              className={cls}
              draggable={renaming !== f.id}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                setDrag({ id: f.id, over: i, below: false });
              }}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                setDrag({ ...drag, over: i, below: e.clientY > r.top + r.height / 2 });
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (!drag) return;
                const from = doc.features.findIndex((x) => x.id === drag.id);
                let to = drag.below ? i + 1 : i;
                if (from < to) to--;
                reorderFeature(drag.id, to);
                setDrag(null);
              }}
              onDragEnd={() => setDrag(null)}
              onClick={(e) => select(f.id, e)}
              onDoubleClick={() => openFeature(f)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!selIds.has(f.id)) useApp.setState({ selection: { kind: "feature", ids: [f.id] } });
                setMenu({ x: e.clientX, y: e.clientY, id: f.id });
              }}
              title={prob ? (lang === "ru" ? prob.ru : prob.en) : undefined}
            >
              <Icon name={ICON[f.type]} />
              <span className="ln">
                {renaming === f.id ? (
                  <input
                    type="text"
                    autoFocus
                    defaultValue={f.name}
                    onFocus={(e) => e.currentTarget.select()}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      renameFeature(f.id, e.currentTarget.value);
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setRenaming(null);
                    }}
                  />
                ) : (
                  f.name
                )}
              </span>
              {prob ? (
                <span className="warn" aria-label={t("Problem", "Ошибка")}>
                  <Icon name="warn" />
                </span>
              ) : null}
              <button
                className={`lb${f.suppressed ? " set" : ""}`}
                title={f.suppressed ? t("Unsuppress", "Включить") : t("Suppress", "Подавить")}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSuppress(f.id);
                }}
              >
                <Icon name={f.suppressed ? "eyeoff" : "eye"} />
              </button>
            </div>
          );
        })}

        {live.length ? <div className="grp">{t("Bodies", "Тела")}</div> : null}
        {live.map((id) => {
          const b = doc.bodies[id];
          if (!b) return null;
          const on = selection.kind === "body" && selection.id === id;
          return (
            <div key={id} role="treeitem" aria-selected={on} className={`lr${on ? " on" : ""}${b.visible ? "" : " off"}`} onClick={() => useApp.setState({ selection: { kind: "body", id }, editing: null })}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: b.color, flex: "none", marginLeft: 2 }} />
              <span className="ln">{b.name}</span>
              <button
                className={`lb${b.visible ? "" : " set"}`}
                title={b.visible ? t("Hide", "Скрыть") : t("Show", "Показать")}
                onClick={(e) => {
                  e.stopPropagation();
                  setBody(id, { visible: !b.visible });
                }}
              >
                <Icon name={b.visible ? "eye" : "eyeoff"} />
              </button>
            </div>
          );
        })}
      </div>
      {menu && menuFeature ? (
        <ContextMenu
          at={menu}
          onClose={() => setMenu(null)}
          items={[
            { label: menuFeature.type === "sketch" ? t("Edit sketch", "Редактировать эскиз") : t("Edit", "Изменить"), onClick: () => openFeature(menuFeature) },
            { label: t("Rename", "Переименовать"), onClick: () => setRenaming(menuFeature.id) },
            { label: menuFeature.suppressed ? t("Unsuppress", "Включить") : t("Suppress", "Подавить"), onClick: () => toggleSuppress(menuFeature.id) },
            "-",
            { label: t("Delete", "Удалить"), danger: true, onClick: () => deleteFeatures(selIds.size > 1 ? [...selIds] : [menuFeature.id]) },
          ]}
        />
      ) : null}
    </aside>
  );
}
