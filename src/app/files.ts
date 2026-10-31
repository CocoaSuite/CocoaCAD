import { DocumentFormatError, FILE_EXTENSION, parseDocument, serializeDocument } from "../core/document";
import { liveBodiesAt } from "../core/graph";
import { getKernel } from "./regen";
import { loadDocument, t, toast, useApp } from "./store";

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "_").trim() || "part";

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

type SavePicker = (o: object) => Promise<{ createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }> }>;

async function saveBlob(blob: Blob, name: string, description: string, ext: string, mime: string) {
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (picker) {
    try {
      const h = await picker({ suggestedName: name, types: [{ description, accept: { [mime]: [ext] } }] });
      const w = await h.createWritable();
      await w.write(blob);
      await w.close();
      return true;
    } catch (e) {
      if ((e as Error).name === "AbortError") return false;
    }
  }
  download(blob, name);
  return true;
}

export async function saveToFile() {
  const doc = useApp.getState().doc;
  const blob = new Blob([serializeDocument(doc)], { type: "application/json" });
  if (await saveBlob(blob, safeName(doc.name) + FILE_EXTENSION, "CocoaCAD project", FILE_EXTENSION, "application/json"))
    toast(t("Project saved.", "Проект сохранён."));
}

export function openFromFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = `${FILE_EXTENSION},application/json`;
  input.onchange = async () => {
    const f = input.files?.[0];
    if (f) await openFileObject(f);
  };
  input.click();
}

export async function openFileObject(f: File) {
  try {
    loadDocument(parseDocument(await f.text()));
    toast(t(`Opened ${f.name}`, `Открыт ${f.name}`));
  } catch (e) {
    toast(e instanceof DocumentFormatError ? e.message : t("Could not open that file.", "Не удалось открыть файл."), true);
  }
}

export async function exportModel(format: "stl" | "step") {
  const k = getKernel();
  const { doc, selection } = useApp.getState();
  const live = liveBodiesAt(doc).filter((id) => doc.bodies[id]?.visible !== false);
  const ids = selection.kind === "body" ? [selection.id] : live;
  if (!k || ids.length === 0) return toast(t("There is no solid to export yet.", "Пока нечего экспортировать."), true);
  try {
    const names = Object.fromEntries(ids.map((id) => [id, doc.bodies[id]?.name ?? id]));
    const blob = await k.export(format, ids, names);
    const ext = format === "stl" ? ".stl" : ".step";
    await saveBlob(blob, safeName(doc.name) + ext, format.toUpperCase(), ext, format === "stl" ? "model/stl" : "model/step");
    toast(
      ids.length === 1 && selection.kind === "body"
        ? t(`Exported ${names[ids[0]!]} as ${format.toUpperCase()}.`, `${names[ids[0]!]} экспортировано в ${format.toUpperCase()}.`)
        : t(`Exported ${ids.length} bod${ids.length === 1 ? "y" : "ies"} as ${format.toUpperCase()}.`, `Экспортировано тел: ${ids.length} (${format.toUpperCase()}).`),
    );
  } catch (e) {
    toast((e as Error).message, true);
  }
}
