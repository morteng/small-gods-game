# Building Geometry v6 — Medieval Detail Pass

**Date:** 2026-06-12 · **Branch:** `feat/building-geometry-v2` (stacked on `feat/pbr-lighting-v1`)
**Reference:** [docs/reference/medieval-building-reference.md](../../reference/medieval-building-reference.md)

## Problem

The parametric 3D buildings are credible massing but architecturally naive:

1. **No eaves** — roof prisms sit flush on the wall top; medieval roofs (especially
   thatch) overhang 0.4–0.9 m.
2. **Windows are an afterthought** — cottage has 0, tavern 2; real counts vary by
   type/status and grow with height.
3. **Chimneys oversized and ahistorical** — default stack is 0.84 m wide (27 px),
   every commoner building gets one; period default for commoners is a ridge smoke
   louvre. Inns/manors should have *multiple* stacks.
4. **No roof furniture** — no half-hip (the signature thatch form), no dormers.
5. **Square footprints** — cottage/tavern bodies are square; real plans are 1:1.5–1:4.
6. **No cast shadows** — buildings float on the terrain.

## Design

### A. Eaves & verges (assetgen `solids.ts`)

Per-roof-material overhang table, in cube-units (1 unit = 2 m):

| roof Mat | eave | verge | real-world |
|---|---|---|---|
| thatch | 0.22 | 0.10 | 44 cm / 20 cm |
| timber (shingle) | 0.16 | 0.08 | 32 / 16 |
| tile | 0.12 | 0.06 | 24 / 12 |
| stone (slate) | 0.08 | 0.0 | 16 / flush masonry verge |
| (flat roofs) | 0 | 0 | parapet slab unchanged |

Construction (`wingRoof`): the roof prism is built over the top storey rect grown
by `eave` across the ridge and `verge` along it, with base dropped by
`pitch·eave` so the **ridge height is unchanged** and the eave edge hangs below
the wall top (geometrically faithful). The grown prism's interior below the wall
top is subtracted away (box over the wall rect) so the wall faces stay visible —
the remaining wedge outside the wall plane IS the eave. Thatch eave = 0.22 keeps
the eave underside (1.35 − 0.33 = 1.02) just above the door head (1.0).

### B. Half-hip roof (`RoofKind 'half_hip'`)

`half_hip` = gable prism (with eaves as above) ∩ hip prism pair built over the
rect *additionally* grown along the ridge — pushing the hip end-slopes outward so
they only clip the top of the gable triangle. Yields the classic thatch gablet by
construction. Blueprint `jerkinhead` (and longhouse) map to it.

### C. Dormers (`BuildingFeatures.dormers`)

`DormerFeature { wing, t, face? }` — a small wall-material box rising from the
camera-facing roof slope topped with a mini gable prism (roof material), ridge
perpendicular to the main ridge. Massing only; the img2img pass paints the dormer
window (brief mentions it). New blueprint feature type `dormer`.

### D. Vent rework (period-correct smoke)

- Chimney default width 0.42 → **0.30** (0.6 m), protrude 0.7 → 0.55 above ridge.
- Smokehole becomes a real **ridge louvre**: timber box + mini roof cap, 0.35
  wide, rising 0.35 above the ridge (was a near-invisible stone nub).
- Presets carry explicit vent lists: tavern gets **2 stacks**, temple/shrine/barn
  get **none**, commoners get the louvre, keep gets a small parapet cap.

### E. Jetty exposure

`body` params gain `jetty` (0–0.3, default 0) → `Wing.jetty` (plumbing already
existed). Tavern gets `jetty: 0.12` (0.24 m oversail on the street faces).

### F. Preset overhaul (windows, proportions, vents)

Per the reference table — key changes:

| preset | footprint | body | windows | smoke | roof |
|---|---|---|---|---|---|
| cottage | 3×3 | **3×2** (was 2×2 square) | 1 shuttered beside door + 1 gable | ridge **louvre** (was wall chimney) | gable thatch |
| longhouse | 4×2 | 4×2 | 2 on humans' end; **opposed doors** (cross-passage) | louvre at t=0.33 | **half_hip** |
| tavern | 3×3 | **3×2**, 2 storeys, jetty | 2 ground + 3 upper south, 1+1 east | **2 chimneys** | gable + **2 dormers** |
| farm_barn | **4×2** (was 3×2) | 4×2 | 3 high slit vents, no real windows | none | gable |
| temple_small | 3×3 | cross | 2 tall arched per nave side | **none** (was smokehole) | hip |
| tower | 2×3 | 2×3 | slit low + arched high (grow with height) | none | flat |
| castle_keep | 3×3 | bailey+tower | slits on bailey; tower windows grow with height | 1 small parapet cap | flat |
| guard_post | 2×2 | 2×2 | 1 | none | hip |
| shrine | 2×2 | 2×2 | 1 small arched | none | gable |
| market_stall / dock / yurt | — | — | unchanged | yurt toono unchanged | — |

### G. Cast shadows (render, separate commit)

Pixi layer only (Canvas2D stays the unlit/shadow-less parity fallback): each image
draw item first draws a **projected silhouette shadow** — same texture, black
tint, alpha ≈ 0.35, flipped/squashed vertically (×−0.45) and skewed along the
screen-space sun azimuth (from `LightingState.sunDir`), pivoted at the sprite's
foot line (dy+dh). All shadows render in a sub-container beneath the entity
sprites, so they fall across terrain *and* the bases of neighbouring
buildings/props — the standard 2D-game projected-shadow model. Off when lighting
is off.

## Consequences

- `ART_RECIPE_VERSION` → `'v6'`; golden buffer-hash pins updated.
- Vendored base library must be reseeded (12 presets, ~$0.5 OpenRouter).
- farm_barn footprint 3×2 → 4×2 flows through placer/collision automatically
  (they read the blueprint footprint).

## Out of scope

- New building types (smithy, manor, church-with-tower, granary) — the reference
  doc covers them for a follow-up presets slice.
- Crow-steps, catslide, oriel, buttresses, crenellation rework.
- True shadow mapping / wall-received shadows.
- Day/night sun movement (PBR Slice 4 — shadows will pick up the animated sunDir
  for free since they read LightingState).
