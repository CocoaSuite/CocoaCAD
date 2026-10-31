// End-to-end workflow check against a built app (vite preview).
// Usage: node e2e/workflow.mjs [baseUrl] [outDir]
import { chromium } from "playwright-core";
const base = process.argv[2] ?? "http://localhost:4173/";
const out = process.argv[3] ?? "e2e-out";
import { mkdirSync } from "node:fs";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "/usr/bin/google-chrome",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
const step = (s) => console.log("•", s);
let failures = 0;
const expectClose = (label, got, want, tol = 0.5) => {
  const ok = typeof got === "number" && Math.abs(got - want) <= tol;
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${got} (expected ${want})`);
};
const expectTrue = (label, cond) => {
  if (!cond) failures++;
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
};
/** Wait for the camera animation to settle (headless rendering is slow). */
const settle = () => page.waitForTimeout(1000);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const state = () => page.evaluate(() => { const s = window.__cad.store.getState(); return { features: s.doc.features.map(f => f.type + ":" + f.name), bodies: s.bodies.map(b => ({ id: b.id, vol: Math.round(b.volume * 100) / 100, faces: b.faceGroups.length })), problems: s.problems, mode: s.mode.kind, status: s.sketchStatus, kernelReady: s.kernelReady }; });
// Rebuilds are debounced (~30 ms), so give one a chance to start before waiting for it.
const waitIdle = async () => { await page.waitForTimeout(120); await page.waitForFunction(() => { const s = window.__cad.store.getState(); return s.kernelReady && !s.rebuilding && s.builtFrom === s.doc.features; }, null, { timeout: 60000 }); await page.waitForTimeout(80); };
/** Click at sketch-local coordinates. */
const sk = async (x, y, opts = {}) => {
  const p = await page.evaluate(([x, y]) => { const r = document.querySelector("#view canvas").getBoundingClientRect(); const q = window.__cad.scene.projectLocal([x, y]); return [r.left + q[0], r.top + q[1]]; }, [x, y]);
  await page.mouse.move(p[0], p[1], { steps: 2 });
  if (!opts.moveOnly) await page.mouse.click(p[0], p[1]);
};

try {
await page.goto(base + "?e2e");
await page.waitForSelector(".start");
await shot("01-start");
step("start screen shown");
await page.getByRole("button", { name: /New part/ }).first().click();
await page.waitForFunction(() => window.__cad.store.getState().kernelReady, null, { timeout: 60000 });
step("kernel ready");

// Sketch on top plane: rectangle + circle
await page.keyboard.press("k");
await settle();
await page.keyboard.press("r");
await sk(-30, -20); await sk(30, 20);
await page.keyboard.press("c");
await sk(0, 0); await sk(8, 0);
let st = await state();
step(`sketch drawn: ${JSON.stringify(st.status)}`);
await shot("02-sketch");

// dimension the top edge to 80 via the properties length field
await page.keyboard.press("s");
await sk(0, 20);
const len = page.locator("#props .nf input").first();
await len.fill("80");
await len.press("Enter");
await page.waitForTimeout(200);
st = await state();
step(`after width dim: dof=${st.status?.dof}`);
expectClose("DOF after width dimension", st.status?.dof, 4, 0);
await shot("03-dimensioned");

await page.keyboard.press("Enter"); // finish sketch
await page.keyboard.press("e");      // extrude
await waitIdle();
st = await state();
step(`extruded: ${JSON.stringify(st.bodies)} problems=${st.problems.length}`);
const distField = page.locator("#props .nf input").first();
await distField.fill("15 mm");
await distField.press("Enter");
await waitIdle();
st = await state();
step(`distance 15: ${JSON.stringify(st.bodies)}`);
expectClose("plate volume 80×40×15 minus Ø16 hole", st.bodies[0]?.vol, (3200 - Math.PI * 64) * 15, 0.05);
await page.keyboard.press("0");
await page.waitForTimeout(500);
await shot("04-extruded");

// Undo/redo the distance edit
await page.keyboard.press("Control+z");
await waitIdle();
const undone = (await state()).bodies[0]?.vol;
await page.keyboard.press("Control+Shift+z");
await waitIdle();
const redone = (await state()).bodies[0]?.vol;
step(`undo vol=${undone} redo vol=${redone}`);
expectClose("undo restores 10 mm", undone, (3200 - Math.PI * 64) * 10, 0.05);
expectClose("redo restores 15 mm", redone, (3200 - Math.PI * 64) * 15, 0.05);

// Fillet: pick the 4 vertical outer edges via the hook
await page.keyboard.press("Escape");
await page.keyboard.press("Shift+F");
await waitIdle();
// apply via properties: set size then click edges in viewport using projected midpoints
const mids = await page.evaluate(() => { const s = window.__cad.store.getState(); const f = s.doc.features.find((x) => x.id === s.pickingEdges); const body = s.bodies.find((b) => b.id === f.body); const r = document.querySelector("#view canvas").getBoundingClientRect(); return body.edges.filter((e) => Math.abs(e.fp.dir[2]) > 0.99 && Math.hypot(e.fp.mid[0], e.fp.mid[1]) > 20).map((e) => { const q = window.__cad.scene.project(e.fp.mid); return q ? [r.left + q[0], r.top + q[1]] : null; }).filter(Boolean); });
step(`fillet: ${mids.length} candidate vertical edges on screen`);
for (const [x, y] of mids) { await page.mouse.move(x, y); await page.mouse.click(x, y); await page.waitForTimeout(120); }
const picked = await page.evaluate(() => { const s = window.__cad.store.getState(); return s.doc.features.find((x) => x.id === s.pickingEdges)?.edges.length; });
step(`fillet edges picked by clicking: ${picked}`);
expectTrue("front-facing vertical edges pickable (hidden one excluded)", picked === 3);
await shot("05-fillet-picking");
const size = page.locator("#props .nf input").first();
await size.fill("4");
await size.press("Enter");
await page.getByRole("button", { name: "Done" }).click();
await waitIdle();
st = await state();
step(`filleted: ${JSON.stringify(st.bodies)} problems=${JSON.stringify(st.problems)}`);
expectClose("fillet R4 on 3 corners removes 3·(16−4π)·15", st.bodies[0]?.vol, (3200 - Math.PI * 64) * 15 - 3 * (16 - 4 * Math.PI) * 15, 0.05);
await shot("06-filleted");

// Second body + boolean subtract
await page.evaluate(() => window.__cad.store.setState({ selection: { kind: "plane", plane: "XZ" } }));
await page.keyboard.press("k");
await settle();
await page.keyboard.press("c");
await sk(40, 7.5); await sk(48, 7.5);
await page.keyboard.press("Enter");
await page.keyboard.press("e");
await waitIdle();
const d2 = page.locator("#props .nf input").first();
await d2.fill("60");
await d2.press("Enter");
await page.getByRole("radio", { name: "Symmetric" }).click();
await waitIdle();
await page.keyboard.press("Escape");
await page.keyboard.press("b");
await waitIdle();
await page.getByRole("radio", { name: "Subtract" }).click();
await waitIdle();
st = await state();
step(`boolean subtract: ${JSON.stringify(st.bodies)} problems=${JSON.stringify(st.problems)}`);
expectTrue("subtract consumes the tool body and removes material", st.bodies.length === 1 && st.bodies[0].vol < (3200 - Math.PI * 64) * 15 - 3 * (16 - 4 * Math.PI) * 15 - 100 && st.problems.length === 0);
const afterBoolean = st.bodies[0]?.vol;
await page.keyboard.press("Escape");
await page.keyboard.press("0");
await page.waitForTimeout(500);
await shot("07-boolean");

// Edit the first sketch dimension → everything downstream rebuilds
await page.evaluate(() => {
  const { store } = window.__cad;
  const s = store.getState();
  const sk = s.doc.features.find((f) => f.type === "sketch");
  store.setState({ selection: { kind: "feature", ids: [sk.id] } });
});
const before = (await state()).bodies[0]?.vol;
await page.locator("#tree .lr", { hasText: "Sketch 1" }).dblclick();
await page.waitForTimeout(300);
await page.locator(".badge", { hasText: "80" }).first().dblclick();
const dimIn = page.locator(".dimedit input");
await dimIn.fill("100");
await dimIn.press("Enter");
await page.keyboard.press("Enter");
await waitIdle();
const after = (await state()).bodies[0]?.vol;
step(`parametric edit 80→100: vol ${before} → ${after}`);
expectTrue("editing the first sketch rebuilds downstream features", after > afterBoolean + 1000 && (await state()).problems.length === 0);
await shot("08-edited");

// Save/restore round trip through IndexedDB
await page.waitForTimeout(1000);
const recents = await page.evaluate(async () => { const req = indexedDB.open("cocoacad"); const db = await new Promise((r) => (req.onsuccess = () => r(req.result))); return new Promise((r) => { const q = db.transaction("projects").objectStore("projects").getAll(); q.onsuccess = () => r(q.result.map((x) => x.name + ":" + x.features)); }); });
step(`autosaved: ${JSON.stringify(recents)}`);
await page.reload();
await page.waitForSelector(".start");
await page.locator(".rec").first().click();
await waitIdle();
st = await state();
step(`reopened: ${st.features.length} features, bodies ${JSON.stringify(st.bodies)}`);
expectClose("reopened project has the same volume", st.bodies[0]?.vol, after, 0.01);

// Russian UI
await page.evaluate(() => window.__cad.store.setState({ lang: "ru" }));
await page.waitForTimeout(200);
await shot("09-russian");

// Export STL via kernel (download)
const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }).catch(() => null), page.evaluate(() => { delete window.showSaveFilePicker; }).then(() => page.getByRole("button", { name: "Экспорт", exact: true }).click())]);
step(`export download: ${dl ? dl.suggestedFilename() : "none"}`);
expectTrue("STL export downloads", !!dl && dl.suggestedFilename().endsWith(".stl"));

} catch (e) { await shot("FAIL"); console.log("FAILED:", e.message.split("\n")[0]); }
console.log("\nERRORS:", errors.length ? errors.join("\n") : "none");
await browser.close();
if (failures || errors.length) { console.log(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nAll checks passed.");
