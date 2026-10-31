import { newId } from "./ids";
import { SCHEMA_VERSION, type CadDocument } from "./types";

export const FILE_EXTENSION = ".cocoacad";
export const FILE_MIME = "application/vnd.cocoasuite.cocoacad+json";

export function createDocument(name = "Untitled part"): CadDocument {
  const now = Date.now();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId("doc_"),
    name,
    units: "mm",
    features: [],
    bodies: {},
    createdAt: now,
    modifiedAt: now,
  };
}

/* ───────── Serialization with migrations (D6) ───────── */

interface FileEnvelope {
  format: "cocoacad";
  schemaVersion: number;
  app: string;
  document: unknown;
}

/** Migrations keyed by the version they upgrade *from*. Add one per schema bump. */
const MIGRATIONS: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {
  // 1: (d) => ({ ...d, schemaVersion: 2, ... }),
};

export function serializeDocument(doc: CadDocument): string {
  const env: FileEnvelope = {
    format: "cocoacad",
    schemaVersion: SCHEMA_VERSION,
    app: "CocoaCAD 0.2",
    document: doc,
  };
  return JSON.stringify(env, null, 1);
}

export class DocumentFormatError extends Error {}

export function parseDocument(text: string): CadDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new DocumentFormatError("Not a valid CocoaCAD file (JSON parse error).");
  }
  if (!raw || typeof raw !== "object") throw new DocumentFormatError("Empty file.");
  const env = raw as Partial<FileEnvelope>;
  if (env.format !== "cocoacad" || typeof env.document !== "object" || env.document === null)
    throw new DocumentFormatError("This file is not a CocoaCAD project.");
  let doc = env.document as Record<string, unknown>;
  let v = typeof doc.schemaVersion === "number" ? doc.schemaVersion : 1;
  if (v > SCHEMA_VERSION)
    throw new DocumentFormatError(
      `This project was saved by a newer CocoaCAD (schema ${v}). Update the app to open it.`,
    );
  while (v < SCHEMA_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) throw new DocumentFormatError(`No migration from schema ${v}.`);
    doc = m(doc);
    v = doc.schemaVersion as number;
  }
  return validate(doc);
}

function validate(d: Record<string, unknown>): CadDocument {
  if (!Array.isArray(d.features)) throw new DocumentFormatError("Missing feature list.");
  const ids = new Set<string>();
  for (const f of d.features as { id?: unknown; type?: unknown }[]) {
    if (typeof f.id !== "string" || typeof f.type !== "string")
      throw new DocumentFormatError("A feature is missing its id or type.");
    if (ids.has(f.id)) throw new DocumentFormatError(`Duplicate feature id ${f.id}.`);
    ids.add(f.id);
  }
  const now = Date.now();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: typeof d.id === "string" ? d.id : newId("doc_"),
    name: typeof d.name === "string" ? d.name : "Untitled part",
    units: "mm",
    features: d.features as CadDocument["features"],
    bodies: (d.bodies && typeof d.bodies === "object" ? d.bodies : {}) as CadDocument["bodies"],
    createdAt: typeof d.createdAt === "number" ? d.createdAt : now,
    modifiedAt: typeof d.modifiedAt === "number" ? d.modifiedAt : now,
  };
}

/* ───────── Naming helpers ───────── */

const BASE_NAMES: Record<string, { en: string; ru: string }> = {
  sketch: { en: "Sketch", ru: "Эскиз" },
  extrude: { en: "Extrude", ru: "Выдавливание" },
  revolve: { en: "Revolve", ru: "Вращение" },
  boolean: { en: "Boolean", ru: "Булева операция" },
  fillet: { en: "Fillet", ru: "Скругление" },
  chamfer: { en: "Chamfer", ru: "Фаска" },
  body: { en: "Body", ru: "Тело" },
};

export function nextName(existing: string[], kind: keyof typeof BASE_NAMES, lang: "en" | "ru"): string {
  const base = BASE_NAMES[kind]![lang];
  let n = 1;
  const set = new Set(existing);
  while (set.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

export const BODY_COLORS = ["#b8bcc4", "#c9a27e", "#8fb3c9", "#a6c48a", "#c98f9f", "#b3a1d6", "#d1c27a"];
