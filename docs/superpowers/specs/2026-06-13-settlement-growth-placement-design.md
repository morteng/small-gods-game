# Settlement growth & placement system (brainstorm)

**Date:** 2026-06-13 · **Status:** brainstorm (user-directed) · **Builds on:** parametric settlement epic G1 (anchors + linear structures), era-aware worldgen, D1 mortality/birth, D2 time-skip

## What the user asked for

An overall placement system that draws paths/roads/streets, places buildings
logically, and **dynamically grows a settlement from nothing to a town** —
partially WFC-constrained ("docks must be beside a river or lake") and
terrain-aware. Plus "things I'm not thinking of".

## Where we already are

- `building-placer.ts` does a road-first organic layout at WORLDGEN: internal
  settlement roads (linear/branching/grid), spiral-search placement, era-picked
  presets, Bresenham connection paths between POIs.
- G1 gave us world-space door/gate anchors and functional walls/gates that
  pass A*; `place_building` exists as an authoring verb (Create panel / Fate).
- Settlements are **static after worldgen** — no code adds buildings during
  play. D1 gives population dynamics (births/deaths) with nowhere to live.

## Core idea: one growth model, two consumers

A deterministic, seeded **SettlementPlanner** that, given a settlement's state
(population, era, wealth/belief, terrain), proposes the next placement actions.
Run it:
1. **At worldgen** — iterate it N steps to "pre-grow" a settlement of the
   target size (replaces the one-shot layout; villages get history for free —
   the oldest buildings cluster at the founding well/green).
2. **During play** — the sim triggers a step when growth conditions fire
   (population per dwelling exceeded, new trade unlocked, era advance, Fate
   asks for it). The same code path, so a town grown live looks like a town
   generated old.

This is the same "deterministic substrate + LLM flavour" split as the rest of
the game: the planner is pure sim (seeded RNG, no Math.random — the guard test
applies); Fate/narration can REQUEST growth or veto it, never place pixels.

## The placement vocabulary (slots, not coordinates)

Growth proposes **slots** scored against constraints, not raw tiles:

- **Road graph first.** A settlement is a graph: founding node (well / green /
  crossroads / dock), through-road, lanes branching as it grows. Buildings
  address slots ALONG edges (frontage), facing the road (uses G1 door
  anchors; pairs with the multi-view facing work). Ribbon development, then
  infill, then back lanes — the medieval growth sequence.
- **Constraint rules per building type** (the WFC-ish part — adjacency
  constraints solved greedily with backtracking, not a full WFC solve):
  - dock → adjacent to water edge; mill → on stream; tavern → on the
    through-road near the gate/green; smithy → settlement edge, downwind
    (fire risk); temple → green/square frontage, or hilltop; manor/keep →
    elevated, set back; barn/granary → field side; midden/tannery → downstream.
  - Soft scores (sun aspect, slope < threshold, flood distance) + hard
    vetoes (water, existing footprint, road).
- **Zones emerge, not drawn:** green/market square = a road-graph node typed
  `plaza` that repels buildings to its frontage ring; churchyard = reserved
  apron around the temple; field strips radiate outside the last lane ring.

## Growth drivers (sim integration)

- **Population pressure:** dwellings have capacity (blueprint `occupancy`);
  births (D1) over capacity → queue a cottage slot. Deaths/abandonment (the
  abandonment system exists) → ruins or infill candidates.
- **Era advance:** era change re-weights the preset table (yurt → cottage →
  townhouse) and unlocks types (temple_small → church+tower from the
  reference doc's ready specs).
- **Wealth/belief:** prosperity need + belief levels gate upgrades (shrine →
  temple; palisade → stone wall — linear structures already exist).
- **Time-skip (D2):** `applySkip` calls the planner with N years of projected
  turnover — the closed-form bridge already projects population; the planner
  converts that to K growth steps so a +50y skip returns a visibly grown town.
- **Fate/levers:** `place_building` already exists; add `grow_settlement(n)`
  as a command-channel capability so rivals/Fate can develop their followers'
  villages.

## Things you might not be thinking of (requested)

- **Bridges & fords:** the road walker should cross water at the narrowest
  point and stamp a bridge entity — instant landmark, and docks/bridges anchor
  trade settlements.
- **Wells:** every founding gets one; medieval settlements are water-radius
  bound — a natural growth limiter (new well unlocks a new quarter).
- **Graveyard:** D1 produces `remains` — give them a place; churchyard fills
  over generations (visible deep-time storytelling, perfect for time-skip).
- **Defensive rings:** palisade ring at village→town transition, gates on
  road crossings (G1 gates already pass A*), later stone; the OLD ring becomes
  an internal street when outgrown (the classic European ring-road fossil).
- **Road hierarchy rendering:** path (dirt) → lane (gravel) → street (cobble)
  by traffic/age; upgrades when frontage fills.
- **Ruins & memory:** never delete — burned/abandoned buildings decay in
  stages (sim already has abandonment); ruins are re-colonizable slots.
- **Terrain memory:** placements should leave terrain edits (cleared trees,
  levelled ground) so removal doesn't leave virgin forest in mid-town.
- **NPC workplace binding:** each non-dwelling slot creates jobs; the
  activity system should route NPCs to their workplace — growth changes
  daily-life patterns visibly.
- **Determinism & saves:** the plan state (road graph, slot queue, planner
  RNG) must serialize into the snapshot like everything else.

## Research findings (2026-06-13, web survey)

Full survey ran against Watabou's TownGeneratorOS, Parish & Müller/Citygen
road growth, lot-subdivision literature, real burgage-plot morphology, and
shipped games (Manor Lords, DF, Songs of Syx). What we're stealing:

- **Wards via golden-spiral Voronoi on tiles** (Watabou): seed points in a
  golden-angle spiral (dense centre → small central patches, the strongest
  "medieval" visual cue), per-tile nearest-seed assignment, ward TYPE from a
  location-rating table (centre/market-adjacency/water/defensibility).
  ~100 LOC on a grid, fully seeded.
- **Roads as discounted A\***: grow the network anchor↔anchor (gate, market,
  church, neighbour settlement) with existing road tiles cheaper to traverse —
  reuse emerges, tree-with-shortcuts topology for free. Replaces tensor
  fields/L-systems, which don't fit a tile grid.
- **Burgage plots as the persistent unit** (validated by Manor Lords): long
  thin lots (2–3 tiles frontage × 4–6 deep) perpendicular to the street,
  house flush at the frontage, yard behind. A plot exists BEFORE and outlives
  its building; upgrades happen in place. Lot subdivision keyed on
  `(worldSeed, roadTileCoord)` so lazily-reached lots are deterministic
  regardless of growth order — replay/time-skip safe.
- **Market = widened main street** at the church/manor crossroads or inside
  the gate — not a detached plaza; the street-widening IS what distinguishes
  planned medieval towns.
- **Frontage-value gradient**: market/crossroads frontage is prime → shops
  and merchant houses; cottages further out. Building-type pick weighted by
  road-distance-to-market.
- **Growth = consuming pre-generated lots**, never inventing geometry at
  growth time: infill (lot adjacent to occupied lots) → ribbon-extend (next
  lot outward) → upgrade-in-place → only when frontage saturates, run the
  road grower once for one new back lane.

## Districts & sub-nodes (user ask, 2026-06-13)

Yes — and the research gives them a natural shape: **wards as entities**:
`{ id, name, type, anchorId, tiles, lotIds }`. The plan graph gains typed
sub-nodes (market, temple precinct, harbour, gate row); each ward is named at
creation from centroid-bearing + function — "North Market", "Fisher Quarter",
"Gate Row", "Temple Hill". That object is exactly the compact promptable
shape `npc-prompt-builder` wants: NPC prompts reference home/work ward by
name; Fate's era-authoring can mutate ward type/name across a time-skip
("the Fisher Quarter burned; now the Ashfield"). District naming lands with
the ward slice (S2 below); S1's `RoadNode.kind` is the forward hook.

## Settlement ground: masks over the natural biome, not biome replacement (user ask, 2026-06-13)

Question raised: should settlements define their own "city biomes", or
generate masks so the regional biome pops through between roads/buildings?

**Recommendation: masks/modifiers, not replacement.** The settlement is a
LAYER composited over the natural biome, so a village in pine forest reads
differently from the same village in scrubland — regional character is the
thing `terrainFill` flood-fills destroy today (hard-edged uniform discs).

Compositing order, all derived from the plan:
1. **Base:** the natural biome's terrain + vegetation (already runs first).
2. **Wear mask** (new, from the plan graph): a scalar field = falloff from
   roads, door paths, market node, and building aprons. High wear → trampled
   dirt tile variant + vegetation culled; mid wear → sparse grass, no trees;
   low wear → untouched biome pokes through between the back lots. Dither the
   thresholds with the world seed so edges are organic, never disc-shaped.
3. **Explicit surfaces:** roads, plaza paving, building grounds — the only
   places tile TYPE is replaced outright.
4. **Ward modifiers** (S2): a ward tints rather than replaces — temple
   precinct biases wildflowers/sacred grove decorations, market biases
   crates/stalls, fisher quarter biases nets — each a decoration-weight
   patch over the same wear field, and per-ward data Fate can patch.

`terrainFill`/`clearForest` in the zone rules collapse into wear-mask
parameters (farm stays a near-full-wear special case: fields ARE replaced
ground). Slots into **S2** alongside lots/wards since both consume the plan
graph's distance fields.

## Open systems: Fate directs the whole generative chain (user ask, 2026-06-13)

Design rule for every slice: **each layer is data in, data out, with a patch
seam** — the same shape that already lets agents patch blueprints
(`BlueprintPatch` → `synthesizeBlueprint(name, patches)`). Fate (or the
Create panel, or an era content pack) must be able to direct ANY level:

| Layer | Artifact | Agent seam |
|---|---|---|
| Building | `Blueprint` | `BlueprintPatch` (exists) |
| Siting | `SiteRule` | `registerSiteRule()` (S1) |
| Settlement | `SettlementPlan` | plan verbs: `grow_settlement`, `add_road`, `claim_lot`, `found_settlement` (S3/S5, via the command-channel capability registry) |
| District | ward entity `{name,type,…}` | `rename_ward` / `retype_ward` (S2+) |
| World | zone rules / era tables | data-driven already (`POI_ZONE_RULES`, `buildingsByEra`); expose as patchable recipe with the period/style world-recipe track |

Two invariants keep this safe and deterministic:
1. Agents emit **typed intents through the command channel** (never direct
   mutation), so everything is validated, previewable, and logged like
   `place_building` today.
2. Agent influence = **inputs to the seeded planner** (patches, weights,
   vetoes), not raw tile edits — the sim stays replayable; a skip can re-run
   the same growth with the same patches and get the same town.

## Suggested slices (updated post-research)

1. **S1 — Settlement plan model** ✅ (2026-06-13): `SettlementPlan` (road
   graph + typed nodes + frontage slots + SITE_RULES), `placeSettlement`
   executes it — doors face roads, docks require water, footprints stay off
   roads. Spec: `2026-06-13-settlement-plan-s1-spec.md`.
2. **S2 — Lots, wards & districts:** burgage-plot subdivision along frontage
   (lots persist, keyed on road-tile coords), golden-spiral ward assignment +
   ward entities with generated names ("North Market") for LLM prompts;
   market = widened main street at the founding node.
3. **S3 — Live growth:** sim system (slow cadence like mortality 0.25 Hz)
   consumes empty lots from population pressure (infill → ribbon-extend →
   upgrade-in-place); discounted-A\* road grower opens back lanes when
   frontage saturates; plan state serialized into the snapshot.
4. **S4 — Constraint catalogue:** mills/bridges/wells/graveyard + water-aware
   road walker; frontage-value gradient for type picks.
5. **S5 — Skip integration + Fate lever:** D2 turnover → growth steps;
   `grow_settlement` capability; ward mutation in era-authoring.
