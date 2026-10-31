// IndexedDB persistence (D6): autosaved projects + recent list.

import { parseDocument, serializeDocument } from "../core/document";
import type { CadDocument } from "../core/types";

const DB = "cocoacad";
const STORE = "projects";

export interface ProjectSummary {
  id: string;
  name: string;
  modifiedAt: number;
  features: number;
}

interface Row extends ProjectSummary {
  data: string;
}

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbp)
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: "id" }).createIndex("modifiedAt", "modifiedAt");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  return dbp;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(r.result);
        t.onerror = () => reject(t.error);
      }),
  );
}

export async function saveProject(doc: CadDocument): Promise<void> {
  const row: Row = { id: doc.id, name: doc.name, modifiedAt: doc.modifiedAt, features: doc.features.length, data: serializeDocument(doc) };
  await tx("readwrite", (s) => s.put(row));
}

export async function loadProject(id: string): Promise<CadDocument | null> {
  const row = await tx<Row | undefined>("readonly", (s) => s.get(id) as IDBRequest<Row | undefined>);
  return row ? parseDocument(row.data) : null;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const rows = await tx<Row[]>("readonly", (s) => s.getAll() as IDBRequest<Row[]>);
  return rows
    .map(({ id, name, modifiedAt, features }) => ({ id, name, modifiedAt, features }))
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
}

export async function deleteProject(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}

/* ───────── prefs (localStorage, like CocoaCanvas) ───────── */

export function getPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`cocoacad.${key}`);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function setPref(key: string, value: unknown) {
  try {
    localStorage.setItem(`cocoacad.${key}`, typeof value === "string" ? value : JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
