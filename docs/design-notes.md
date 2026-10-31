# CocoaCanvas design reference (source of truth for CocoaCAD UI)

Extracted from `CocoaSuite/cocoacanvas` @ c3f324a (`editor.html`), verified against screenshots of the running app at 1440×900.

## 0. How CocoaCanvas is built
- One self-contained file (`editor.html`, ~780 KB): inline `<style>`, inline vanilla JS, no framework, no build step. PWA (`manifest.webmanifest`, `sw.js`, network-first cache).
- UI is rendered with template strings (`innerHTML`); there are no importable components. "Reuse" therefore means porting the CSS rules and markup patterns 1:1, not importing modules.
- Bilingual: `L(en, ru)` helper, `data-ru="…"` attributes on static markup, `data-tt="English|Русский"` tooltips (rendered as native `title`).
- Persistence: IndexedDB database `cocoacanvas` + `localStorage` for prefs; autosave; `.ccanvas` JSON project files; version history.
- Undo: snapshot stack of serialized documents (`H`/`F` arrays). (CocoaCAD will use command-based undo instead, as required.)
- Dark theme only (`color-scheme: dark`).

## 1. Layout and proportions (desktop)
```
body: grid rows [auto, 1fr]
┌ #top (min-height 38px, panel bg, 1px bottom border) ───────────────────────────────┐
│ brand(30px tall) · menus File Edit Object View Help · project name (muted, ghost)   │
│ · flex spacer · centred Helper pill (520px max) · spacer · icon btn · [Export] pri  │
├ #mid: grid columns 240px | minmax(0,1fr) | 264px ──────────────────────────────────┤
│ #lay (Layers)  │ #stage: #view (canvas bg #1f1f1f)            │ #inspW (Design)     │
│ .ph header     │                                              │ #insp padding 10/12 │
│ search 28px    │                                              │ gap 8, sections     │
│ rows 28px      │ #tbar: centred icon row, 6/10 padding,       │                     │
│                │ 1px top border, panel bg, buttons 34×30      │                     │
└────────────────┴──────────────────────────────────────────────┴─────────────────────┘
```
- Panels are separated only by 1px `--line` borders; no gaps, no shadows between docked panels.
- Tool bar sits at the bottom of the stage, centred, with `.vs` 1×20px vertical separators between groups.
- 721–1100px widths: side panels become floating cards (radius 16, shadow `0 10px 30px rgba(0,0,0,.45)`), toggled from the top bar, sliding with `transform .34s cubic-bezier(.22,.8,.24,1)`. Tool bar becomes a floating pill (radius 18) at bottom: 16px.

## 2. Tokens
| Token | Value | Use |
|---|---|---|
| `--bg` | `#121212` | app background, input fields |
| `--panel` | `#1a1a1a` | top bar, side panels, tool bar, dialogs |
| `--panel2` | `#252525` | buttons, menus, hover rows, popovers |
| `--line` | `#303030` | every border and divider |
| `--fg` | `#ececec` | text |
| `--mute` | `#8f8f8f` | labels, secondary text, idle icons |
| `--pri` / `--prifg` | `#f2f2f2` / `#111` | primary button (white with black text) |
| `--acc` / `--accfg` | `#4a4a4a` / `#fff` | accent fill (e.g. ready send button) |
| `--sfill` / `--sedge` | `#4a4a4a` / `#fff` | slider fill / thumb line |
| `--hl` | `#fff` | focus outline, highlights |
| `--sel` | `#4b9cff` | selection (handles, outlines, drop lines, badges, caret) |
| `--bad` | `#ff8a73` | errors, destructive |
| `--guide` | `#ff5b8a` | smart guides |
| `--cbg` | `#1f1f1f` | canvas/viewport background |
| brand orange | `#D15A2C` | logo, toggles on, step dots, "new" badges, export page checks — used sparingly |
| selected layer row | `#2d3a4d` | |
| menu item hover | `#363636` | |
| `--sans` | `system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif` | |
| `--mono` | `ui-monospace,SFMono-Regular,Menlo,Consolas,monospace` | numbers, zoom label, kbd, hex |

## 3. Typography
- Base `13px/1.4 var(--sans)`.
- Section headers (`.ph`, `.sec`, `.setH`, `.stLab`): 11px, uppercase, `letter-spacing:.08em`, `--mute`.
- Dialog title `h2` 16px (settings shows ~17px semibold). Primary button weight 600; list titles 650.
- Hints `.hint` 12px/1.5 muted. Numeric readouts use `--mono` 12px.

## 4. Spacing, radii, shadows
- Radii: button 6, input 5, menu item 4, dropdown 7, toast 8, dialog box 10, helper pill 999, start screen 14, floating panels 16, mobile sheets 18–22.
- Inspector: padding 10/12, gap 8; field grid `96px | 1fr` gap 8; two-up grid gap 6.
- Section divider: `margin-top 8; padding-top 8; border-top 1px --line`.
- Shadows: dropdown `0 10px 28px rgba(0,0,0,.45)`; popover `0 10px 30px rgba(0,0,0,.5)`; start screen `0 20px 60px rgba(0,0,0,.6)`.
- Modal scrim `rgba(0,0,0,.6)`.

## 5. Controls
- **Button**: `--panel2` bg, 1px `--line`, radius 6, padding 5/10; hover → border `--mute`; focus-visible 2px `--hl` outline offset 1; disabled opacity .45.
- **Primary** (`.pri`): white bg, black text, 600 weight; hover pure white.
- **Icon button** (`.ic`): 16px stroke icons; in tool bar transparent 34×30, hover `--panel2`, active (`.on`) = primary colours (white bg, black icon).
- **Menu bar** (`.mt`): transparent, radius 4, padding 4/9, hover/open `--panel2`. Dropdown `.dd`: `--panel2`, radius 7, padding 4, min-width 210, items padding 6/10 radius 4 hover `#363636`, `hr` separators.
- **Context menu**: same `.dd` styling at pointer position.
- **Text/number input**: `--bg` fill, 1px `--line`, radius 5, padding 4/6. Number fields (`.nf`) have a scrub label inside on the left (11px muted, `ew-resize` cursor, drag to change).
- **Segmented** (`.seg`): row of ghost buttons; `.on` = `--panel2` bg + `--line` border.
- **Select**: same as input, native.
- **Slider**: 28px tall bar, fill `--sfill`, 2px white thumb line, label left inside, mono value right inside.
- **Toggle** (`.sw2`): 42×24 pill, off = `--panel2`, on = brand orange with white knob.
- **Checkbox**: native, 16–18px.
- **Layer row** (`.lr`): 28px tall, radius 5, chevron + 13px icon + name + hover-only lock/eye buttons; selected `#2d3a4d`; hidden rows .45 opacity; double-click renames inline.
- **Empty states**: `.empty` muted 1.5 line-height, plain sentence guidance.
- **Toast**: bottom-centred, `--panel2`, radius 8, fade .2s.
- **Modal** box: `--panel`, 1px `--line`, radius 10, padding 18, gap 12, width ≤ 420 (wider variants 520/600/800); right-aligned `.row` of buttons, primary last.
- **Settings rows** (`.setr`): label + small muted description left, control right.
- **Keyboard table** (`.kt`): `kbd` mono 12px on `--panel2`, 1px line, radius 4.
- **On-canvas badges**: `--sel` blue rect with 11px white text (e.g. "200 × 150").
- **Selection handles**: white squares with 1px blue stroke; rotate zones invisible with custom cursor.

## 6. Icons
- Custom inline SVG, 24×24 viewBox, `fill:none; stroke:currentColor; stroke-width:2` in tool bar (1.7–1.8 in panels), round caps and joins. Visual style ≈ Lucide/Feather. Rendered 16px (13–15px in rows).

## 7. Interaction and motion
- Hover reveals secondary actions (lock/eye on rows, delete on recent items).
- Escape cancels, Delete removes, double-click to edit/rename, right-click context menu, Shift/Ctrl/Cmd multi-select, drag-to-reorder with a blue 2px drop line.
- Wheel pans; Ctrl/Cmd+wheel zooms at cursor (CAD viewport will adopt CAD conventions, see architecture).
- Motion is short and calm: .15–.2s fades, panel slides .34s `cubic-bezier(.22,.8,.24,1)`; all wrapped in `prefers-reduced-motion`.
- First-run: dismissible welcome tour (animated card, orange step dots) and a start screen (recent projects, new/open).
- Custom thin scrollbars `rgba(255,255,255,.22)`.

## 8. Mapping to CocoaCAD
| CocoaCanvas | CocoaCAD |
|---|---|
| Layers panel (240px) | Model tree: Origin/planes, Sketches, Features (history), Bodies |
| Design inspector (264px) | Properties: feature parameters, sketch constraints, measurements |
| Bottom tool bar | Mode-aware tool bar: Part tools ↔ Sketch tools |
| Size badge (blue) | Live dimension badges while drawing |
| `.nf` scrub fields | Unit-aware numeric fields (`25 mm`, `1 in`) |
| Start screen / welcome tour | Same, with CAD workflow steps |
| Helper pill in top bar | Slot reserved (command search) |
