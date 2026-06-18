# Coastal relief & island shape — replacing the dome (brainstorm)

**Date:** 2026-06-18 · **Status:** brainstorm (user-directed; no code beyond the
dome-stopgap noted in §9). **Builds on / extends:**
[water: hydrology, aquatic biomes & lean rendering](2026-06-17-water-hydrology-biome-rendering-design.md)
(S0–S6, branch `feat/water-s0-hydrology`),
[connectome world layout](2026-06-16-connectome-world-layout-design.md) (`planWorldLayout`, the island mask),
the shared terrain-deformation channel (`src/world/terrain-deformation.ts`, `heightAt = base ⊕ deformations`),
[spatial coordination](2026-06-17-spatial-coordination-design.md), and the affordance-graph idea.

## What the user asked

> "the dome idea is too primitive, the system should be more sophisticated. and
> the island is almost completely round — we should probably have a section of
> parameters for coasts where the whole coastline is noisy and warped (much like
> POI zones / the lake), and also different coastal features assigned easily
> ('rocky cliffs to the southwest', 'beaches and natural harbors to the
> southeast'). what am I not thinking of?"

## Why the dome is wrong (root cause)

`DEFAULT_ISLAND` today = a euclidean **radial** mask (`islandFalloff`) plus a
single central **dome** (`islandDome`) added to elevation. Two faults:

1. **It conflates "where is the shore" with "how high is inland."** The dome
   raises elevation by distance *from the map centre*. So the island is highest
   dead-centre and round. Worse, observed live (2026-06-18): bumping the dome to
   0.34 pushed the whole central interior to ~0.84 elevation = **mountain biome**,
   burying every settlement (Oakshire's own tiles read 45/81 mountain) and
   starving lakes. A single radial scalar can't express "low coastal plain, high
   interior massif **over here**, flat delta **over there**."
2. **It's isotropic → round.** The coastline is a circle because the mask is a
   distance threshold. There's no place for bays, capes, peninsulas, fjords.

The fix is to **separate the two axes** and make each a proper field:
*shape* (where land/sea is) and *relief* (how high land is), with coastal
*character* layered on the shoreline.

## The model

### A. Relief from **distance-to-coast**, not distance-to-centre
Replace the dome with: `inlandRelief = reliefCurve(distanceToCoast)` where
distance-to-coast is a real distance field from the (warped) shoreline. A relief
curve maps coast-distance → height band: `0 = waterline → beach → coastal plain →
upland → (interior plateau)`. Effects this buys for free:
- a long peninsula stays low; a broad interior rises — no central bullseye;
- POI peaks (the Cloudwall, via the `mountain` **peak-mode** influence already in
  `poi-influence.ts`) ride **on top** as the high features, instead of competing
  with a dome that already mountain-ified the middle;
- it composes: `elevation = baseNoise ⊕ reliefCurve(coastDist) ⊕ POI peaks ⊕
  deformations` — same ⊕ discipline as `terrain-deformation.ts`. Relief becomes a
  **producer**, not a special case.

### B. A warped, non-round coastline
The shore is the contour where the land/sea field crosses sea level. Make it
organic by **domain-warping the position before the distance test** (multi-octave
seeded fbm): large octave → big bays/capes/peninsulas; small octave →
crenellation. This is the *exact* mechanism the new POI outline-warp uses
(`poi-influence.ts` warp, tapered) and the lake outline — lift it to the whole
landmass. Pure + deterministic, so it reproduces identically everywhere the field
is rebuilt (worldgen biomes, render heightfield, layout solver — see §4).

### C. Coastal **character** by sector — derived first, authorable second
A "coast zone" producer = POI-zones, but for the shoreline ring. The coast is cut
into arcs (angular sectors, or better a coast **connectome** of labelled spans),
each carrying a profile: `cliff | beach | dune | delta | fjord | harbor | shoals
| marsh`. A profile drives **shore slope** (cliff = steep elevation gradient at
the waterline; beach = shallow gradient + sand; delta = flat + river mouth),
**tile palette**, **depth profile offshore**, and **props** (driftwood,
tidepools, rock arches).

The key move (see §3, gap 1): **derive the default profile from what's inland**,
then allow overrides. The arc behind the Cloudwall → cliffs automatically; behind
lowland → beach; where a river reaches the sea (hydrology already knows) → delta;
behind a swamp → marsh/mangrove. `"rocky cliffs to the southwest"` is then an
**override** on a coherent baseline, not the sole input.

## 3 · What you're not thinking of (the high-value part)

1. **Derive-from-inland, don't only hand-assign.** Pure sector assignment drifts
   incoherent (cliffs in front of a beach). Default each coast span from the
   elevation/biome behind it; expose overrides for art direction. Coherent by
   construction, authorable when it matters.
2. **Coastal features are affordances — and they fix a live bug.** A "natural
   harbor" should *guarantee* a buildable cell next to deep-enough water. Today the
   `dock`/port `nearWater` rule (`building-placer.ts`/`settlement-plan.ts`) fails
   because we hand-place a port and pray water lands within 2 tiles (it didn't).
   Let the coast producer **supply the port site** (or the port POI itself):
   harbor→port site, beach→landing/fishing, cliff→no landing. Feeds the
   affordance-graph epic; retires a class of placement flakiness.
3. **This is the land half of the *water* epic — don't duplicate it.** The water
   doc's **S5** already classifies beach-vs-cliff by *terrain slope at the
   waterline* and draws foam/shoreline; the master variable is `depth =
   waterSurface − terrainHeight`. Coastal-relief's job is to **produce that slope
   intentionally** (cliffs = steep, beach = shallow) so S5 reads what we meant,
   and to feed the offshore **depth profile** (harbors deep close in, shoals
   shallow far out) that drives the aquatic `DepthZone`
   (`littoral|sublittoral|profundal` in `src/water/water-biome.ts`). Same shared
   **water mask** (`HydrologyResult.waterMask` / `getHydrologyResult`) — never a
   second copy.
4. **One elevation channel, composed.** Make coast-relief a producer on
   `terrain-deformation.ts` (or the base-field stage), so it coexists with road
   grade-cuts and river incision (`river-deformation.ts`) under one `heightAt`.
   The dome being "primitive" is really "bolted-on special case"; this removes the
   special case.
5. **The layout solver will drown POIs.** `planWorldLayout` assumes a round
   euclidean mask (`targetCornerD`) to decide where authored content is safe, and
   packs everything to `d < ~0.5` of centre — which is *also* why the playable
   area is a central blob even before the coast warps. A warped coast means the
   solver's "is this on land?" test must call the **same** coast field, and
   content must be **distributed across the warped land** (peninsulas, lobes),
   not centred. Designing this in is mandatory or POIs land in the sea.
6. **Parity is non-negotiable.** The coast/relief field must be the *one* pure
   function used by worldgen biome classification, the render heightfield
   (`world/heightfield.ts`, `render/gpu/terrain-field.ts`), the water mask, and
   the layout solver. Divergence = rendered terrain, water, biomes, and placement
   disagree. Same rule that keeps `island-mask` shared today.
7. **"Round" has two causes.** (a) radial mask and (b) solver centring. Fixing
   only the mask still yields a central blob; both must change.
8. **Sea level & multi-body (from the water epic's open Qs).** Single global ocean
   height vs. per-region inland seas affects the basin fill and the coast contour.
   Coastal-relief should assume the water epic's sea-level decision, not introduce
   its own.

## 4 · Integration — single sources of truth

- **Coast/relief field**: one pure `f(x,y,seed,spec)` consumed by biome
  classification, `heightfield.ts`, `terrain-field.ts`, the water mask, and
  `planWorldLayout`. Replaces `islandDome`; `islandFalloff` generalises into the
  warped land/sea field.
- **Water mask & depth**: from `getHydrologyResult` / `HydrologyResult`
  (`waterMask`, `waterType`, `flowDir*`). Coast-relief sets the *terrain* under
  the waterline; the water epic owns the surface, depth, foam, aquatic biome.
- **Deformation channel**: coast-relief is a producer on
  `terrain-deformation.ts`, coordinated with `river-deformation.ts` /
  `road-deformation.ts`.
- **Aquatic biome**: `classifyWaterCell(waterType, climate)` already exists; the
  coast's offshore depth profile selects the `DepthZone`. Climate via `climateOf`.
- **Affordances**: harbor/landing sites published for the port/settlement placers
  and the affordance graph.

## 5 · Slice breakdown (parity-first; each independently shippable)

- **C0 · Land/sea field seam (behaviour-neutral). ✅ BUILT.** Both duplicate
  "dome then falloff" implementations (inline in `generateTerrainFields` +
  `applyIslandMask`) collapsed behind ONE `shapeCoastElevation(e,x,y,w,h,spec,
  seed)` in `island-mask.ts`; `seed` threaded for C1/C2. Parity test pins the
  contract. *(Also fixed a dead `TERRAIN_Z_PX_PER_M` bump — the value was
  shadowed by the world-style default, which now mirrors it at 17.)*
- **C1 · Coast-distance relief replaces the dome. ✅ BUILT.** `islandDome`
  deleted; replaced by `coastReliefAt` — a memoised chamfer distance-to-coast
  field (`getCoastField`, off the macro land/sea mask) feeding a bounded relief
  ramp that **plateaus** below the mountain threshold. `spec.dome` repurposed as
  the plateau height (keeps the `coastDrama` knob). Guard test: across 4 seeds
  the interior is predominantly walkable land (mountain biome < 40 %), with **no
  central bullseye**. Subsumes the dome-0.16 stopgap.
- **C2 · Warped coastline. ✅ BUILT.** `warpedIslandDistance` perturbs the round
  distance by seeded multi-octave fbm inside `islandFalloff`, **tapered to 0
  before `d = 0.95`** so the border (all tiles at `d ≥ 1`) never warps → the
  closed ocean frame survives any amplitude. Relief follows the warped shore for
  free (the coast-distance field reads the same warped mask). Knobs on the spec:
  `coastWarp` (amplitude) + `coastWarpFreq` (bay scale); default warp = 0.14.
  Parity holds across worldgen + render heightfield because both flow the same
  `seed` through the one seam. `planWorldLayout`'s land-test was **not** changed:
  content packs to `d < 0.495` while the warped coast wobbles in `d ≈ 0.59–0.87`,
  so POIs stay inland even in the deepest bay — proper spreading onto the warped
  land (peninsulas/lobes) is deferred to **C5**.
- **C3 · Coast character — derived.** Default each coast span's profile from the
  inland elevation/biome + river mouths; drive shore slope + tile palette +
  offshore depth profile. Hooks into water S5 (slope→beach/cliff) and depth-zones.
- **C4 · Coast character — authored + affordances.** A seed `coast` section:
  per-sector overrides ("rocky cliffs SW", "beaches & harbors SE") + harbor/
  landing **affordances** that supply port/landing sites (retire the dock
  `nearWater` flakiness).
- **C5 · Content distribution.** Spread authored + position-less POIs across the
  warped land (peninsulas/lobes) instead of the central disc (the solver's
  Open-Q1 force-directed slice).

MVP = **C0 + C1 + C2** (un-rounds the island and kills the dome correctly).

## 6 · Relationship to the water epic

| Concern | Owner |
|---|---|
| Where is water / mask / flow / depth | **Water epic** (`HydrologyResult`, S0) |
| Water surface, foam, ripple, caustics | **Water epic** (S2/S3/S5) |
| Aquatic biome (salinity×flow×climate×depth) | **Water epic** (`water-biome.ts`, S4) |
| Beach-vs-cliff render by slope, riparian banks | **Water epic** (S5 / §4) |
| **Land shape (coastline warp), inland relief** | **This doc** (C0–C2) |
| **Shore slope *intent* + palette + offshore depth profile** | **This doc** (C3) |
| **Coast character sectors + harbor affordances** | **This doc** (C4) |
| **Content distribution on warped land** | **This doc** (C5) / layout epic |

They meet at one contract: coastal-relief produces the **terrain under and around
the waterline**; the water epic reads `depth` off it. Land-side and water-side of
the same shoreline.

## 7 · Open questions

1. **Coast representation:** angular sectors (cheap, coarse) vs. a coast
   connectome of labelled spans (richer, ties to the connectome model)? Lean
   sectors for v1, connectome later?
2. **Relief curve authoring:** a few named profiles (atoll / volcanic-high /
   continental-shelf / archipelago) vs. raw knobs? Generative-not-hand-tuned
   preference says named profiles built from rules.
3. **Single island vs. archipelago:** does the warped field allow detached lobes
   (separate islands) by default, and does the solver place across them?
4. **Sea level:** inherit the water epic's global-vs-per-region decision (its
   Open-Q3) — confirm single global ocean for v1.
5. **Override grammar:** how does the player/Fate phrase "rocky cliffs SW" — a
   seed `coast` array of `{sector, profile}`, or natural-language via the
   create-panel/Fate authoring path?

## 8 · Performance

- The coast/relief field is built **once per world** (like the current mask), O(1)
  per-cell lookups; the distance-to-coast field is one flood/JFA pass at gen time,
  cached. No per-frame cost — render reads the same heightfield it already does.
- Warp = a few fbm samples per cell at gen time only.
- Harbor affordances remove failed placement retries (net win at gen).

## 9 · Interim stopgap currently in the tree (not this epic)

On `feat/default-world-showcase` (the showcase work): the dome was dropped
**0.34 → 0.16** and the mine POI moved off the massif, which fixes the
brown-mountain centre well enough to keep the current world playable. The dome is
exactly what C1 replaces — treat 0.16 as a band-aid, not a design.
