# Third-party notices

CocoaCAD's own source is not affected by the licences below. The two LGPL
components are shipped as **separate, replaceable WebAssembly files** (never
inlined or statically linked into CocoaCAD's JavaScript); to substitute your own
build, replace the corresponding `.wasm` file in `assets/` with a compatible one.

| Component | Version | Licence | Where it runs | Source |
|---|---|---|---|---|
| OpenCASCADE Technology, via `replicad-opencascadejs` | 1.1.0 | LGPL-2.1 | `assets/replicad_single-*.wasm` in the geometry worker | https://github.com/sgenoud/replicad (build), https://dev.opencascade.org (OCCT) |
| PlaneGCS (FreeCAD), via `@salusoft89/planegcs` | 1.3.0 | LGPL-2.1 | `assets/planegcs-*.wasm` on the main thread | https://github.com/Salusoft89/planegcs, https://github.com/FreeCAD/FreeCAD |
| replicad | 1.2.0 | MIT | worker | https://github.com/sgenoud/replicad |
| three.js | 0.187.0 | MIT | viewport | https://github.com/mrdoob/three.js |
| React, React DOM | 19.3.1 | MIT | UI | https://github.com/facebook/react |
| Zustand | 5.0.16 | MIT | UI state | https://github.com/pmndrs/zustand |

The full LGPL-2.1 texts ship with the app in `licenses/OCCT-LGPL-2.1.txt` and
`licenses/planegcs-LGPL-2.1.txt`.
