import type { SketchPlaneDef, Vec2, Vec3 } from "../types";

/** Right-handed frame of a sketch plane in world space (Z-up). */
export interface PlaneFrame {
  origin: Vec3;
  xDir: Vec3;
  yDir: Vec3;
  normal: Vec3;
}

const BASES: Record<SketchPlaneDef["base"], { x: Vec3; y: Vec3; n: Vec3 }> = {
  XY: { x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] }, // Top
  XZ: { x: [1, 0, 0], y: [0, 0, 1], n: [0, -1, 0] }, // Front
  YZ: { x: [0, 1, 0], y: [0, 0, 1], n: [1, 0, 0] }, // Right
};

export function planeFrame(def: SketchPlaneDef): PlaneFrame {
  const b = BASES[def.base];
  const sign = def.flip ? -1 : 1;
  const xDir: Vec3 = [b.x[0] * sign, b.x[1] * sign, b.x[2] * sign];
  const normal: Vec3 = [b.n[0] * sign, b.n[1] * sign, b.n[2] * sign];
  return {
    origin: [b.n[0] * def.offset, b.n[1] * def.offset, b.n[2] * def.offset],
    xDir,
    yDir: b.y,
    normal,
  };
}

export function toWorld(f: PlaneFrame, p: Vec2): Vec3 {
  return [
    f.origin[0] + f.xDir[0] * p[0] + f.yDir[0] * p[1],
    f.origin[1] + f.xDir[1] * p[0] + f.yDir[1] * p[1],
    f.origin[2] + f.xDir[2] * p[0] + f.yDir[2] * p[1],
  ];
}

export function toLocal(f: PlaneFrame, p: Vec3): Vec2 {
  const d: Vec3 = [p[0] - f.origin[0], p[1] - f.origin[1], p[2] - f.origin[2]];
  return [dot(d, f.xDir), dot(d, f.yDir)];
}

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
