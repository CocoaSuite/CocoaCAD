import type { ReactNode } from "react";
import { Field, NumberField, Seg, Toggle } from "./controls";
import { Icon } from "./icons";
import { CONSTRAINT_TOOLS, applyConstraint, toggleConstruction } from "./Toolbar";
import {
  activeSketch,
  commitSketch,
  deleteFeatures,
  editFeature,
  enterSketch,
  featureById,
  finishSketch,
  renameDoc,
  setBody,
  startSketch,
  t,
  useApp,
} from "../app/store";
import { L, pick } from "../app/i18n";
import { exportModel } from "../app/files";
import { BODY_COLORS } from "../core/document";
import { liveBodiesAt } from "../core/graph";
import { findProfiles } from "../core/sketch/profiles";
import { constraintsFor } from "../core/sketch/rules";
import { SketchView, dist, deleteFromSketch } from "../core/sketch/model";
import { newId } from "../core/ids";
import { formatNumber } from "../core/units";
import type {
  BodyOp,
  BooleanFeature,
  EdgeFinishFeature,
  ExtrudeFeature,
  Feature,
  Id,
  RevolveFeature,
  SketchConstraint,
  SketchFeature,
} from "../core/types";

export function Properties({ hidden }: { hidden: boolean }) {
  const mode = useApp((s) => s.mode);
  const selection = useApp((s) => s.selection);
  const editing = useApp((s) => s.editing);
  const doc = useApp((s) => s.doc);
  useApp((s) => s.lang);

  let body: ReactNode;
  let title = t("Properties", "Свойства");
  if (mode.kind === "sketch") {
    title = t("Sketch", "Эскиз");
    body = <SketchInspector />;
  } else if (editing && doc.features.some((f) => f.id === editing)) {
    const f = featureById(editing)!;
    title = f.name;
    body = <FeatureEditor feature={f} />;
  } else if (selection.kind === "feature" && selection.ids.length === 1) {
    const f = featureById(selection.ids[0]!);
    if (f) {
      title = f.name;
      body = <FeatureEditor feature={f} />;
    }
  } else if (selection.kind === "feature" && selection.ids.length > 1) {
    body = (
      <>
        <div className="hint">{t(`${selection.ids.length} features selected.`, `Выбрано элементов: ${selection.ids.length}.`)}</div>
        <button className="danger" onClick={() => deleteFeatures(selection.ids)}>
          {t("Delete selected", "Удалить выбранные")}
        </button>
      </>
    );
  } else if (selection.kind === "body") {
    title = doc.bodies[selection.id]?.name ?? title;
    body = <BodyInspector id={selection.id} />;
  } else if (selection.kind === "plane") {
    const names = { XY: t("Top plane (XY)", "Верхняя плоскость (XY)"), XZ: t("Front plane (XZ)", "Фронтальная плоскость (XZ)"), YZ: t("Right plane (YZ)", "Правая плоскость (YZ)") };
    title = names[selection.plane];
    body = (
      <>
        <div className="hint">{t("An origin plane. Sketch on it to start a profile.", "Базовая плоскость. Создайте на ней эскиз контура.")}</div>
        <button className="pri" onClick={() => startSketch(selection.plane)}>
          {t("Sketch on this plane", "Эскиз на этой плоскости")}
        </button>
      </>
    );
  } else body = <DocInfo />;

  return (
    <aside id="propsW" className={hidden ? "hide" : undefined} aria-label={t("Properties", "Свойства")}>
      <div className="ph">
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
      </div>
      <div id="props">{body}</div>
    </aside>
  );
}

/* ───────── document ───────── */

function DocInfo() {
  const doc = useApp((s) => s.doc);
  const bodies = useApp((s) => s.bodies);
  const ms = useApp((s) => s.lastRebuildMs);
  const vol = bodies.reduce((s, b) => s + b.volume, 0);
  return (
    <>
      <div className="sec">{t("Project", "Проект")}</div>
      <Field label={t("Name", "Имя")}>
        <input type="text" key={doc.name} defaultValue={doc.name} onBlur={(e) => renameDoc(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
      </Field>
      <div className="stat"><span>{t("Units", "Единицы")}</span><span>mm</span></div>
      <div className="stat"><span>{t("Features", "Элементы")}</span><span>{doc.features.length}</span></div>
      <div className="stat"><span>{t("Bodies", "Тела")}</span><span>{bodies.length}</span></div>
      {bodies.length ? <div className="stat"><span>{t("Total volume", "Общий объём")}</span><span>{formatNumber(vol, 1)} mm³</span></div> : null}
      {ms ? <div className="stat"><span>{t("Last rebuild", "Перестроение")}</span><span>{formatNumber(ms, 0)} ms</span></div> : null}
      <div className="sec">{t("Getting started", "Начало работы")}</div>
      <div className="steps">
        <div><i>1</i>{t("Pick a plane, then Sketch (K).", "Выберите плоскость, затем «Эскиз» (K).")}</div>
        <div><i>2</i>{t("Draw a closed profile and dimension it (D).", "Нарисуйте замкнутый контур и задайте размеры (D).")}</div>
        <div><i>3</i>{t("Finish, then Extrude (E) or Revolve.", "Завершите и выдавите (E) или вращайте.")}</div>
      </div>
      <div className="hint">{t("Right-drag orbits, middle-drag pans, wheel zooms. Left-drag also orbits outside a sketch.", "Правая кнопка — вращение, средняя — панорама, колесо — масштаб. Вне эскиза левая кнопка тоже вращает.")}</div>
    </>
  );
}

/* ───────── body ───────── */

function BodyInspector({ id }: { id: Id }) {
  const meta = useApp((s) => s.doc.bodies[id]);
  const mesh = useApp((s) => s.bodies.find((b) => b.id === id));
  if (!meta) return null;
  const [lo, hi] = mesh?.bbox ?? [[0, 0, 0], [0, 0, 0]];
  return (
    <>
      <Field label={t("Name", "Имя")}>
        <input type="text" key={meta.name} defaultValue={meta.name} onBlur={(e) => e.currentTarget.value.trim() && e.currentTarget.value !== meta.name && setBody(id, { name: e.currentTarget.value.trim() })} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
      </Field>
      <Field label={t("Colour", "Цвет")}>
        <div className="swatches">
          {BODY_COLORS.map((c) => (
            <button key={c} className={c === meta.color ? "on" : undefined} style={{ background: c }} aria-label={c} onClick={() => setBody(id, { color: c })} />
          ))}
        </div>
      </Field>
      <div className="setr">
        <span>{t("Visible", "Видимость")}</span>
        <Toggle checked={meta.visible} onChange={(v) => setBody(id, { visible: v })} label={t("Visible", "Видимость")} />
      </div>
      {mesh ? (
        <>
          <div className="sec">{t("Measurements", "Измерения")}</div>
          <div className="stat"><span>{t("Volume", "Объём")}</span><span>{formatNumber(mesh.volume, 2)} mm³</span></div>
          <div className="stat"><span>{t("Surface area", "Площадь")}</span><span>{formatNumber(mesh.area, 2)} mm²</span></div>
          <div className="stat"><span>{t("Size X × Y × Z", "Габарит X × Y × Z")}</span><span>{[0, 1, 2].map((i) => formatNumber(hi[i]! - lo[i]!, 2)).join(" × ")}</span></div>
          <div className="stat"><span>{t("Faces · edges", "Грани · рёбра")}</span><span>{mesh.faceGroups.length} · {mesh.edges.length}</span></div>
        </>
      ) : null}
      <div className="sec">{t("Export", "Экспорт")}</div>
      <div className="actions">
        <button onClick={() => exportModel("stl")}>STL</button>
        <button onClick={() => exportModel("step")}>STEP</button>
      </div>
    </>
  );
}

/* ───────── features ───────── */

function Problem({ id }: { id: Id }) {
  const p = useApp((s) => s.problems.find((x) => x.featureId === id));
  const lang = useApp((s) => s.lang);
  return p ? <div className="err" role="alert">{pick(lang, p)}</div> : null;
}

function FeatureEditor({ feature: f }: { feature: Feature }) {
  return (
    <>
      <Problem id={f.id} />
      {f.type === "sketch" ? <SketchFeatureEditor f={f} /> : null}
      {f.type === "extrude" || f.type === "revolve" ? <SweepEditor f={f} /> : null}
      {f.type === "boolean" ? <BooleanEditor f={f} /> : null}
      {f.type === "fillet" || f.type === "chamfer" ? <EdgeFinishEditor f={f} /> : null}
      <div className="sec" />
      <div className="actions">
        <button
          onClick={() => {
            const cur = featureById(f.id);
            if (cur) editFeature(cur, { ...cur, suppressed: !cur.suppressed });
          }}
        >
          {f.suppressed ? t("Unsuppress", "Включить") : t("Suppress", "Подавить")}
        </button>
        <button className="danger" onClick={() => deleteFeatures([f.id])}>
          {t("Delete", "Удалить")}
        </button>
      </div>
    </>
  );
}

function SketchFeatureEditor({ f }: { f: SketchFeature }) {
  const prof = findProfiles(f.sketch);
  const names = { XY: t("Top (XY)", "Верхняя (XY)"), XZ: t("Front (XZ)", "Фронтальная (XZ)"), YZ: t("Right (YZ)", "Правая (YZ)") };
  return (
    <>
      <Field label={t("Plane", "Плоскость")}>
        <select value={f.plane.base} onChange={(e) => editFeature(f, { ...f, plane: { ...f.plane, base: e.target.value as SketchFeature["plane"]["base"] } })}>
          {(["XY", "XZ", "YZ"] as const).map((p) => (
            <option key={p} value={p}>{names[p]}</option>
          ))}
        </select>
      </Field>
      <Field label={t("Offset", "Смещение")}>
        <NumberField label="↕" value={f.plane.offset} onChange={(v, o) => editFeature(f, { ...f, plane: { ...f.plane, offset: v } }, o.live ? `off:${f.id}` : undefined)} />
      </Field>
      <div className="setr">
        <span>{t("Flip normal", "Развернуть нормаль")}</span>
        <Toggle checked={!!f.plane.flip} onChange={(v) => editFeature(f, { ...f, plane: { ...f.plane, flip: v } })} label={t("Flip normal", "Развернуть нормаль")} />
      </div>
      <div className="stat"><span>{t("Entities", "Объекты")}</span><span>{f.sketch.entities.length}</span></div>
      <div className="stat"><span>{t("Constraints", "Ограничения")}</span><span>{f.sketch.constraints.length}</span></div>
      <div className="stat"><span>{t("Closed regions", "Замкнутые области")}</span><span>{prof.regions.length}</span></div>
      {prof.openEntities.length ? <div className="hint">{t(`${prof.openEntities.length} open segment(s) won't form a profile.`, `Незамкнутых сегментов: ${prof.openEntities.length}.`)}</div> : null}
      <button className="pri" onClick={() => enterSketch(f.id)}>
        {t("Edit sketch", "Редактировать эскиз")}
      </button>
    </>
  );
}

const OPS: { value: BodyOp; en: string; ru: string }[] = [
  { value: "new", en: "New", ru: "Новое" },
  { value: "add", en: "Add", ru: "Добавить" },
  { value: "cut", en: "Cut", ru: "Вырез" },
  { value: "intersect", en: "Intersect", ru: "Пересечь" },
];

function bodiesBefore(fid: Id): Id[] {
  const doc = useApp.getState().doc;
  const i = doc.features.findIndex((f) => f.id === fid);
  return liveBodiesAt(doc, i - 1);
}

type SweepPatch = Partial<Omit<ExtrudeFeature, "type">> & Partial<Omit<RevolveFeature, "type">>;

function SweepEditor({ f }: { f: ExtrudeFeature | RevolveFeature }) {
  const doc = useApp((s) => s.doc);
  const sketches = doc.features.slice(0, doc.features.findIndex((x) => x.id === f.id)).filter((x): x is SketchFeature => x.type === "sketch");
  const sk = sketches.find((s) => s.id === f.sketchId);
  const prof = sk ? findProfiles(sk.sketch) : null;
  const targets = bodiesBefore(f.id);
  const ed = (patch: SweepPatch, live?: string) => editFeature(f, { ...f, ...patch } as typeof f, live);
  const setOp = (op: BodyOp) => {
    const patch: SweepPatch = { op };
    if (op !== "new" && !f.target) patch.target = targets[targets.length - 1];
    ed(patch);
  };
  const lines = sk ? sk.sketch.entities.filter((e) => e.type === "line") : [];
  return (
    <>
      <Field label={t("Sketch", "Эскиз")}>
        <select value={f.sketchId} onChange={(e) => ed({ sketchId: e.target.value, profiles: [] })}>
          {!sk ? <option value={f.sketchId}>{t("(missing)", "(нет)")}</option> : null}
          {sketches.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </Field>
      {prof && prof.regions.length > 1 ? (
        <>
          <div className="sec">{t("Profiles", "Контуры")}</div>
          <label className="chk">
            <input type="checkbox" checked={f.profiles.length === 0} onChange={() => ed({ profiles: [] })} />
            {t("All closed regions", "Все замкнутые области")}
          </label>
          {prof.regions.map((r, i) => (
            <label key={r.key} className="chk">
              <input
                type="checkbox"
                checked={f.profiles.includes(r.key)}
                onChange={(e) => ed({ profiles: e.target.checked ? [...f.profiles, r.key] : f.profiles.filter((k) => k !== r.key) })}
              />
              {t(`Region ${i + 1}`, `Область ${i + 1}`)} <span className="hint">· {formatNumber(r.area, 1)} mm²{r.holes.length ? t(` · ${r.holes.length} hole(s)`, ` · отв.: ${r.holes.length}`) : ""}</span>
            </label>
          ))}
        </>
      ) : null}
      <div className="sec">{f.type === "extrude" ? t("Extent", "Протяжённость") : t("Rotation", "Вращение")}</div>
      {f.type === "extrude" ? (
        <>
          <Field label={t("Distance", "Расстояние")}>
            <NumberField label="D" value={f.distance} min={0.001} onChange={(v, o) => ed({ distance: v }, o.live ? `dist:${f.id}` : undefined)} autoFocus />
          </Field>
          <Seg
            value={f.direction}
            onChange={(direction) => ed({ direction })}
            options={[
              { value: "normal", label: t("One side", "Одна сторона") },
              { value: "reverse", label: t("Reverse", "Обратно") },
              { value: "symmetric", label: t("Symmetric", "Симметр.") },
            ]}
          />
        </>
      ) : (
        <>
          <Field label={t("Axis", "Ось")}>
            <select
              value={f.axis.kind === "sketchAxis" ? `axis:${f.axis.axis}` : `line:${f.axis.lineId}`}
              onChange={(e) => {
                const [k, v] = e.target.value.split(":") as [string, string];
                ed({ axis: k === "axis" ? { kind: "sketchAxis", axis: v as "x" | "y" } : { kind: "sketchLine", lineId: v } });
              }}
            >
              <option value="axis:x">{t("Sketch X axis", "Ось X эскиза")}</option>
              <option value="axis:y">{t("Sketch Y axis", "Ось Y эскиза")}</option>
              {lines.map((l, i) => (
                <option key={l.id} value={`line:${l.id}`}>
                  {t(`Line ${i + 1}`, `Линия ${i + 1}`)}
                  {l.construction ? t(" (construction)", " (вспомог.)") : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("Angle", "Угол")}>
            <NumberField label="∠" quantity="angle" value={f.angle} min={0.1} max={360} step={5} onChange={(v, o) => ed({ angle: v }, o.live ? `ang:${f.id}` : undefined)} />
          </Field>
        </>
      )}
      <div className="sec">{t("Result", "Результат")}</div>
      <Seg value={f.op} onChange={setOp} options={OPS.map((o) => ({ value: o.value, label: t(o.en, o.ru), title: t(o.en, o.ru) }))} />
      {f.op !== "new" ? (
        <Field label={t("Target body", "Целевое тело")}>
          <select value={f.target ?? ""} onChange={(e) => ed({ target: e.target.value })}>
            {!f.target ? <option value="">{t("Choose…", "Выберите…")}</option> : null}
            {targets.map((b) => (
              <option key={b} value={b}>{doc.bodies[b]?.name ?? b}</option>
            ))}
          </select>
        </Field>
      ) : null}
      {f.op !== "new" && targets.length === 0 ? <div className="hint">{t("There is no earlier body to modify.", "Нет более раннего тела для изменения.")}</div> : null}
    </>
  );
}

function BooleanEditor({ f }: { f: BooleanFeature }) {
  const doc = useApp((s) => s.doc);
  const bodies = bodiesBefore(f.id);
  const ed = (patch: Partial<BooleanFeature>) => editFeature(f, { ...f, ...patch });
  return (
    <>
      <Seg
        value={f.op}
        onChange={(op) => ed({ op })}
        options={[
          { value: "union", label: t("Union", "Объединение") },
          { value: "subtract", label: t("Subtract", "Вычитание") },
          { value: "intersect", label: t("Intersect", "Пересечение") },
        ]}
      />
      <Field label={t("Target", "Цель")}>
        <select value={f.target} onChange={(e) => ed({ target: e.target.value, tools: f.tools.filter((x) => x !== e.target.value) })}>
          {bodies.map((b) => (
            <option key={b} value={b}>{doc.bodies[b]?.name ?? b}</option>
          ))}
        </select>
      </Field>
      <div className="sec">{t("Tools", "Инструменты")}</div>
      {bodies
        .filter((b) => b !== f.target)
        .map((b) => (
          <label key={b} className="chk">
            <input type="checkbox" checked={f.tools.includes(b)} onChange={(e) => ed({ tools: e.target.checked ? [...f.tools, b] : f.tools.filter((x) => x !== b) })} />
            {doc.bodies[b]?.name ?? b}
          </label>
        ))}
      <div className="setr">
        <span>
          {t("Keep tool bodies", "Сохранить инструменты")}
          <small>{t("Otherwise they are consumed.", "Иначе они поглощаются.")}</small>
        </span>
        <Toggle checked={f.keepTools} onChange={(keepTools) => ed({ keepTools })} label={t("Keep tool bodies", "Сохранить инструменты")} />
      </div>
    </>
  );
}

function EdgeFinishEditor({ f }: { f: EdgeFinishFeature }) {
  const doc = useApp((s) => s.doc);
  const picking = useApp((s) => s.pickingEdges === f.id);
  const bodies = bodiesBefore(f.id);
  const ed = (patch: Partial<EdgeFinishFeature>, live?: string) => editFeature(f, { ...f, ...patch }, live);
  return (
    <>
      <Field label={t("Body", "Тело")}>
        <select value={f.body} onChange={(e) => ed({ body: e.target.value, edges: [] })}>
          {bodies.map((b) => (
            <option key={b} value={b}>{doc.bodies[b]?.name ?? b}</option>
          ))}
        </select>
      </Field>
      <Field label={f.type === "fillet" ? t("Radius", "Радиус") : t("Distance", "Расстояние")}>
        <NumberField label={f.type === "fillet" ? "R" : "D"} value={f.size} min={0.001} step={0.25} onChange={(v, o) => ed({ size: v }, o.live ? `size:${f.id}` : undefined)} />
      </Field>
      <div className="stat"><span>{t("Edges", "Рёбра")}</span><span>{f.edges.length}</span></div>
      {picking ? (
        <>
          <div className="hint">{t("Click edges in the view to add or remove them. The model is shown as it was before this feature.", "Щёлкайте рёбра, чтобы добавить или убрать. Модель показана до этого элемента.")}</div>
          <div className="actions">
            <button onClick={() => ed({ edges: [] })} disabled={!f.edges.length}>{t("Clear", "Очистить")}</button>
            <button className="pri" onClick={() => useApp.setState({ pickingEdges: null })}>{t("Done", "Готово")}</button>
          </div>
        </>
      ) : (
        <button onClick={() => useApp.setState({ pickingEdges: f.id, editing: f.id })}>{t("Pick edges", "Выбрать рёбра")}</button>
      )}
    </>
  );
}

/* ───────── sketch mode ───────── */

const CNAME: Record<SketchConstraint["type"], [string, string]> = {
  coincident: ["Coincident", "Совпадение"],
  horizontal: ["Horizontal", "Горизонтальность"],
  vertical: ["Vertical", "Вертикальность"],
  parallel: ["Parallel", "Параллельность"],
  perpendicular: ["Perpendicular", "Перпендикулярность"],
  equal: ["Equal", "Равенство"],
  fix: ["Fixed", "Фиксация"],
  pointOnLine: ["Point on line", "Точка на линии"],
  pointOnCircle: ["Point on curve", "Точка на кривой"],
  midpoint: ["Midpoint", "Середина"],
  tangent: ["Tangent", "Касание"],
  distance: ["Distance", "Расстояние"],
  hdistance: ["Horizontal distance", "Гориз. расстояние"],
  vdistance: ["Vertical distance", "Верт. расстояние"],
  radius: ["Radius", "Радиус"],
  diameter: ["Diameter", "Диаметр"],
  angle: ["Angle", "Угол"],
};

function SketchInspector() {
  const status = useApp((s) => s.sketchStatus);
  const selection = useApp((s) => s.selection);
  useApp((s) => s.doc);
  const sk = activeSketch();
  if (!sk) return null;
  const data = sk.sketch;
  const v = new SketchView(data);
  const sel = selection.kind === "sketch" ? selection : { points: [] as Id[], entities: [] as Id[], constraints: [] as Id[] };
  const bad = new Set(status?.conflicting ?? []);
  const prof = findProfiles(data);

  /** Set (or add) a driving dimension on the selection. */
  const setDim = (type: SketchConstraint["type"], refs: Id[], value: number, live: boolean) => {
    const existing = data.constraints.find((c) => c.type === type && c.refs.length === refs.length && c.refs.every((r, i) => r === refs[i]));
    const constraints = existing
      ? data.constraints.map((c) => (c === existing ? { ...c, value } : c))
      : [...data.constraints, { id: newId("k"), type, refs, value }];
    commitSketch({ ...data, constraints }, L("Dimension", "Размер"), live ? { mergeKey: `dim:${refs.join()}` } : {});
  };

  const one = sel.entities.length === 1 && sel.points.length === 0 ? v.ents.get(sel.entities[0]!) : undefined;
  const onePoint = sel.points.length === 1 && sel.entities.length === 0 ? data.points.find((p) => p.id === sel.points[0]) : undefined;

  return (
    <>
      <div className="stat">
        <span>{t("Status", "Состояние")}</span>
        <span style={{ color: status?.status === "conflicting" ? "var(--bad)" : status?.dof === 0 ? "#8fd18f" : undefined }}>
          {!status ? "…" : data.entities.length === 0 ? t("Empty", "Пусто") : status.status === "conflicting" ? t("Over-constrained", "Переопределён") : status.dof === 0 ? t("Fully constrained", "Определён") : t(`${status.dof} DOF`, `${status.dof} ст. св.`)}
        </span>
      </div>
      <div className="stat"><span>{t("Closed regions", "Замкнутые области")}</span><span>{prof.regions.length}</span></div>
      {prof.openEntities.length && data.entities.length ? <div className="hint">{t("Some segments don't close a loop yet.", "Некоторые сегменты ещё не замкнуты.")}</div> : null}

      {one ? (
        <>
          <div className="sec">{one.type === "line" ? t("Line", "Линия") : one.type === "circle" ? t("Circle", "Окружность") : t("Arc", "Дуга")}</div>
          {one.type === "line" ? (
            <Field label={t("Length", "Длина")}>
              <NumberField label="L" min={0.001} value={dist(v.p(one.p1), v.p(one.p2))} onChange={(val, o) => setDim("distance", [one.id], val, o.live)} />
            </Field>
          ) : (
            <Field label={one.type === "circle" ? t("Diameter", "Диаметр") : t("Radius", "Радиус")}>
              <NumberField
                label={one.type === "circle" ? "⌀" : "R"}
                min={0.001}
                value={one.type === "circle" ? one.r * 2 : one.r}
                onChange={(val, o) => setDim(one.type === "circle" ? "diameter" : "radius", [one.id], val, o.live)}
              />
            </Field>
          )}
          <div className="setr">
            <span>{t("Construction", "Вспомогательная")}</span>
            <Toggle checked={!!one.construction} onChange={() => toggleConstruction()} label={t("Construction", "Вспомогательная")} />
          </div>
        </>
      ) : null}

      {onePoint ? (
        <>
          <div className="sec">{t("Point", "Точка")}</div>
          <div className="two">
            <NumberField label="X" value={onePoint.x} onChange={(x) => commitSketch(data, L("Move point", "Переместить точку"), { drag: [{ pointId: onePoint.id, to: [x, onePoint.y] }] })} />
            <NumberField label="Y" value={onePoint.y} onChange={(y) => commitSketch(data, L("Move point", "Переместить точку"), { drag: [{ pointId: onePoint.id, to: [onePoint.x, y] }] })} />
          </div>
          <div className="hint">{t("Moves the point as far as its constraints allow.", "Перемещает точку, насколько позволяют ограничения.")}</div>
        </>
      ) : null}

      {sel.points.length + sel.entities.length > 0 ? (
        <>
          <div className="sec">{t("Constrain", "Ограничить")}</div>
          <div className="actions" style={{ gap: 4 }}>
            {CONSTRAINT_TOOLS.filter((c) => constraintsFor(c.id, sel, data)).map((c) => (
              <button key={c.id} style={{ flex: "0 0 auto" }} onClick={() => applyConstraint(c.id)} title={t(c.en, c.ru)}>
                <Icon name={c.id} />
              </button>
            ))}
          </div>
        </>
      ) : null}

      <div className="sec">
        {t("Constraints", "Ограничения")} <span className="mono">{data.constraints.length}</span>
      </div>
      {data.constraints.length === 0 ? <div className="empty" style={{ padding: "2px 0" }}>{t("None yet. Select geometry and use the toolbar, or press D to dimension.", "Пока нет. Выделите геометрию и выберите ограничение или нажмите D.")}</div> : null}
      <div className="clist">
        {data.constraints.map((c) => {
          const on = sel.constraints.includes(c.id);
          const [en, ru] = CNAME[c.type];
          const val = c.value === undefined || c.type === "fix" ? "" : c.type === "angle" ? `${formatNumber((Math.abs(c.value) * 180) / Math.PI, 2)}°` : formatNumber(Math.abs(c.value), 2);
          return (
            <div
              key={c.id}
              className={`crow${on ? " on" : ""}${bad.has(c.id) ? " bad" : ""}`}
              onClick={(e) => useApp.setState({ selection: { kind: "sketch", points: [], entities: e.shiftKey ? sel.entities : [], constraints: e.shiftKey ? [...sel.constraints, c.id] : [c.id] } })}
            >
              <span className="cn">{t(en, ru)}</span>
              <span className="cv">{val}</span>
              <button title={t("Delete", "Удалить")} onClick={(e) => (e.stopPropagation(), commitSketch(deleteFromSketch(data, [c.id]), L("Delete constraint", "Удалить ограничение")))}>
                <Icon name="x" />
              </button>
            </div>
          );
        })}
      </div>
      <div className="sec" />
      <button className="pri" onClick={finishSketch}>{t("Finish sketch", "Завершить эскиз")}</button>
      <div className="hint">{t("Esc ends a line chain. Delete removes the selection. Shift-click adds to it.", "Esc завершает цепочку линий. Delete удаляет выделенное. Shift — добавить к выделению.")}</div>
    </>
  );
}
