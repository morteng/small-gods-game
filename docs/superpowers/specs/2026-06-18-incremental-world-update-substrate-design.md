# Incremental World-Update Substrate — design

Status: **design / brainstorm** (no code yet — doc-first per owner). 2026-06-18.

## 1. Motivation

The world is going to change *locally and continuously*: a villager digs a hole, a
meteor leaves a crater, a river floods, fire scorches a wood, a building is raised,
flora regrows over a time-skip. It also changes *globally*: a climate re-zone, a sea-level
shift, day↔night. Today almost everything is computed **whole-map** and memoized on a coarse
key (`getHeightfield`/`getClimateFields` keyed on seed+dims+style; the draw-list cache I just
added keyed on map+layers). A single local edit either does nothing or forces a full rebuild.

The profiler (`__renderProfile`/`__renderTrace`, see [[project-renderer-perf-profiling]]) made the
cost of "rebuild everything" concrete: rebuilding the ~10k-entity draw list every frame was ~293ms.
We fixed that by **caching** — but caching without **precise invalidation** is how you get stale
craters and frozen tree art (see §8). We need one substrate that turns *"this region changed"* into
*"recompute exactly the dependent cells/entities and re-upload exactly the affected GPU range."*

This already exists for ONE channel: **`src/world/terrain-deformation.ts`** — an analytic, bounded,
versioned brush store (`heightAt = baseSeedHeight ⊕ deformations`). This design **generalizes that
pattern to every channel** and adds the dirty-tracking + propagation + partial-upload around it.

## 2. Principles

1. **Base ⊕ deformations, per channel.** Every spatial field = a procedural *base* (pure function of
   seed+coords) ⊕ an ordered list of *bounded edits*. Recompute a cell = re-evaluate base + replay the
   edits whose footprint covers it. This is exactly `DeformationStore`; we lift it to a generic
   `FieldLayer<T>` and instantiate per channel.
2. **The tile grid is the spatial substrate.** A region is a tile AABB (plus an optional analytic mask
   for non-rect shapes — craters are discs, the brushes in `terrain-deformation.ts` already do this).
3. **Edits are data, not imperative mutations.** A `WorldEdit` carries its region, channel
   contributions, and a `source` id (so a producer can replace/remove its own output wholesale —
   `removeSource`, already there).
4. **Dirty-region accumulation, frame-coherent flush.** Edits during a frame accumulate dirty rects per
   channel; a flush at frame head recomputes only dirty cells and does **partial GPU upload** of the
   affected buffer ranges. Overlapping rects coalesce.
5. **Dependencies propagate with region expansion.** height→(water, biome, entities); biome→(scatter,
   draw-list). Some propagations *grow* the region (a dam dirties water *downstream*, not just the dam).
6. **Versioned invalidation, not key-guessing.** Each channel/region carries a monotonic version;
   consumers (memoized fields, the draw-list cache, GPU buffers) compare versions to invalidate
   precisely. This replaces the coarse `drawCacheKey` and the masked tree-art staleness (§8).
7. **Global = whole-map region.** Climate re-zone is the same machinery with `region = entire map`.

## 3. Data model

```ts
type Region =
  | { kind: 'rect'; minX; minY; maxX; maxY }
  | { kind: 'disc'; cx; cy; r }            // crater/dig/explosion
  | { kind: 'global' };                     // climate, sea level, time-of-day

type Channel =
  | 'height'        // terrain elevation        (DeformationStore today)
  | 'material'      // surface material/biome id (rock/scorched/mud/snow override)
  | 'climate'       // moisture + temperature    (getClimateFields today)
  | 'water'         // hydrology + surface       (hydrology-store / water-field today)
  | 'occupancy'     // entity placement (add/remove flora, debris, rubble)
  | 'content';      // non-spatial: "art for kind X is ready", "tier changed"

interface WorldEdit {
  id: string;
  source: string;                 // 'dig', 'meteor:42', 'fire', 'build:house7', 'climate'
  region: Region;
  channels: Partial<Record<Channel, ChannelOp>>;  // height brush, material paint, kill-entities, …
  priority: number;               // composition order within a channel (existing convention)
}
```

`ChannelOp` for `height` = the existing `Deformation` (raise/carve/add/level + mask). New ops:
`material` paint (set/blend a surface id over the mask), `occupancy` (remove entities in region; spawn
a set), `water` source/sink. The point: **the height channel is already built** — we add sibling
channels with the same shape.

## 4. The change bus — `DirtyRegistry`

```ts
class DirtyRegistry {
  private dirty: Map<Channel, Region[]>;   // accumulated, coalesced
  private version: Map<Channel, number>;
  emit(edit: WorldEdit): void;             // marks edit.channels' regions dirty, bumps versions, propagates
  drain(channel): { regions: Region[]; version: number };   // consumer pulls + clears
  versionOf(channel): number;              // cheap cache-guard read
}
```

- `emit` applies the edit to the per-channel `FieldLayer` stores (so `heightAt` etc. reflect it
  immediately) AND records the dirty region + bumps the version + runs **propagation** (§5).
- Consumers either pull `drain()` at frame head (push model, for GPU upload) or read `versionOf()` as a
  cache guard (pull model, for the draw-list cache / memoized fields).

## 5. Dependency propagation

A fixed DAG, evaluated in order, each step may expand the dirty region:

```
height  ─▶ water   (expand: flood-fill downstream from the dirty rect along the flow field)
height  ─▶ climate (lapse depends on elevation-above-sea → same rect)
climate ─▶ material/biome (same rect)
height+material ─▶ occupancy (entities re-sited/culled in rect; e.g. crater kills trees)
occupancy/material ─▶ draw-list (invalidate cached static items intersecting rect)
* ─▶ GPU buffers (partial upload of affected rows)
```

Most propagations keep the region; **water is the notable expander** (hydrology is inherently
non-local). MVP can over-approximate water as "dirty rect + a downstream margin" and refine later.

## 6. Consumers & partial recompute

- **Terrain field** (`terrain-field.ts` packs height/colour/moisture/temp storage buffers): on a dirty
  rect, recompute only those cells and `writeBuffer(buf, rowOffset, data, …)` the affected **row range**
  (the grid is row-major; a rect = a contiguous band of rows, or per-row sub-ranges). This is the
  GPU-side incremental win — no full re-upload.
- **Climate field** (`getClimateFields`): same; today it re-allocs whole arrays on any change — give it a
  dirty-rect partial-recompute path.
- **Water** (`hydrology-store` + `water-field`): recompute flow/surface in region+downstream, partial
  upload.
- **Draw-list cache** (the new static cache in `gpu-render-frame.ts`): replace `drawCacheKey` with
  `DirtyRegistry.versionOf('occupancy')` + region-bucketed rebuild — rebuild only the static items whose
  tiles intersect a dirty rect, not the whole list. (MVP: whole-list invalidate on any occupancy/content
  bump — already most of the win; region-bucketing is the refinement.)
- **GPU storage buffers**: a small helper to map a tile rect → buffer byte ranges and issue minimal
  `writeBuffer`s.

## 7. Worked examples

- **Dig a hole** `disc(cx,cy,r=2)`: height `carve`, material→`dirt`, occupancy→remove flora in disc.
  Dirty: height/material/occupancy rect (tiny). Flush: recompute ~a few dozen cells, partial-upload one
  row band, drop a few trees from the static cache. Sub-millisecond.
- **Meteor crater** `disc(cx,cy,r=20)`: height `carve` bowl + `add` rim, material→`scorched`,
  occupancy→kill everything in disc + spawn debris, water→mark region+downstream dirty (the bowl may
  pool into a lake). Flush recomputes the disc's cells + a downstream water margin, partial-uploads those
  rows, rebuilds the static draw items in the disc. Bounded by the crater size, not the map.
- **Global climate re-zone** (`author_set_climate`, already shipped): `region:'global'`, channel
  `climate`. Whole-map dirty → today's behaviour, now expressed in the substrate (and it could be made
  incremental-by-chunk to avoid a hitch).
- **Content ready** (`art for pale_tree warmed in`): `region:'global'`, channel `content`. Bumps the
  content version → the draw-list cache rebuilds once → trees upgrade from placeholder to the real pack.
  **This is the fix for the staleness bug the static cache introduced (§8).**

## 8. Trees & flora — there is a lot here (owner: "lots of work still to be done for trees")

The tree art "cascade" (parametric pack → billboard → flat placeholder) is a **load fallback**, not
distance-LOD: `resolveParametricPlantArt` is peek-then-warm, so a species shows a placeholder until its
one cached pack finishes composing off-frame. Decisions + open work:

- **DECIDED: pre-warm all species at the loading screen + drop the placeholder.** Only ~5 species → ~5
  cheap `composeStructure` calls front-loaded, so in-game trees are never placeholders. Collapse the
  middle `resolveEntityArt` billboard tier for plants (largely redundant).
- **Cache-staleness fix (caused by the new static draw cache):** the cache freezes the art tier at build
  time, so a pack warming in *after* the first wide build leaves trees stuck on the placeholder. Fix =
  the `content` channel above (bump content version on pack-ready → cache rebuilds). Pre-warming also
  side-steps it, but the content event is the principled fix and protects img2img buildings too.
- **Open tree work (NOT covered by the above — needs its own plan/prioritization):**
  - **Real zoom-LOD** — at overview we currently build+pack+draw all ~10k trees (render ≈51ms, now the
    top cost after the draw-list fix). LOD here is BOTH a quality and a *perf* lever: merge/impostor
    distant flora, density-thin when zoomed out, billboard clusters. This is the next big perf slice.
    Ties to spec slice L-F (zoom-LOD) and the instance-resident path (Layer 2 of the entity rework).
  - **Flora epic Slice 2** — entity-kind wiring (per [[project-flora-vegetation-generation]]; Slices 0+1
    landed). Unblocks world-style `floraScale`.
  - **Species variety / quality** — geometry richness, seasonal colour (ties to the `climate` channel +
    time-of-day), wind sway, canopy/trunk material.
  - **Growth/regrowth over time** — flora as `occupancy` edits over a time-skip (D2); fire/crater clears
    then regrows. Direct consumer of this substrate.
  - **Depth interleave** — the static-cache split currently draws NPCs over static (acceptable now);
    proper foot-y depth so trees can occlude characters correctly.

## 9. Slices (incremental, each shippable; build only after review)

- **S0 — `DirtyRegistry` + generalize `FieldLayer<T>`** from `DeformationStore` (height stays the
  reference impl). Versions + coalescing. No new visuals; unit-tested.
- **S1 — content-ready invalidation** (smallest real win): wire plant/building art-ready → `content`
  version → draw-list cache rebuild. Fixes §8 staleness. Pairs with tree pre-warm.
- **S2 — partial GPU upload** helper (tile rect → buffer row ranges) + terrain-field dirty-rect path.
- **S3 — `material`/`occupancy` channels** + the dig/crater edit producers (the headline feature).
- **S4 — water/climate propagation** (downstream expansion; incremental climate-by-chunk).
- **S5 — region-bucketed draw-list invalidation** (rebuild only intersecting static items).

MVP for "dig a hole / leave a crater that persists and re-textures": **S0 + S2 + S3** (+ S1 for the
art-cache correctness it exposes).

## 10. Relation to existing systems

- `src/world/terrain-deformation.ts` — the height channel; the template. `DeformationStore.version` is
  already the versioning seed.
- `src/world/heightfield.ts` (`getClimateFields`), `src/render/gpu/terrain-field.ts` — partial-recompute
  + partial-upload targets.
- `src/world/hydrology-store.ts`, water-field — the propagation-heavy consumer.
- `gpu-render-frame.ts` static draw-list cache + `__invalidateDrawCache()` — the interim seam this
  replaces with versioned, region-scoped invalidation.
- Profiling: `__renderProfile`/`__renderTrace` ([[project-renderer-perf-profiling]]) — verify each slice
  doesn't regress and that partial upload beats full.
- [[spec-shared-terrain-deformation-channel]] · [[project-flora-vegetation-generation]] ·
  [[project-terrain-water-shader-system]] · [[project-spatial-coordination-epic]].
```
