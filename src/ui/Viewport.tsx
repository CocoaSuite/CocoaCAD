import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { CadScene } from "../viewport/scene";
import { SketchController } from "../viewport/sketchController";
import {
  activeSketch,
  commitSketch,
  editFeature,
  featureById,
  requestView,
  startSketch,
  t,
  useApp,
  type SketchStatus,
} from "../app/store";
import { L } from "../app/i18n";
import { installKeys } from "../app/keys";
import { resolveEdge } from "../kernel/naming";
import { planeFrame } from "../core/sketch/plane";
import { arcAngles, arcMid, SketchView } from "../core/sketch/model";
import { isDimension, measure } from "../core/sketch/rules";
import { formatNumber, parseQuantity } from "../core/units";
import type { EdgeFinishFeature, Id, OriginPlane, SketchConstraint, SketchFeature, Vec2 } from "../core/types";

export function Viewport() {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CadScene | null>(null);
  const ctrlRef = useRef<SketchController | null>(null);
  const [, tick] = useReducer((x: number) => x + 1, 0);
  const [hoverPlane, setHoverPlane] = useState<OriginPlane | null>(null);
  const [hoverEdge, setHoverEdge] = useState<number | null>(null);

  const doc = useApp((s) => s.doc);
  const mode = useApp((s) => s.mode);
  const bodies = useApp((s) => s.bodies);
  const selection = useApp((s) => s.selection);
  const pickingEdges = useApp((s) => s.pickingEdges);
  const sketchStatus = useApp((s) => s.sketchStatus);
  const tool = useApp((s) => s.tool);
  const ortho = useApp((s) => s.ortho);
  const viewRequest = useApp((s) => s.viewRequest);
  const kernelReady = useApp((s) => s.kernelReady);
  const kernelError = useApp((s) => s.kernelError);
  useApp((s) => s.lang); // re-render on language change

  // mount
  useEffect(() => {
    const scene = new CadScene(host.current!);
    sceneRef.current = scene;
    const ctrl = new SketchController(scene);
    ctrlRef.current = ctrl;
    scene.onChange = tick;
    ctrl.onRedraw = tick;
    // End-to-end test hook (only with ?e2e in the URL).
    if (location.search.includes("e2e")) (window as unknown as { __cad: unknown }).__cad = { scene, ctrl, store: useApp };
    const removeKeys = installKeys({ sketchCancel: () => ctrl.cancel(), sketchDelete: () => ctrl.deleteSelection() });
    return () => {
      removeKeys();
      scene.dispose();
    };
  }, []);

  const sketch = mode.kind === "sketch" ? (doc.features.find((f) => f.id === mode.featureId) as SketchFeature | undefined) : undefined;

  // mode and grid
  useEffect(() => {
    const scene = sceneRef.current!;
    scene.setPartMode(mode.kind === "part");
    ctrlRef.current!.reset();
    scene.buildGrid(sketch ? planeFrame(sketch.plane) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode.kind, mode.kind === "sketch" ? mode.featureId : null, sketch?.plane.base, sketch?.plane.offset]);

  useEffect(() => sceneRef.current!.setOrtho(ortho), [ortho]);

  // bodies
  const fillet = pickingEdges ? featureById<EdgeFinishFeature>(pickingEdges) : undefined;
  useEffect(() => {
    const styles: Record<Id, { color: string; visible: boolean; selected: boolean }> = {};
    for (const b of bodies) {
      const meta = doc.bodies[b.id];
      styles[b.id] = {
        color: meta?.color ?? "#b8bcc4",
        visible: meta?.visible ?? true,
        selected: selection.kind === "body" && selection.id === b.id,
      };
    }
    sceneRef.current!.setBodies(bodies, styles, !!fillet);
  }, [bodies, doc.bodies, selection, fillet]);

  // edge highlight while picking
  const pickedHashes = useMemo(() => {
    if (!fillet) return new Set<number>();
    const body = bodies.find((b) => b.id === fillet.body);
    if (!body) return new Set<number>();
    return new Set(fillet.edges.map((ref) => resolveEdge(ref, body.edges)).filter((i) => i >= 0).map((i) => body.edges[i]!.hash));
  }, [fillet, bodies]);
  useEffect(() => {
    sceneRef.current!.highlightEdges(fillet?.body ?? null, pickedHashes, hoverEdge);
  }, [fillet?.body, pickedHashes, hoverEdge, bodies]);

  // sketches
  const ctrl = ctrlRef.current;
  useEffect(() => {
    const scene = sceneRef.current!;
    const sel = new Set(selection.kind === "feature" ? selection.ids : []);
    const consumed = new Set(doc.features.flatMap((f) => (f.type === "extrude" || f.type === "revolve") && !f.suppressed ? [f.sketchId] : []));
    const visible = doc.features.filter((f): f is SketchFeature => f.type === "sketch" && !f.suppressed && (mode.kind === "part" ? !consumed.has(f.id) || sel.has(f.id) : f.id !== mode.featureId));
    scene.setSketches(mode.kind === "part" ? visible : [], sel);
    if (sketch) {
      const ss = selection.kind === "sketch" ? selection : { points: [], entities: [], constraints: [] };
      const conflicting = new Set<Id>();
      for (const cid of sketchStatus?.conflicting ?? []) {
        const c = sketch.sketch.constraints.find((k) => k.id === cid);
        c?.refs.forEach((r) => conflicting.add(r));
      }
      scene.setActiveSketch(sketch, {
        selectedPoints: new Set(ss.points),
        selectedEntities: new Set(ss.entities),
        conflicting,
        hoverEntity: ctrl?.hoverEntity ?? null,
        hoverPoint: ctrl?.hoverPoint ?? null,
        fullyConstrained: sketchStatus?.dof === 0 && sketchStatus.status === "ok",
      });
    } else scene.setActiveSketch(null);
  });

  // planes
  useEffect(() => {
    sceneRef.current!.stylePlanes(hoverPlane, selection.kind === "plane" ? selection.plane : null);
  }, [hoverPlane, selection]);

  // view requests
  useEffect(() => {
    if (!viewRequest) return;
    const scene = sceneRef.current!;
    const sk = activeSketch();
    scene.setView(viewRequest.view, viewRequest.view === "normal" && sk ? { frame: planeFrame(sk.plane) } : undefined);
  }, [viewRequest]);

  /* ───────── pointer routing ───────── */

  const downAt = useRef<{ x: number; y: number; button: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    downAt.current = { x: e.clientX, y: e.clientY, button: e.button };
    const scene = sceneRef.current!;
    if (mode.kind === "sketch" && e.button === 0) {
      const p = scene.sketchPoint(e.clientX, e.clientY);
      if (p) ctrlRef.current!.down(p, { shiftKey: e.shiftKey, button: e.button, detail: e.detail });
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const scene = sceneRef.current!;
    if (mode.kind === "sketch") {
      const p = scene.sketchPoint(e.clientX, e.clientY);
      if (p) ctrlRef.current!.move(p, e.buttons);
      return;
    }
    if (e.buttons) return;
    if (fillet) {
      const h = scene.pickEdge(fillet.body, e.clientX, e.clientY);
      if (h !== hoverEdge) setHoverEdge(h);
      return;
    }
    const pl = scene.pickPlane(e.clientX, e.clientY);
    if (pl !== hoverPlane) setHoverPlane(pl);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    ctrlRef.current!.up();
    const d = downAt.current;
    downAt.current = null;
    if (!d || mode.kind === "sketch" || d.button !== 0) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return; // it was an orbit
    const scene = sceneRef.current!;
    if (fillet) {
      const h = scene.pickEdge(fillet.body, e.clientX, e.clientY);
      if (h === null) return;
      const body = bodies.find((b) => b.id === fillet.body);
      const info = body?.edges.find((x) => x.hash === h);
      if (!info) return;
      const has = pickedHashes.has(h);
      const all = body!.edges;
      const edges = has
        ? fillet.edges.filter((r) => all[resolveEdge(r, all)]?.hash !== h)
        : [...fillet.edges, info.src ? { fp: info.fp, src: info.src } : { fp: info.fp }];
      editFeature(fillet, { ...fillet, edges });
      return;
    }
    const body = scene.pickBody(e.clientX, e.clientY);
    if (body) return useApp.setState({ selection: { kind: "body", id: body }, editing: null });
    const pl = scene.pickPlane(e.clientX, e.clientY);
    if (pl) return useApp.setState({ selection: { kind: "plane", plane: pl }, editing: null });
    useApp.setState({ selection: { kind: "none" }, editing: null });
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (mode.kind !== "part") return;
    const pl = sceneRef.current!.pickPlane(e.clientX, e.clientY);
    if (pl) startSketch(pl);
  };

  /* ───────── overlay ───────── */

  const scene = sceneRef.current;
  const overlay = scene && sketch ? <SketchOverlay scene={scene} sketch={sketch} ctrl={ctrlRef.current!} status={sketchStatus} /> : null;
  const live = scene && ctrl?.live ? scene.projectLocal(ctrl.live.at) : null;
  const axes = scene?.axesOnScreen();
  const drawing = mode.kind === "sketch" && tool !== "select";

  return (
    <div
      id="view"
      ref={host}
      className={drawing ? "tool-draw" : fillet ? "pick" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => {
        e.preventDefault();
        if (mode.kind === "sketch") ctrlRef.current!.cancel();
      }}
      aria-label={t("3D viewport", "3D-вид")}
    >
      <div className="overlay">
        {overlay}
        {live && ctrl?.live ? (
          <div className="badge live" style={{ left: live[0], top: live[1] - 18 }}>
            {ctrl.live.text}
          </div>
        ) : null}
        <div className="vchip">
          {mode.kind === "sketch" && sketchStatus ? <SketchChip status={sketchStatus} empty={!sketch?.sketch.entities.length} /> : null}
          {fillet ? (
            <span className="chip">
              {t("Click edges to", "Щёлкните рёбра:")} <b>{fillet.type === "fillet" ? t("fillet", "скругление") : t("chamfer", "фаска")}</b> · {fillet.edges.length}
            </span>
          ) : null}
        </div>
        {axes ? <Triad axes={axes} /> : null}
        {!kernelReady && !kernelError && mode.kind === "part" && doc.features.length > 0 ? (
          <div className="kernel-msg">{t("Loading the geometry kernel…", "Загрузка геометрического ядра…")}</div>
        ) : null}
        {kernelError ? <div className="kernel-msg" style={{ color: "var(--bad)" }}>{kernelError}</div> : null}
        {doc.features.length === 0 && mode.kind === "part" ? (
          <div className="kernel-msg">
            {t("Pick a plane and press Sketch — or double-click a plane — to start drawing.", "Выберите плоскость и нажмите «Эскиз» — или дважды щёлкните по плоскости.")}
          </div>
        ) : null}
      </div>
      <div className="vbtns" style={{ pointerEvents: "auto" }}>
        <button onClick={() => requestView("fit")} title={t("Fit all (F)", "Показать всё (F)")}>
          {t("Fit", "Вписать")}
        </button>
        <button onClick={() => requestView(mode.kind === "sketch" ? "normal" : "iso")} title={t("Home view (H)", "Исходный вид (H)")}>
          {mode.kind === "sketch" ? t("Normal to", "Нормально") : t("Iso", "Изо")}
        </button>
        <button onClick={() => useApp.setState({ ortho: !ortho })} title={t("Perspective / orthographic (O)", "Перспектива / ортогональ (O)")}>
          {ortho ? t("Ortho", "Орто") : t("Persp", "Персп")}
        </button>
      </div>
    </div>
  );
}

function SketchChip({ status, empty }: { status: SketchStatus; empty: boolean }) {
  if (empty)
    return (
      <span className="chip">
        {t("Empty sketch — pick a tool and click to draw", "Пустой эскиз — выберите инструмент и щёлкните")}
      </span>
    );
  if (status.status === "conflicting")
    return (
      <span className="chip bad">
        <b>{t("Over-constrained", "Переопределён")}</b>
      </span>
    );
  if (status.dof === 0)
    return (
      <span className="chip ok">
        <b>{t("Fully constrained", "Полностью определён")}</b>
      </span>
    );
  return (
    <span className="chip">
      <b>{status.dof}</b> {t("degrees of freedom left", "степеней свободы")}
    </span>
  );
}

function Triad({ axes }: { axes: { x: Vec2; y: Vec2; z: Vec2 } }) {
  const c = 32;
  const r = 22;
  const items = [
    { k: "X", v: axes.x, col: "#e5534b" },
    { k: "Y", v: axes.y, col: "#6fbf73" },
    { k: "Z", v: axes.z, col: "#4b9cff" },
  ];
  return (
    <svg className="triad" viewBox="0 0 64 64" aria-hidden="true">
      {items.map(({ k, v, col }) => (
        <g key={k}>
          <line x1={c} y1={c} x2={c + v[0] * r} y2={c + v[1] * r} stroke={col} strokeWidth="2" strokeLinecap="round" />
          <text x={c + v[0] * (r + 7)} y={c + v[1] * (r + 7) + 3.5} fill={col} fontSize="10" fontWeight="600" textAnchor="middle" fontFamily="system-ui">
            {k}
          </text>
        </g>
      ))}
    </svg>
  );
}

/* ───────── dimension badges and constraint glyphs ───────── */

const GLYPH: Partial<Record<SketchConstraint["type"], string>> = {
  horizontal: "H",
  vertical: "V",
  parallel: "∥",
  perpendicular: "⊥",
  equal: "=",
  tangent: "T",
  midpoint: "M",
  fix: "⚓",
  pointOnLine: "⋯",
  pointOnCircle: "◌",
};

function SketchOverlay({ scene, sketch, ctrl, status }: { scene: CadScene; sketch: SketchFeature; ctrl: SketchController; status: SketchStatus | null }) {
  const selection = useApp((s) => s.selection);
  const [editingDim, setEditingDim] = useState<Id | null>(null);
  const [text, setText] = useState("");

  // open the editor for a just-created dimension
  useEffect(() => {
    if (ctrl.pendingDim) {
      const c = sketch.sketch.constraints.find((k) => k.id === ctrl.pendingDim);
      ctrl.pendingDim = null;
      if (c) {
        setEditingDim(c.id);
        setText(rawDim(c));
      }
    }
  });

  const v = new SketchView(sketch.sketch);
  const selCons = new Set(selection.kind === "sketch" ? selection.constraints : []);
  const bad = new Set(status?.conflicting ?? []);
  const upp = scene.unitsPerPx();
  const out: React.ReactNode[] = [];

  const at = (p: Vec2, dx = 0, dy = 0) => {
    const s = scene.projectLocal(p);
    return s ? { left: s[0] + dx, top: s[1] + dy } : null;
  };
  const select = (id: Id, e: React.MouseEvent) => {
    e.stopPropagation();
    const cur = selection.kind === "sketch" ? selection : { points: [] as Id[], entities: [] as Id[], constraints: [] as Id[] };
    useApp.setState({
      selection: e.shiftKey
        ? { kind: "sketch", ...cur, constraints: cur.constraints.includes(id) ? cur.constraints.filter((x) => x !== id) : [...cur.constraints, id] }
        : { kind: "sketch", points: [], entities: [], constraints: [id] },
    });
  };

  const glyphOffsets = new Map<Id, number>();
  for (const c of sketch.sketch.constraints) {
    try {
      if (isDimension(c)) {
        const anchor = dimAnchor(c, v, upp);
        const pos = anchor && at(anchor);
        if (!pos) continue;
        if (editingDim === c.id) {
          out.push(
            <div key={c.id} className="dimedit" style={pos} onPointerDown={(e) => e.stopPropagation()}>
              <input
                autoFocus
                value={text}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Escape") setEditingDim(null);
                  if (e.key === "Enter") {
                    try {
                      let val = parseQuantity(text, c.type === "angle" ? "angle" : "length");
                      if (c.type === "angle") val = (val * Math.PI) / 180;
                      if (c.type === "hdistance" || c.type === "vdistance") val = Math.sign(c.value ?? 1) * Math.abs(val);
                      if (val <= 0 && c.type !== "angle") throw new Error();
                      const next = { ...sketch.sketch, constraints: sketch.sketch.constraints.map((k) => (k.id === c.id ? { ...k, value: val } : k)) };
                      commitSketch(next, L("Edit dimension", "Изменить размер"));
                      setEditingDim(null);
                    } catch {
                      e.currentTarget.classList.add("bad");
                    }
                  }
                }}
                onBlur={() => setEditingDim(null)}
              />
            </div>,
          );
          continue;
        }
        out.push(
          <div
            key={c.id}
            className={`badge${c.driving === false ? " ref" : ""}${bad.has(c.id) ? " bad" : ""}${selCons.has(c.id) ? " on" : ""}`}
            style={pos}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => select(c.id, e)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditingDim(c.id);
              setText(rawDim(c));
            }}
            title={t("Double-click to edit", "Двойной щелчок — изменить")}
          >
            {fmtDim(c, measure(c, sketch.sketch))}
          </div>,
        );
        continue;
      }
      const g = GLYPH[c.type];
      if (!g) continue;
      const targets = c.type === "fix" || c.type === "midpoint" || c.type === "pointOnLine" || c.type === "pointOnCircle" ? [c.refs[0]!] : c.refs;
      for (const ref of targets) {
        const base = refAnchor(ref, v);
        if (!base) continue;
        const n = glyphOffsets.get(ref) ?? 0;
        glyphOffsets.set(ref, n + 1);
        const pos = at(base, 12 + n * 18, -12);
        if (!pos) continue;
        out.push(
          <div
            key={c.id + ref}
            className={`glyph${selCons.has(c.id) ? " on" : ""}${bad.has(c.id) ? " bad" : ""}`}
            style={pos}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => select(c.id, e)}
            title={c.type}
          >
            {g}
          </div>,
        );
      }
    } catch {
      /* stale ref */
    }
  }
  return <>{out}</>;
}

function refAnchor(id: Id, v: SketchView): Vec2 | null {
  if (v.isPoint(id)) return v.p(id);
  const e = v.ents.get(id);
  if (!e) return null;
  if (e.type === "line") {
    const a = v.p(e.p1);
    const b = v.p(e.p2);
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  }
  if (e.type === "arc") return arcMid(v, e);
  const c = v.p(e.c);
  return [c[0] + e.r * Math.SQRT1_2, c[1] + e.r * Math.SQRT1_2];
}

function dimAnchor(c: SketchConstraint, v: SketchView, upp: number): Vec2 | null {
  const e0 = v.ents.get(c.refs[0]!);
  const off = 16 * upp;
  if ((c.type === "distance" || c.type === "hdistance" || c.type === "vdistance") && e0?.type === "line" && c.refs.length === 1) {
    const a = v.p(e0.p1);
    const b = v.p(e0.p2);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const n: Vec2 = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
    return [(a[0] + b[0]) / 2 + n[0] * off, (a[1] + b[1]) / 2 + n[1] * off];
  }
  if (c.type === "radius" || c.type === "diameter") {
    if (!e0 || e0.type === "line") return null;
    const ctr = v.p(e0.c);
    if (e0.type === "arc") {
      const { a0, a1 } = arcAngles(v, e0);
      const m = (a0 + a1) / 2;
      return [ctr[0] + (e0.r + off) * Math.cos(m), ctr[1] + (e0.r + off) * Math.sin(m)];
    }
    return [ctr[0] + (e0.r + off) * Math.cos(Math.PI / 4), ctr[1] + (e0.r + off) * Math.sin(Math.PI / 4)];
  }
  if (c.type === "angle") {
    const a = refAnchor(c.refs[0]!, v);
    const b = refAnchor(c.refs[1]!, v);
    return a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : null;
  }
  const a = refAnchor(c.refs[0]!, v);
  const b = c.refs[1] ? refAnchor(c.refs[1], v) : null;
  if (a && b) return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + off];
  return a;
}

function rawDim(c: SketchConstraint): string {
  const val = c.value ?? 0;
  return c.type === "angle" ? `${formatNumber((Math.abs(val) * 180) / Math.PI, 3)}°` : `${formatNumber(Math.abs(val), 3)} mm`;
}

function fmtDim(c: SketchConstraint, measured?: number | null): string {
  const val = measured ?? c.value ?? 0;
  if (c.type === "angle") return `${formatNumber((Math.abs(val) * 180) / Math.PI, 2)}°`;
  const n = formatNumber(Math.abs(val), 2);
  if (c.type === "diameter") return `⌀${n}`;
  if (c.type === "radius") return `R${n}`;
  return n;
}
