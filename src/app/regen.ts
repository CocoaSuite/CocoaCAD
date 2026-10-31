// Drives the geometry worker from document changes: debounced, latest-wins.

import { validateReferences } from "../core/graph";
import type { Feature } from "../core/types";
import { WorkerKernel, type GeometryKernel } from "../kernel/client";
import { saveProject } from "./storage";
import { useApp } from "./store";

let kernel: GeometryKernel | null = null;

export function getKernel(): GeometryKernel | null {
  return kernel;
}

export function startRegen() {
  kernel = new WorkerKernel();
  kernel.ready.then(
    () => {
      useApp.setState({ kernelReady: true });
      schedule();
    },
    (e: Error) => useApp.setState({ kernelError: e.message }),
  );

  let lastFeatures: Feature[] | null = null;
  let lastPicking: string | null = null;
  useApp.subscribe((s) => {
    if (s.doc.features !== lastFeatures || s.pickingEdges !== lastPicking) {
      lastFeatures = s.doc.features;
      lastPicking = s.pickingEdges;
      schedule();
    }
  });

  // Autosave (debounced) to IndexedDB.
  let lastDoc = useApp.getState().doc;
  let saveTimer = 0;
  useApp.subscribe((s) => {
    if (s.doc === lastDoc) return;
    lastDoc = s.doc;
    if (s.doc.features.length === 0) return; // don't clutter recents with empty parts
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveProject(useApp.getState().doc).catch(() => undefined);
    }, 700);
  });
}

let timer = 0;
let seq = 0;
let inflight = false;
let again = false;
let builtPicking: string | null = null;

function schedule() {
  clearTimeout(timer);
  timer = window.setTimeout(run, 30);
}

async function run() {
  if (!kernel || !useApp.getState().kernelReady) return;
  if (inflight) {
    again = true;
    return;
  }
  inflight = true;
  const my = ++seq;
  const { doc, pickingEdges } = useApp.getState();
  if (useApp.getState().builtFrom === doc.features && pickingEdges === builtPicking) {
    inflight = false;
    return;
  }
  builtPicking = pickingEdges;
  // While picking fillet/chamfer edges, show the model as it was before that feature.
  let features = doc.features;
  if (pickingEdges) {
    const i = features.findIndex((f) => f.id === pickingEdges);
    if (i >= 0) features = features.slice(0, i);
  }
  useApp.setState({ rebuilding: true });
  try {
    const result = await kernel.rebuild(features);
    if (my === seq) {
      const statics = validateReferences(doc);
      const seen = new Set(result.problems.map((p) => p.featureId));
      useApp.setState({
        bodies: result.bodies,
        builtFrom: doc.features,
        problems: [...result.problems, ...statics.filter((p) => !seen.has(p.featureId))],
        lastRebuildMs: result.ms,
      });
    }
  } catch (e) {
    useApp.setState({ kernelError: (e as Error).message });
  } finally {
    inflight = false;
    useApp.setState({ rebuilding: false });
    if (again) {
      again = false;
      schedule();
    }
  }
}
