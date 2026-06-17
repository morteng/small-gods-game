# Water: hydrology, aquatic biomes & lean rendering (brainstorm)

**Date:** 2026-06-17 · **Status:** brainstorm (user-directed) · **Builds on:**
[roads / linear features connectome](2026-06-14-roads-linear-features-connectome-design.md),
the shared terrain deformation channel (`src/world/terrain-deformation.ts`, `heightAt = base ⊕ deformations`),
[terrain rendering system](2026-06-15-terrain-rendering-system-design.md),
[worldbuilding fact DB](2026-06-14-worldbuilding-fact-database-design.md),
flora fact-DB (`src/flora/`), biome regions (`src/world/biome-regions.ts`),
GPU terrain (T1 heightfield) + banded PBR lighting (`src/render/lighting-state.ts`).

## What the user asked

> "let's think about the water. both lake, river, stream and ocean. as lean and
> fast as possible — lakes flat terrain at water height, rivers as polygon strips
> with shader accommodation for slope angle, waterfall mode, obstructions (rocks),
> turbulence, merges; ocean to be beach and cliff aware; all support optional
> flotsam bitmaps that move with streams and waves. sounds doable for a single
> terrain pass with shaders? what am I not thinking of?"
>
> then: "everything your way. also separate biomes for rivers and lakes and ocean
> with influence over bottom terrain color, rocks, flora and fauna — also to affect
> river banks. figure out best way to subdivide. caustics to be simulated where
> appropriate."

## The thesis (my synthesis)

Four moves make the whole thing lean, and each one collapses several of the
stated features into a single mechanism:

1. **Not one pass — one *extra* pass.** Terrain stays opaque (front-to-back, no
   blend). Water is **one shared blended pass** after terrain, before entities.
   All four body types (stream/river/lake/ocean) go through **one shader**; type
   is a data attribute, not a separate pass.
2. **Subdivide representation by *scale*, not by *type*.** Wide water (lakes,
   ocean, grid-resolvable rivers) = **carve + fill** (reuse the planned river-
   incision deformation; a carved channel is a low region the water-surface field
   fills exactly like a lake basin). Sub-cell streams = **road-style ribbons**.
   Rivers and lakes become the *same* representation, so the merge / river-mouth /
   river→ocean seams — the worst part of a strips-vs-cells split — simply vanish.
3. **The shader reads the terrain-height buffer.** `depth = waterSurface −
   terrainHeight` falls out for free, and depth then drives color gradient,
   shoreline foam (`depth < ε` = "beach aware"), obstruction wake, cliff-vs-beach
   classification, blend-vs-opaque, biome depth-zone, *and* caustic reach. One
   variable, most of the feature list.
4. **The real deliverable is the flow field, not the shader.** Flow direction,
   waterfall mode, turbulence, merges, flotsam advection are all driven by a
   per-cell / per-ribbon-vertex **flow vector** produced by a hydrology pass
   (drainage graph → downhill direction; Strahler order → width/speed). The
   shader is then a pure function `water = f(depth, flowVec, biome, time)` shared
   by both the cell-fill mesh and the stream ribbon — which is *why* their seams
   match. Build the data first; the shader is the easy half.

> Reframed in one line: **water is a derived layer over terrain + hydrology,
> rendered in one blended pass whose every effect is a function of `depth` and
> `flow`.**

---

## 1 · Representation — split by scale

| Body | Representation | Surface height | Flow |
|------|----------------|----------------|------|
| Ocean | cell-fill below sea level | global sea level | tidal/wave noise, ~0 net |
| Lake | cell-fill of a closed basin | per-lake constant (outlet height) | ~0 + wind ripple |
| River (≥ ~1 cell wide) | **carved channel** (incision deformation) then cell-fill | bed + shallow head, follows downhill | strong, along channel |
| Stream (< 1 cell) | **Catmull-Rom ribbon** (roads pattern) | rides terrain-lift | strong, along spline tangent |

The mask, surface-height field and flow field are produced for *all four* the
same way; only the **mesh emission** differs (grid cells vs ribbon quads). Both
meshes feed the *same* water pass and *same* shader. A stream that widens into a
river is a ribbon handing off to cell-fill at the resolution boundary — both
sampling the same flow field, so the handoff is continuous.

**Why not keep rivers as strips over uncarved terrain (the original idea):** two
shaders meeting at lake mouths and confluences z-fight and colour-mismatch. Carve
+ fill removes the second representation for everything grid-resolvable, and the
incision deformation was already on the roadmap (Génevaux carve, hydrology
research `wf_209810e7`). Net: less code, no seam class.

## 2 · The water pass (render)

Frame order (WebGPU): **terrain (opaque) → water (blended) → entities + flotsam
(y-sorted) → overlays.** One added pass.

Shader inputs (uniforms / buffers, all already on the GPU or cheap to add):
- terrain height buffer (existing) → `depth`
- water-surface height (per-cell field / per-vertex on ribbons)
- flow vector field
- per-cell biome id (→ tint, clarity, caustic params) — see §3
- `lighting-state` (sun dir, ambient, day/night from `state.clock`) — shared with terrain
- `time` for advection/animation

Per-fragment, everything is `f(depth, flow, biome, time)`:
- **colour**: shallow→deep gradient by depth, tinted by biome `waterTint`
- **foam**: `depth < ε` (shoreline) **or** `|∇·flow|` high (merges/obstructions) **or** slope high (waterfall lip)
- **normal / ripple**: flow-advected normal noise (UV scrolls along `flow`); lentic = gentle, lotic = streaked, tidal = rolling
- **specular**: cheap fresnel + one sun glint (no reflections — see Deferred)

**Fill-rate rule (the real perf risk, learned from the stencil-shadow fix on the
gen-8 iGPU):** deep water renders **opaque** (you can't see the bottom anyway);
only the shallow band (`depth < clarity`) blends + animates + shows caustics.
Frustum-cull the water mesh; ocean off-screen costs nothing.

**Waterfall mode** = a shader branch on local slope: fast UV scroll + vertical
foam + (later) spray particles. Honest limit: a ground-hugging cell/ribbon on a
cliff is water *painted on the cliff face*, not a falling sheet. Fine for the
stylised look; a true vertical sheet (extra near-vertical quads at the drop) is
deferred.

## 3 · Aquatic biomes — subdivide by axes, not by enumeration

Same pattern as the flora fact-DB: an aquatic biome is **a point in a small axis
space**, not a hand-listed set. A **fact-catalogue pack** (Wikipedia-grounded
limnology: lotic/lentic, littoral/profundal/benthic, riparian, intertidal/
neritic/pelagic) mirrors `src/flora/flora-facts-data.ts`.

**Selection axes (pick the biome pack):**
- **Salinity** — `fresh | brackish | marine` (body-type derived: river/lake = fresh, estuary/river-mouth = brackish, ocean = marine)
- **Flow regime** — `lotic` (flowing: river/stream) `| lentic` (still: lake/pond) `| tidal` (ocean)
- **Climate band** — *inherited from the embedding terrestrial biome* via `biome-regions.ts`. This is what makes a temperate lake ≠ a desert oasis ≠ a boreal tarn without a combinatorial table — the surrounding biome carries it.

**Zonation axis (within one body — and it's FREE):**
- **Depth zone** — `littoral` (sunlit bottom, rooted plants) `| sublittoral | profundal` (dark); ocean: `intertidal | neritic | pelagic`. Selected by the **same `depth`** the shader already computes. No new field.

So: biome = `f(salinity, flowRegime, climate)`; zone = `f(depth)`.

**What each (biome × zone) carries:**
| Field | Drives |
|-------|--------|
| `bedSubstrate` + `bedColor` | the terrain colour *under* the water (visible in littoral/shallow) |
| `rockSet` | which rock recipes seed as obstructions (ties to flora geometry kit's rocks) |
| `submergedFlora` | reeds/weed in littoral; nothing in profundal |
| `emergentFlora` | the waterline ring (lily pads, rushes) |
| `bankFlora` (riparian) | §4 |
| `fauna` | cosmetic entities — fish schools (littoral/neritic), wading birds (intertidal), etc. |
| `waterTint` | shader colour |
| `clarity` | one scalar that sets blend depth **and** caustic reach **and** how deep submerged flora renders — the unifying knob |

`clarity` is the elegant single dial: a clear alpine lake blends + casts caustics
deep and shows weed far down; a peat bog or silty river goes opaque almost at the
surface, no caustics, no visible bed. One number, three consistent behaviours.

## 4 · River banks / shorelines = the riparian ecotone

Banks are not authored per-river — they're the **derived edge** where the water
mask meets land (same edge-detection as the ocean shoreline). The bank treatment
is the biome's `bankFlora` + `bedSubstrate` applied along a **distance-to-water
gradient** (reuse the flora-density gradient machinery): mud/gravel at the line,
reeds/sedge just above, riparian trees (willow/alder) set back. Ocean shoreline
is the same mechanism with `intertidal` zone params (beach sand + foam band on
gentle slope; splash + bare rock on steep — classified by terrain slope at the
waterline). **Beach/cliff awareness and river banks are one feature.**

## 5 · Caustics — faked but animated, gated by where it's appropriate

"Where appropriate" = **shallow + clear + sunlit bottom** — exactly the littoral/
shallow band that already blends. Caustics are an **additive term on the
underwater bed colour**, not a light-transport sim:

```
bedColor += causticTex(uv·warp, time) · sunlight · causticFade(depth) · biome.clarity
```

- `causticTex` — a tiling precomputed caustic map (or summed-Voronoi procedural), warped/scrolled by `time` (and biased along `flow` so river caustics streak).
- `causticFade(depth)` — zero at the surface line, peak in the shallow band, → 0 by `clarity` depth. No caustics in deep/opaque water (you can't see the bed anyway).
- `sunlight` — from `lighting-state`: daytime only, intensity by sun elevation; off at night.

Lean: one texture sample + a fade, only on already-blended fragments. A **true**
caustic simulation (photon/wavefront) is explicitly out — the animated fake reads
correctly at pixel-art scale. Caustics are pure render (time-driven), never in
the sim/snapshot.

## 6 · Slice breakdown

Strict dependency chain — data before pixels before life.

- **S0 · Hydrology data model.** Drainage graph (flow accumulation over `heightAt`), Strahler order → width, downhill → **flow field**, water-surface height field, and the **water mask** — *shared with the sim* (see §7). Deliverable everything else consumes; no rendering yet.
- **S1 · Carve + fill geometry.** River-incision deformation (producer on the shared channel) + lake/ocean basin fill; emit the cell-fill water mesh + ribbon mesh for sub-cell streams. Flat colour only (parity with today's water diamonds).
- **S2 · Water pass + core shader.** One blended pass; reads terrain height; `depth`→colour/foam, `flow`→advected normals, lighting + day/night. All four types via params. Deep=opaque / shallow=blend fill-rate rule.
- **S3 · Dynamics.** Waterfall mode (slope branch), obstruction + merge turbulence (`depth` + flow divergence), stream-ribbon↔cell-fill handoff.
- **S4 · Aquatic biome layer.** The fact-catalogue pack (salinity×flow×climate × depth-zone) → bed colour/substrate, rock sets, submerged/emergent flora, `clarity`, `waterTint`; riparian bank gradient (§4) reusing flora placement.
- **S5 · Caustics + shoreline polish.** Caustic projection in the littoral band; beach/cliff shoreline treatment + foam bands.
- **S6 · Life & motion (cosmetic).** Flotsam (flow-advected bitmaps) + fauna (fish/birds). Out of the deterministic sim & snapshot — accept non-frame-identical across re-rolls.

## 7 · Integration — single sources of truth

- **One water mask, shared sim↔render.** "Where is water" already drives building placement (the dock/water rule in `building-placer.ts` / `settlement-plan.ts`), collision, and pathfinding (`road-walker.ts`). S0's mask must be *the* mask — don't fork a render-only copy. `WATER_TYPES` (`src/core/constants.ts`) is the existing tile vocabulary to reconcile against.
- **Deformation channel.** River incision is a producer on `terrain-deformation.ts` (`heightAt = base ⊕ deformations`), coordinated with roads (already a shared-channel consumer) — bridges (roads epic) must agree with the carve or roads dip into the channel.
- **Lighting.** Water shader reads the same `lighting-state` as terrain (sun, ambient, `state.clock` day/night) — that's why it's a pass in the GPU frame, not a bolt-on.
- **Flora/biome.** Aquatic biome packs sit beside `src/flora/`; bank/emergent/submerged plants reuse the flora geometry kit + placement gradient; climate axis reads `biome-regions.ts`.

## 8 · Explicitly deferred / out of scope

- Real reflections (planar / SSR) — cheap fresnel + sun glint only.
- True vertical waterfall sheets — painted-on stylisation first.
- True caustic light-transport — animated fake only.
- Underwater fauna AI / ecology in the sim — fauna is cosmetic in S6.
- Sub-grid hydraulic accuracy (flooding, seasonal level change) — flow field is steady-state v1.

## 9 · Open questions for the user

1. **Flotsam/fauna determinism:** confirm cosmetic-only (not in snapshot/replay) is acceptable — it's the lean choice but means they won't be frame-identical across scrub/re-roll.
2. **Grid resolution for the carve/ribbon split:** what's the narrowest river we want cell-resolved vs. ribbon? Sets the incision width threshold.
3. **Sea level:** single global ocean height, or per-region (inland seas at different levels)? Affects the basin-fill for lakes vs. ocean.
4. **Caustic map source:** precomputed tiling texture (one art asset) vs. fully procedural in-shader (no asset, more ALU) — lean either way; pick by whether we want an authored look.
