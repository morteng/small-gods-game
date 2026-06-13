# Settlement growth S3 — live growth from population pressure (spec)

**Date:** 2026-06-13 · **Status:** spec · **Slice of:** [settlement growth design](2026-06-13-settlement-growth-placement-design.md) · **Builds on:** S2 (lots/wards/market/wear)

## Goal

Settlements grow DURING play: when a settlement's population exceeds its
housing capacity and a free burgage lot exists, a new dwelling appears on it
— the same lots, the same alignment rules, so a town grown live looks like a
town generated old. Plan state persists through autosave and stays consistent
under timeline scrub/re-roll.

## Non-goals (later slices)

- BACK-LANE road growth (perpendicular lanes / discounted-A* grower) — S4
  alongside the constraint catalogue. S3 grows the main street by RIBBON
  EXTENSION only (extend the through street past an end node, re-subdivide);
  once that hits the node cap or the map edge/water, growth stops.
- Upgrade-in-place (cottage → townhouse) and era-advance reweighting — S4/S5.
- `grow_settlement` Fate capability — S5 (the system is its substrate).
- Ruins/abandonment infill (re-colonising lots) — S4.
- **Two-sided streets.** Preset doors face SOUTH (the camera-visible face),
  so only north/west-side lots are claimable; flipping a door to a hidden
  face would regenerate the sprite with no visible entrance. Rides with the
  multi-view facing epic (full-3D Slice 2), which exists precisely to pair
  facade variants with street-aware placement.

## A. Plan persistence

- `SettlementPlan.poiId` (set by `placeSettlement`) ties a plan to its POI.
- `GameMap.settlementPlans?: SettlementPlan[]` — map-generator stores the
  plans it already collects. `SaveFile.map` is stored verbatim → autosave
  persistence is free. (Type-only import cycle types⇄settlement-plan is fine.)

## B. Growth system (`src/sim/systems/settlement-growth-system.ts`)

Slow cadence (0.25 Hz, one fire per in-game day, like births/mortality):

1. Group living NPCs by `homePoiId` (births pattern, sorted POI order for
   replay-stable rng draws).
2. Per plan: `capacity` = Σ `DWELLING_CAPACITY[preset]` over building
   entities with `properties.poiId === plan.poiId`. `DWELLING_CAPACITY`
   is an open registry (yurt 4, cottage 5, longhouse 8) with
   `registerDwellingCapacity()` — same agent seam pattern as SITE_RULES.
3. Pressure = residents > capacity. Under pressure, with probability
   `GROWTH_CHANCE` (0.15/fire ≈ days-to-weeks of sim time), place ONE
   dwelling:
   - Preset: era roster (`resolveSettlementEra` + `presetsForEra`) filtered
     to registered dwellings, picked via `ctx.rng`.
   - Lot: free lots whose `side` opposes the preset's door facing, ordered
     **infill-first** (lots with a claimed neighbour within 2 tiles of their
     frontage), then centre-out — the medieval sequence (infill → ribbon).
   - Placement: flush against the street on the door side, swept along the
     lot frontage (centred try first); footprint must sit fully inside the
     lot, off ROADS (inter-POI connectors carved after planning cross lots),
     on buildable OR clearable terrain — growth may fell forest/meadow
     inside its own lot (medieval assarting), which worldgen seeding never
     does — and clear of non-vegetation entities.
   - Stamp: overlapping vegetation removed, footprint non-walkable except
     door cells, ground under the building → grass; `lot.buildingId` set;
     entity id `${poiId}_bld_g${tick}`; event `settlement_grown` appended.
4. No free lot fits → `extendThroughStreet`: extend the through street past
   an `end` node by `EXTEND_LEN` tiles (off water/edge), turn that node into
   a `junction`, add a new `end` node + edge, re-derive slots, and
   re-subdivide lots (coordinate-keyed → existing lots reproduce exactly and
   carry their `buildingId`). Carve the new tiles into the live grid, then
   retry placement once. Bounded by `MAX_PLAN_NODES`; past that (or at the
   map edge) growth stops until S4 grows back-lanes.

## C. Scrub/re-roll consistency (`src/world/settlement-reconcile.ts`)

`restoreSnapshot` rebuilds entities from the snapshot but shares `state.map`
tiles BY REFERENCE — runtime tile mutations diverge on scrub-back (a
pre-existing gap that `place_building` already has; growth would widen it).
Fix for the lot-constrained case, called at the end of `restoreSnapshot`:

- Reset every lot tile of every plan to walkable (lot tiles are buildable
  ground by construction) and clear every `lot.buildingId`.
- Re-stamp every restored building entity's footprint (non-walkable except
  door cells) and re-claim the lot its footprint intersects.

Deterministic reconciliation from restored entities — nothing new to
serialize in `Snapshot`. Ground-type divergence (grass where a scrubbed-away
building stood) is accepted as cosmetic; vegetation entities ARE restored by
the snapshot. Worldgen buildings outside lots re-stamp as a no-op.

## D. Events

New `SimEvent`: `{ type: 'settlement_grown'; poiId; entityId; preset; lotId }`.

## Tests

- Growth fires under pressure: over-capacity POI with free lots gains a
  dwelling on a lot, door fronting the road; capacity relief stops growth.
- No growth when: at/under capacity, no plan, no matching free lot.
- Determinism: same seed/state → same growth sequence.
- Reconcile: grow → capture → grow more → restore to earlier snapshot →
  later building's tiles walkable again, lot unclaimed, re-rolled growth
  can claim it; restored building footprints non-walkable except doors.
- `settlement_grown` appended with the right poiId/lotId.
