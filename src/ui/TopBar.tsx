import { useEffect, useRef, useState } from "react";
import { BrandMark, Icon } from "./icons";
import {
  createBoolean,
  createEdgeFinish,
  createExtrude,
  createRevolve,
  deleteFeatures,
  finishSketch,
  isUpToDate,
  newDocument,
  redo,
  renameDoc,
  requestView,
  t,
  undo,
  undoState,
  useApp,
  type ViewName,
} from "../app/store";
import { pick } from "../app/i18n";
import { exportModel, openFromFile, saveToFile } from "../app/files";

type Item = { label: string; key?: string; onClick: () => void; disabled?: boolean } | "-";

export function TopBar({ onTogglePanel }: { onTogglePanel: (side: "left" | "right") => void }) {
  const doc = useApp((s) => s.doc);
  const mode = useApp((s) => s.mode);
  const lang = useApp((s) => s.lang);
  const rebuilding = useApp((s) => s.rebuilding);
  const upToDate = useApp(isUpToDate);
  const kernelReady = useApp((s) => s.kernelReady);
  const kernelError = useApp((s) => s.kernelError);
  const problems = useApp((s) => s.problems);
  const selection = useApp((s) => s.selection);
  const ortho = useApp((s) => s.ortho);
  useApp((s) => s.rev);
  const [open, setOpen] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const u = undoState();

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !barRef.current?.contains(e.target as Node) && setOpen(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  const view = (v: ViewName) => () => requestView(v);
  const part = mode.kind === "part";
  const menus: { id: string; label: string; items: Item[] }[] = [
    {
      id: "file",
      label: t("File", "Файл"),
      items: [
        { label: t("New part", "Новая деталь"), key: "Ctrl+Alt+N", onClick: newDocument },
        { label: t("Open…", "Открыть…"), key: "Ctrl+O", onClick: openFromFile },
        { label: t("Recent projects…", "Недавние проекты…"), onClick: () => useApp.setState({ dialog: "start" }) },
        "-",
        { label: t("Save as file…", "Сохранить в файл…"), key: "Ctrl+S", onClick: saveToFile },
        "-",
        { label: t("Export STL", "Экспорт STL"), onClick: () => exportModel("stl") },
        { label: t("Export STEP", "Экспорт STEP"), onClick: () => exportModel("step") },
      ],
    },
    {
      id: "edit",
      label: t("Edit", "Правка"),
      items: [
        { label: u.undoLabel ? `${t("Undo", "Отменить")} ${pick(lang, u.undoLabel)}` : t("Undo", "Отменить"), key: "Ctrl+Z", onClick: undo, disabled: !u.canUndo },
        { label: u.redoLabel ? `${t("Redo", "Повторить")} ${pick(lang, u.redoLabel)}` : t("Redo", "Повторить"), key: "Ctrl+Shift+Z", onClick: redo, disabled: !u.canRedo },
        "-",
        {
          label: t("Delete", "Удалить"),
          key: "Del",
          disabled: selection.kind !== "feature",
          onClick: () => selection.kind === "feature" && deleteFeatures(selection.ids),
        },
        "-",
        { label: t("Settings…", "Настройки…"), key: "Ctrl+,", onClick: () => useApp.setState({ dialog: "settings" }) },
      ],
    },
    {
      id: "insert",
      label: t("Insert", "Вставка"),
      items: [
        { label: t("Extrude", "Выдавливание"), key: "E", onClick: createExtrude, disabled: !part },
        { label: t("Revolve", "Вращение"), key: "Shift+R", onClick: createRevolve, disabled: !part },
        { label: t("Boolean", "Булева операция"), key: "B", onClick: createBoolean, disabled: !part },
        { label: t("Fillet", "Скругление"), key: "Shift+F", onClick: () => createEdgeFinish("fillet"), disabled: !part },
        { label: t("Chamfer", "Фаска"), key: "Shift+C", onClick: () => createEdgeFinish("chamfer"), disabled: !part },
        ...(part ? [] : (["-", { label: t("Finish sketch", "Завершить эскиз"), key: "Enter", onClick: finishSketch }] as Item[])),
      ],
    },
    {
      id: "view",
      label: t("View", "Вид"),
      items: [
        { label: t("Fit all", "Показать всё"), key: "F", onClick: view("fit") },
        { label: t("Isometric", "Изометрия"), key: "0", onClick: view("iso") },
        { label: t("Top", "Сверху"), key: "1", onClick: view("top") },
        { label: t("Front", "Спереди"), key: "2", onClick: view("front") },
        { label: t("Right", "Справа"), key: "3", onClick: view("right") },
        ...(part ? [] : ([{ label: t("Normal to sketch", "Нормально к эскизу"), key: "N", onClick: view("normal") }] as Item[])),
        "-",
        { label: ortho ? t("Perspective", "Перспектива") : t("Orthographic", "Ортогональная"), key: "O", onClick: () => useApp.setState({ ortho: !ortho }) },
      ],
    },
    {
      id: "help",
      label: t("Help", "Справка"),
      items: [
        { label: t("Keyboard shortcuts", "Горячие клавиши"), key: "?", onClick: () => useApp.setState({ dialog: "shortcuts" }) },
        { label: t("About CocoaCAD", "О программе"), onClick: () => useApp.setState({ dialog: "about" }) },
      ],
    },
  ];

  const status = kernelError
    ? { dot: "bad", text: t("Geometry kernel failed to load", "Ядро не загрузилось") }
    : !kernelReady
      ? { dot: "busy", text: t("Loading geometry kernel…", "Загрузка ядра…") }
      : rebuilding || !upToDate
        ? { dot: "busy", text: t("Rebuilding…", "Перестроение…") }
        : problems.length
          ? { dot: "bad", text: t(`${problems.length} feature(s) need attention`, `Требуют внимания: ${problems.length}`) }
          : mode.kind === "sketch"
            ? { dot: "ok", text: t("Sketching — Enter to finish", "Эскиз — Enter для завершения") }
            : { dot: "ok", text: t("Model up to date", "Модель актуальна") };

  return (
    <header id="top" ref={barRef}>
      <button className="ic ghost ptog" onClick={() => onTogglePanel("left")} title={t("Model tree", "Дерево модели")}>
        <Icon name="panels" />
      </button>
      <div className="brand" title="CocoaCAD">
        <BrandMark />
        <b>CocoaCAD</b>
      </div>
      <nav style={{ display: "flex", gap: 2 }}>
        {menus.map((m) => (
          <div key={m.id} className={`mn${open === m.id ? " on" : ""}`}>
            <button className="mt" aria-haspopup="menu" aria-expanded={open === m.id} onClick={() => setOpen(open === m.id ? null : m.id)} onPointerEnter={() => open && setOpen(m.id)}>
              {m.label}
            </button>
            {open === m.id ? (
              <div className="dd" role="menu">
                {m.items.map((it, i) =>
                  it === "-" ? (
                    <hr key={i} />
                  ) : (
                    <button
                      key={i}
                      role="menuitem"
                      disabled={it.disabled}
                      onClick={() => {
                        setOpen(null);
                        it.onClick();
                      }}
                    >
                      <span>{it.label}</span>
                      {it.key ? <kbd>{it.key}</kbd> : null}
                    </button>
                  ),
                )}
              </div>
            ) : null}
          </div>
        ))}
      </nav>
      {editingName ? (
        <input
          className="pname-edit"
          type="text"
          autoFocus
          defaultValue={doc.name}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => {
            renameDoc(e.currentTarget.value);
            setEditingName(false);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setEditingName(false);
          }}
        />
      ) : (
        <button className="pname" onClick={() => setEditingName(true)} title={t("Rename project", "Переименовать проект")}>
          {doc.name}
        </button>
      )}
      <div className="spacer" />
      <div className="helper" role="status" aria-live="polite">
        <span className={`dot ${status.dot}`} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{status.text}</span>
      </div>
      <div className="spacer" />
      <button className="ic ghost" onClick={undo} disabled={!u.canUndo} title={t("Undo (Ctrl+Z)", "Отменить (Ctrl+Z)")}>
        <Icon name="undo" />
      </button>
      <button className="ic ghost wide-only" onClick={redo} disabled={!u.canRedo} title={t("Redo (Ctrl+Shift+Z)", "Повторить (Ctrl+Shift+Z)")}>
        <Icon name="redo" />
      </button>
      <button className="ic ghost wide-only" onClick={() => useApp.setState({ dialog: "settings" })} title={t("Settings", "Настройки")}>
        <Icon name="gear" />
      </button>
      <button className="pri" onClick={() => exportModel("stl")} title={t("Export the visible bodies as STL", "Экспорт видимых тел в STL")}>
        {t("Export", "Экспорт")}
      </button>
      <button className="ic ghost ptog" onClick={() => onTogglePanel("right")} title={t("Properties", "Свойства")}>
        <Icon name="panelsR" />
      </button>
    </header>
  );
}
