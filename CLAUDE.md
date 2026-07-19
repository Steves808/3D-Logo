# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A standalone, dependency-free 3D Logo turtle graphics interpreter that runs entirely in the browser. No build step, no package manager, no external libraries. Open `index.html` (or `logo3d.html`, which is identical) directly in a browser to run it.

## Development

**To run:** Open `index.html` in any modern browser — no server required.  
**To test changes:** Refresh the browser. If the status bar shows "JS loaded ✅  Ready." the script loaded correctly. If it still shows the fallback message, the browser is blocking the JS.  
**CSP note:** The HTML loads `logo3d.js` as an external script specifically to be CSP-safe. Never move logic inline into the HTML.

There are no build, lint, or test commands.

## Architecture

Everything lives in `logo3d.js` (≈960 lines), wrapped in a single IIFE. The pipeline is:

```
Textarea input → tokenize() → parseProgram() → execBlock() → segments[] → draw()
```

### Rendering

- 2D Canvas with manual perspective projection (`project()` at line 77)
- Camera state: yaw, pitch, distance, pan — manipulated via pointer events (single-pointer orbit, two-pointer pinch/zoom/pan) and mouse wheel
- Depth-sorted segments drawn each frame; no retained scene graph
- Segments are stored as `{ a, b, color, width, isSnapSpoke }` in the `segments` array

### Interpreter (three stages)

1. **Tokenizer** (`tokenize()`): splits source into tokens, handles `#hex` colors and `;` comments
2. **Parser** (`parseProgram()` / `parseBlock()`): recursive descent, builds an AST of blocks. Handles `TO...END` procedure definitions, `REPEAT`, `IF/ELSE`, `MAKE`, `SC [r g b]`, `PICK [...]`, `RANDOM`
3. **Executor** (`execBlock()`): walks the AST, maintains turtle state + variable scope. Hard limit of 800,000 steps to prevent runaway loops.

### Turtle State

The turtle's orientation is a 3×3 rotation matrix (not Euler angles). Rotation helpers use the Rodrigues formula (`rotAxis()`). `basisForward/Right/Up()` extract direction vectors from the matrix.

Key commands: `FD`/`BK` (move), `LT`/`RT` (yaw), `UP`/`DN` (pitch), `RL`/`RR` (roll), `AR`/`AL`/`AU`/`AD` (arcs), `PU`/`PD` (pen), `COLOR`/`SC`, `WIDTH`, `HOME`, `CS`/`CLEAR`, `OMARK`/`GOTO`, `SP` (snap).

### Export

- **OBJ+MTL (tubes):** Groups segments by color into named materials, converts each segment into a capped cylinder mesh. Triggered by "Export OBJ" button (`objExportTubesWithMtl`).
- **OBJ+MTL (dots):** Emits a small 3D primitive (tetrahedron/octahedron/cube) at each segment's midpoint, or at both endpoints for segments longer than a threshold. Triggered by "Export Dots OBJ" button (`objExportDotsWithMtl`). Shares the same color→MTL pipeline as tubes.
- **STL:** Triggered by "Export STL" button via `stlExportFromSegments()`.
- **`batch-export.js`:** Node.js CLI that runs a Logo program and exports without a browser. Modes: `--mode=rods` (cylinders), `--mode=voxels` (cube grid), `--mode=dots` (primitives). See file header for full flag reference.

### Math primitives

Pure functions, no classes: `V(x,y,z)`, `add/sub/mul`, `I3/matMul/matVec`, `rotAxis`, `norm`.

## Current status (2026-05-13)

### What was built today

**Dots exporter (browser) — `logo3d.js` + `index.html` / `logo3d.html`:**
- Added `_DOT_SHAPES` constant with tetrahedron, octahedron, and cube templates; face windings verified to produce outward CCW normals
- Added `objExportDotsWithMtl(segs, opts)` — iterates drawn segments, places one primitive at each midpoint (or one at each endpoint for segments longer than `splitThreshold`, default 5.0 units); `dotSize` scales the template (default 0.1); inherits the per-color MTL pipeline from the tube exporter; outputs `.toFixed(6)` coordinates to keep file size manageable
- Wired "Export Dots OBJ" button in both HTML files; downloads `logo3d_dots.obj` + `logo3d_dots.mtl`

**Batch exporter — `batch-export.js` (new file, ~900 lines):**
- Self-contained Node.js CLI; zero DOM dependencies, no canvas
- Contains its own copy of the Logo interpreter adapted from `logo3d.js` (tokenizer, parser, expression evaluator, `execBlock`); adds `COLOR` as a `SC` alias
- Pure-JS `parseCssColorToKd` (hex, `rgb()`, named-color lookup) replacing the canvas-based version
- Three export modes sharing `groupByColor`, `buildMtl`, and `placementPoints` helpers:
  - `--mode=rods` — cylinder tube meshes (port of `objExportTubesWithMtl`)
  - `--mode=voxels` — snaps segment midpoints to a grid, deduplicates, emits one cube per occupied cell (`--voxel-size=N`)
  - `--mode=dots` — same primitive logic as browser dots exporter (`--shape=tetra|octa|cube`, `--dot-size=N`, `--split-threshold=N`)
- Usage: `node batch-export.js --mode=dots --shape=tetra sphere.logo`

### What is tested and known working

- **Browser dots button:** code reviewed and logic-traced; not live-tested in a browser yet (no server session this evening)
- **Primitive face windings:** verified analytically for all three shapes — each face normal points away from the opposite vertex/face; should import cleanly in Blender and most slicers
- **Sphere test (manual trace):** the program `omark j rpt 100 [omark k rpt 100 [pu fd 20 pd fd 1 goto k up 3.6 omark k] goto j rt 3.6 omark j]` produces 10,000 one-unit segments; with `splitThreshold=5.0` each gets exactly one midpoint dot → 10,000 tetrahedra, 40,000 vertices, 40,000 faces; step count ≈70,400, well within the 800,000 limit

### What still needs testing

- **Browser "Export Dots OBJ" button:** open `index.html`, run the sphere program, click the button, import the downloaded OBJ into Blender/MeshLab to confirm 10,000 tetrahedra appear on a sphere
- **`batch-export.js` end-to-end:** Node.js is not installed on this machine; needs `node batch-export.js --mode=dots sphere.logo` and import of the result
- **Alternate shapes:** `--shape=octa` and `--shape=cube` are untested; the face-winding math was done for all three but should be spot-checked visually
- **Voxels mode:** new code path, never run; test with a simple straight line and confirm the right number of cubes appear at the snapped grid positions
- **`COLOR` command alias:** added in `batch-export.js` but not in the browser interpreter; any test-suite programs that use `COLOR` (rather than `SC`) will fail in the browser but succeed in batch mode
- **The previously-planned interpreter test suite** (color-cycling programs, recursive fractals with `STOP`) is still pending from the prior session

### Next step when you return

1. Install Node.js if not present, then run: `node batch-export.js --mode=dots --out=sphere_dots.obj sphere.logo` (create `sphere.logo` containing the sphere program above) and import `sphere_dots.obj` into Blender — confirm the sphere of tetrahedra looks right
2. Open `index.html`, run the sphere program, click "Export Dots OBJ", import into Blender — confirm the browser path produces the same result
3. If both check out, run the full interpreter test suite (color-cycling + fractal blocks) that was deferred from the prior session

---

## Prior session — what was fixed

### What was fixed in that session

**Export pipeline (both buttons were completely broken before that session):**
- Added missing `downloadTextFile()` — both export buttons threw `ReferenceError` before this
- Added missing `stlExportFromSegments()` — STL export now generates ASCII STL tube meshes
- Fixed `parseCssColorToKd()` — replaced a 3-format regex with a 1×1 canvas draw so every valid CSS color (named, rgba, 8-digit hex, etc.) resolves correctly in MTL materials
- Snap spokes (`isSnapSpoke: true`) are now filtered out of both OBJ and STL exports
- MTL filename is no longer hardcoded in the OBJ header — it flows from the click handler so the two filenames can't drift apart
- Fixed `blob:` URL download failure on `file://` origins (Chrome security restriction) — switched to `data:` URLs

**Camera:**
- All event-driven redraws now go through `scheduleRedraw()` (rAF batching) — eliminates redundant mid-frame redraws during fast mouse moves
- Added orbit momentum: releasing a drag flicks the camera and it coasts to a stop (`_momentumTick`, 12% decay per frame, ~650 ms at 60 fps)

**Interpreter — missing language features (cross-referenced against a 110-block test suite):**
- `IF` condition evaluation was a stub (always `true`) — replaced with `evalCondition()` which handles `CC=1` (embedded `=`), `CC GT 5`, `CT LT 100`, and colon-var forms like `:D=0`
- `STOP` command implemented — throws `_STOP` sentinel, caught by the enclosing `CALL` handler so only the current procedure exits (not the whole program)
- Colon-variable parameters (`TO t :l :d … END`, calls like `t :l/3 :d-1`) — parser now does an arity pre-pass, strips colon-params from TO bodies, and binds/restores them as local vars on each call; `resolveAny` and `evalExpr` both strip the leading `:` so colon-vars work in arithmetic
- `ARCRIGHT` / `ARCLEFT` / `ARCUP` / `ARCDOWN` added as aliases for `AR` / `AL` / `AU` / `AD`

### What is still broken / not implemented

- **`GT` and `LT` as comparison keywords** are now handled by `evalCondition`, but only in the simple 3-token form (`CC GT 5`). Compound conditions (`if x gt 0 and y lt 10`) are not supported — `evalCondition` falls back to `true` for unrecognised forms.
- **Recursive procedures with mutual references** — the arity pre-pass is a single linear scan of tokens; a procedure called before it is defined *in the source* gets arity 0 and its arguments are not consumed. All test-suite blocks define procedures before calling them, so this is not currently observed to fail.
- **`IMPORT libshapes`** is silently ignored (as designed), but any program that then calls procedures from that library (e.g. `SM`) will throw "Unknown procedure: SM".
- **Cap winding inconsistency in OBJ export** — start-cap and end-cap normals point in opposite directions relative to the barrel. Most importers compute normals from geometry so this is invisible in practice, but strict validators (some slicer tools) may flag it.
- **Float precision in OBJ/STL output** — vertex coordinates use JavaScript's default `toString()` (up to 17 significant digits), bloating file size for complex models. `.toFixed(6)` would suffice.

### Deferred from that session (still pending)

Run the full test suite against the updated interpreter, focusing on the color-cycling programs (the ones that chain `if cc=1 [sc red] if cc=2 [sc orange] … if cc gt 5 [make cc=0]`) to confirm colors now cycle correctly, and on the recursive fractal blocks (`tri fractal`, `self similar squares`, `iterations with stop spiral`) to confirm `STOP` exits cleanly without aborting the whole program.

## Key Constraints

- **No inline scripts** — required for CSP compliance; keep all JS in `logo3d.js`
- **No external dependencies** — the app must work offline and without a CDN
- **Step limit** — the 800,000-step execution guard in `execBlock()` is intentional; don't raise it without considering browser hang risk
- `isSnapSpoke: true` segments are snap-geometry hints and must not feed back into snap detection to avoid recursion

## Data loading rule

Help, Acknowledgements, and Examples content must always be fetched at runtime from their `.txt` files (`commands.txt`, `acknowledge.txt`, `examples.txt`). Never embed this content as hardcoded constants in `logo3d.js`. The `.txt` files are the single source of truth and must be editable without touching code.

## Button sizing rule

All toolbar buttons and the Examples dropdown use the shared CSS class `.toolbar-btn` (defined in each HTML file's `<style>` block) for font size and padding. Never scatter per-button sizing across inline styles. When adding a new toolbar control, add `class="toolbar-btn"` to it.
