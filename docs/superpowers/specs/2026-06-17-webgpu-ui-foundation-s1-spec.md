# S1 — WebGPU UI foundation (spec)

**Date:** 2026-06-17 · **Status:** 📋 DRAFT — not started ·
**Parent:** [WebGPU UI + MCP integration brainstorm](2026-06-15-webgpu-ui-mcp-integration-design.md)
· **Predecessor:** [S0 — Command/Query bus](2026-06-15-command-query-bus-s0-spec.md) ✅
· **Successors:** S2 input · S3 HUD/inspector · S3.5 generated skin

## Goal

Build the **canvas every game-facing UI element is drawn on**: an immediate-mode,
WebGPU-native UI layer that renders **textured quads, programmatic 9-slice panels,
and bitmap/MSDF text** in the existing GPU frame. S1 ships the *engine*, not the
*game UI* — it renders with **gray-box placeholder skins** (solid/▢ rects) and a
couple of throwaway demo widgets to prove the pipeline. Stat-minimal HUD,
gestures, and painted skins are later slices.

The thesis S1 must prove: **"does canvas UI draw correctly in the GPU pass at any
zoom/DPI, with crisp pixel text"** — decoupled from "is the UI pretty" (S3.5) and
"does it feel snappy" (S2).

## Non-goals (explicitly later slices)

- **Input / gestures / hit-test routing** → S2. S1 exposes the hit-test *data*
  (per-widget rects + ids from the immediate-mode pass) but does **not** wire
  `PointerEvent`s, camera inertia, or pinch. A minimal dev-only click probe is
  allowed to validate hit rects, gated behind a flag.
- **Minimal HUD, presence orb, inspector, divine radial** → S3. S1 may include a
  disposable demo panel/button to exercise the batcher; it is not the real HUD.
- **Painted/era skins** → S3.5. S1 draws gray-box: flat fills + 1px borders from
  `ui-palette`, programmatic 9-slice with solid regions.
- **MCP / WS** → S4+.
- **Porting time-bar / settings / studio off DOM** → S3/S6. The existing DOM
  chrome keeps running untouched during S1 (canvas UI composites *over* it).

## What S1 reuses (existing seams)

- **GPU frame** — `GpuScene` (`src/render/gpu/gpu-scene.ts`) owns the passes:
  Pass 1 terrain → 1.5 cast-shadows → 2 entities + shapes. S1 adds **Pass 3 — UI**
  after Pass 2, same `colorView`, `loadOp:'load'`, **no depth**, alpha blend.
- **`webgpu-context.ts`** — device/format/canvas; UI pipeline created here-style
  alongside the others.
- **`GameQuery`** (`src/game/game-query.ts`) — S1 demo widgets read from the query
  facade, never from raw `state`, to lock in the "UI is a bus adapter" rule early.
- **`shape-geometry.ts` / `shape-wgsl.ts`** — the existing screen/shape pass is the
  closest prior art for a non-entity quad pipeline; mirror its buffer/bind-group
  shape, don't fork it.

## Architecture — new files (all under `src/render/ui/`)

> Canvas has no `tokens.css`; UI tokens live in TS. Keep this dir render-only and
> import-light (Node-testable batcher/layout/atlas math; WebGPU calls isolated).

| File | Responsibility |
|---|---|
| `ui-batcher.ts` | Pure CPU batcher. Accumulates **draw commands** (textured quad, 9-slice, text run, solid rect) into one growable instance buffer (pos/uv/rgba/atlas-page). `flush()` returns typed arrays. **No WebGPU** — Node-testable. |
| `ui-pass.ts` | The WebGPU side: pipeline (screen-space ortho, premult-alpha blend, no depth), atlas texture(s) + sampler, per-frame buffer upload, `record(pass)`. Owns the WGSL. The only file that touches `device`. |
| `wgsl/ui-wgsl.ts` | Vertex (ortho transform from a `{viewport, dpr}` uniform) + fragment (sample atlas page, tint, alpha) shader. Bitmap path = nearest; MSDF path = `median(rgb)` screen-derivative AA. |
| `ui-context.ts` | Immediate-mode context. `begin(frame)` / `end()`; widgets `panel()`, `label()`, `rect()`, `nineSlice()`, `button()` (visual only in S1 — emits a hit-rect + id, returns last-known hot/active from the **injected** input snapshot, which S2 fills; in S1 the snapshot is empty so buttons are inert). Owns layout cursor + a retained-free hot/active id model. |
| `ui-palette.ts` | UI design tokens in TS, **derived from the world palette** so chrome and world share colour. Gray-box values now; S3.5 swaps in skinned atlas regions. |
| `text/bitmap-font.ts` | Bitmap pixel-font atlas loader + glyph metrics + `layoutRun(text, scale)` → positioned quads. Integer-scaled, nearest-filtered. Primary HUD text. |
| `text/msdf-font.ts` | MSDF atlas loader + `layoutRun` for **world-anchored** labels that scale smoothly with zoom. Same metrics interface as bitmap so callers are font-agnostic. |
| `ui-layer.ts` | Thin façade wiring `ui-context` (build list) → `ui-batcher` (quads) → `ui-pass` (draw). Exposes `renderUi(frame)` for `GpuScene` to call in Pass 3. Holds the per-frame input snapshot seam for S2. |

**Fonts (resolved decision #1):** one family, two atlases. Primary face
**Pixel Operator** (OFL) — bitmap blit for HUD, **MSDF generated from the same
TTF** for world labels. S1 vendors the atlases as static assets (PNG + JSON
metrics) under `public/asset-library/ui-fonts/`; generation is an author-time
script (`scripts/gen-font-atlas.ts`, msdf-bgfx/`msdf-atlas-gen`), **not** a boot
or paid path. If atlas tooling slips, S1 may ship the bitmap atlas only and stub
MSDF (world labels are an S3 concern) — flagged as a fallback, not the plan.

## Layered render model (which S1 layers land now)

Per design A.1, four layers. S1 builds the **plumbing for all**, populates two:

1. **World** — existing GPU scene. Untouched.
2. **World-anchored UI** — selection rings / floating labels / radial. S1 ships
   the **transform seam** (a draw mode where quad positions are world-space, run
   through the camera matrix instead of screen ortho) + an MSDF label demo. Real
   content = S3.
3. **Screen-space HUD** — immediate-mode, integer-scaled. S1 ships the batcher +
   one demo panel/button/label to prove it. Real HUD = S3.
4. **DOM island** — **not** in S1 (S6). Existing DOM chrome stays as-is.

## Detailed design notes

- **One pass, two projections.** `ui-pass` takes a per-draw `space: 'screen' |
  'world'` flag selecting the uniform (screen ortho vs camera VP). Both go through
  the same pipeline/atlas to keep it one instanced draw where possible (group by
  space + atlas page, ≤ a handful of draws/frame).
- **DPI / integer scale.** HUD uses an integer `uiScale = floor(dpr)` (or a
  zoom-ladder-style snap) so bitmap glyphs stay pixel-crisp; viewport + dpr come
  in via the uniform. Verify at dpr 1 and 2.
- **Premultiplied alpha**, `loadOp:'load'` over the entity pass — match the
  surface alpha mode already configured in `webgpu-context.ts` (the shadow/entity
  passes establish premult; UI must agree or it'll fringe).
- **Immediate-mode hot/active.** Classic Dear ImGui id model: `button()` computes
  a stable id (call-site/string), looks up hover/press from the **input snapshot**
  (`{pointer, buttons}`), sets visual state, returns `clicked`. In S1 the snapshot
  is empty → all inert, but the *id + hit-rect output* is real and unit-tested so
  S2 only has to feed the snapshot in.
- **No retained widget tree.** Rebuild every frame from `GameQuery` DTOs. This is
  the simplicity win; guard it (no per-widget persistent objects beyond the
  hot/active id scalars).

## Testing strategy

**Node (vitest) — the bulk:**
- `ui-batcher` — quad/9-slice/text-run accumulation: vertex/uv/color arrays
  byte-exact for fixed inputs; 9-slice corner/edge/center region math; buffer
  growth.
- `bitmap-font.layoutRun` / `msdf-font.layoutRun` — glyph advance, kerning,
  integer scale, wrap; identical metrics interface across both.
- `ui-context` — layout cursor advance, **hit-rect + id emission**, hot/active
  resolution given a synthetic input snapshot (proves S2's contract).
- `ui-palette` — derivation from world palette is deterministic.
- Keep WebGPU out of these (`ui-pass`/`webgpu-context` are not unit-tested in
  Node — no device). Guard the dir's import-purity like the existing
  `no-three-in-bundle` / `no-static-pixi-import` tests if needed.

**Browser eyeball (Playwright `__debug.grab()` / canvas `toDataURL`, per
`docs/DEV_LOOP.md`):**
- Demo HUD panel + button + bitmap label render crisp at dpr 1 and 2, correct
  position under window resize.
- MSDF world-label demo stays sharp across the full zoom ladder (in vs out).
- Compositing: UI draws **over** entities, **under** nothing (it's the top GPU
  pass); existing DOM chrome still visible above canvas as today.
- Zero WebGPU validation errors in console.

## Risks & mitigations

- **MSDF atlas tooling friction** → bitmap-only fallback for S1 (world labels are
  S3); don't block the foundation on smooth-zoom text.
- **Premult-alpha fringing** mismatch with entity pass → settle blend/alpha-mode
  against `webgpu-context.ts` first; add an eyeball check for halo.
- **Scope creep into S2/S3** → enforce: no `PointerEvent` wiring, no real HUD
  content, no skins. Demo widgets are disposable and clearly marked.
- **Font licensing** → Pixel Operator is OFL; vendor the license file alongside
  the atlas.

## Definition of done

- `src/render/ui/` exists with the files above; `GpuScene` calls Pass 3 UI.
- Node suite green incl. new batcher/font/context/palette tests; tsc + build clean.
- Browser: demo HUD panel + button + bitmap label + one MSDF world label render
  correctly at dpr 1/2 across the zoom ladder, over the entity pass, zero GPU
  validation errors — `__debug.grab()` screenshot captured.
- Gray-box only; no skin, no input wiring, no HUD semantics. Existing DOM chrome
  untouched.
- Memory + ROADMAP updated; S2 unblocked (input snapshot seam documented).
