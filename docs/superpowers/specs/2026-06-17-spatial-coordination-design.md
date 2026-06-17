# Spatial coordination — one footprint, one authority, one geometry

**Status:** BRAINSTORM (no code beyond the interim fixes below). Scoped after a live
fence-bug hunt surfaced that the symptoms are coordination gaps, not isolated bugs.
**Date:** 2026-06-17
**Origin:** user, mid-debug — "seems like the systems should be better standardized and
coordinated throughout the connectome?" + "keep performance optimization in mind."

## 0. What triggered this

Chasing "fences render under houses / buildings poke through fences," a live world
(`?` dev server, fresh island) showed **11 of 17 buildings overlapping their croft
hedge enclosures**. Two interim fixes landed (kept as the stopgap, see §6); a stricter
re-measure of a regenerated world *still* found **4 hedge slabs drawing through
buildings**. That residue is the diagnosis: every producer carries its **own** notion
of where a thing is and how big it is, and the renderer re-derives geometry a third
way. The bugs are the seams between subsystems, not faults inside them.

## 1. The coordination gaps (each observed this session)

1. **Two "building extent" definitions.** The croft gate guard asks
   `OccupancyGrid.is(x,y,'building')`, whose 'building' claim is
   `buildingSolidCells()` = the **collision blocked mask minus doors**
   (`src/world/occupancy-grid.ts`). The **renderer draws the full footprint bbox**
   (the dome/roof spans the whole `footprint.w×h`). Cells that are in-bbox but
   not-solid (round-wall edges, eaves) are ungated → a hedge slab pokes out from
   under the silhouette. This is the residual 4 leaks.
2. **Two fence systems.** Connectome `BarrierRun` enclosures (`hedge_run`/
   `palisade_run`/`wall_run`, `src/world/enclosure.ts`) **and** legacy `fence_post`
   props scattered by the village/farm brushes (`src/world/brushes/`), which render
   **nothing** (category `prop`, tagged `barrier` → routed to the barrier path → no
   `properties.barrier` → empty). Dead weight that still occupies tiles.
3. **Props with no coherent render path.** The graveyard rendered as floating grey
   cubes; `well`/`sign_post`/`fence_post`/`bench`/`lamp_post` are category `prop`,
   which the entity pass (`world-render-graph.ts` wants only
   building/vegetation/barrier/npc/decoration) **skips entirely**. So a brush-placed
   prop is either invisible or arrives via an inconsistent fallback.
4. **Producer/consumer geometry re-derivation.** `gatesWhereOpen` (producer) walked
   the ring at integer `t`; the renderer (`iso-barrier.ts`) drops slabs by **midpoint
   `t+0.5`**. Each re-derives the polyline walk independently → half-tile phase drift
   → leaks. (Fixed for this one case in §6, but the *pattern* recurs anywhere two
   sides re-walk the same geometry.)
5. **No content-version gate on saves.** A world persisted by pre-island code is
   silently restored on boot, masking new worldgen (the "island is missing / terrain
   is older" report). `ART_RECIPE_VERSION` / `WORLD_CONTENT_VERSION` exist for assets
   but the **save** isn't versioned against worldgen.
6. **Terrain-height coupling.** Buildings/roads get a foot-z terrain lift; barriers
   draw at `z=0` (sea level) in screen space. On the raised island interior this is a
   latent float/sink seam (not confirmed visually this session, but it's the same
   class of gap: one producer is terrain-aware, its neighbour isn't).

## 2. The spine that already exists (and where it stops)

- **`OccupancyGrid`** (`src/world/occupancy-grid.ts`) is *explicitly* documented as
  "the ONE spatial authority" — producers CLAIM tagged cells and CONSULT before
  writing. **But:** it is **settlement-local** (one grid per `placeSettlement`), its
  `OccupantKind` is only `road|civic|building|barrier` (no props/vegetation/graveyard),
  and the 'building' claim is **collision-extent, not render-extent**.
- **`WorldRenderGraph`** (`src/render/graph/render-graph.ts` + adapter) is the read
  seam meant to become connectome-native — but today it *re-derives* category and
  footprint from raw entities rather than reading what the producer placed.
- The **connectome** (POIs, roads, settlements) is the layout authority but does not
  yet own a unified spatial/affordance index that both worldgen and render consume.

So the architecture is *already pointed the right way* — the work is to finish
converging on it, not invent it.

## 3. Proposal: three "one"s

### 3a. ONE footprint definition
A single `Footprint` per placeable (building, barrier slab, prop, civic, graveyard)
with an explicit, named extent set — and a single rule for which extent each consumer
uses:
- `solid` — collision / pathing / placement deconfliction (today's `buildingSolidCells`).
- `visual` — the render silhouette bbox (what the sprite covers).
- `claim` — what the spatial authority reserves (default = `visual` for deconfliction
  against neighbours, so nothing renders *through* a silhouette; `solid` for pathing).

The croft-gate leak is exactly "used `solid` where it needed `visual`." Make the
choice explicit and per-consumer instead of implicit-and-wrong.

### 3b. ONE spatial authority
Promote `OccupancyGrid` from settlement-local to the region/world spatial index every
producer reads/writes, with occupant kinds covering **all** producers (add
`prop|vegetation|graveyard|water|reserved`). Brush scatter, graveyards, civics,
enclosures, and the building placer all deconflict through it — so a prop can't land
under a dome and a hedge can't cross a footprint. Retire the parallel `fence_post`
brush system (or make it claim + render through the same path).

### 3c. ONE geometry
The renderer **projects placed geometry** rather than re-deriving it. A barrier run
stores (or the authority caches) its slab list once; the gate decision and the draw
read the *same* slab array. No second polyline walk → no phase drift (gap #4 becomes
structurally impossible, not just fixed once). This is also where the `fence_post`/prop
render path gets unified.

## 4. Performance (explicit requirement)

This design is meant to be **cheaper**, not costlier:
- The authority is **one grid/index built once per region**, O(1) `has/at/is` lookups,
  replacing each producer's ad-hoc `Set<string>` (roadSet/civicSet/registry scans) and
  the renderer's per-frame re-derivation.
- "One geometry" removes duplicate polyline walks (producer + renderer) — fewer ops at
  both gen-time and draw-time.
- Adjacent win: it pairs with the known **jerky-zoom** bug (`gpu-scene.ts` re-packs +
  re-uploads ALL entity instances every frame). Projecting cached placed-geometry +
  memoizing the instance pack is the same "stop re-deriving" principle on the render
  side. Worth sequencing together.
- Non-negotiables preserved: `Math.random`-free seeded worldgen; deterministic output;
  no per-frame allocation in the draw path.

## 5. Slicing (parity-first; each slice is independently shippable)

- **C0 — footprint extent seam (behaviour-neutral):** introduce `solid|visual|claim`
  extents with a helper; default every current consumer to today's value. Pure refactor,
  the seam. Pin with the existing spatial-invariant integration net.
- **C1 — close the leak via `visual` claim:** croft/settlement gates consult the
  **visual** footprint, not `solid`. Drives the 4 residual leaks to 0. (This is the
  "finish the leak" stopgap, now done *correctly* through the seam.)
- **C2 — one geometry for barriers:** cache the slab list on the run; gate + draw read
  it. Deletes the second polyline walk (kills gap #4 structurally).
- **C3 — authority covers props + graveyards:** add occupant kinds; brush scatter +
  graveyard claim/consult; give props ONE render path (or stop emitting invisible ones).
  Retire/cut the `fence_post` brush duplicate.
- **C4 — promote authority scope:** settlement-local → region; cross-settlement and
  brush producers deconflict through it. Fold `WorldRenderGraph` onto the same source.
- **C5 — save/worldgen version gate:** stamp worldgen version on the save; stale saves
  regenerate (or migrate) instead of silently masking new generation.
- **C6 — terrain coupling:** barriers (and any z=0 producer) read the shared heightfield
  like buildings/roads. Pairs with the deformation channel work.

## 6. Recommended MVP & the interim fixes already in place

**Interim (landed on `feat/legacy-chrome-l0-l1`, tested, tsc clean) — keep as stopgap:**
- per-slab barrier y-sort (`barrierSlabs`) — fences interleave with buildings per piece;
- `gatesWhereOpen` walks the renderer's exact slabs (phase fix) — most leaks closed;
- camera GPU cluster (L0, unrelated but in the same branch).

**MVP for THIS epic: C0 + C1 + C2.** C0 makes "which extent" explicit, C1 zeroes the
visible leak the right way, C2 removes the re-derivation that caused the phase bug in
the first place. C3–C6 follow as appetite allows; C5 is cheap and prevents the whole
"why is my world old" class of confusion.

## 7. Open questions
- Authority scope: keep settlement-local grids + a thin region overlay, or one region
  grid? (Perf vs. cross-settlement deconfliction — lean region overlay.)
- Is `fence_post` worth keeping at all, or fully replaced by `BarrierRun` crofts?
- Should `visual` footprint come from the blueprint silhouette (IoU mask) or just the
  `footprint.w×h` bbox? Bbox is cheap and sufficient for "don't render through me."
- Where does the graveyard belong — a civic precinct (claimed area) with its own
  render path, or a building-class structure?
