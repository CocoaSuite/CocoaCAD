# Decision record

| # | Date | Decision | Rationale | Alternatives considered |
|---|---|---|---|---|
| D1 | 2026-10-31 | **React 19 + strict TypeScript + Vite**; Zustand for UI state only; CAD core is framework-free TypeScript. | Typed modules and testability at CAD scale. CocoaCanvas's look is reproduced by porting its CSS (it has no importable components). | Vanilla TS in CocoaCanvas's single-file style. |
| D2 | 2026-10-31 | **Geometry kernel: OpenCASCADE via replicad's WASM build** (`replicad-opencascadejs`, LGPL-2.1), running in a Web Worker behind a `GeometryKernel` adapter. | Mature B-rep kernel (extrude, revolve, Booleans, fillet, chamfer, STEP/STL); production-proven and actively maintained; MIT wrapper. | occt-wasm (OCCT 8, smaller, but new and single-maintainer); libcascade (raw opencascade.js fork). |
| D3 | 2026-10-31 | **Bodies: multi-body, chosen per feature.** Each Extrude/Revolve picks New body / Add / Cut / Intersect, and standalone Boolean features combine bodies. | Covers the brief's union, subtract and intersect between solids; familiar from Onshape. | Single body per part (FreeCAD PartDesign). |
| D4 | 2026-10-31 | **Languages: English + Russian** from day one, with a language switch in Settings, as in CocoaCanvas. | Family consistency. | English only. |
| D5 | 2026-10-31 | **Sketch solver: planegcs** (FreeCAD PlaneGCS compiled to WASM, LGPL-2.1) behind a `ConstraintSolver` adapter. | Real numeric solver with degree-of-freedom, conflict and redundancy reporting, and the full constraint set; maintained. | SolveSpace (GPLv3; no maintained browser build). |
| D6 | 2026-10-31 | **Document: versioned JSON `.cocoacad`** with `schemaVersion` plus migrations, stored in IndexedDB. Parametric data only, never meshes. | Easy to diff and migrate; reopens fully parametric. | Binary or zip container (possible later for embedded imports). |
| D7 | 2026-10-31 | **Topological naming:** references are stored as signatures. The primary key is the source feature, sketch entity and role, taken from OCCT generation history; the fallback is a geometric fingerprint (normal, centroid, area). Unresolved references flag the feature in the tree, which offers a re-pick. | Raw face and edge indices are unstable after upstream edits. | Index-based references (rejected). |
| D8 | 2026-10-31 | **Undo: command-based** (each command can apply and invert itself), followed by incremental recomputation of the dependency graph. | Required by the brief; keeps history consistent with the parametric model. | Snapshot stack, as CocoaCanvas uses. |
| D9 | 2026-10-31 | Dark theme only; static PWA hosting, matching CocoaCanvas. | Family consistency. | — |
| D10 | 2026-10-31 | **Least-movement sketch solving.** Ordinary edits softly hold every point in place (planegcs temporary constraints → SQP); plain DogLeg is the fallback if that fails to converge. Drags hold only the dragged points. | Without it, adding one dimension could move unrelated geometry (observed: setting a width changed the height). | Plain solve only (as before); per-parameter weighting. |
| D11 | 2026-10-31 | **D7 implemented for extrudes:** edges are named by their generating sketch point (lateral) or segment and cap; fingerprint fallback otherwise. Revolve and Boolean-created edges use the fingerprint only for now. | Covers the common “change a dimension, keep the fillet” case without OCCT generation history, which replicad does not expose. | Expose `BRepPrimAPI_MakePrism::Generated` via a custom OCCT build (larger effort; Phase 3 candidate). |
| D12 | 2026-10-31 | **Incremental recompute by input hashing** in the worker: each feature result is keyed by its parameters plus the keys of its sketch and input bodies. | Unchanged branches are reused exactly; no separate invalidation logic to get wrong. | Recompute from the first edited feature onward. |

## Licensing notes
- OCCT (via replicad-opencascadejs) and planegcs are LGPL-2.1. Both are shipped as separately loaded, replaceable `.wasm` files, with their license texts and source links in `THIRD_PARTY_NOTICES`. This does not constrain CocoaCAD's own license.
- replicad: MIT. Three.js: MIT. React: MIT. Zustand: MIT.

## Open items
- ~~Environment: npm registry blocked~~ — resolved for Phase 2; dependencies installed.
- Bundle: the OCCT module is ~23 MB (7.3 MB gzipped). It is cached by the service worker after first load. A trimmed custom build or `occt-wasm` could cut this (Phase 3).
- Not yet built: sketch on face, patterns, mirror, shell, loft/sweep, assemblies, drawings.
