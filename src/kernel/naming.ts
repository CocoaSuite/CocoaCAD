// Topological naming (D7). An edge reference is resolved by:
//   1. its generating source — the sweep feature plus the sketch point (lateral
//      edge) or sketch segment and cap (cap edge) that produced it; stable when
//      dimensions change, because it is recomputed from the current sketch;
//   2. a geometric fingerprint (midpoint, direction, length) as the fallback.
// Kept free of OCCT types so the UI can resolve references against mesh data.

import type { EdgeRef, Id, SketchData, Vec3 } from "../core/types";
import { toLocal, dot, type PlaneFrame } from "../core/sketch/plane";
import { distToEntity, SketchView } from "../core/sketch/model";
import type { EdgeInfo } from "./protocol";

export interface SweepSource {
  featureId: Id;
  frame: PlaneFrame;
  /** Signed offsets of the two caps along the sketch normal. */
  caps: [number, number];
  sketch: SketchData;
}

const TOL = 1e-3;

/** Name an edge by the sketch geometry that generated it, if it can be identified. */
export function edgeSource(info: EdgeInfo, sources: SweepSource[]): string | undefined {
  const { mid, dir } = info.fp;
  for (let s = sources.length - 1; s >= 0; s--) {
    const src = sources[s]!;
    const n = src.frame.normal;
    const v = new SketchView(src.sketch);
    const local = toLocal(src.frame, mid);
    const along = Math.abs(dot(dir, n));
    if (along > 0.999) {
      // lateral edge: runs along the sweep through a profile vertex
      for (const e of src.sketch.entities) {
        if (e.construction || e.type === "circle") continue;
        for (const pid of e.type === "line" ? [e.p1, e.p2] : [e.start, e.end]) {
          const p = v.p(pid);
          if (Math.hypot(p[0] - local[0], p[1] - local[1]) < TOL) return `${src.featureId}:v:${pid}`;
        }
      }
      continue;
    }
    if (along > 1e-3 && info.fp.len > TOL) continue;
    const h = dot([mid[0] - src.frame.origin[0], mid[1] - src.frame.origin[1], mid[2] - src.frame.origin[2]], n);
    const cap = Math.abs(h - src.caps[0]) < TOL ? 0 : Math.abs(h - src.caps[1]) < TOL ? 1 : -1;
    if (cap < 0) continue;
    for (const e of src.sketch.entities) {
      if (e.construction) continue;
      try {
        if (distToEntity(v, e, local) < TOL) return `${src.featureId}:c${cap}:${e.id}`;
      } catch {
        /* dangling */
      }
    }
  }
  return undefined;
}

/** Index of the edge a reference points to, or -1 if it cannot be resolved. */
export function resolveEdge(ref: EdgeRef, infos: EdgeInfo[]): number {
  if (ref.src) {
    const cands = infos.map((e, i) => (e.src === ref.src ? i : -1)).filter((i) => i >= 0);
    if (cands.length === 1) return cands[0]!;
    if (cands.length > 1) {
      // the source edge was split (e.g. by a Boolean); take the piece nearest the old position
      let best = cands[0]!;
      let bd = Infinity;
      for (const i of cands) {
        const d = dist3(infos[i]!.fp.mid, ref.fp.mid);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      return best;
    }
  }
  return matchFingerprint(ref, infos);
}

/** Geometric fallback: nearest midpoint with a compatible direction and length. */
export function matchFingerprint(ref: EdgeRef, infos: EdgeInfo[]): number {
  let best = -1;
  let bestScore = Infinity;
  const scale = Math.max(1, ref.fp.len);
  infos.forEach((info, i) => {
    const d = dist3(info.fp.mid, ref.fp.mid);
    const cos = Math.abs(dot(info.fp.dir, ref.fp.dir));
    const dl = Math.abs(info.fp.len - ref.fp.len) / scale;
    if (d > scale * 0.05 + 1e-3 || cos < 0.98 || dl > 0.05) return;
    const score = d + dl;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
