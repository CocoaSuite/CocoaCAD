# Architecture (Phase 2)

```
            ┌──────────── main thread ─────────────────────────────┐   ┌──── worker ─────────┐
 pointer ─▶ │ SketchController ─▶ commitSketch ─▶ PlanegcsSolver   │   │                     │
 keys    ─▶ │ UI (React) ─▶ store actions ─▶ Command ─▶ CommandStack│   │                     │
            │                         │ new immutable CadDocument   │   │                     │
            │                         ▼                             │   │                     │
            │  regen (debounced, latest-wins) ── features ─────────────▶│ Engine.rebuild      │
            │                         ▲                             │   │  per-feature cache  │
            │  CadScene (Three.js) ◀──┴── meshes, edges, problems ◀────│  OCCT via replicad  │
            │  autosave ─▶ IndexedDB                              │   │  exports STL/STEP   │
            └──────────────────────────────────────────────────────┘   └─────────────────────┘
```

## Document and commands (D6, D8)

`CadDocument` is plain JSON: an ordered feature list plus body metadata. It is
never mutated. Every change is a `Command` with `apply` and `invert`
(`core/commands.ts`), so undo replays inverses rather than restoring snapshots.
Commands with the same `mergeKey` inside 1.5 s merge — a whole drag or a
scrubbed value is one undo step. Sketch edits are commands too: the sketch is
solved first, and an edit that over-constrains the sketch is rejected before it
reaches the stack.

Files are `{ format: "cocoacad", schemaVersion, document }`; `parseDocument`
runs migrations keyed by the version they upgrade from and refuses files from a
newer schema.

## Rebuild (incremental recompute)

`app/regen.ts` sends the feature list to the worker after each change. The
engine walks the history and keys each feature's result by a hash of its own
parameters (names excluded) and the keys of everything it reads — its sketch and
its input bodies. A feature is recomputed only when its key changes, so editing
one feature rebuilds that feature and its dependents, not unrelated bodies.
Meshes are cached by the final body key too. `builtFrom` in the store records
which feature list the visible geometry came from, so the status pill and tests
know when the model is current.

While a fillet or chamfer is picking edges, the model is shown rolled back to
just before it, so the edges you click are the ones the feature will act on.

## Sketches (D5)

`core/sketch/profiles.ts` finds closed regions: endpoints are merged (shared
ids, coincident constraints, equal positions), dangling edges pruned, and the
planar faces of each connected component walked with half-edges sorted by
tangent angle. Loops from different components nest by containment; a region is
a loop minus the loops directly inside it. Extrude and revolve use every
even-depth region by default, or the regions picked in the properties panel.

The solver adapter (`ConstraintSolver`) hides planegcs. Ordinary edits are
solved least-movement: every point is softly held where it is (planegcs
temporary constraints, solved by SQP), so adding a width dimension never changes
the height. If that solve fails to converge from badly inconsistent input, a
plain solve is the fallback. Drags use temporary targets on the dragged points
only.

## Edge references (D7)

`kernel/naming.ts`. Each edge of a body is named, where possible, by what
generated it: for an extrude, a lateral edge by the sketch point it sweeps
through (`x1:v:<pointId>`), a cap edge by the sketch segment and which cap
(`x1:c1:<entityId>`). Names are recomputed from the current sketch on every
rebuild, so references survive dimension changes. When an edge has no source
name (revolves, Boolean-created edges) or the source is gone, the geometric
fingerprint (midpoint, direction, length) is the fallback. References that
still don't resolve stop the feature with “Re-pick the edges” rather than
silently filleting something else.

## Viewport

`viewport/scene.ts` is framework-free Three.js: Z-up, perspective or
orthographic, OrbitControls with CAD buttons (right orbit, middle pan, wheel
zoom to cursor; left orbits only outside sketches). Sketch rendering, region
fills, preview geometry and picking (planes, bodies, edges with occlusion,
sketch-plane hits) live there. React (`ui/Viewport.tsx`) only syncs state and
draws the HTML overlay: dimension badges, constraint glyphs, live labels and the
axis triad.

## Not in Phase 2

Sketching on model faces, sketch-plane references to geometry, patterns,
mirror, shell, loft/sweep, assemblies, drawings, and generation-history naming
for revolves and Boolean-created edges.
