# Terrain texturing polish + px-consistency + perf + doorstep wear + flora-into-ground

**Status:** in progress 2026-07-21 · **T0 SHIPPED** (px-invariant LOD, main `0ce12476`) · **T1
SHIPPED** (water: exact diamond cull + dead-channelAt + flotsam zoom-gate, main `18d2eba4`) · **D10
SHIPPED** (UI quiet-chrome, main `5cbe46a3`) · **T2 in review** (terrain art) · T3/T4 pending ·
USER DIRECTIVE (2026-07-21): "polish and artistically organize
terrain textures/splatmap/gravel, scatter rocks/boulders on areas of terrain (slope aware + other
features) to make terrain texturing and vegetation play realistically and artistically together
better … do a proper polish of the underlying math of the visuals … introduce wear, scatter
rocks/gravel from doorsteps out into the world (should hook into overall graph system like
everything else)." Plus three reported defects: (1) engine keeps dropping to px2/3/4; (2) terrain
texture COLOR differs between px levels; (3) vegetation disappears at px3 — want coloration retained
when zoomed out even if animation stops (bake into terrain).
**Orchestration:** Opus orchestrates (spec + review + CI-gate + live-verify + band retune); Sonnet
implementers in isolated worktrees, strict file ownership. "Orchestrate lesser models where possible."
**Standing law:** WebGPU-only renderer; all `src/sim/` `Math.random`-free (seeded rng); any post-gen
`tile.type` write MUST `bumpTilesRev(map)`; bumping `WORLD_CONTENT_VERSION`/`ART_RECIPE_VERSION`
updates `tests/unit/content-version.test.ts` same commit.

## Reality check (investigated 2026-07-21, three read-only agents + live profiler on this Mac)

**px / dynamic-resolution governor** (`src/render/gpu/adaptive-resolution.ts`, chosen per frame in
`gpu-render-frame.ts:141`): EMA frame-time; DROP below ~22fps (`downMs≈45.45`), CLIMB above ~28fps
(`upMs≈35.71`), protects px1 by policy. px ladder `[1,2,3,4]` = CSS-px per art texel; higher =
lower-res backing target (`computeView` in `render-profiler.ts:41-63`, `S=round(px·dpr)`,
`lowW=ceil(W/S)`), nearest-upscaled to the swapchain. Stale comments at `gpu-render-frame.ts:77,133`
still say 30/40fps — outdated, fix in passing.

**Live profiler on this machine, current settlement view:** px1 = **51.3ms → 19.5fps** (below the
22fps drop line → it downscales, exactly as reported). GPU-bound (48ms GPU / 3.3ms CPU). Ablation
GPU cost ranking: **water ≈ 29ms** (51→22ms without it), **shadows ≈ 26ms**, **entities ≈ 29ms**,
bare clear+blit+UI ≈ 11ms. Water is the single biggest lever (investigation: ~104k full-map quads/
frame). `window.__renderProfile({frames,warmup})` + `window.__renderTrace` are the harnesses;
`?px=N` pins a level for A/B.

**Color field** (`terrain-field.ts:202 packColorField`, memo `:242` keyed
`WxH|layers|water|t${tilesRev}` — NOT px): CPU buffer is biome/tile-type hue authority only
(`TILE_COLORS`), bilinearly sampled in WGSL. Wear reaches color by rewriting `tile.type` → dirt +
`bumpTilesRev` → memo repaint.

**Ground splat / detail** (`wgsl/terrain-wgsl.ts`, block `uFlags.x>0.5` at `:663-749`): 11-layer
`groundTex` array with CPU-built mip pyramid (`gpu-scene.ts:546`). Weights dust/dry/grass/desert/
forest-floor from moisture+bareField+sward-drift+jit. Analytic in-shader detail (no entities):
`analyticPebbles` (:386, Voronoi stones), `analyticGravel` (:368), `analyticCobble` (:350),
`analyticRock` (:414, elevation-bedded strata), scree apron `wScree` (:805). Rock SPRITES
(billboards) placed by `brushes/hills.ts` (`ALPINE_KINDS`) + analytic scatter in
`render/gpu/grass-scatter.ts` (`emit(...,'rock')`, hard cut `slope>0.48`). Per-tile fields available
to texturing: biome color, normalized+absolute height (m), slope (`1-n.y`), moisture, temperature,
road pavedness/verge/dist, noise; CPU-side continuous water distance `getRenderWaterDist`
(NOT yet uploaded to shader), dust mirror `dust01`.

**THE px COLOR/DETAIL BUG (root cause, confirmed):** every detail-selecting term derives from
`fwTiles = fwidth(in.vGrid)` (`terrain-wgsl.ts:622`), measured in the *low-res* target, and is
NEVER normalized by px. So px2+ = larger `fwTiles` = coarser ground mip (`groundPatch` `lod0` :99),
lower `texFade = smoothstep(4.0,1.0,fwTexels)` :631 (washes the whole splat toward flat biome color),
and `detailLod = smoothstep(1.1,0.55,cellFw)` :346 → 0 (pebbles/cobble/gravel/rock chips vanish).
`fwTiles ∝ S/(z·dpr)`; dividing the footprint by `px` (≈ `S/dpr`) makes LOD depend on camera zoom
`z` ALONE → px-invariant color, while a genuine zoom-out still fades detail. This one fix resolves
BOTH defect (2) [color differs per px] AND the "analytic detail vanishes at px3" half of defect (3).

**Vegetation LOD** (`gpu-scene.ts:1281`): grass/clutter billboards gate on `camZoom < GRASS_MIN_ZOOM
(0.45)` — already DECOUPLED from px (fixed earlier). Flora ENTITY sprites (trees/shrubs) have NO
zoom/px gate (cached static draw list; only snow-hide/layer-hide). So the "veg disappears at px3"
report is (a) the analytic ground chips [fixed by the px-normalization above], and/or (b) grass
billboards at zoom-out. Durable coloration-retention = bake a flora tint into the COLOR FIELD
(immune to the `fwidth` fade), injected at `packColorField` (:222) from a per-cell buffer accumulated
at flora placement (`vegetation-fill.ts:171`, `vegetation-placer.ts` emit seams).

**Wear model to imitate** (`src/sim/trample.ts` `TrampleGrid`): sparse `Map<idx,wear>` accumulator,
`deposit`/`depositWithSpill` (0.2 to 8-neighbours, eligible soft ground), `promoteDecay` swaps
`tile.type→dirt` at wear≥120 / reverts <80 (hysteresis) + `bumpTilesRev`. Gen-time prewarm =
`settlement-wear.ts depositBuildingWear` (:189) which already iterates every building, resolves
`doorstepTile(anchor)`, knows busy-vs-ordinary, stamps doorstep+perimeter+wall-base. Graph:
`RoadGraph` (`road-graph.ts`) — `edge.polyline` is the source-of-truth cell path; adjacency built
from `edges[].a/b`; `desire-line-corridors.ts traceAdoptionCorridors` is the existing path-tracer.

## Design — waves (each shippable, server-CI gated, live-verified on grabs)

### T0 — px-invariant terrain LOD (foundation; fixes color-per-px + analytic-detail-vanish)
Normalize the screen-space-derivative footprint by the px factor so terrain mip/`texFade`/`detailLod`
depend on **camera zoom only**, not the resolution tier. Add `px` (or `S/dpr`) to the terrain
uniform block (`uXform`/a new field) and divide `fwTiles` (and everything derived: `fwG`, `fwTexels`,
`cellFw`) by it before the LOD/fade math in `wgsl/terrain-wgsl.ts` (`groundPatch` :91-103, `texFade`
:630-631, `detailLod` :346, analytic AA terms). Keep the camera-zoom fade (zoom-out still recedes to
biome color) — only the px component is removed. Fold the stale 30/40fps comments fix. **Trade-off
accepted:** px3/4 now run the full ground block (slightly more terrain cost at the fallback tiers) —
worth it for visual consistency; the big perf reclaim is water (T1). **Verify:** `?px=1` vs `?px=3`
grabs at the SAME camera show matching ground coloration; a real zoom-out still fades detail.
Owner: 1 Sonnet agent, WGSL + the uniform plumbing. Tests: a WGSL-parity/pin update if the packed
uniform changes; assert the footprint expression divides by px.

### T1 — perf: hold px1 (cut frame cost so the governor stops dropping)
Target the profiler's ranking. **Water pass first** (the ~29ms hog): tighten viewport-cull +
zoom-coarsen `maxQuads` (T5 window exists but is insufficient at settlement zoom); investigate
whether the water quad count can be gated to the visible+near band and whether still water can share
the terrain pass. **Entities second:** the NPC draw list rebuilds every frame
(`gpu-render-frame.ts:166`) — cache/incrementalize. **Shadows third:** evaluate stencil-union cast-
shadow cost vs a cheaper approximation at settlement zoom. Re-profile after each change; goal = px1
≥ ~30fps at the settlement view on this machine (climbs above the 28fps refine line and stays).
Owner: 1 Sonnet agent, GPU-scene/frame; profiler-gated (attach before/after `__renderProfile`).
NOTE: measure on THIS machine via the live profiler — the win must be empirical, not assumed.
**LANDED (`18d2eba4`):** water is the confirmed lever (real `__renderTrace` at zoom 0.15: water
31ms + flotsam 31ms → 5fps; the `__renderProfile` whole-map path OVERSTATES water). Shipped the
zero-risk wins — L1 exact diamond cull (AABB `window` circumscribes the visible iso rect → ~half the
quads off-screen; test candidate quads against the true rect, byte-identical when the diamond covers
every corner), L3 dead `channelAt` (the cell-center river-band lookup only feeds `inBand`, read only
when `typ==0u` — gate it so ocean/lake vertices stop paying), L2 flotsam zoom-gate
(`FLOTSAM_MIN_ZOOM=0.25` on `camera.zoom`). **DEFERRED, flagged as follow-ups:** L4 fragment
zoom-LOD (already on the `CHEAP_WATER=1` tier — low payoff, correctness-pinned swell math), L5 NPC
draw-list memo (needs a positions-dirty signal from `world.ts`/`npc-sim.ts`, outside water ownership;
NPCs move under the live sim so the still-camera case is rare). Remaining `uiFlotsam` cost after L2,
if any, lives in `ui.frame()` — a follow-up scoped to `ui-runtime.ts`, NOT flotsam. Entities/shadows
levers from the original plan NOT yet touched — separate pass if the governor still drops.

### T2 — terrain texturing art + math polish (the core ask)
Reorganize the ground splat so texturing reads as an ARTFUL, slope-and-feature-aware surface, not
noisy blotches. `wgsl/terrain-wgsl.ts` splat block + CPU `dust-mask.ts` mirror + `grass-scatter.ts`:
- **Splat/gravel organization:** retune dust/dry/grass/desert/forest-floor weighting so dry patches
  follow real drivers (moisture, slope, water-distance, elevation) with coherent macro shapes, not
  high-frequency mottling; improve blend math (height-blend, mean-normalization) so biome stays hue
  authority. Bring `getRenderWaterDist` to the shader (upload a buffer like moisture/temp) so
  shore-damp / dry-upland gradients are real.
- **Slope- & feature-aware rock/boulder/gravel scatter:** analytic scree aprons below cliffs, gravel
  on dry/steep/road-verge ground, boulder clusters on flats & rock-fields, coherent with the rock
  SPRITE placement (`grass-scatter.ts`/`hills.ts`) so analytic + billboard rock agree. Slope bands
  render-space calibrated (per `vegetation-placer.ts` convention).
- **Play with vegetation:** ground dust/rock gates share the same slope/moisture drivers as the
  vegetation placer so bare ground, rock, and flora tell one story.
Owner: 1–2 Sonnet agents. ART bump if the geometry/material pins move. Iterate on grabs with me.

### T3 — doorstep→world gravel/wear scatter, hooked into the connectome graph
New gen-time pass imitating `TrampleGrid`: for each building, from `doorstepTile(anchor)` radiate a
gravel/trodden-ground deposit OUTWARD along the connected `RoadEdge.polyline` (adjacency from
`edges[].a/b`; trace like `desire-line-corridors.ts`) with distance falloff, busy-kinds heavier.
Promote to a new `gravel`/`trodden` ground `tile.type` (add to `TILE_COLORS`, walkable/soft sets as
appropriate) + `bumpTilesRev`. Anchor at `settlement-wear.ts depositBuildingWear`'s existing per-
building loop. Because it flows through the color field it survives the px fade. Deterministic
(seeded rng, no `Math.random`). Owner: 1 Sonnet agent. Tests: deterministic deposit, tilesRev bump,
graph-walk falloff, no-op on peopleless worlds.

### T4 — bake flora coloration into the ground color field (zoom-out retention)
Accumulate a per-cell flora tint at placement (`vegetation-fill.ts:171` + placer emit) — species
average/`petalTint`-aware — into a parallel buffer; blend it into `packColorField` (:222) before
`hexToAbgr`, weighted so biome stays hue authority. Result: when grass billboards / analytic detail
recede at zoom-out or px, the ground RETAINS the vegetation's coloration instead of flattening to
bare biome. Invalidate via `tilesRev` (or fold into the placement→color path). Owner: 1 Sonnet
agent. Depends on T2 (texturing settled). Tests: deterministic tint accumulation, memo invalidation.

### D10 (parallel, separate epic tail) — UI quiet-chrome + band fade + band retune
In flight in a worktree (time cluster→clock-chip-until-hovered, camera→+/- until hovered, ~150ms
band-change label fade). Band-threshold empirical retune done by me on live grabs.

## Sequencing
T0 first (foundation — fixes 2 of 3 defects, unblocks consistent art verification). T1 ∥ T2 (perf
vs art — different files, coordinate on `gpu-scene`/`terrain-wgsl` touchpoints; T0 lands before T2 so
art is verified px-consistent). T3 after T2 (shares the color-field/tile-type surface). T4 last
(depends on T2). D10 lands independently. Each wave: Sonnet in worktree → I review diff + live-verify
grabs across px levels + server-CI-gate (`✓ Server CI passed`) → merge to main.

## Acceptance
No terrain color difference between px levels at a fixed camera; px1 holds ≥~30fps at the settlement
view (governor stops dropping); vegetation coloration persists when zoomed out; terrain reads as an
organized, slope-/feature-aware surface where gravel, rock, wear, and flora tell one coherent story;
doorstep gravel radiates believably along the road graph. Server CI green per wave; WebGPU-only; no
new DOM; deterministic sim.
