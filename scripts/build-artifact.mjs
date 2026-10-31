// Turns dist/ into dist-artifact/, a layout that can be hosted as a claude.ai
// artifact page:
//  - the OCCT .wasm (~23 MB) is split into pieces under the host's 15 MB
//    per-file limit; the worker rejoins them (window.__COCOACAD_WASM_PARTS__);
//  - index.html becomes page content only (the host adds doctype/head);
//  - the service worker and web manifest are left out (hosts don't run them).
// Usage: node scripts/build-artifact.mjs   (after `vite build`)

import { cpSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SRC = "dist";
const OUT = "dist-artifact";
const PART = 11 * 1024 * 1024;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
cpSync(join(SRC, "assets"), join(OUT, "assets"), { recursive: true });
cpSync(join(SRC, "licenses"), join(OUT, "licenses"), { recursive: true });
cpSync(join(SRC, "icon.svg"), join(OUT, "icon.svg"));

const occt = readdirSync(join(OUT, "assets")).find((f) => /^replicad_single-.*\.wasm$/.test(f));
if (!occt) throw new Error("OCCT wasm not found in dist/assets — run vite build first");
const buf = readFileSync(join(OUT, "assets", occt));
rmSync(join(OUT, "assets", occt));
const parts = [];
for (let i = 0, o = 0; o < buf.length; i++, o += PART) {
  const name = occt.replace(/\.wasm$/, `.part${i}.wasm`);
  writeFileSync(join(OUT, "assets", name), buf.subarray(o, o + PART));
  parts.push(`assets/${name}`);
}

const html = readFileSync(join(SRC, "index.html"), "utf8");
const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"/g)].map((m) => m[1]);
const js = [...html.matchAll(/<script type="module"[^>]*src="\.\/([^"]+)"/g)].map((m) => m[1]);
const page = [
  "<title>CocoaCAD</title>",
  '<meta name="theme-color" content="#1a1a1a">',
  '<meta name="color-scheme" content="dark">',
  '<link rel="icon" href="icon.svg" type="image/svg+xml">',
  ...css.map((h) => `<link rel="stylesheet" href="${h}">`),
  `<script>window.__COCOACAD_WASM_PARTS__=${JSON.stringify(parts)};</script>`,
  '<div id="root"></div>',
  "<noscript>CocoaCAD needs JavaScript and WebAssembly.</noscript>",
  ...js.map((h) => `<script type="module" crossorigin src="${h}"></script>`),
  "",
].join("\n");
writeFileSync(join(OUT, "index.html"), page);

const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p !== join(OUT, "index.html")) files.push(p.slice(OUT.length + 1));
  }
};
walk(OUT);
writeFileSync(join(OUT, "files.json"), JSON.stringify(files, null, 1));
console.log(`${OUT}: index.html + ${files.length} files; OCCT split into ${parts.length} parts`);
for (const f of files) console.log(`  ${f}  ${(statSync(join(OUT, f)).size / 1048576).toFixed(2)} MB`);
