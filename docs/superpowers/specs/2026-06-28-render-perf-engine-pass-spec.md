# Render-perf engine pass — fill-rate, ALU, per-frame waste, and engine professionalization

**Status:** spec (no code). Slots under the **renderer-perf-profiling** epic
(`MEMORY.md` → `[[project-renderer-perf-profiling]]`). Continues the work that already
shipped the static draw-list cache, the adaptive px ladder, and the viewport water-mesh
cull. Branch when picked up: `perf/render-engine-pass` off `main`.

## Why now / current regime (don't re-fight settled battles)

The profiling harness (`window.__renderProfile` / `__renderTrace`,
`src/render/gpu/render-profiler.ts`) already established, on the gen-8 Intel iGPU floor:

- **Gameplay zoom (settlement): water is no longer the bottleneck.** The viewport
  water-mesh cull (`e1c37b5`) + sparse wet-cell mesh (`16e8286`) took the water pass
  **49 ms → ~1 ms**. Removing water now barely moves the frame.
- **Overview / fit-zoom: FILL-bound.** px sweep px1 69 ms → px2 21 → px3 13 → px4 12.5.
  Resolution scaling is a strong lever *here* (px1→px2 ≈ 3×). The dominant cost is
  full-res fragments over a large water/terrain area.
- **CPU encode is negligible** (~2–3 ms) since the static draw-list cache — until entity
  counts climb (the Tier-3 regime below).

So the recommendations below are **mostly aimed at the overview fill-bound regime + ALU
per fragment + residual per-frame CPU waste**, not at the already-won gameplay-zoom water
pass. Each slice must be **re-measured with the harness before and after** — this epic's
rule is *verify, don't assume* (`[[feedback-verify-reviewer-claims]]`).

## Tier 1 — real wins, attack the bottleneck

### T1.1 — Render water to a half-resolution target and upscale
Water is smooth and low-frequency; it does not need native-res fragments. A ½×½ water
target is ~4× fill-rate cut on the dominant **overview** pass. The crisp waterline (the one
thing that *can't* be half-res) is already clipped per-pixel against full-res height buffers
— keep that edge test at full res via a thin compositing/upscale step that re-evaluates the
shoreline clip at native res while sampling the half-res water body colour underneath.
- **Scope it to the regime that's fill-bound.** At gameplay zoom water is ~1 ms; a half-res
  target buys ~nothing there and adds a blit + a target. Gate the half-res path on the
  fill-bound regime (wide zoom) or measure that it's net-positive everywhere before making
  it unconditional. WebGPU-only; reuse the existing low-res-blit plumbing from P-E
  (`8ae24eb`) if it still fits.
- **Risk:** double-resolution waterline seam. Mitigate by compositing the shore clip at
  full res (it already reads full-res height buffers), not by upscaling a pre-clipped image.

### T1.2 — Bake the fbm/noise to a small tiling texture
Replace per-fragment `hash21 + sin` fbm (~20 ALU/sample) with one texture fetch from a
small tiling noise texture (a few hundred KB VRAM). Cuts ALU on **every water and terrain
fragment** — compounds with T1.1 and helps both regimes.
- Bake once at init (deterministic seed) into a tiling R16/RG16 texture; sample with
  `repeat` addressing. Match the current fbm's octave sum closely enough that terrain/water
  read identically (pin a WGSL/CPU parity check the way the channel SDF is pinned).
- **Watch:** tiling visible at extreme zoom-out; pick tile size + octave split so the seam
  is sub-pixel at fit-zoom. Mixed `*`/`^` in WGSL needs explicit parens or it white-screens
  (`[[project-procedural-texture-feature-sizes]]`); GPU-validate via `getCompilationInfo`.

### T1.3 — Kill the redundant per-frame full `world.query()` calls
`frame-renderer.ts` issues several full NPC `world.query()` sweeps per frame (followers
count, power contribution, minimap, debug HUD, hover-find), each spreading a `Set` into a
fresh array. Cache **one** NPC list per frame and pass it to each consumer. Pure CPU waste;
trivial; helps the *running* (gameplay) case specifically — the original complaint.
- Build the NPC list once at the top of the frame; thread it (or hang it on the per-frame
  render context). Verify the count via the HUD is unchanged.

## Tier 2 — professionalize the engine

### T2.1 — Add timestamp-query GPU profiling (where supported)
`__renderProfile` measures CPU/wall time + ablation; true per-pass GPU ms needs
`timestamp-query`. **The gen-8 iGPU floor does NOT expose it** (documented in
`[[project-renderer-perf-profiling]]`) — so this is a *progressive enhancement*: when the
adapter advertises `timestamp-query`, attach a `QuerySet` + resolve buffer and report real
per-pass GPU ms; otherwise fall back to the existing ablation timing. You cannot honestly
tune the half-res water target (T1.1) on hardware that *does* expose it without this.

### T2.2 — Wrap the static passes in render bundles
`GPURenderBundle` for the camera-independent static draw layer (flora/buildings/deco/roads —
already cached as a list by the static draw-list cache). Cuts CPU command-recording and is
the idiomatic structure; sets up T-3 (bundle culling). Low risk, real cleanup. Won't fix the
GPU fill bottleneck — pair with Tier 1.

### T2.3 — Per-frame allocation hygiene
The dynamic draw-list build news up ~5 Maps + a Set + a sorted-array copy every NPC frame.
Pre-allocate and clear-in-place. Minor, but it's GC pressure on the hot path; compounds with
T1.3 (same frame-renderer hot path).

## Tier 3 — future scaling (do later, only when it pays — NOTE, don't build)

### T3.1 — GPU-driven culling via compute + indirect draw
The Nanite-class lever (toji bundle-culling / vkguide). Only pays once entity counts hit the
thousands of *draws* and CPU culling/submission becomes the wall. We're at ~20–65 draws post
static-cache; **not yet.** Record as the scaling path; revisit if a world pushes draw counts
back up (the overview regime had ~10k draw *items* before the static cache collapsed them —
if that regresses, this is the answer).

### T3.2 — Bindless textures
Collapse the 11–53 per-texture entity draws into one. Again a CPU/draw-count win, relevant
only at scale. Note alongside T3.1.

## Sequencing

T1.3 (trivial, helps gameplay) → T1.2 (ALU, both regimes) → T1.1 (fill, overview; the
biggest single GPU lever but scope-gated) → T2.1 (so T1.1 is measurable on capable HW) →
T2.2 / T2.3 (cleanup). Tier 3 is a documented scaling path, not scheduled.

## Verification

- **Before/after with the harness** at BOTH regimes (overview fit-zoom + gameplay zoom):
  `__renderProfile({frames,warmup})` px sweep + per-pass ablation; `__renderTrace` live
  phase breakdown. Capture via `__debug.grab()` / `canvas.toDataURL`, not `page.screenshot`
  (`[[feedback-playwright-in-dev-loop]]`).
- **No visual regression:** waterline crisp (T1.1), terrain/water texture identical (T1.2),
  HUD counts unchanged (T1.3). A render catches geometry/seam bugs no assertion does.
- **Tests green** + `npm run build` clean. New parity test for the baked-noise texture
  (T1.2) and the half-res composite shoreline (T1.1) if they touch WGSL the CPU mirror pins.

## Critical files

| Concern | File |
|---|---|
| Profiling harness | `src/render/gpu/render-profiler.ts`, `GpuScene.profile()` in `gpu-scene.ts` |
| Water pass / mesh / field | `src/render/gpu/water-field.ts`, `wgsl/water-wgsl.ts` |
| fbm/noise in shaders | `wgsl/terrain-wgsl.ts`, `wgsl/water-wgsl.ts` (the `hash21`/fbm) |
| Per-frame NPC queries | `src/game/frame-renderer.ts` |
| Dynamic draw-list build | `src/render/iso/entity-draw-list.ts` |
| Low-res blit (reuse for T1.1) | the P-E blit path (`8ae24eb`) in `gpu-render-frame.ts` |
| Static draw layer (bundle candidate) | the static-cache path in `gpu-scene.ts` |

## Out of scope / already done

- Gameplay-zoom water cost (won: `e1c37b5` + `16e8286`).
- The adaptive px ladder (shipped; px>2 helps at overview per the re-profile — keep it).
- Removing the per-cell composed height bake (it's the lift/water/camera datum — KEEP, per
  the unified-terrain-features plan's hard constraint).
</content>
</invoke>
