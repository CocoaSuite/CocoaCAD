// Three.js viewport, framework-free. Z-up world, CAD mouse conventions:
// left-drag orbits in part mode, right-drag orbits always, middle-drag or
// Shift+right pans, wheel zooms toward the cursor.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Id, OriginPlane, SketchFeature, Vec2, Vec3 } from "../core/types";
import { planeFrame, toLocal, toWorld, type PlaneFrame } from "../core/sketch/plane";
import { arcAngles, SketchView } from "../core/sketch/model";
import { findProfiles } from "../core/sketch/profiles";
import type { BodyMesh } from "../kernel/protocol";
import type { ViewName } from "../app/store";

const COL = {
  sketch: 0xececec,
  sketchDim: 0x8f8f8f,
  construction: 0x8f8f8f,
  sel: 0x4b9cff,
  bad: 0xff8a73,
  edge: 0x0d0d0d,
  hover: 0x9cc7ff,
  preview: 0x4b9cff,
  region: 0x4b9cff,
  plane: 0x6b8fb8,
  x: 0xe5534b,
  y: 0x6fbf73,
  z: 0x4b9cff,
};

export interface SketchStyle {
  selectedPoints: Set<Id>;
  selectedEntities: Set<Id>;
  conflicting: Set<Id>;
  hoverEntity: Id | null;
  hoverPoint: Id | null;
  fullyConstrained: boolean;
}

export interface BodyStyle {
  color: string;
  visible: boolean;
  selected: boolean;
}

export class CadScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  private persp: THREE.PerspectiveCamera;
  private orthoCam: THREE.OrthographicCamera;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  controls: OrbitControls;
  private light = new THREE.DirectionalLight(0xffffff, 1.6);

  private bodiesGroup = new THREE.Group();
  private sketchesGroup = new THREE.Group();
  private activeGroup = new THREE.Group();
  private previewGroup = new THREE.Group();
  private planesGroup = new THREE.Group();
  private gridGroup = new THREE.Group();
  private edgeHi = new THREE.Group();

  private bodyObjs = new Map<Id, { key: string; mesh: THREE.Mesh; edges: THREE.LineSegments; data: BodyMesh }>();
  private planeMeshes = new Map<OriginPlane, THREE.Mesh>();
  private raf = 0;
  private dirty = true;
  private ro: ResizeObserver;
  onChange: () => void = () => {};
  sketchFrame: PlaneFrame | null = null;
  private partMode = true;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x1f1f1f);
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.tabIndex = 0;

    THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
    this.persp = new THREE.PerspectiveCamera(40, 1, 0.1, 100000);
    this.orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -100000, 100000);
    this.persp.up.set(0, 0, 1);
    this.orthoCam.up.set(0, 0, 1);
    this.camera = this.persp;
    this.persp.position.set(120, -160, 110);
    this.orthoCam.position.copy(this.persp.position);
    this.controls = this.makeControls();

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2a2a, 1.2));
    this.scene.add(this.light);
    this.scene.add(this.light.target);
    for (const g of [this.gridGroup, this.planesGroup, this.bodiesGroup, this.sketchesGroup, this.activeGroup, this.previewGroup, this.edgeHi]) this.scene.add(g);
    this.buildPlanes();
    this.buildGrid(null);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      if (this.dirty) {
        this.dirty = false;
        this.light.position.copy(this.camera.position);
        this.light.target.position.copy(this.controls.target);
        this.renderer.render(this.scene, this.camera);
      }
    };
    loop();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  invalidate() {
    this.dirty = true;
  }

  private makeControls() {
    const c = new OrbitControls(this.camera, this.renderer.domElement);
    c.enableDamping = false;
    c.zoomToCursor = true;
    c.screenSpacePanning = true;
    c.rotateSpeed = 0.8;
    c.addEventListener("change", () => {
      this.dirty = true;
      this.onChange();
    });
    this.applyMouseButtons(c);
    return c;
  }

  private applyMouseButtons(c = this.controls) {
    c.mouseButtons = {
      LEFT: (this.partMode ? THREE.MOUSE.ROTATE : null) as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    c.touches = { ONE: (this.partMode ? THREE.TOUCH.ROTATE : null) as THREE.TOUCH, TWO: THREE.TOUCH.DOLLY_PAN };
  }

  setPartMode(part: boolean) {
    this.partMode = part;
    this.applyMouseButtons();
    this.planesGroup.visible = part;
  }

  setOrtho(ortho: boolean) {
    const from = this.camera;
    const to = ortho ? this.orthoCam : this.persp;
    if (from === to) return;
    const target = this.controls.target.clone();
    const dist = from.position.distanceTo(target);
    to.position.copy(from.position);
    to.quaternion.copy(from.quaternion);
    to.up.copy(from.up);
    if (to instanceof THREE.OrthographicCamera) {
      // match the visible height at the target distance
      const h = 2 * dist * Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2));
      to.zoom = 1;
      this.orthoHeight = h;
    } else if (from instanceof THREE.OrthographicCamera) {
      const h = this.orthoHeight / from.zoom;
      const d = h / 2 / Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2));
      const dir = from.position.clone().sub(target).normalize();
      to.position.copy(target).addScaledVector(dir, d);
    }
    this.camera = to;
    this.controls.dispose();
    this.controls = this.makeControls();
    this.controls.target.copy(target);
    this.resize();
    this.controls.update();
  }
  private orthoHeight = 200;

  resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    const oh = this.orthoHeight;
    this.orthoCam.left = (-oh * (w / h)) / 2;
    this.orthoCam.right = (oh * (w / h)) / 2;
    this.orthoCam.top = oh / 2;
    this.orthoCam.bottom = -oh / 2;
    this.orthoCam.updateProjectionMatrix();
    this.dirty = true;
    this.onChange();
  }

  /* ───────── views ───────── */

  setView(view: ViewName, sketchNormal?: { frame: PlaneFrame }) {
    const box = this.contentBox();
    const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const size = box.isEmpty() ? 100 : Math.max(20, box.getSize(new THREE.Vector3()).length());
    let dir = new THREE.Vector3(1, -1.25, 0.9);
    let up = new THREE.Vector3(0, 0, 1);
    const dirs: Partial<Record<ViewName, [number, number, number]>> = {
      top: [0, 0, 1],
      bottom: [0, 0, -1],
      front: [0, -1, 0],
      back: [0, 1, 0],
      right: [1, 0, 0],
      left: [-1, 0, 0],
    };
    if (view === "normal" && sketchNormal) {
      const f = sketchNormal.frame;
      dir = new THREE.Vector3(...f.normal);
      up = new THREE.Vector3(...f.yDir);
    } else if (view === "fit") {
      dir = this.camera.position.clone().sub(this.controls.target).normalize();
      up = this.camera.up.clone();
    } else if (dirs[view]) {
      dir = new THREE.Vector3(...dirs[view]!);
      if (view === "top") up = new THREE.Vector3(0, 1, 0);
      if (view === "bottom") up = new THREE.Vector3(0, -1, 0);
    }
    dir.normalize();
    const target = view === "normal" && sketchNormal && box.isEmpty() ? new THREE.Vector3(...sketchNormal.frame.origin) : center;
    const dist = size / 2 / Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2)) * 1.15;
    this.animateTo(target, target.clone().addScaledVector(dir, dist), up, size * 1.2);
  }

  private anim = 0;
  private animateTo(target: THREE.Vector3, pos: THREE.Vector3, up: THREE.Vector3, orthoSize: number) {
    cancelAnimationFrame(this.anim);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now();
    const fromT = this.controls.target.clone();
    const fromP = this.camera.position.clone();
    const fromU = this.camera.up.clone();
    const fromZoom = this.camera instanceof THREE.OrthographicCamera ? this.camera.zoom : 1;
    const toZoom = this.orthoHeight / orthoSize;
    const dur = reduce ? 0 : 340;
    const step = () => {
      const k = dur === 0 ? 1 : Math.min(1, (performance.now() - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      this.controls.target.lerpVectors(fromT, target, e);
      // interpolate direction & distance separately to avoid flying through the model
      const d0 = fromP.clone().sub(fromT);
      const d1 = pos.clone().sub(target);
      const len = THREE.MathUtils.lerp(d0.length(), d1.length(), e);
      const dir = d0.normalize().lerp(d1.normalize(), e).normalize();
      this.camera.position.copy(this.controls.target).addScaledVector(dir, len);
      this.camera.up.copy(fromU).lerp(up, e).normalize();
      if (this.camera instanceof THREE.OrthographicCamera) {
        this.camera.zoom = THREE.MathUtils.lerp(fromZoom, toZoom, e);
        this.camera.updateProjectionMatrix();
      }
      this.camera.lookAt(this.controls.target);
      this.controls.update();
      this.dirty = true;
      this.onChange();
      if (k < 1) this.anim = requestAnimationFrame(step);
    };
    step();
  }

  private contentBox(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const o of this.bodyObjs.values()) if (o.mesh.visible) box.expandByObject(o.mesh);
    if (this.activeGroup.children.length) box.expandByObject(this.activeGroup);
    else if (this.sketchesGroup.children.length) box.expandByObject(this.sketchesGroup);
    return box;
  }

  /* ───────── grid & origin planes ───────── */

  buildGrid(frame: PlaneFrame | null, size = 200) {
    this.gridGroup.clear();
    const step = niceStep(size / 20);
    const half = Math.ceil(size / step) * step;
    const minor: number[] = [];
    const major: number[] = [];
    for (let v = -half; v <= half + 1e-9; v += step) {
      const isMajor = Math.abs(v / (step * 5) - Math.round(v / (step * 5))) < 1e-6;
      const arr = isMajor ? major : minor;
      arr.push(v, -half, 0, v, half, 0, -half, v, 0, half, v, 0);
    }
    const mk = (arr: number[], opacity: number) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
      return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthWrite: false }));
    };
    const grid = new THREE.Group();
    grid.add(mk(minor, 0.045), mk(major, 0.09));
    // axes through origin
    const ax = new THREE.BufferGeometry();
    ax.setAttribute("position", new THREE.Float32BufferAttribute([-half, 0, 0, half, 0, 0, 0, -half, 0, 0, half, 0], 3));
    ax.setAttribute("color", new THREE.Float32BufferAttribute(frame ? [0.9, 0.33, 0.29, 0.9, 0.33, 0.29, 0.44, 0.75, 0.45, 0.44, 0.75, 0.45] : [0.9, 0.33, 0.29, 0.9, 0.33, 0.29, 0.44, 0.75, 0.45, 0.44, 0.75, 0.45], 3));
    grid.add(new THREE.LineSegments(ax, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false })));
    if (frame) {
      const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...frame.xDir), new THREE.Vector3(...frame.yDir), new THREE.Vector3(...frame.normal));
      m.setPosition(...frame.origin);
      grid.applyMatrix4(m);
    } else {
      // world Z axis
      const z = new THREE.BufferGeometry();
      z.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, half / 2], 3));
      grid.add(new THREE.LineSegments(z, new THREE.LineBasicMaterial({ color: COL.z, transparent: true, opacity: 0.55 })));
    }
    grid.renderOrder = -1;
    this.gridGroup.add(grid);
    this.gridStep = step;
    this.dirty = true;
  }
  gridStep = 10;

  private buildPlanes() {
    const s = 40;
    for (const name of ["XY", "XZ", "YZ"] as OriginPlane[]) {
      const f = planeFrame({ base: name, offset: 0 });
      const geo = new THREE.PlaneGeometry(s, s);
      const mat = new THREE.MeshBasicMaterial({ color: COL.plane, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false });
      const mesh = new THREE.Mesh(geo, mat);
      const border = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: COL.plane, transparent: true, opacity: 0.5 }));
      mesh.add(border);
      const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...f.xDir), new THREE.Vector3(...f.yDir), new THREE.Vector3(...f.normal));
      m.setPosition(f.xDir[0] * s / 2 + f.yDir[0] * s / 2, f.xDir[1] * s / 2 + f.yDir[1] * s / 2, f.xDir[2] * s / 2 + f.yDir[2] * s / 2);
      mesh.applyMatrix4(m);
      mesh.userData = { plane: name };
      this.planeMeshes.set(name, mesh);
      this.planesGroup.add(mesh);
    }
  }

  stylePlanes(hover: OriginPlane | null, selected: OriginPlane | null) {
    for (const [name, m] of this.planeMeshes) {
      const on = name === hover || name === selected;
      (m.material as THREE.MeshBasicMaterial).opacity = name === selected ? 0.22 : on ? 0.16 : 0.08;
      (m.material as THREE.MeshBasicMaterial).color.setHex(name === selected ? COL.sel : COL.plane);
    }
    this.dirty = true;
  }

  /* ───────── bodies ───────── */

  setBodies(bodies: BodyMesh[], styles: Record<Id, BodyStyle>, edgeMode: boolean) {
    const keep = new Set<Id>();
    for (const b of bodies) {
      keep.add(b.id);
      let o = this.bodyObjs.get(b.id);
      if (!o || o.key !== b.key) {
        if (o) this.disposeBody(o);
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(b.vertices, 3));
        g.setAttribute("normal", new THREE.BufferAttribute(b.normals, 3));
        g.setIndex(new THREE.BufferAttribute(b.triangles, 1));
        g.computeBoundingSphere();
        const mesh = new THREE.Mesh(
          g,
          new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 0.05, roughness: 0.62, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
        );
        mesh.userData = { body: b.id };
        const eg = new THREE.BufferGeometry();
        eg.setAttribute("position", new THREE.BufferAttribute(b.lines, 3));
        const edges = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: COL.edge }));
        edges.userData = { body: b.id };
        this.bodiesGroup.add(mesh, edges);
        o = { key: b.key, mesh, edges, data: b };
        this.bodyObjs.set(b.id, o);
      }
      const st = styles[b.id] ?? { color: "#b8bcc4", visible: true, selected: false };
      const mat = o.mesh.material as THREE.MeshStandardMaterial;
      mat.color.set(st.color);
      mat.emissive.setHex(st.selected ? 0x1d3d66 : 0x000000);
      mat.transparent = edgeMode;
      mat.opacity = edgeMode ? 0.92 : 1;
      o.mesh.visible = st.visible;
      o.edges.visible = st.visible;
      (o.edges.material as THREE.LineBasicMaterial).color.setHex(st.selected ? 0x2c5a94 : COL.edge);
    }
    for (const [id, o] of this.bodyObjs) if (!keep.has(id)) (this.disposeBody(o), this.bodyObjs.delete(id));
    this.dirty = true;
  }

  private disposeBody(o: { mesh: THREE.Mesh; edges: THREE.LineSegments }) {
    this.bodiesGroup.remove(o.mesh, o.edges);
    o.mesh.geometry.dispose();
    (o.mesh.material as THREE.Material).dispose();
    o.edges.geometry.dispose();
    (o.edges.material as THREE.Material).dispose();
  }

  /** Highlight edges (by OCCT hash) of a body; used while picking fillet edges. */
  highlightEdges(bodyId: Id | null, hashes: Set<number>, hover: number | null) {
    this.edgeHi.clear();
    if (!bodyId) return void (this.dirty = true);
    const o = this.bodyObjs.get(bodyId);
    if (!o) return;
    const add = (hs: Set<number>, color: number, width: number) => {
      const arr: number[] = [];
      for (const g of o.data.edgeGroups) {
        if (!hs.has(g.edgeId)) continue;
        for (let i = g.start; i < g.start + g.count; i++) arr.push(o.data.lines[i * 3]!, o.data.lines[i * 3 + 1]!, o.data.lines[i * 3 + 2]!);
      }
      if (!arr.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
      const ls = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, linewidth: width, depthTest: false, transparent: true }));
      ls.renderOrder = 10;
      this.edgeHi.add(ls);
    };
    add(hashes, COL.sel, 2);
    if (hover !== null && !hashes.has(hover)) add(new Set([hover]), COL.hover, 2);
    this.dirty = true;
  }

  /* ───────── sketches ───────── */

  /** Inactive sketches (thin) in part mode; hidden while editing one. */
  setSketches(sketches: SketchFeature[], selected: Set<Id>) {
    disposeGroup(this.sketchesGroup);
    for (const s of sketches) {
      const color = selected.has(s.id) ? COL.sel : COL.sketchDim;
      this.sketchesGroup.add(sketchObject(s, color, false, null));
    }
    this.dirty = true;
  }

  setActiveSketch(s: SketchFeature | null, style?: SketchStyle) {
    disposeGroup(this.activeGroup);
    this.sketchFrame = s ? planeFrame(s.plane) : null;
    if (s && style) {
      this.activeGroup.add(sketchObject(s, COL.sketch, true, style));
    }
    this.dirty = true;
  }

  /** Preview geometry while a sketch tool is active (local coords). */
  setPreview(segments: { a: Vec2; b: Vec2 }[], arcs: { c: Vec2; r: number; a0: number; a1: number }[], points: Vec2[]) {
    disposeGroup(this.previewGroup);
    const f = this.sketchFrame;
    if (!f) return;
    const arr: number[] = [];
    for (const s of segments) arr.push(...toWorld(f, s.a), ...toWorld(f, s.b));
    for (const a of arcs) {
      const n = Math.max(8, Math.ceil((a.a1 - a.a0) / (Math.PI / 48)));
      for (let i = 0; i < n; i++) {
        const t0 = a.a0 + ((a.a1 - a.a0) * i) / n;
        const t1 = a.a0 + ((a.a1 - a.a0) * (i + 1)) / n;
        arr.push(...toWorld(f, [a.c[0] + a.r * Math.cos(t0), a.c[1] + a.r * Math.sin(t0)]), ...toWorld(f, [a.c[0] + a.r * Math.cos(t1), a.c[1] + a.r * Math.sin(t1)]));
      }
    }
    if (arr.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: COL.preview, depthTest: false, transparent: true }));
      l.renderOrder = 20;
      this.previewGroup.add(l);
    }
    if (points.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(points.flatMap((p) => toWorld(f, p)), 3));
      const pts = new THREE.Points(g, pointMaterial(COL.preview, 9));
      pts.renderOrder = 21;
      this.previewGroup.add(pts);
    }
    this.dirty = true;
  }

  /* ───────── projection & picking ───────── */

  private ray = new THREE.Raycaster();

  private ndc(x: number, y: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  }

  /** Client point → sketch-local coordinates on the active sketch plane. */
  sketchPoint(x: number, y: number): Vec2 | null {
    const f = this.sketchFrame;
    if (!f) return null;
    this.ray.setFromCamera(this.ndc(x, y), this.camera);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(...f.normal), new THREE.Vector3(...f.origin));
    const hit = this.ray.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return null;
    return toLocal(f, [hit.x, hit.y, hit.z]);
  }

  /** World point → client-relative pixel position in the viewport element. */
  project(p: Vec3): [number, number] | null {
    const v = new THREE.Vector3(...p).project(this.camera);
    if (v.z > 1) return null;
    const el = this.renderer.domElement;
    return [((v.x + 1) / 2) * el.clientWidth, ((1 - v.y) / 2) * el.clientHeight];
  }

  projectLocal(p: Vec2): [number, number] | null {
    return this.sketchFrame ? this.project(toWorld(this.sketchFrame, p)) : null;
  }

  /** World units per screen pixel around a sketch-local point. */
  unitsPerPx(at: Vec2 = [0, 0]): number {
    const a = this.projectLocal(at);
    const b = this.projectLocal([at[0] + 1, at[1]]);
    const c = this.projectLocal([at[0], at[1] + 1]);
    if (!a || !b || !c) return 1;
    const px = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - a[0], c[1] - a[1]));
    return px > 1e-9 ? 1 / px : 1;
  }

  pickPlane(x: number, y: number): OriginPlane | null {
    if (!this.planesGroup.visible) return null;
    this.ray.setFromCamera(this.ndc(x, y), this.camera);
    const bodies = this.ray.intersectObjects([...this.bodyObjs.values()].filter((o) => o.mesh.visible).map((o) => o.mesh), false);
    const hits = this.ray.intersectObjects([...this.planeMeshes.values()], false);
    const h = hits[0];
    if (!h) return null;
    if (bodies[0] && bodies[0].distance < h.distance) return null;
    return h.object.userData.plane as OriginPlane;
  }

  pickBody(x: number, y: number): Id | null {
    this.ray.setFromCamera(this.ndc(x, y), this.camera);
    const hits = this.ray.intersectObjects([...this.bodyObjs.values()].filter((o) => o.mesh.visible).map((o) => o.mesh), false);
    return (hits[0]?.object.userData.body as Id) ?? null;
  }

  /** Nearest edge of a body under the cursor (screen-space distance ≤ tol px). */
  pickEdge(bodyId: Id, x: number, y: number, tol = 7): number | null {
    const o = this.bodyObjs.get(bodyId);
    if (!o) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    const mx = x - r.left;
    const my = y - r.top;
    let best: number | null = null;
    let bestD = tol;
    // occlusion: ignore edges well behind the first surface hit
    this.ray.setFromCamera(this.ndc(x, y), this.camera);
    const surf = this.ray.intersectObject(o.mesh, false)[0]?.distance ?? Infinity;
    const camPos = this.camera.position;
    for (const g of o.data.edgeGroups) {
      for (let i = g.start; i < g.start + g.count; i += 2) {
        const a: Vec3 = [o.data.lines[i * 3]!, o.data.lines[i * 3 + 1]!, o.data.lines[i * 3 + 2]!];
        const b: Vec3 = [o.data.lines[i * 3 + 3]!, o.data.lines[i * 3 + 4]!, o.data.lines[i * 3 + 5]!];
        const pa = this.project(a);
        const pb = this.project(b);
        if (!pa || !pb) continue;
        const d = segDist([mx, my], pa, pb);
        if (d < bestD) {
          const mid = new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
          const depth = mid.distanceTo(camPos);
          if (surf !== Infinity && depth > surf + o.mesh.geometry.boundingSphere!.radius * 0.02 + 0.5) continue;
          bestD = d;
          best = g.edgeId;
        }
      }
    }
    return best;
  }

  /** Screen-space axis directions for the orientation triad. */
  axesOnScreen(): { x: Vec2; y: Vec2; z: Vec2 } {
    const m = this.camera.matrixWorldInverse;
    const f = (v: THREE.Vector3): Vec2 => {
      const d = v.clone().transformDirection(m);
      return [d.x, -d.y];
    };
    return { x: f(new THREE.Vector3(1, 0, 0)), y: f(new THREE.Vector3(0, 1, 0)), z: f(new THREE.Vector3(0, 0, 1)) };
  }

  snapshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }
}

/* ───────── helpers ───────── */

function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
}

function segDist(p: [number, number], a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

const dotTex = (() => {
  let tex: THREE.Texture | null = null;
  return () => {
    if (tex) return tex;
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc(16, 16, 13, 0, Math.PI * 2);
    g.fill();
    tex = new THREE.CanvasTexture(c);
    return tex;
  };
})();

function pointMaterial(color: number, size: number) {
  return new THREE.PointsMaterial({ color, size, sizeAttenuation: false, map: dotTex(), alphaTest: 0.5, depthTest: false, transparent: true });
}

function disposeGroup(g: THREE.Group) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
  g.clear();
}

function sketchObject(s: SketchFeature, baseColor: number, active: boolean, style: SketchStyle | null): THREE.Group {
  const f = planeFrame(s.plane);
  const v = new SketchView(s.sketch);
  const g = new THREE.Group();
  const buckets = new Map<string, { color: number; dashed: boolean; arr: number[] }>();
  const push = (color: number, dashed: boolean, a: Vec2, b: Vec2) => {
    const k = `${color}:${dashed}`;
    if (!buckets.has(k)) buckets.set(k, { color, dashed, arr: [] });
    buckets.get(k)!.arr.push(...toWorld(f, a), ...toWorld(f, b));
  };
  for (const e of s.sketch.entities) {
    let color = baseColor;
    if (style) {
      if (style.conflicting.has(e.id)) color = COL.bad;
      else if (style.selectedEntities.has(e.id)) color = COL.sel;
      else if (style.hoverEntity === e.id) color = COL.hover;
      else if (e.construction) color = COL.construction;
      else if (style.fullyConstrained) color = 0xd8e8d8;
    } else if (e.construction) continue;
    const dashed = !!e.construction;
    try {
      if (e.type === "line") push(color, dashed, v.p(e.p1), v.p(e.p2));
      else {
        const c = v.p(e.c);
        const [a0, a1] = e.type === "circle" ? [0, Math.PI * 2] : (({ a0, a1 }) => [a0, a1])(arcAngles(v, e));
        const n = Math.max(12, Math.ceil((a1 - a0) / (Math.PI / 64)));
        for (let i = 0; i < n; i++) {
          const t0 = a0 + ((a1 - a0) * i) / n;
          const t1 = a0 + ((a1 - a0) * (i + 1)) / n;
          push(color, dashed, [c[0] + e.r * Math.cos(t0), c[1] + e.r * Math.sin(t0)], [c[0] + e.r * Math.cos(t1), c[1] + e.r * Math.sin(t1)]);
        }
      }
    } catch {
      /* dangling reference; skip */
    }
  }
  for (const b of buckets.values()) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(b.arr, 3));
    const mat = b.dashed
      ? new THREE.LineDashedMaterial({ color: b.color, dashSize: 2, gapSize: 1.5, depthTest: !active, transparent: true })
      : new THREE.LineBasicMaterial({ color: b.color, depthTest: !active, transparent: true });
    const ls = new THREE.LineSegments(geo, mat);
    if (b.dashed) ls.computeLineDistances();
    ls.renderOrder = active ? 15 : 5;
    g.add(ls);
  }
  if (active && style) {
    // filled regions so closed profiles read at a glance
    const prof = findProfiles(s.sketch);
    for (const r of prof.regions) {
      if (r.depth % 2 !== 0) continue;
      const shape = new THREE.Shape(r.outer.polygon.map(([x, y]) => new THREE.Vector2(x, y)));
      for (const h of r.holes) shape.holes.push(new THREE.Path(h.polygon.map(([x, y]) => new THREE.Vector2(x, y))));
      const geo = new THREE.ShapeGeometry(shape);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: COL.region, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false, depthTest: false }));
      const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...f.xDir), new THREE.Vector3(...f.yDir), new THREE.Vector3(...f.normal));
      m.setPosition(...f.origin);
      mesh.applyMatrix4(m);
      mesh.renderOrder = 14;
      g.add(mesh);
    }
    // points
    const groups = new Map<number, number[]>();
    for (const p of s.sketch.points) {
      const color = style.selectedPoints.has(p.id) ? COL.sel : style.hoverPoint === p.id ? COL.hover : COL.sketch;
      if (!groups.has(color)) groups.set(color, []);
      groups.get(color)!.push(...toWorld(f, [p.x, p.y]));
    }
    for (const [color, arr] of groups) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
      const pts = new THREE.Points(geo, pointMaterial(color, color === COL.sketch ? 6 : 9));
      pts.renderOrder = 16;
      g.add(pts);
    }
  }
  return g;
}
