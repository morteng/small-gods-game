# Placement & Fit Audit: Findings

**Date:** 2026-08-10  
**Method:** 7 parallel dimension scouts (deepseek-v4-flash) + 7 adversarial verifiers  
**Verifier refutation rate:** 2 of 7 had no findings to refute (bridges, no-bridge);  
  all confirmed findings in dimensions where bugs were found.

---

## A. Root Causes, Grouped

### Group 1 — Runtime systems skip worldgen reconcilers (HIGHEST IMPACT)

**SettlementGrowthSystem** (src/sim/systems/settlement-growth-system.ts) and **desire-line-adoption** (src/world/desire-line-adoption.ts) create buildings, roads, and bridge tiles post-worldgen WITHOUT calling any of the 5+ worldgen reconcilers:
- `clearObstructedVegetation` — vegetation grows through new roads and buildings
- `reconcileBuildingsWithWater` — new buildings near water aren't checked for flooding
- `detectCrossings` — new roads crossing water get flat bridge tiles but NO parametric bridge structure entity (pier/arch/deck model)
- `reconcileFilletRaster` — growth road centerlines never get smoothed ribbon reconciliation → the drawn ribbon can drift off the tile walker
- `reconcileRoadTileVisibility` — orphaned road tiles can render as invisible

This single gap explains contributions to symptoms **1** (badly placed buildings), **2** (uncleared vegetation), **4** (misplaced/no bridge structures), and **5** (road over water with no bridge). Worldgen itself correctly runs all reconcilers at the end; the architecture just has no runtime equivalent.

**Evidence file:line:**
- `settlement-growth-system.ts:130-380` — stampFootprint, extendThroughStreet, annexAcrossBridge — zero reconciler calls
- `desire-line-adoption.ts:268-566` — adoptDesireLine stamps tiles and bumps graph.rev but never calls clearObstructedVegetation or detectsCrossings
- `map-generator.ts:796-808` — reconcileBuildingsWithWater + reconcileBarriersWithBuildings (gen-time only)
- `map-generator.ts:1025` — clearObstructedVegetation (gen-time only)

**Fixes required:**
- A shared `reconcileAfterMutation(map, world, flags)` entry point usable by both worldgen and runtime
- Or a mutation event bus: emit typed events from stamp primitives, reconcilers subscribe

### Group 2 — reconcileBuildingsWithWater checks tile.type, not render-water mask (WIDESPREAD)

`building-water-reconcile.ts:51-54` checks `WATER_TYPES.has(tile.type)` (the D8 hydrology raster). But mills (mill-site-store.ts:61-66) and bridges (detect-crossings.ts:248-249) are sited against `buildRenderWaterTypeMemo` — the smooth connectome ribbon. These two water derivations can disagree by up to ~1 tile at meanders. A river that meanders one cell closer to a mill's bank footprint sets the footprint cell's tile.type to `'river'`, triggering a false-positive nudge that teleports the mill inland.

This explains symptom **3** (waterwheel not in river) — the mill was sited correctly against painted water, then reconciled away from tile-classified water.

**Evidence file:line:**
- `building-water-reconcile.ts:51-54` — `footprintTouchesWater` uses `tile.type` and `WATER_TYPES`
- `mill-site-store.ts:61-66` — `collectMillSites` uses `buildRenderWaterTypeMemo`
- `detect-crossings.ts:248-249` — crossing detection uses `renderWaterAt`, not tile.type

**Affects:** All buildings, but most visibly mills and waterside structures.

### Group 3 — Mill wheel has no vertical alignment to water (MOST VISIBLE)

The waterwheel's `submerge` parameter is a fixed preset constant (blueprint/presets/index.ts:362, `submerge: 0.38` tiles). It is never computed from the actual water surface height (`waterSurfaceAt` in water-field.ts:892). The wheel assumes z=0 = building floor = water surface, but the river surface is incised ~0.5m below the bank top (`river-surface-field.ts:21`, `SURFACE_INSET_M = 0.5`).

For the nominal case (bank elevation ≈ building footprint elevation), the wheel dips ~0.38m below the building floor while the water surface is ~0.5m below the bank top — the wheel bottom is ~0.12m above the water. On a high bank or high-relief world, the gap is larger.

**Additionally, no millrace/wheel-pit carve exists** — the aspirational comment at presets/index.ts:341-343 describes it but the code was never written. Without a local terrain scoop under the wheel, even a correctly submerged wheel would sit above the river bed.

**Evidence file:line:**
- `blueprint/presets/index.ts:341-343` — aspirational "carves the race + wheel-pit" comment, no implementation
- `blueprint/parts/structural.ts:118-124` — `cz = radius - submerge`, fixed offset, no water-surface query
- `river-surface-field.ts:21` — `SURFACE_INSET_M = 0.5`, river surface incised below bank
- `water-field.ts:892` — `waterSurfaceAt` exists, called by zero mill-related code

### Group 4 — Barriers/walls invisible to vegetation clearing (VEGETATION)

NOTE: The fractional origin bug (originally Group 4) was REFUTED by the verifier.

`clearObstructedVegetation` (vegetation-clear.ts:180) only checks `isBuilding()` (building-collision.ts:45), which returns true only for entities with `category === 'building'` or tag `'building'`. Barriers placed by `placeBarrier` (place-barrier.ts:107-110) have kind `"${run.kind}_run"` (not in entity-kinds.ts → `tryGetEntityKindDef` returns null) and tags `['barrier', 'obstacle', 'settlement']` — no `'building'` tag. So a tree whose trunk falls inside a wall's footprint survives.

Worse: `fillBareGround` (vegetation-fill.ts:107) re-sows ground-cover into "bare" cells after the clear, and its occupancy check also only checks `isBuilding()`. Wall-footprint cells on `grass`/`meadow`/`glen` tile types get re-planted with wildflowers after the killing-field and vegetation-clear passes.

Light barriers (`hedge`, `fence`, `paling`) are also NOT in `WALL_WEAR_KINDS` (settlement-wear.ts:269), so they get neither wear-dirt tiles nor vegetation clearance — even at gen time.

**Evidence file:line:**
- `vegetation-clear.ts:192-193` — `onBuilding` check uses `isBuilding(b)`
- `building-collision.ts:45-49` — `isBuilding` only category='building' or tag 'building'
- `place-barrier.ts:107-110` — barrier tags: `['barrier', 'obstacle', 'settlement']`
- `vegetation-fill.ts:126-131` — occupancy check mirrors the same gap
- `settlement-wear.ts:269` — `WALL_WEAR_KINDS` excludes hedge/fence/paling

### Group 5 — Settlement pad lifts waterside building above water surface (FLOATING)

`settlement-deformation.ts:78-82` levels building footprints to mean terrain height minus `SETTLE_DEPTH_M(0.12m)`. The adjacent river water surface (river-surface-field.ts) is NOT on a pad. The building foot-z (terrain-lift.ts) samples the curved composed heightfield *including* the pad, while the water surface at the adjacent tile is at the natural river incision elevation.

Quantified: for a building 4.8m above sea level on a slope where the river is at sea level (0.35 normalised): raw elevation difference = (0.45 − 0.35) × 48 = 4.8m. After gamma=1.8 curve: building foot at ~0.372 normalised = 21px lift. Water surface at 0.35 = 0px lift. Visible float: **~21px**. On a higher bank the error is larger.

**Evidence file:line:**
- `settlement-deformation.ts:65-80` — pad target = mean − SETTLE_DEPTH_M
- `terrain-lift.ts` — foot-z lift samples curved composed heightfield (includes pad)
- `river-surface-field.ts:21` — `SURFACE_INSET_M = 0.5`, water surface incised below bank
- `render/gpu/terrain-field.ts` — `curveRenderElev` gamma=1.8 applied to composed heights

### Group 6 — Pre/post-fillet bank cell mismatch in bridges (LATENT)

Crossing specs are captured from the pre-fillet road graph (map-generator.ts ~686). Fillet reconciliation (~916) bumps graph.rev, and `getCrossingOpenings` (crossing-openings.ts:53-66) re-runs `detectCrossings`, potentially finding different bank cells on the pinned centerline. But the bridge entity at ~944 is built from the ORIGINAL pre-fillet crossing spec. The road ribbon is pinned to post-fillet banks while the deck sits at pre-fillet banks — a sub-tile jog.

Severity is low in practice because bow pins are small (≤0.65 tile correction), but the architectural gap is structural.

**Evidence file:line:**
- `map-generator.ts:686, 916, 944` — spec capture → fillet reconcile → span build
- `road-deformation.ts:1245` — `graph.rev = (graph.rev ?? 0) + 1` in reconcileCenterlineBows
- `crossing-openings.ts:53-66` — getCrossingOpenings re-detects on rev change
- `road-deformation.ts:369` — pinBankOpenings pins to fresh bank cells

---

## B. Per User Symptom

### Symptom 1 — Buildings placed badly

| Cause | Type | File:Line | Notes |
|-------|------|-----------|-------|
| Fractional origin in frontage placement | **REFUTED** (to-anchors.ts .5 offsets cancel with doorOf()) | building-placer.ts:877-883, to-anchors.ts:27-28 | Fragile cancellation — code correct today but a future asymmetric edit could introduce this bug |
| No slope threshold for building placement | **(a) bug** | building-placer.ts:756-770 | fitsAt checks terrain type, occupancy, water — but NOT slope. Buildings on 45° grade accepted |
| `requiresRoadAccess` declared but never enforced | **(b) missing** | building-placer.ts:120-125, 367-450 | Spiral-fallback buildings can have zero road/door access |
| Settlement growth creates buildings without reconcile | **(a) bug** | settlement-growth-system.ts:130-380 | New buildings near water never checked for flooding |
| Settlement road grid doesn't adapt to terrain | **(c) timing** | settlement-plan.ts:189-202 | Grid is purely geometric; buildings onto arbitrary grades |

### Symptom 2 — Tall vegetation NOT cleared around walls/towers

| Cause | Type | File:Line | Notes |
|-------|------|-----------|-------|
| Barriers/walls invisible to isBuilding() check | **(a) bug** | vegetation-clear.ts:192-193, building-collision.ts:45-49 | Tree inside wall footprint survives |
| fillBareGround re-plants on barrier footprint tiles | **(a) bug** | vegetation-fill.ts:126-131 | Ground cover sprouts through wall base |
| Runtime barrier placement never clears vegetation | **(b) missing** | place-barrier.ts:48-113 | No call to clearObstructedVegetation or cullVegetationEntities |
| Light barriers (hedge/fence/paling) excluded from wear | **(b) missing** | settlement-wear.ts:269 | No tile-type change → fillBareGround re-plants at gen time too |

### Symptom 3 — Watermill wheel NOT in river, too high above water

| Cause | Type | File:Line | Notes |
|-------|------|-----------|-------|
| Fixed submerge never reads actual water surface | **(b) missing** | structural.ts:118-124, presets/index.ts:362 | Wheel depth = constant 0.38 tiles, not computed from waterSurfaceAt() |
| No millrace/wheel-pit carve | **(b) missing** | presets/index.ts:341-343 | Aspirational comment only; no terrain deformation |
| reconcileBuildingsWithWater uses tile.type, not render-water | **(a) bug** | building-water-reconcile.ts:51-54 | Mill sited against render-water but reconciled against different mask |
| Settlement pad lifts mill above water surface | **(a) bug** | settlement-deformation.ts:78-82 | ~21px float at gamma=1.8, relief=48m for building 4.8m above sea |

### Symptom 4 — Bridges misplaced

| Cause | Type | File:Line | Notes |
|-------|------|-----------|-------|
| Pre/post-fillet bank cell mismatch | **(c) timing** | map-generator.ts:686→916→944 | Deck built from pre-fillet banks, road ribbon pinned to post-fillet banks. Sub-tile jog in practice |
| No outright bugs found | — | — | Detection uses correct render-water mask, axis is road-centreline secant, two-stage heightfield intentional |

### Symptom 5 — Road/water crossings with NO bridge

| Cause | Type | File:Line | Notes |
|-------|------|-----------|-------|
| Runtime adoption creates bridge tiles without crossing structure | **(b) missing** | desire-line-adoption.ts | Tiles say 'bridge' and walk correctly, but no parametric deck entity |
| Settlement growth annex bridge tiles without crossing registration | **(b) missing** | settlement-growth-system.ts:annexAcrossBridge | Bridge tiles stamped, no CrossingSpec, no crossing-tier store entry |
| No-worldgen-path bug found in road-stamping guards | ✅ All correct | road-graph.ts, wire-gate.ts, settlement-plan.ts | Every worldgen road-stamping path correctly guards against creating un-bridged water tiles |

---

## C. The Integration Story

### Structural change 1 — Single post-mutation reconcile entry point

```ts
// New file: src/world/runtime-reconcile.ts
function reconcileAfterMutation(map: GameMap, world: World, flags: {
  buildings?: boolean; roads?: boolean; vegetation?: boolean;
}): void {
  if (flags.vegetation) clearObstructedVegetation(world, map);
  if (flags.buildings) {
    reconcileBuildingsWithWater(world, map.tiles);
    reconcileBarriersWithBuildings(world);
  }
  if (flags.roads) {
    detectCrossings(map.roadGraph, ...);
    reconcileCenterlineBows(map);
    reconcileFilletRaster(map, world);
    reconcileRoadTileVisibility(map);
  }
}
```

Called by worldgen's final passes (replacing inline calls) AND by `SettlementGrowthSystem.tick()`, `adoptDesireLine()`, `placeBarrier()`.

**What it buys:** Closes the runtime gap for ALL current systems. Any future mutation system that calls it won't regress. Eliminates the 5-symptom-class runtime gap in one change.

### Structural change 2 — Single water-contract source

Replace `tile.type` checks against `WATER_TYPES` with `getRenderWaterMask(map)` wherever existence of visible water is the question. Specifically:
- `building-water-reconcile.ts:51-54` → use `getRenderWaterMask`
- `building-placer.ts` placement validation → use `getRenderWaterMask`

**What it buys:** Eliminates the tile-grid vs render-water disagreement that causes false-positive reconciliation nudges (most visible in mills). One water truth for placement, reconciliation, and rendering.

### Structural change 3 — Per-site wheel submerge

Instead of the fixed `submerge: 0.38` in the mill blueprint, compute it at placement time against the actual water surface:
```ts
const waterLevel = waterSurfaceAt(map, wheelOverhangX, wheelOverhangY);
const bankLevel = heightMetresAt(map, millFootprintX, millFootprintY);
const submerge = (bankLevel - waterLevel) + WHEEL_RIM_CLEARANCE;
```

**What it buys:** Fixes the "wheel above water" symptom for all terrain profiles and world styles. The millrace carve can follow as a separate deformation pass.

### Structural change 4 — Barrier-aware vegetation clearing

Add `isBarrier(e)` alongside `isBuilding(e)` in `vegetation-clear.ts` and `vegetation-fill.ts`. `isBarrier` checks entity kind pattern `*_run` or tag `'barrier'`.

**What it buys:** Closes the vegetation-growing-through-walls symptom for all barrier types (walls, fences, palisades, ramparts, hedges, barricades) at gen time AND runtime.

---

## D. Ordered Fix Plan

| # | What | Files | Size | Fixes | Risk |
|---|------|-------|------|-------|------|
| 1 | **Barrier-aware vegetation clear + fill** Add `isBarrier()` alongside `isBuilding()` in both vegetation-clear.ts and vegetation-fill.ts | `vegetation-clear.ts:192-193`, `vegetation-fill.ts:126-131`, `building-collision.ts` (add `isBarrier`) | Half-day | Symptom 2 (all subtypes) | Low — additive check, existing building behavior unchanged |
| 2 | **Runtime barrier vegetation clear** Call `clearFootprint` or `cullVegetationEntities` from `placeBarrier` | `place-barrier.ts:113` (after `world.addEntity`) | One-liner | Symptom 2 (runtime) | Low — footprint cells already computed |
| 3 | **Water contract: reconcile uses render-water mask** Change `footprintTouchesWater` to check `getRenderWaterMask(map)` instead of `WATER_TYPES.has(tile.type)` | `building-water-reconcile.ts:51-54` | One-liner | Symptom 3 (false-positive mill nudge), Symptom 1 (waterside buildings) | Low/Medium — changes which buildings get nudged; existing worldgen tests will catch regressions |
| 4 | **Per-site wheel submerge** Pass `waterSurfaceAt` result to mill placement, compute submerge = bankLevel − waterLevel + clearance | `blueprint/parts/structural.ts`, `building-placer.ts:620-628`, `mill-site-store.ts` | Half-day | Symptom 3 (wheel above water) | Medium — changes mill appearance on all worlds; needs test-pin update |
| 5 | **Runtime reconcile entry point** Write `reconcileAfterMutation()`, call from settlement growth + adoption + barrier placement | New `src/world/runtime-reconcile.ts`, edit `settlement-growth-system.ts`, `desire-line-adoption.ts`, `place-barrier.ts` | Multi-day | Symptoms 1-5 runtime manifestations | High — test coverage gap; could cause performance regression if reconcilers are expensive per-tick. Gate on `lowFrequency` tick |
| 6 | **Slope threshold for buildings** Add `maxSlope` to `PlacementConstraint`, enforce in `fitsAt` | `building-placer.ts:756-770`, `terrain-affordance.ts`, `site-fitness.ts` | Half-day | Symptom 1 (buildings on steep grades) | Low — match the existing vegetation slope threshold pattern |
| 7 | **Bridge pre/post-fillet timing** After fillet reconcile, re-derive crossingSpecs from the live graph before building bridge spans | `map-generator.ts:~944` (re-run `detectCrossings` after fillet reconcile, use fresh specs for spans) | Half-day | Symptom 4 (sub-tile bridge jog) | Low — matches the same graph state the fillet processed |
| 8 | **getRenderWaterMask cache key** Add `beaverDams.length` or a hash to the cache key | `render-water-mask.ts:84` | One-liner | Stale water mask on identical seed+dims with different dams | Very low — latent bug |
| 9 | **requiresRoadAccess enforcement** Read `constraint.requiresRoadAccess` in spiral search, reject sites beyond threshold distance from road | `building-placer.ts:367-450` | Half-day | Symptom 1 (buildings with no road access) | Low — changes which spiral-fallback sites are accepted |

**Requires content-version or test-pin bump:** Item 4 (wheel submerge) changes visual output — needs existing worldgen test pins updated. Item 1 (barrier vegetation) adds new entities/removes old ones — snapshot tests may change. No `ART_RECIPE_VERSION` bump needed (no geometry changes).

---

## Summary

| Symptom | Confirmed causes | Unconfirmed |
|---------|-----------------|-------------|
| 1 — Buildings placed badly | 3 bugs found (no slope threshold, dead requiresRoadAccess, runtime skip reconcilers); fractional origin refuted — offsets cancel | — |
| 2 — Vegetation not cleared around walls | 4 bugs found (isBuilding() misses barriers, fillBareGround re-plants, runtime gap, light barriers excluded from wear) | — |
| 3 — Watermill wheel above water | 4 bugs found (fixed submerge, no millrace carve, reconcile uses wrong water mask, pad lifts building) | — |
| 4 — Bridges misplaced | No outright bugs; 1 timing risk (pre/post-fillet bank cells) | — |
| 5 — No bridge over water | No worldgen path creates un-bridged water tiles. 2 missing runtime mechanisms (adoption, growth) | Bridge tiles added at runtime create no crossing structure entities |

**Verifier refutation count:** 1 finding was fully refuted (placement: fractional origin — `.5` offsets cancel). 3 additional claims were refuted as non-bugs (grade: pad lift is design intent, single-point foot-z mitigated by pads, tile-grid WATER_TYPES is correct for reconcile). The bridges verifier upgraded the "no bug found" assessment to a confirmed timing risk. The mill verifier refuted the sub-claim that the wheel always hangs above water (nominal case ~0.12m submerged, bank ≈ building pad level), but confirmed the structural gap.

**Net confirmed bugs:** 14 (down from 17 scout-reported) after the grade verifier's comprehensive refutations.

**One architectural change that fixes the most:** `reconcileAfterMutation` shared entry point (item 5). It directly closes the runtime gap affecting symptoms 1-5, and any future mutation system automatically inherits the full reconcile set.
---

## Verification pass (independent re-read, 2026-08-10)

This run spawned a real fleet (7 scouts + 7 verifiers) and refuted 4 of its own claims — a materially
better process than the other three audits, and it shows. Re-checked the two highest-value groups.

### CONFIRMED — Group 3, the waterwheel. This is the best finding of the whole sweep.
Every cited line checks out, and together they are a complete mechanism for "the wheel is not in the river":
- `blueprint/presets/index.ts:362` — `submerge: 0.38`, a fixed literal in the mill preset.
- `blueprint/parts/structural.ts:124` — `const cz = radius - submerge`. A pure geometric offset with no
  water-surface query anywhere in the part. The comment at `:121-123` states the assumption outright:
  the wheel dips below **"z=0 (the ground / water surface)"** — i.e. the geometry assumes ground level
  *is* water level.
- That assumption is false by construction for a watermill. `mill-site-store.ts` seats the mill on a dry
  **bank** cell, and `river-deformation.ts:35-39` (`REACH_CARVE`) incises the channel 1.0 m (brook) to
  6.5 m (major river) below that bank. The wheel is therefore built to dip 0.38 tiles below a waterline
  that is metres further down.
- `waterSurfaceAt` (`render/gpu/water-field.ts:892`) — the function that would resolve this — has exactly
  **two references in the tree: its own docstring (`:866`) and `dev/debug-api.ts:309`.** Zero production
  callers, none mill-related. Confirmed as claimed.

This supersedes the `site-requirements-audit.md` root cause (a "pad float" whose sign was backwards) and
is more specific than the bank-height argument in that report's verification note: the defect is not only
that the mill sits high, it is that **the wheel's vertical position is authored as a constant instead of
being resolved against the water surface.** Fixing the constant to a per-site query is the single
highest-value change identified across all four audits.

### CONFIRMED — Group 4, vegetation around walls and towers. Clean, and the cheapest real fix found.
- `place-barrier.ts:105-112` — a barrier entity is created with `kind: \`${run.kind}_run\`` and
  `tags: ['barrier', 'obstacle', 'settlement']`. **No `'building'` tag.**
- `building-collision.ts` — `isBuilding` returns true only for `category === 'building'` or
  `tags.includes('building')`.
- `vegetation-clear.ts:35, :228` — the clear pass gates on `isBuilding(b)`.
- `vegetation-fill.ts:25, :145` — the re-sow pass gates on the same predicate.

So walls, towers and gatehouses are **invisible to both the clearing pass and the re-sowing pass**. Trees
inside a wall footprint are never cleared, and ground cover is re-sown over wall cells afterwards. This is
a complete explanation of the reported symptom, and the fix is to make the barrier footprint visible to
that predicate rather than to touch either vegetation pass.

### PARTIALLY MISFRAMED — Group 5 ("settlement pad LIFTS waterside building")
The substance (building foot-z is sampled from the composed+curved field while the adjacent water surface
is not) is right and matches the bank-height mechanism. The framing is not: the settlement pad does not
lift anything. `settlement-deformation.ts:62` levels to mean grade **minus** `SETTLE_DEPTH_M`, and the
constant's own doc says *"How far a foundation settles BELOW the mean grade… The whole footprint drops by
this."* The pad settles buildings **down** ~0.12 m (≈2.4 px at the ~20 px/m the codebase quotes). The real
vertical error is the bank incision (1.0–6.5 m), not the pad. Retitle before acting, or the fix targets
the wrong term.

### NOT VERIFIED
Groups 1, 2 and 6, and the symptom-4 / symptom-5 conclusions. Worth noting that dimensions 5 (bridges) and
6 (missing crossings) returned **zero bugs**, which does not match the user's reported observations —
either those symptoms have a cause outside the files those two scouts were pointed at, or they were missed.
That gap is the most likely place for a follow-up sweep.
