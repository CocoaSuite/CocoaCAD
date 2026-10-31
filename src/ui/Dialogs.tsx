import { useEffect, useState } from "react";
import { BrandMark, Icon } from "./icons";
import { Seg, Toggle } from "./controls";
import { loadDocument, newDocument, setLang, t, toast, useApp } from "../app/store";
import { deleteProject, getPref, listProjects, loadProject, setPref, type ProjectSummary } from "../app/storage";
import { openFromFile } from "../app/files";
import { SKETCH_TOOLS } from "./Toolbar";

function Modal({ children, wide, onClose, label }: { children: React.ReactNode; wide?: string; onClose: () => void; label: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={label} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`box${wide ? " " + wide : ""}`}>{children}</div>
    </div>
  );
}

export function Dialogs() {
  const dialog = useApp((s) => s.dialog);
  useApp((s) => s.lang);
  const close = () => useApp.setState({ dialog: null });
  if (dialog === "start") return <StartScreen onClose={close} />;
  if (dialog === "settings") return <Settings onClose={close} />;
  if (dialog === "shortcuts") return <Shortcuts onClose={close} />;
  if (dialog === "about") return <About onClose={close} />;
  return null;
}

function StartScreen({ onClose }: { onClose: () => void }) {
  const [recent, setRecent] = useState<ProjectSummary[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  useEffect(() => {
    listProjects().then(setRecent, () => setRecent([]));
  }, []);
  const lang = useApp((s) => s.lang);
  const fmt = new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={t("Start", "Начало")}>
      <div className="start">
        <div className="side">
          <div className="brand">
            <BrandMark />
            <b>CocoaCAD</b>
          </div>
          <button className="pri" onClick={newDocument}>
            <Icon name="plus" />
            {t("New part", "Новая деталь")}
          </button>
          <button onClick={() => (onClose(), openFromFile())}>
            <Icon name="folder" />
            {t("Open file…", "Открыть файл…")}
          </button>
          <div className="spacer" />
          <div className="hint">{t("Parametric part modelling in your browser. Projects save automatically on this device.", "Параметрическое моделирование деталей в браузере. Проекты сохраняются на этом устройстве автоматически.")}</div>
        </div>
        <div className="main">
          <div className="sec" style={{ marginBottom: 4 }}>{t("Recent", "Недавние")}</div>
          {recent === null ? <div className="hint">…</div> : null}
          {recent?.length === 0 ? (
            <>
              <div className="empty" style={{ padding: "4px 0" }}>{t("No projects yet. Here's the basic workflow:", "Проектов пока нет. Основной порядок работы:")}</div>
              <div className="steps">
                <div><i>1</i>{t("Sketch on an origin plane: lines, rectangles, circles, arcs.", "Эскиз на базовой плоскости: линии, прямоугольники, окружности, дуги.")}</div>
                <div><i>2</i>{t("Add constraints and dimensions until the sketch is fully defined.", "Добавьте ограничения и размеры, пока эскиз не станет определённым.")}</div>
                <div><i>3</i>{t("Extrude or revolve it into a solid, then cut, combine and fillet.", "Выдавите или вращайте в тело, затем вырезайте, объединяйте, скругляйте.")}</div>
                <div><i>4</i>{t("Edit any step later — everything after it rebuilds.", "Любой шаг можно изменить позже — всё после него перестроится.")}</div>
              </div>
            </>
          ) : null}
          {recent?.map((r) => (
            <div
              key={r.id}
              className="rec"
              role="button"
              tabIndex={0}
              onClick={async () => {
                try {
                  const d = await loadProject(r.id);
                  if (d) loadDocument(d);
                } catch (e) {
                  toast((e as Error).message, true);
                }
              }}
              onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLElement).click()}
            >
              <Icon name="cube" />
              <div className="rn">
                <b>{r.name}</b>
                <small>
                  {fmt.format(r.modifiedAt)} · {t(`${r.features} features`, `элементов: ${r.features}`)}
                </small>
              </div>
              {confirming === r.id ? (
                <button
                  className="danger"
                  onClick={async (e) => {
                    e.stopPropagation();
                    await deleteProject(r.id);
                    setConfirming(null);
                    setRecent((x) => x?.filter((y) => y.id !== r.id) ?? null);
                  }}
                  onBlur={() => setConfirming(null)}
                  autoFocus
                >
                  {t("Delete", "Удалить")}
                </button>
              ) : (
                <button
                  className="del"
                  title={t("Delete from this device", "Удалить с устройства")}
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirming(r.id);
                  }}
                >
                  <Icon name="trash" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Settings({ onClose }: { onClose: () => void }) {
  const lang = useApp((s) => s.lang);
  const ortho = useApp((s) => s.ortho);
  const [snap, setSnap] = useState(getPref("gridSnap", true));
  return (
    <Modal onClose={onClose} label={t("Settings", "Настройки")} wide="w520">
      <h2>{t("Settings", "Настройки")}</h2>
      <div className="setr">
        <span>
          {t("Language", "Язык")}
          <small>{t("Interface language", "Язык интерфейса")}</small>
        </span>
        <Seg value={lang} onChange={setLang} options={[{ value: "en", label: "English" }, { value: "ru", label: "Русский" }]} />
      </div>
      <div className="setr">
        <span>
          {t("Snap to grid", "Привязка к сетке")}
          <small>{t("While sketching, when no point is nearby", "При рисовании, если рядом нет точки")}</small>
        </span>
        <Toggle
          checked={snap}
          onChange={(v) => {
            setSnap(v);
            setPref("gridSnap", v);
          }}
          label={t("Snap to grid", "Привязка к сетке")}
        />
      </div>
      <div className="setr">
        <span>
          {t("Orthographic view", "Ортогональный вид")}
          <small>{t("No perspective distortion", "Без перспективных искажений")}</small>
        </span>
        <Toggle
          checked={ortho}
          onChange={(v) => {
            useApp.setState({ ortho: v });
            setPref("ortho", v);
          }}
          label={t("Orthographic view", "Ортогональный вид")}
        />
      </div>
      <div className="setr">
        <span>
          {t("Units", "Единицы")}
          <small>{t("Fields also accept in, cm, m and ft — they're converted to mm.", "Поля принимают также in, cm, m, ft — с пересчётом в мм.")}</small>
        </span>
        <span className="mono">mm</span>
      </div>
      <div className="row">
        <button className="pri" onClick={onClose}>{t("Done", "Готово")}</button>
      </div>
    </Modal>
  );
}

function Shortcuts({ onClose }: { onClose: () => void }) {
  const rows = (items: [string, string, string][]) =>
    items.map(([k, en, ru]) => (
      <tr key={k + en}>
        <td>{t(en, ru)}</td>
        <td>
          <kbd>{k}</kbd>
        </td>
      </tr>
    ));
  return (
    <Modal onClose={onClose} label={t("Keyboard shortcuts", "Горячие клавиши")} wide="w520">
      <h2>{t("Keyboard shortcuts", "Горячие клавиши")}</h2>
      <table className="kt">
        <tbody>
          <tr><td colSpan={2}><h3>{t("General", "Общие")}</h3></td></tr>
          {rows([
            ["Ctrl+Z", "Undo", "Отменить"],
            ["Ctrl+Shift+Z", "Redo", "Повторить"],
            ["Ctrl+S", "Save as file", "Сохранить в файл"],
            ["Ctrl+O", "Open file", "Открыть файл"],
            ["Del", "Delete selection", "Удалить выделенное"],
            ["Esc", "Cancel / deselect", "Отмена / снять выделение"],
            ["?", "This list", "Этот список"],
          ])}
          <tr><td colSpan={2}><h3>{t("Part", "Деталь")}</h3></td></tr>
          {rows([
            ["K", "New sketch", "Новый эскиз"],
            ["E", "Extrude", "Выдавливание"],
            ["Shift+R", "Revolve", "Вращение"],
            ["B", "Boolean", "Булева операция"],
            ["Shift+F", "Fillet", "Скругление"],
            ["Shift+C", "Chamfer", "Фаска"],
          ])}
          <tr><td colSpan={2}><h3>{t("Sketch", "Эскиз")}</h3></td></tr>
          {SKETCH_TOOLS.map((x) => (
            <tr key={x.id}>
              <td>{t(x.en, x.ru)}</td>
              <td><kbd>{x.key}</kbd></td>
            </tr>
          ))}
          {rows([
            ["X", "Construction toggle", "Вспомогательная"],
            ["Shift+H / V", "Horizontal / vertical", "Горизонт. / вертик."],
            ["Shift+I", "Coincident", "Совпадение"],
            ["Shift+E", "Equal", "Равенство"],
            ["Enter", "Finish sketch", "Завершить эскиз"],
          ])}
          <tr><td colSpan={2}><h3>{t("View", "Вид")}</h3></td></tr>
          {rows([
            ["F", "Fit all", "Показать всё"],
            ["0 / 1 / 2 / 3", "Iso / top / front / right", "Изо / сверху / спереди / справа"],
            ["N", "Normal to sketch", "Нормально к эскизу"],
            ["O", "Perspective / orthographic", "Перспектива / орто"],
          ])}
        </tbody>
      </table>
      <div className="hint">{t("Mouse: right-drag orbit · middle-drag or Shift+right-drag pan · wheel zoom at cursor.", "Мышь: правая — вращение · средняя или Shift+правая — панорама · колесо — масштаб к курсору.")}</div>
      <div className="row">
        <button className="pri" onClick={onClose}>{t("Close", "Закрыть")}</button>
      </div>
    </Modal>
  );
}

function About({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} label={t("About", "О программе")}>
      <div className="brand">
        <BrandMark />
        <b>CocoaCAD</b>
      </div>
      <div className="hint">
        {t("Version 0.2 — part of CocoaSuite. Geometry by OpenCASCADE (via replicad), sketch solving by FreeCAD's PlaneGCS.", "Версия 0.2 — часть CocoaSuite. Геометрия: OpenCASCADE (через replicad), решатель эскизов: PlaneGCS из FreeCAD.")}
      </div>
      <div className="hint">
        {t("Open-source components: OpenCASCADE and planegcs (LGPL-2.1, loaded as separate replaceable modules), replicad, Three.js, React, Zustand (MIT). See THIRD_PARTY_NOTICES.", "Компоненты с открытым кодом: OpenCASCADE и planegcs (LGPL-2.1, отдельные заменяемые модули), replicad, Three.js, React, Zustand (MIT). См. THIRD_PARTY_NOTICES.")}
      </div>
      <div className="row">
        <button className="pri" onClick={onClose}>{t("Close", "Закрыть")}</button>
      </div>
    </Modal>
  );
}
