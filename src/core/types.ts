// Document schema for CocoaCAD (.cocoacad). Parametric data only — never meshes (D6).

export type Id = string;
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export const SCHEMA_VERSION = 1;

/* ───────── Sketch model ───────── */

export interface SketchPoint {
  id: Id;
  x: number;
  y: number;
}

export interface SketchLine {
  id: Id;
  type: "line";
  p1: Id;
  p2: Id;
  construction?: boolean;
}

export interface SketchCircle {
  id: Id;
  type: "circle";
  c: Id;
  r: number;
  construction?: boolean;
}

/** Counter-clockwise from `start` to `end` around `c`. */
export interface SketchArc {
  id: Id;
  type: "arc";
  c: Id;
  start: Id;
  end: Id;
  r: number;
  construction?: boolean;
}

export type SketchEntity = SketchLine | SketchCircle | SketchArc;

export type ConstraintType =
  | "coincident"
  | "horizontal"
  | "vertical"
  | "parallel"
  | "perpendicular"
  | "equal"
  | "fix"
  | "pointOnLine"
  | "pointOnCircle"
  | "midpoint"
  | "tangent"
  | "distance"
  | "hdistance"
  | "vdistance"
  | "radius"
  | "diameter"
  | "angle";

export interface SketchConstraint {
  id: Id;
  type: ConstraintType;
  /** Point or entity ids, in the order the type expects (see sketch/constraints.ts). */
  refs: Id[];
  /** Dimension value in document units (mm) or radians for angles. */
  value?: number;
  /** Reference dimensions are measured, not enforced. */
  driving?: boolean;
}

export interface SketchData {
  points: SketchPoint[];
  entities: SketchEntity[];
  constraints: SketchConstraint[];
}

export type OriginPlane = "XY" | "XZ" | "YZ";

export interface SketchPlaneDef {
  base: OriginPlane;
  offset: number;
  flip?: boolean;
}

/* ───────── Features ───────── */

export type BodyOp = "new" | "add" | "cut" | "intersect";

interface FeatureBase {
  id: Id;
  name: string;
  suppressed?: boolean;
}

export interface SketchFeature extends FeatureBase {
  type: "sketch";
  plane: SketchPlaneDef;
  sketch: SketchData;
}

export interface ExtrudeFeature extends FeatureBase {
  type: "extrude";
  sketchId: Id;
  /** Loop keys (see profileKey) of the regions to use; empty means every closed region. */
  profiles: string[];
  distance: number;
  direction: "normal" | "reverse" | "symmetric";
  op: BodyOp;
  /** Body to modify when op ≠ "new". */
  target?: Id;
}

export type RevolveAxis =
  | { kind: "sketchAxis"; axis: "x" | "y" }
  | { kind: "sketchLine"; lineId: Id };

export interface RevolveFeature extends FeatureBase {
  type: "revolve";
  sketchId: Id;
  profiles: string[];
  axis: RevolveAxis;
  /** Degrees. */
  angle: number;
  op: BodyOp;
  target?: Id;
}

export interface BooleanFeature extends FeatureBase {
  type: "boolean";
  op: "union" | "subtract" | "intersect";
  target: Id;
  tools: Id[];
  keepTools: boolean;
}

/**
 * Edge reference (D7). `fp` is the geometric fingerprint fallback; `src` is the
 * generation-history key when the kernel could provide one.
 */
export interface EdgeRef {
  fp: { mid: Vec3; dir: Vec3; len: number };
  src?: string;
}

export interface EdgeFinishFeature extends FeatureBase {
  type: "fillet" | "chamfer";
  body: Id;
  edges: EdgeRef[];
  size: number;
}

export type Feature =
  | SketchFeature
  | ExtrudeFeature
  | RevolveFeature
  | BooleanFeature
  | EdgeFinishFeature;

export type FeatureType = Feature["type"];

export interface BodyMeta {
  id: Id;
  name: string;
  color: string;
  visible: boolean;
}

export interface CadDocument {
  schemaVersion: number;
  id: Id;
  name: string;
  units: "mm";
  features: Feature[];
  /** Keyed by the id of the feature that created the body. */
  bodies: Record<Id, BodyMeta>;
  createdAt: number;
  modifiedAt: number;
}
