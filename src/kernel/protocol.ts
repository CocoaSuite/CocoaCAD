// Messages between the UI thread and the geometry worker. Typed arrays travel as
// transferables. Nothing here depends on OCCT/replicad types.

import type { Feature, Id, Vec3 } from "../core/types";

export interface EdgeInfo {
  /** OCCT hash; matches edgeGroups[].edgeId in the mesh. */
  hash: number;
  fp: { mid: Vec3; dir: Vec3; len: number };
  /** Generating-source name (see kernel/naming.ts), when identifiable. */
  src?: string;
}

export interface BodyMesh {
  id: Id;
  /** Input hash of the body's final state; unchanged key = unchanged geometry. */
  key: string;
  vertices: Float32Array;
  normals: Float32Array;
  triangles: Uint32Array;
  faceGroups: { start: number; count: number; faceId: number }[];
  lines: Float32Array;
  edgeGroups: { start: number; count: number; edgeId: number }[];
  edges: EdgeInfo[];
  volume: number;
  area: number;
  bbox: [Vec3, Vec3];
}

export interface KernelProblem {
  featureId: Id;
  en: string;
  ru: string;
}

export interface RebuildResult {
  bodies: BodyMesh[];
  problems: KernelProblem[];
  /** Features actually recomputed this pass (the rest came from cache). */
  recomputed: Id[];
  ms: number;
}

export type KernelRequest =
  | { id: number; type: "init"; wasmUrl: string; wasmParts?: string[] }
  | { id: number; type: "rebuild"; features: Feature[] }
  | { id: number; type: "export"; format: "stl" | "step"; bodyIds: Id[]; names: Record<Id, string> };

export type KernelResponse =
  | { id: number; ok: true; type: "init"; ms: number }
  | { id: number; ok: true; type: "rebuild"; result: RebuildResult }
  | { id: number; ok: true; type: "export"; blob: Blob }
  | { id: number; ok: false; error: string };
