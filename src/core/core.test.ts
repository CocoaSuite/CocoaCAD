import { describe, expect, it } from "vitest";
import { CommandStack, addFeature, removeFeatures, updateFeature } from "./commands";
import { createDocument, parseDocument, serializeDocument } from "./document";
import { dependentsOf, validateReferences } from "./graph";
import { parseQuantity } from "./units";
import type { ExtrudeFeature, SketchFeature } from "./types";
import { emptySketch } from "./sketch/model";

const sketch = (id: string): SketchFeature => ({
  id,
  type: "sketch",
  name: "Sketch 1",
  plane: { base: "XY", offset: 0 },
  sketch: emptySketch(),
});
const extrude = (id: string, sketchId: string, extra: Partial<ExtrudeFeature> = {}): ExtrudeFeature => ({
  id,
  type: "extrude",
  name: "Extrude 1",
  sketchId,
  profiles: [],
  distance: 10,
  direction: "normal",
  op: "new",
  ...extra,
});

describe("units", () => {
  it("parses plain numbers and units", () => {
    expect(parseQuantity("25")).toBe(25);
    expect(parseQuantity("25 mm")).toBe(25);
    expect(parseQuantity("1 in")).toBeCloseTo(25.4);
    expect(parseQuantity("2,5 cm")).toBeCloseTo(25);
    expect(parseQuantity("(10+2)*3")).toBe(36);
    expect(parseQuantity("1in + 0.6 mm")).toBeCloseTo(26);
    expect(parseQuantity("-4")).toBe(-4);
  });
  it("parses angles", () => {
    expect(parseQuantity("90", "angle")).toBe(90);
    expect(parseQuantity("1 rad", "angle")).toBeCloseTo(57.2958, 3);
  });
  it("rejects junk", () => {
    expect(() => parseQuantity("abc")).toThrow();
    expect(() => parseQuantity("5 parsecs")).toThrow();
    expect(() => parseQuantity("(3")).toThrow();
    expect(() => parseQuantity("")).toThrow();
  });
});

describe("command stack", () => {
  it("applies, undoes and redoes without snapshots", () => {
    const stack = new CommandStack();
    let doc = createDocument();
    doc = stack.exec(doc, addFeature(sketch("s1")));
    doc = stack.exec(doc, addFeature(extrude("x1", "s1"), { body: { id: "x1", name: "Body 1", color: "#fff", visible: true } }));
    expect(doc.features.map((f) => f.id)).toEqual(["s1", "x1"]);
    expect(doc.bodies.x1).toBeDefined();
    doc = stack.undo(doc)!;
    expect(doc.features.map((f) => f.id)).toEqual(["s1"]);
    expect(doc.bodies.x1).toBeUndefined();
    doc = stack.redo(doc)!;
    expect(doc.features.map((f) => f.id)).toEqual(["s1", "x1"]);
    expect(stack.undo(stack.undo(doc)!)!.features).toHaveLength(0);
  });

  it("merges consecutive edits with the same key into one step", () => {
    const stack = new CommandStack();
    let doc = createDocument();
    const s = sketch("s1");
    const x0 = extrude("x1", "s1");
    doc = stack.exec(doc, addFeature(s));
    doc = stack.exec(doc, addFeature(x0));
    const x1 = { ...x0, distance: 11 };
    const x2 = { ...x0, distance: 12 };
    doc = stack.exec(doc, updateFeature(x0, x1, undefined, "drag"), 1000);
    doc = stack.exec(doc, updateFeature(x1, x2, undefined, "drag"), 1100);
    expect((doc.features[1] as ExtrudeFeature).distance).toBe(12);
    doc = stack.undo(doc)!;
    expect((doc.features[1] as ExtrudeFeature).distance).toBe(10);
  });

  it("restores deleted features at their original positions", () => {
    const stack = new CommandStack();
    let doc = createDocument();
    for (const f of [sketch("a"), sketch("b"), sketch("c")]) doc = stack.exec(doc, addFeature(f));
    doc = stack.exec(doc, removeFeatures(doc, ["a", "c"]));
    expect(doc.features.map((f) => f.id)).toEqual(["b"]);
    doc = stack.undo(doc)!;
    expect(doc.features.map((f) => f.id)).toEqual(["a", "b", "c"]);
  });
});

describe("document file", () => {
  it("round-trips through JSON", () => {
    const doc = { ...createDocument("Bracket"), features: [sketch("s1"), extrude("x1", "s1")] };
    const back = parseDocument(serializeDocument(doc));
    expect(back.name).toBe("Bracket");
    expect(back.features).toEqual(doc.features);
  });
  it("refuses other files and newer schemas", () => {
    expect(() => parseDocument("{}")).toThrow(/not a CocoaCAD/);
    expect(() => parseDocument("nope")).toThrow();
    const future = JSON.stringify({ format: "cocoacad", schemaVersion: 99, document: { schemaVersion: 99, features: [] } });
    expect(() => parseDocument(future)).toThrow(/newer/);
  });
});

describe("dependency graph", () => {
  it("finds dependents and broken references", () => {
    const doc = {
      ...createDocument(),
      features: [sketch("s1"), extrude("x1", "s1"), sketch("s2"), extrude("x2", "s2", { op: "cut", target: "x1" })],
    };
    expect(dependentsOf(doc, ["s1"])).toEqual(["x1", "x2"]);
    expect(dependentsOf(doc, ["s2"])).toEqual(["x2"]);
    expect(validateReferences(doc)).toEqual([]);
    const broken = { ...doc, features: doc.features.filter((f) => f.id !== "s1") };
    expect(validateReferences(broken).map((p) => p.featureId)).toEqual(["x1", "x2"]);
  });
});
