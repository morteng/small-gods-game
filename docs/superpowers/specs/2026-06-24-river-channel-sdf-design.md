# River channel as a signed-distance field — design

**Status**: design · **Date**: 2026-06-24 · **Branch**: `main` (slices land incrementally)

## Problem

Rivers render as a **per-cell classified band**: the water fragment shader discards a
pixel when its *cell* is not typed `River` (`water-wgsl.ts` ~L271-273), so the river's
outer silhouette is the cell-membership boundary — staircased at 32 px/tile. The shader
already samples the water *surface* bicubically (`cubicSurfaceW`, ~L181), so the waterline
is C1-smooth **within** drawn cells, but it cannot smooth the cell-quantized **edge**. That
edge is the "jaggy river" the user sees.

Compounding it, "is point P wet?" is answered in four drifting places — the GPU clip, the
per-cell `waterSurfaceAt`, the new `paintedWaterAt` patch, and the classification masks —
so CPU readouts (the studio hover saying *forest* on blue water) disagree with the paint.

## Guiding principle — a realtime-mutable connectome

The renderer is a **live projection of a fully-mutable world connectome**: editing any
node/edge (water node, lake outline, road, terrain feature) must reflect *instantly*, with
no per-cell re-bake and no worldgen re-run. That rules out baked per-cell fields for anything
editable (a baked SDF re-bakes on every drag) and rules IN the pattern *connectome → small
GPU geometry buffer → analytic shader, re-upload the geometry on edit*. The river channel is
the first instance; the same pattern generalises to lake banks, roads, and deformation
features. The studio's existing live water-node drag / merge (W-K) drives the re-upload.

## Core idea

A **binary mask sampled smoothly still staircases; a signed-distance field sampled smoothly
is smooth — that is the whole point of an SDF.** So represent the river not as "which cells
are river" but as a per-cell **distance to the nearest reach centreline**, and decide
wetness from `sd = dist − halfWidth < 0`. The silhouette becomes the smooth offset curve of
the (already smooth, Catmull-Rom) centreline, not the cell grid.

This also unifies the four wetness derivations into **one oracle** read by shader + hover +
riparian + sim. `computeShoreDist` already proves the pattern (it is an unsigned DF used for
ocean/lake foam); lakes and ocean fold into the same signed-distance representation later.

## What already exists (reuse — do not reinvent)

- **Smooth centrelines + widths.** `river-network.ts` `WaterReach.centerline: Pt[]` (tile
  coords, ~0.5-tile Catmull-Rom resample) + `klass`; `river-deformation.ts` `REACH_CARVE`
  gives `halfWidth` per class. This is the SDF *source*.
- **Bank-referenced fill level.** `river-surface-field.ts` already reconstructs a render-space
  fill surface per river cell (bank probe + downstream smoothing). Its *level* logic is reused
  to tag each centreline vertex with a fill height; its per-cell dilation/plateau machinery is
  what the SDF *replaces*.
- **Distance-field precedent.** `computeShoreDist` (`water-field.ts` ~L120) — BFS DF, bilinear
  in-shader. Same upload/sampling path the channel SDF uses.
- **Bicubic surface + per-pixel clip.** `water-wgsl.ts` `cubicSurfaceW`/`cubicTerrainH` —
  keep; the SDF gates the *silhouette*, the existing clip gates the *vertical* (surface vs bed).

## Compute on the GPU — analytic distance, no baked field

**Decision (2026-06-24):** do NOT bake a per-cell SDF. Bake is one-time/memoised (not a
frame cost), and a per-cell field re-bakes on every connectome drag. Instead the shader
computes distance to the centreline **analytically** — the connectome IS the render input
(the "renderer = projection of the connectome" north star). Wins: tiny uploads (KB of
geometry, not MB of per-cell floats), an *exactly* continuous silhouette (no cell grid at
all), and instant live edits (re-upload a few KB of segments). Cost: more shader ALU + a
per-tile acceleration structure. Frame cost is comparable (a few segment-distance evals
vs a few texture taps).

### The GPU inputs (small, connectome-derived)

- **Segment buffer** (`array<f32>`, stride 8): every reach centreline as line segments
  `ax, ay, bx, by, halfA, halfB, surfA, surfB`. Endpoints carry the channel half-width
  (tiles, by class — can taper) AND the render-space bank-referenced fill surface, so the
  shader lerps both along the nearest segment. Flow = `normalize(b−a)` in-shader. ~1–3 k
  segments → tens of KB.
- **Bucket index** (uniform-grid acceleration, CSR): coarse `bucketSize`-tile grid;
  `bucketOffset: array<u32>` (length `nbx·nby + 1`) + `bucketSegs: array<u32>` (flattened
  segment ids whose expanded AABB overlaps each bucket). A fragment tests only its bucket's
  1–4 local segments.
- **`bucketSize, nbx, nby`** in the water-globals uniform.

### The shader rule (per water fragment)

```
g  = fragment tile position
b  = bucket(g);  loop seg in bucketSegs[bucketOffset[b] .. bucketOffset[b+1]]:
       (d,t) = pointSegment(g, seg);  if d < best: best = {d, half=lerp(halfA,halfB,t),
                                                            surf=lerp(surfA,surfB,t), seg}
sd = best.d − best.half                       // negative inside the channel
wet = sd < 0  AND  best.surf − cubicTerrainH(g) > 0
edge anti-aliased with fwidth(sd); flow = normalize(b−a) for the existing river motion
```

The silhouette is the smooth offset curve `sd = 0`; the waterline keeps the existing
surface-vs-terrain clip. Ocean/lake keep their per-cell path for now (S4 folds them in).

## Slices (each verified before the next; check in between)

- **S1 — CPU geometry + bucket builder (pure, no render change).**
  `src/render/gpu/river-channel-geometry.ts`: flatten the (optionally edited) water network
  into the segment buffer (endpoint half-width + bank-referenced fill surface, reusing
  `river-surface-field`'s bank reference per vertex) + the CSR bucket index + a coarse
  `riverBand` gate byte. Pure, memoised per (seed, dims). **Unit tests:** a point on the
  centreline has `sd<0`; a point past half+margin is outside its bucket / `sd>0`; fill ≥ bed;
  determinism. No GPU/shader touch — lands byte-identical, verified numerically. *(Replaces
  the earlier per-cell `river-channel-sdf.ts`.)*
- **S2 — GPU upload + analytic shader.** Upload the segment + bucket buffers (new water
  bindings) + the uniform grid dims; in `water-wgsl.ts` add the analytic `riverChannel(g)`
  function and make rivers the analytic silhouette/surface (gated by `riverBand` so far-from-
  river fragments skip the loop), keeping the surface clip + river motion. Retire the per-cell
  river typing + `river-surface-field` for the silhouette. **Live A/B in `?studio=world`:** the
  staircase is gone; drag a node → re-upload only the segment buffer (no re-bake). Capture
  `canvas.toDataURL`. The risky visual slice — land alone, verify, ready to revert.
- **S3 — One wetness oracle.** `waterAt(map,x,y,dyn)` mirrors the analytic rule on the CPU
  (same segment query). Point hover/riparian/sim at it; **delete `paintedWaterAt`** and the
  per-cell `waterSurfaceAt` round. The studio tooltip then reads correct by construction.
- **S4 (opt) — Lakes/ocean into the same scheme.** Lake bank = distance to its shore polygon
  (segment buffer of the lake outline); ocean = existing `shoreDist`. One distance rule for all.
- **S5 (opt) — Shrink the classification masks** to their real jobs (raster = sim/replay
  determinism; render mask = biome colour), no longer "is it wet".

## Determinism / boundaries

Render-side only (derive-don't-persist, keyed by seed+dims): no `WORLD_CONTENT_VERSION` bump,
no snapshot/replay impact. The sim keeps the deterministic raster (`FloodWatch`, causal sites).
The carve (`REACH_CARVE`) and the SDF read the **same** connectome, so channel + carve + paint
finally agree.

## Risks

- **Band typing (S2).** Rivers currently draw only on river-typed cells; drawing on a dilated
  band must not bleed onto lakes/ocean or double-draw. Mitigate: a dedicated `riverBand` mask,
  clipped by `sd` and the surface clip.
- **Confluences / sharp bends.** Nearest-segment distance can pinch at junctions; the offset
  curve may self-intersect on tight turns. Mitigate: `min` over reaches (union), accept rounded
  joins (SDF unions round naturally — a feature here).
- **Cost.** Per-cell nearest-centreline over a band is O(band cells × local segments); bound by
  chunked AABBs as the carve already does. Memoised, off the per-frame path.
