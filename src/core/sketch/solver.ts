// ConstraintSolver adapter (D5). The UI and core only see this interface; the
// planegcs implementation lives in solver-planegcs.ts.

import type { Id, SketchData, Vec2 } from "../types";

export type SolveStatus = "ok" | "failed" | "conflicting" | "redundant";

export interface SolveResult {
  status: SolveStatus;
  data: SketchData;
  /** Remaining degrees of freedom (0 = fully constrained). */
  dof: number;
  conflicting: Id[];
  redundant: Id[];
}

export interface DragTarget {
  pointId: Id;
  to: Vec2;
}

export interface ConstraintSolver {
  solve(data: SketchData, drag?: DragTarget[]): SolveResult;
}

/** Degrees of freedom contributed by geometry (before constraints). */
export function geometryDof(data: SketchData): number {
  return data.points.length * 2 + data.entities.filter((e) => e.type !== "line").length; // radius
}
