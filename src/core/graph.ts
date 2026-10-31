// Dependency graph over the feature history. Used for validation, delete
// warnings and deciding what to recompute (the kernel additionally caches by
// input hash, so untouched branches are never rebuilt).

import type { CadDocument, Feature, Id } from "./types";

/** Ids a feature reads from: sketches and bodies (a body id is its creating feature's id). */
export function featureInputs(f: Feature): Id[] {
  switch (f.type) {
    case "sketch":
      return [];
    case "extrude":
    case "revolve":
      return f.op === "new" || !f.target ? [f.sketchId] : [f.sketchId, f.target];
    case "boolean":
      return [f.target, ...f.tools];
    case "fillet":
    case "chamfer":
      return [f.body];
  }
}

/** Body this feature creates or modifies, if any. */
export function featureBodyOutput(f: Feature): Id | null {
  switch (f.type) {
    case "sketch":
      return null;
    case "extrude":
    case "revolve":
      return f.op === "new" ? f.id : (f.target ?? null);
    case "boolean":
      return f.target;
    case "fillet":
    case "chamfer":
      return f.body;
  }
}

/** Every body that exists after evaluating the history (excluding consumed tools). */
export function liveBodiesAt(doc: CadDocument, uptoIndex = doc.features.length - 1): Id[] {
  const live: Id[] = [];
  doc.features.slice(0, uptoIndex + 1).forEach((f) => {
    if (f.suppressed) return;
    if ((f.type === "extrude" || f.type === "revolve") && f.op === "new") live.push(f.id);
    if (f.type === "boolean" && !f.keepTools)
      for (const t of f.tools) {
        const i = live.indexOf(t);
        if (i >= 0) live.splice(i, 1);
      }
  });
  return live;
}

export interface FeatureProblem {
  featureId: Id;
  en: string;
  ru: string;
}

/** Static reference checks (geometry errors come from the kernel). */
export function validateReferences(doc: CadDocument): FeatureProblem[] {
  const problems: FeatureProblem[] = [];
  const seen = new Map<Id, Feature>();
  const bodies = new Set<Id>();
  for (const f of doc.features) {
    let broken = false;
    const push = (en: string, ru: string) => {
      broken = true;
      problems.push({ featureId: f.id, en, ru });
    };
    if (!f.suppressed) {
      if (f.type === "extrude" || f.type === "revolve") {
        const s = seen.get(f.sketchId);
        if (!s || s.type !== "sketch") push("Its sketch is missing.", "Отсутствует эскиз.");
        else if (s.suppressed) push("Its sketch is suppressed.", "Эскиз подавлен.");
        if (f.op !== "new" && (!f.target || !bodies.has(f.target)))
          push("Pick a target body.", "Выберите целевое тело.");
      }
      if (f.type === "boolean") {
        if (!bodies.has(f.target)) push("Its target body is missing.", "Отсутствует целевое тело.");
        if (f.tools.length === 0) push("Pick at least one tool body.", "Выберите хотя бы одно тело-инструмент.");
        for (const t of f.tools)
          if (!bodies.has(t)) push("A tool body is missing.", "Отсутствует тело-инструмент.");
        if (f.tools.includes(f.target)) push("A body cannot act on itself.", "Тело не может действовать на себя.");
      }
      if ((f.type === "fillet" || f.type === "chamfer") && !bodies.has(f.body))
        push("Its body is missing.", "Отсутствует тело.");
    }
    seen.set(f.id, f);
    if (!f.suppressed && !broken && (f.type === "extrude" || f.type === "revolve") && f.op === "new") bodies.add(f.id);
    if (!f.suppressed && f.type === "boolean" && !f.keepTools) for (const t of f.tools) bodies.delete(t);
  }
  return problems;
}

/** Features that (transitively) depend on any of `ids`. */
export function dependentsOf(doc: CadDocument, ids: Id[]): Id[] {
  const hit = new Set(ids);
  const out: Id[] = [];
  for (const f of doc.features) {
    if (hit.has(f.id)) continue;
    const ins = featureInputs(f);
    // A body is also "touched" by every feature that modifies it, so later
    // modifiers of a dependent body depend on it too.
    const out_ = featureBodyOutput(f);
    if (ins.some((i) => hit.has(i)) || (out_ && hit.has(out_))) {
      hit.add(f.id);
      out.push(f.id);
    }
  }
  return out;
}
