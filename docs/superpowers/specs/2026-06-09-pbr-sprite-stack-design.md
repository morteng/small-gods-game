# Small Gods — PBR Sprite Stack (design)

> Epic spec. Defers to [VISION.md](../../VISION.md) on cosmology/belief/Fate. This is
> the visual/render layer and expands the parked **Track R** ("WebGL-2D PixiJS
> normal-lit renderer"). Each slice in §6 is independently shippable and gets its own
> implementation plan when reached; this pass also produces the **Slice 1** plan.

## Goal

Buildings — then all sprites — render as **lit PBR sprites**: a per-sprite G-buffer
(albedo + normal + depth + AO + roughness/metallic + emissive) lit by a WebGL fragment
shader whose output is **quantized into banded shades** so the hand-drawn pixel-art look
survives. Lighting is driven by four payoffs the player asked for:

- **Day/night + weather** — a global sun/moon + ambient swept by the sim clock; weather moods.
- **Divine & dramatic light** — localized dynamic point lights (divine glow on a focused NPC, miracles, omens).
- **Firelight & emissive** — hearths, torches, lit windows at night; an emissive map that self-lights and casts local glow.
- **Material truth** — wet stone vs dry thatch vs metal read correctly under any light (roughness/metallic).

## Background — what already exists

- **Albedo via chroma-key** is done (`src/render/chroma-key.ts`, `blob-to-building-sprite.ts`):
  the LLM paints the texture on a forced solid-magenta background, keyed out to clean alpha.
- **The geometry rasterizer is already a mini G-buffer.** `src/assetgen/render/rasterize.ts`
  emits `'albedo'` and `'normal'` and keeps a **per-pixel z-buffer** (depth is computed and
  currently discarded). `composeStructure` (`src/assetgen/compose.ts`) returns aligned
  `grey`/`normal` + `bbox` + `anchors` (door/vent/window **nodes**).
- **Materials are a closed enum** (`src/assetgen/types.ts` `Mat`): `stone | timber | plaster |
  thatch | tile | foliage | bark | earth | metal | door | brick`. Per-material
  roughness/metallic is a lookup table.
- **Cache format is already widened** (`src/render/generated-art-cache.ts`
  `GeneratedArtRecord`) with optional `normal`/`anchors`; will extend to the full pack.
- **Render flows through a seam** — `src/game/frame-renderer.ts` → `buildRenderContext`
  (`src/game/render-context.ts`) → per-layer draw. A WebGL layer slots in here.
- **PixiJS is not yet a dependency.** PixiJS ≠ `three`, so the `no-three-in-bundle` guard
  stays green. (Memory: PixiJS is the long-standing Track-R candidate.)

## 1. The PBR G-buffer (per-sprite asset)

Each cached building sprite becomes a **co-registered map set** (identical crop + scale +
dimensions), persisted in IndexedDB keyed by blueprint identity + `ART_RECIPE_VERSION` + model.

| Map | Channels | Source |
|---|---|---|
| **albedo** | RGBA | LLM (chroma-key) — the texture. ✅ done |
| **normal** | RGB (tangent/view-space) | geometry — `rasterize('normal')`. ✅ exists |
| **depth / height** | R | geometry — the z-buffer already computed, currently discarded |
| **AO** | R | geometry — screen-space AO baked once at gen time from depth + normal |
| **roughness + metallic** | R, G | per-`Mat` lookup, rasterized as a new ORM-style pass |
| **emissive** | RGB | geometry — window/door/vent nodes + a per-`Mat` emissive flag, painted as a glow mask |
| **nodes** | JSON | door/vent/window anchors (0..1 normalized). ✅ exists |

**Packing.** To keep texture units low, channels pack into a small number of RGBA textures:
- `albedo` (RGBA) — its own texture (it's the LLM output).
- `geom` = normal.xy + depth + AO (RGBA).
- `orm_e` = roughness + metallic + emissive-mask + (spare) (RGBA), with emissive *color*
  derived from albedo × mask, or a separate emissive RGB if needed.

Exact packing is finalized in the Slice-1 plan; the asset contract is "a `SpriteMaps` bundle
of named, co-registered RGBA buffers + nodes JSON".

## 2. Generation pipeline (runtime, cached)

- Thread `Mat` through `WorldFacet`/`ScreenFacet` so the rasterizer can emit material-derived
  channels (today facets carry only resolved `albedo: RGB`).
- Extend `rasterize()` with modes: `'depth'`, `'orm'` (roughness/metallic), `'emissive'`;
  capture the existing z-buffer for depth; add a post-pass screen-space AO from depth+normal.
- `composeStructure` returns the full `SpriteMaps` set (all `size×size`, plus `bbox`/`anchors`).
- `GeneratedBuildingArtSource` (`src/render/generated-building-art-source.ts`) writes the whole
  pack to the cache; on a hit it returns the pack. Albedo remains the **only** network call;
  geometry passes are cheap and run in-browser (manifold already does).
- **Registration:** all geometry maps share the grey `bbox`; the LLM albedo is keyed + cropped
  to its content and scaled to the same target dimensions, so the pack is co-registered.

## 3. The lit renderer (incremental PixiJS WebGL layer)

- Add PixiJS as a render backend **behind the existing seam**. **Buildings first**: a PixiJS
  layer draws lit building sprites; Canvas2D keeps drawing terrain + UI. Migrate NPCs /
  vegetation layer-by-layer in later slices, then retire Canvas2D entity drawing.
- **Camera parity:** the PixiJS layer shares the existing camera transform (pan/zoom, iso
  placement) so lit sprites land exactly where Canvas2D drew them. Fallback to the current
  Canvas2D sprite blit when WebGL is unavailable or the layer is toggled off.
- **Banded shading:** the fragment shader samples the G-buffer, accumulates lights, then
  **quantizes** luminance to N bands (configurable) so output stays crisp pixel-art rather than
  smooth-painterly. This is the defining stylistic choice (player picked "crisp pixel-art").

## 4. Light model & game wiring

- **Ambient + sun/moon:** direction, color, intensity computed from `state.clock` (day-night
  cycle); weather state tints/dims. Global, one per frame.
- **Point lights:** a per-frame light list the sim feeds the renderer — divine glow on the
  focused NPC / miracles / omens; firelight from hearths/torches; lit windows at night (the
  emissive map self-lights and contributes a local glow). Each light = `{ pos, color, radius,
  intensity, kind }`; the shader does the accumulation.
- Lights are **data**, owned by the sim/render bridge, not hardcoded in the shader.

## 5. Testing strategy

- **Pure functions** (material→ORM table, AO kernel math, light-accumulation/banding math
  factored out of GLSL into a testable TS reference, packing/unpacking) are unit-tested in Node.
- **G-buffer generation** is verified with offline **preview PNGs** per map (the established
  `scripts/assetgen-preview.ts` pattern) — a visual render catches geometry bugs no assertion
  does (project rigor note).
- **Renderer** parity + lighting are verified in-browser via the dev loop (`__debug.grab()` /
  `canvas.toDataURL`, not `page.screenshot`), comparing lit vs Canvas2D placement.
- WebGL shader code itself is not unit-tested; its math is mirrored in tested TS helpers.

## 6. Slices (each ships independently; each gets its own plan when reached)

1. **G-buffer generation** — thread `Mat`; extend `rasterize`/`composeStructure`/cache to
   produce + store the full `SpriteMaps` set for the cottage; verify every map via preview PNGs.
   *(Plan written now.)*
2. **PixiJS building layer (parity)** — render the cottage's albedo through a PixiJS layer behind
   the seam, exact camera parity, Canvas2D fallback intact. **No lighting yet** — placement parity first.
3. **Lighting shader v1** — ambient + one directional sun, banded output, normal + AO. First *lit* cottage.
4. **Day/night + weather** — drive sun/ambient from `state.clock`; weather moods.
5. **Point lights** — divine glow + firelight + emissive windows from a sim-fed light list.
6. **Material truth** — roughness/metallic into the shader.
7. **Migrate remaining layers** — NPCs, vegetation; retire Canvas2D entity drawing.

## 7. Risks & non-goals

- **Risk: pixel-art vs lighting fights.** Mitigated by banded quantization (Slice 3) — tune band
  count on the cottage before scaling.
- **Risk: two renderers diverge (placement/z-order).** Mitigated by sharing one camera transform
  and keeping Canvas2D fallback until parity is proven per layer.
- **Risk: per-sprite map memory.** Mitigated by channel packing (§1) and the existing
  generate-once IndexedDB cache.
- **Non-goal:** real-time shadows between sprites, global illumination, a physically-exact BRDF.
  This is stylized PBR for a 2D iso sprite scene.
- **Non-goal:** `three` / a heavyweight 3D engine in the bundle (guard stays green).
