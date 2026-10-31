# CocoaCAD

Parametric part modelling in the browser — the CAD member of CocoaSuite, styled
after [CocoaCanvas](https://github.com/CocoaSuite/cocoacanvas).

Sketch on a plane, constrain and dimension the sketch, then extrude or revolve
it into solids; cut, combine, fillet and chamfer; change any earlier step and
everything after it rebuilds. Projects save automatically in the browser and
export to STL and STEP.

## Features (Phase 2)

- **Sketcher** — line chains, rectangles, circles, 3-point arcs, construction
  geometry; point, origin and grid snapping; automatic horizontal/vertical.
- **Constraints** — coincident, point-on-line/curve, horizontal, vertical,
  parallel, perpendicular, equal, tangent, midpoint, fix; dimensions for
  length, point distance, point-to-line, radius, diameter and angle. Live
  degrees-of-freedom and over-constraint reporting (planegcs). Edits move only
  what they must.
- **Features** — extrude (one side, reverse, symmetric), revolve (sketch axis
  or any sketch line), each creating a new body or adding, cutting or
  intersecting with an existing one; Boolean union/subtract/intersect between
  bodies; fillet and chamfer on edges picked in the viewport.
- **History** — reorder by drag, suppress, rename, delete with dependency
  warnings; problems flagged in the tree with a reason.
- **Undo** — command-based, with drags and scrubs merged into single steps.
- **Files** — autosave to IndexedDB, recent projects, `.cocoacad` save/open
  (also by drag and drop), STL and STEP export of all or selected bodies.
- **UI** — English and Russian, keyboard shortcuts (`?`), orthographic or
  perspective view, standard views, floating panels on narrow screens, PWA.

## Develop

```sh
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests: core, solver (real WASM), kernel (real OCCT)
npm run build        # typecheck + production build into dist/
npm run preview      # serve dist/ on :4173
node e2e/workflow.mjs http://localhost:4173/ e2e-out   # end-to-end check in Chrome
```

The end-to-end script drives the built app in headless Chrome
(`CHROME=/path/to/chrome` to override) through a full modelling session and
checks volumes against hand-computed values.

## Layout

```
src/core/      framework-free CAD core: document schema, commands, graph, units
src/core/sketch/  sketch model, profile detection, constraint rules, solver adapter
src/kernel/    GeometryKernel adapter, Web Worker, OCCT feature engine, edge naming
src/viewport/  Three.js scene and sketch tool controller
src/app/       store (Zustand), rebuild driver, persistence, files, shortcuts, i18n
src/ui/        React components (top bar, tree, properties, toolbar, dialogs)
docs/          design reference, decision record, architecture
```

See `docs/architecture.md` for how the pieces fit, `docs/decisions.md` for why,
and `THIRD_PARTY_NOTICES.md` for licences.
