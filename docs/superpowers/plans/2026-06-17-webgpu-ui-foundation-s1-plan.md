# S1 — WebGPU UI foundation (plan)

**Spec:** [2026-06-17-webgpu-ui-foundation-s1-spec.md](../specs/2026-06-17-webgpu-ui-foundation-s1-spec.md)
· **Status:** 📋 not started · **Branch:** `feat/webgpu-ui-s1` off `main`

Build order is **inside-out**: pure CPU pieces first (Node-testable, no device),
then the WebGPU pass, then wire into the frame, then eyeball. Each stage leaves the
suite green and the game still running on the existing DOM chrome.

## Stage 0 — Branch + skeleton
- Branch `feat/webgpu-ui-s1` off `main` (confirm clean tree; the connectome
  session is in `src/blueprint`/`src/assetgen` — disjoint).
- Create `src/render/ui/` with empty modules + an import-purity guard test (no
  `pixi`/`three`; `ui-pass`/`webgpu-context` are the only WebGPU touch points).
- **Checkpoint:** tsc clean, suite green (no behaviour yet).

## Stage 1 — `ui-palette` + `ui-batcher` (pure CPU)
- `ui-palette.ts`: tokens derived deterministically from the world palette.
- `ui-batcher.ts`: draw-command accumulation (solid rect, textured quad, 9-slice,
  text run) → growable typed arrays (pos/uv/rgba/page); `flush()`/`reset()`.
- Tests: vertex/uv/color arrays byte-exact; 9-slice region math; buffer growth;
  palette determinism.
- **Checkpoint:** Node tests green for batcher + palette.

## Stage 2 — Font atlases (`text/bitmap-font` + `text/msdf-font`)
- `scripts/gen-font-atlas.ts` (author-time): Pixel Operator TTF → bitmap PNG+JSON
  and MSDF PNG+JSON → `public/asset-library/ui-fonts/` (+ OFL license file).
- `bitmap-font.ts` / `msdf-font.ts`: load metrics, `layoutRun(text, scale)` →
  positioned quads via the batcher; **shared metrics interface**.
- Tests: advance/kern/scale/wrap; bitmap and MSDF expose identical interface.
- **Fallback:** if MSDF tooling slips, ship bitmap-only, stub MSDF, flag it.
- **Checkpoint:** Node tests green; atlases vendored.

## Stage 3 — `ui-context` (immediate mode, no device)
- `begin/end`; `panel/label/rect/nineSlice/button`; layout cursor; hot/active id
  model reading an injected input snapshot (empty in S1 → inert, real S2 seam).
- `button()` emits stable id + hit-rect, returns `clicked` from the snapshot.
- Tests: layout advance, hit-rect + id emission, hot/active resolution under a
  synthetic snapshot (this is S2's contract — lock it now).
- **Checkpoint:** Node tests green; immediate-mode API exercised end-to-end on CPU.

## Stage 4 — `ui-pass` + `wgsl/ui-wgsl` (WebGPU)
- Pipeline: screen-space ortho + world-space VP via a `space` flag and a
  `{viewport, dpr, vp}` uniform; premult-alpha blend matched to
  `webgpu-context.ts`; **no depth**. Mirror `shape-geometry`/`shape-wgsl` buffer
  + bind-group shape.
- Atlas texture(s) + sampler (nearest for bitmap, linear for MSDF); per-frame
  buffer upload from `ui-batcher.flush()`; `record(pass)`.
- WGSL: ortho/VP vertex; fragment samples page, tints, MSDF `median` AA.
- (Not Node-tested — no device. Validated in Stage 6.)
- **Checkpoint:** tsc clean; compiles.

## Stage 5 — `ui-layer` + wire into `GpuScene` Pass 3
- `ui-layer.renderUi(frame)` = context build → batcher → pass.
- `GpuScene`: add **Pass 3 — UI** after Pass 2 (`colorView`, `loadOp:'load'`, no
  depth). One disposable demo: a HUD panel + button + bitmap label (reads a value
  via `GameQuery`) + one MSDF world-anchored label, behind a `?uidemo` flag.
- **Checkpoint:** tsc + build clean; game boots; demo draws.

## Stage 6 — Browser eyeball + harden
- `npm run dev`, Playwright `__debug.grab()`: crisp at dpr 1 & 2; correct under
  resize; MSDF label sharp across the full zoom ladder; UI over entities; existing
  DOM chrome still above canvas; **zero GPU validation errors**.
- Tune integer `uiScale`, blend/alpha, premult fringing.
- **Checkpoint:** screenshots captured; visual sign-off.

## Stage 7 — Land
- Full suite green, tsc + build clean. `/code-review` the diff.
- Remove or flag-gate the demo widgets (don't ship loose).
- Update `[[project-webgpu-ui-mcp-integration]]` memory + ROADMAP: S1 done, S2
  next, document the input-snapshot seam `ui-context` exposes.
- Merge to `main` (FF). Do **not** push unless asked.

## Out of scope (guardrails)
- No `PointerEvent`/gesture/inertia wiring (S2). No real HUD/orb/inspector/radial
  semantics (S3). No painted or era skins (S3.5). No MCP/WS (S4+). No DOM-chrome
  port (S6). No paid generation calls anywhere (money freeze in effect).
