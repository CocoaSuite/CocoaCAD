/// <reference lib="webworker" />
// Geometry worker: owns the OCCT instance so long rebuilds never block the UI.

import opencascade from "replicad-opencascadejs";
import * as R from "replicad";
import { Engine, toKernelError } from "./engine";
import type { KernelRequest, KernelResponse } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

let engine: Engine | null = null;

function post(msg: KernelResponse, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

self.onmessage = async (ev: MessageEvent<KernelRequest>) => {
  const req = ev.data;
  try {
    if (req.type === "init") {
      const t0 = performance.now();
      let opts: object;
      if (req.wasmParts?.length) {
        // Hosts with a per-file size limit get the module in pieces; rejoin them here.
        const bufs = await Promise.all(req.wasmParts.map((u) => fetch(u).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`Could not load ${u} (${r.status})`))))));
        const all = new Uint8Array(bufs.reduce((s, b) => s + b.byteLength, 0));
        let o = 0;
        for (const b of bufs) {
          all.set(new Uint8Array(b), o);
          o += b.byteLength;
        }
        opts = { wasmBinary: all.buffer };
      } else opts = { locateFile: () => req.wasmUrl };
      const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)(opts);
      R.setOC(oc as Parameters<typeof R.setOC>[0]);
      engine = new Engine(R);
      post({ id: req.id, ok: true, type: "init", ms: performance.now() - t0 });
      return;
    }
    if (!engine) throw new Error("Kernel not initialised");
    if (req.type === "rebuild") {
      const result = engine.rebuild(req.features);
      // Copies, so the engine's mesh cache keeps its own arrays.
      result.bodies = result.bodies.map((b) => ({
        ...b,
        vertices: b.vertices.slice(),
        normals: b.normals.slice(),
        triangles: b.triangles.slice(),
        lines: b.lines.slice(),
      }));
      const transfer = result.bodies.flatMap((b) => [b.vertices.buffer, b.normals.buffer, b.triangles.buffer, b.lines.buffer]);
      post({ id: req.id, ok: true, type: "rebuild", result }, transfer);
      return;
    }
    if (req.type === "export") {
      const blob = engine.exportBodies(req.format, req.bodyIds, req.names);
      post({ id: req.id, ok: true, type: "export", blob });
    }
  } catch (e) {
    post({ id: req.id, ok: false, error: toKernelError(e).en });
  }
};
