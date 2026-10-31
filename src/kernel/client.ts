// GeometryKernel adapter (D2). The UI talks to this interface only; the
// OCCT/replicad implementation lives behind a Web Worker.

import type { Feature, Id } from "../core/types";
import type { KernelRequest, KernelResponse, RebuildResult } from "./protocol";
import wasmUrl from "replicad-opencascadejs/wasm?url";

export interface GeometryKernel {
  ready: Promise<void>;
  rebuild(features: Feature[]): Promise<RebuildResult>;
  export(format: "stl" | "step", bodyIds: Id[], names: Record<Id, string>): Promise<Blob>;
}

type Pending = { resolve: (r: KernelResponse) => void; reject: (e: Error) => void };

export class WorkerKernel implements GeometryKernel {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();
  readonly ready: Promise<void>;

  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "cocoacad-kernel" });
    this.worker.onmessage = (ev: MessageEvent<KernelResponse>) => {
      const p = this.pending.get(ev.data.id);
      if (!p) return;
      this.pending.delete(ev.data.id);
      if (ev.data.ok) p.resolve(ev.data);
      else p.reject(new Error(ev.data.error));
    };
    this.worker.onerror = (ev) => {
      for (const p of this.pending.values()) p.reject(new Error(ev.message || "Geometry worker crashed"));
      this.pending.clear();
    };
    this.ready = this.call({ type: "init", wasmUrl: new URL(wasmUrl, location.href).href }).then(() => undefined);
  }

  private call(req: DistributiveOmit<KernelRequest, "id">): Promise<KernelResponse> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...req, id });
    });
  }

  async rebuild(features: Feature[]): Promise<RebuildResult> {
    await this.ready;
    const r = await this.call({ type: "rebuild", features });
    if (r.ok && r.type === "rebuild") return r.result;
    throw new Error("Unexpected kernel reply");
  }

  async export(format: "stl" | "step", bodyIds: Id[], names: Record<Id, string>): Promise<Blob> {
    await this.ready;
    const r = await this.call({ type: "export", format, bodyIds, names });
    if (r.ok && r.type === "export") return r.blob;
    throw new Error("Unexpected kernel reply");
  }
}

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
