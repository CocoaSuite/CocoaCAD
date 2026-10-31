// Command-based undo (D8). Every command knows how to apply and invert itself on
// an immutable document. The stack never stores whole-document snapshots.

import type { BodyMeta, CadDocument, Feature, Id } from "./types";

export interface Label {
  en: string;
  ru: string;
}

export interface Command {
  label: Label;
  apply(doc: CadDocument): CadDocument;
  invert(doc: CadDocument): CadDocument;
  /** Consecutive commands with the same key merge into one undo step (e.g. scrubbing a value). */
  mergeKey?: string;
  /** Combine with a following command of the same mergeKey. */
  merge?(next: Command): Command;
}

const touch = (doc: CadDocument): CadDocument => ({ ...doc, modifiedAt: Date.now() });

function indexOf(doc: CadDocument, id: Id): number {
  const i = doc.features.findIndex((f) => f.id === id);
  if (i < 0) throw new Error(`Feature ${id} not found`);
  return i;
}

/* ───────── Concrete commands ───────── */

export function addFeature(feature: Feature, opts: { index?: number; body?: BodyMeta; label?: Label } = {}): Command {
  return {
    label: opts.label ?? { en: `Add ${feature.name}`, ru: `Добавить «${feature.name}»` },
    apply(doc) {
      const features = doc.features.slice();
      const at = opts.index ?? features.length;
      features.splice(at, 0, feature);
      const bodies = opts.body ? { ...doc.bodies, [opts.body.id]: opts.body } : doc.bodies;
      return touch({ ...doc, features, bodies });
    },
    invert(doc) {
      const features = doc.features.filter((f) => f.id !== feature.id);
      let bodies = doc.bodies;
      if (opts.body) {
        bodies = { ...bodies };
        delete bodies[opts.body.id];
      }
      return touch({ ...doc, features, bodies });
    },
  };
}

export function removeFeatures(doc0: CadDocument, ids: Id[], label?: Label): Command {
  // Capture what is needed to invert, at construction time.
  const removed = ids
    .map((id) => ({ index: indexOf(doc0, id), feature: doc0.features[indexOf(doc0, id)]! }))
    .sort((a, b) => a.index - b.index);
  const bodies = ids.map((id) => doc0.bodies[id]).filter((b): b is BodyMeta => !!b);
  return {
    label: label ?? { en: "Delete", ru: "Удалить" },
    apply(doc) {
      const set = new Set(ids);
      const nextBodies = { ...doc.bodies };
      for (const id of ids) delete nextBodies[id];
      return touch({ ...doc, features: doc.features.filter((f) => !set.has(f.id)), bodies: nextBodies });
    },
    invert(doc) {
      const features = doc.features.slice();
      for (const r of removed) features.splice(r.index, 0, r.feature);
      const nextBodies = { ...doc.bodies };
      for (const b of bodies) nextBodies[b.id] = b;
      return touch({ ...doc, features, bodies: nextBodies });
    },
  };
}

export function updateFeature<F extends Feature>(before: F, after: F, label?: Label, mergeKey?: string): Command {
  if (before.id !== after.id) throw new Error("updateFeature: id mismatch");
  const swap = (doc: CadDocument, from: Feature, to: Feature) => {
    const i = indexOf(doc, from.id);
    const features = doc.features.slice();
    features[i] = to;
    return touch({ ...doc, features });
  };
  const cmd: UpdateFeatureCommand<F> = {
    label: label ?? { en: `Edit ${after.name}`, ru: `Изменить «${after.name}»` },
    after,
    apply: (doc) => swap(doc, before, after),
    invert: (doc) => swap(doc, after, before),
  };
  if (mergeKey) {
    cmd.mergeKey = mergeKey;
    // Keep the oldest "before" and the newest "after": one undo step for a whole drag.
    cmd.merge = (next) => {
      const n = next as Partial<UpdateFeatureCommand<F>>;
      return n.after ? updateFeature(before, n.after, label, mergeKey) : next;
    };
  }
  return cmd;
}

interface UpdateFeatureCommand<F extends Feature> extends Command {
  after: F;
}

export function moveFeature(id: Id, from: number, to: number): Command {
  const mv = (doc: CadDocument, a: number, b: number) => {
    const features = doc.features.slice();
    const [f] = features.splice(a, 1);
    if (!f || f.id !== id) throw new Error("moveFeature: stale index");
    features.splice(b, 0, f);
    return touch({ ...doc, features });
  };
  return {
    label: { en: "Reorder feature", ru: "Переместить элемент" },
    apply: (doc) => mv(doc, from, to),
    invert: (doc) => mv(doc, to, from),
  };
}

export function updateBody(before: BodyMeta, after: BodyMeta, label?: Label): Command {
  const set = (doc: CadDocument, b: BodyMeta) => touch({ ...doc, bodies: { ...doc.bodies, [b.id]: b } });
  return {
    label: label ?? { en: "Edit body", ru: "Изменить тело" },
    apply: (doc) => set(doc, after),
    invert: (doc) => set(doc, before),
  };
}

export function renameDocument(before: string, after: string): Command {
  return {
    label: { en: "Rename project", ru: "Переименовать проект" },
    apply: (doc) => touch({ ...doc, name: after }),
    invert: (doc) => touch({ ...doc, name: before }),
  };
}

export function composite(label: Label, cmds: Command[]): Command {
  return {
    label,
    apply: (doc) => cmds.reduce((d, c) => c.apply(d), doc),
    invert: (doc) => cmds.reduceRight((d, c) => c.invert(d), doc),
  };
}

/* ───────── Stack ───────── */

export class CommandStack {
  private undoList: Command[] = [];
  private redoList: Command[] = [];
  private lastExecAt = 0;
  constructor(private limit = 500) {}

  exec(doc: CadDocument, cmd: Command, now = Date.now()): CadDocument {
    const next = cmd.apply(doc);
    const top = this.undoList[this.undoList.length - 1];
    if (top && cmd.mergeKey && top.mergeKey === cmd.mergeKey && top.merge && now - this.lastExecAt < 1500) {
      this.undoList[this.undoList.length - 1] = top.merge(cmd);
    } else {
      this.undoList.push(cmd);
      if (this.undoList.length > this.limit) this.undoList.shift();
    }
    this.lastExecAt = now;
    this.redoList = [];
    return next;
  }

  undo(doc: CadDocument): CadDocument | null {
    const cmd = this.undoList.pop();
    if (!cmd) return null;
    this.redoList.push(cmd);
    this.lastExecAt = 0;
    return cmd.invert(doc);
  }

  redo(doc: CadDocument): CadDocument | null {
    const cmd = this.redoList.pop();
    if (!cmd) return null;
    this.undoList.push(cmd);
    this.lastExecAt = 0;
    return cmd.apply(doc);
  }

  get canUndo() {
    return this.undoList.length > 0;
  }
  get canRedo() {
    return this.redoList.length > 0;
  }
  get undoLabel(): Label | undefined {
    return this.undoList[this.undoList.length - 1]?.label;
  }
  get redoLabel(): Label | undefined {
    return this.redoList[this.redoList.length - 1]?.label;
  }
  clear() {
    this.undoList = [];
    this.redoList = [];
  }
}
