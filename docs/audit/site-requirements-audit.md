# Site-Requirements Audit

> Adversary-verified: **22/24 claims confirmed, 0 refuted, 2 partial.**  
> Verifier: `reviewer` subagent, re-read every cited `file:line` from source.
> Builds: `npm run lint` clean, `npm run lint:world` clean.

---

## A. Verdict on the thesis

> **The watermill is NOT a one-off bug — it is the best-constrained building in the codebase.**  
> The thesis ("the mill is one instance of a general missing mechanism") is **reversed**.  
> The mill is the **one thing that works**; everything else is the gap.

The mill (`CIVIC_RULES.mill` + `mill-site-store.ts`) has **flush-or-nothing** hard enforcement: the wheel foot must sit against rendered river water of Strahler order 2–6, linked via `hydrology (flowDirX/Y)` and `render-water-mask (WaterType.River)`. If no such site exists, the mill is **skipped**. This is the strictest constraint in the codebase.

The fishery hut (`CIVIC_RULES.fishery` + `fishery-site-store.ts`) shares the same flush-or-nothing pattern (pond klass only, never river/lake/mere).

**The real defect:** these two buildings are the **only** ones with hard resource-adjacency constraints. Every other building type — 15+ presets — either has no site rule at all, or has only a **soft affinity** (center/edge sort reorder) that never hard-rejects invalid terrain.

The mill the user saw on dry ground was likely placed by one of four failure modes:
1. **The settlement pad float** — `terrain-deformation.ts` raises the building pad ~0.12 m above the base terrain, while the water surface stays at the base level. The mill's wheel dips into the rendered water BELOW the pad surface, creating a ~21 px visual gap at native zoom. (Bug, `src/world/terrain-deformation.ts:45-60` path of `composedHeight` → `curveRenderElev`.)
2. **Map-less fallback path** — when `placeSettlement` is called without a `GameMap` (test/legacy callers), `mill`/`fishery` fall back to `waterWithin()` tile-scan proximity check instead of flush-or-nothing hydrology tags (`settlement-plan.ts:635-650`). The tile scan tests `tile.type` for `WATER_TYPES`, not rendered water.
3. **Post-hoc water flooding** — the inter-POI river carve and flood-watch run AFTER settlement placement, so a river that reaches for a POI near where a mill was flush-placed can flood its wheel after the fact. The `reconcileBuildingsWithWater` pass (`building-water-reconcile.ts`) nudges buildings off post-placed water, but nudging a mill off its water source destroys the intentional siting.
4. **Render vs. tile divergence** — the render-water mask can differ from `tile.type` at bridge crossings and meanders. A mill placed flush against a `WaterType.River` render cell might still sit above drawn water if the rendered water surface is a smoothed ribbon at sub-cell resolution and the building pad sits above it.

---

## B. The requirement matrix

> Each building type (preset or civic) mapped to its siting requirement.  
> **Hard** = won't place without it. **Soft** = re-ranks but doesn't reject. **Absent** = no constraint.

### Civic & special buildings (placed via `planCivics`)

| Building | Requirement it should have | What the code enforces | Enforced at | Hard/Soft | Notes |
|----------|---------------------------|----------------------|-------------|-----------|-------|
| **watermill** | Wheel in flowing river (Strahler 2–6), bank flush, wheel below water surface | ✅ Hydrology tag (render-water River + Strahler band) + flush-or-nothing | `mill-site-store.ts:54-90`, `settlement-plan.ts:373-385` (flushFootprintForHint) | **HARD** | Strongest constraint in the codebase. But settlement pad float lifts it above water (bug). |
| **fisherman_hut** | Bank of a pond (klass=pond, never river/lake/mere), jetty over real water, racks on dry ground | ✅ Ponds-only filter + flush-or-nothing | `fishery-site-store.ts:45-90`, `settlement-plan.ts:393-410` | **HARD** | Correctly scoped. Map-less callers get tile-scan fallback (weaker). |
| **well** | Plausible groundwater, centre of settlement (on green) | ✅ `CIVIC_RULES.well` → green heart | `settlement-plan.ts:610-615` | **HARD** (on green) | Doesn't check groundwater table / bedrock. Visible oddity only on solid rock. |
| **graveyard** | Well-drained soil, settlement rim | ✅ `CIVIC_RULES.graveyard` → farthest ring | `settlement-plan.ts:620-630` | **HARD** (rim) | Doesn't check soil drainage. Never offends visually on default terrain. |
| **dock** | Flush against deep navigable water | `SITE_RULES.dock: nearWater: 2` | `settlement-plan.ts:139`, `building-placer.ts:720` | **HARD** but **WRONG** | `nearWater:2` allows a dock 1 tile inland. Should be flush-or-nothing like the mill. The POI-level `adjacencyRequirement: 'shallow_water'` on `port` zones partially mitigates. |

### Settlement building-class presets (placed via `placeSettlement` focus → frontage → spiral)

| Building | Requirement it should have | What the code enforces | Enforced at | Hard/Soft | Believability risk |
|----------|---------------------------|----------------------|-------------|-----------|-------------------|
| **parish-church** | Prominent elevated site, solid rock foundation, sunlit orientation, seen from across the village | `SITE_RULES: center affinity + focus`; site profile 'prominent' soft-reorders by sun/prominence/shelter. **No hard rejection filter.** | `settlement-plan.ts:146`, `building-placer.ts:848-861`, `site-fitness.ts:122-135` | **Soft** (reorder only) | 🚨 HIGH — church in a hollow is instantly wrong. Has the right scoring primitives (`prominence`, `sunny`) but they're only a ±3-tile-equivalent pull, never a gate. |
| **manor** | Slight rise, good drainage, away from industrial trades | `SITE_RULES: center affinity + focus:true, focusMin:6` | `settlement-plan.ts:147` | **Soft** | ⚠️ MEDIUM — center-first placement gets it prestige position, but no terrain check. |
| **tavern** | Road frontage (street-corner or market square) | `SITE_RULES: center affinity` | `settlement-plan.ts:139` | **Soft** | ✅ LOW — center affinity gets it on the main street. Adequate. |
| **market_stall** | Market square / widened street | `SITE_RULES: center affinity` | `settlement-plan.ts:141` | **Soft** | ✅ LOW |
| **shrine** | Wayside path, crossroads, or sacred grove | `SITE_RULES: center affinity` | `settlement-plan.ts:140` | **Soft** | ⚠️ LOW — acceptable for settlement shrines. Wayside shrines don't go through settlement placer. |
| **farm_barn** | Adjacent to arable fields, cart access, settlement edge | `SITE_RULES: edge affinity` | `settlement-plan.ts:142` | **Soft** | ⚠️ LOW — edge affinity is correct. `stampFarmland()` (`farmland.ts`) tills fields around the barn post-placement, fixing the visual. |
| **longhouse** | Slight slope for drainage (byre end downslope) | `SITE_RULES: edge affinity` | `settlement-plan.ts:143` | **Soft** | ✅ LOW |
| **tower** | Exposed hilltop, line-of-sight, hard rock foundation | **No rule** | — | **Absent** | 🚨 HIGH — watchtower on flat valley floor is nonsensical. Most visible example of this class of defect. |
| **castle_keep** | Defensible hilltop, sea cliff, river bend, rock ground | **No rule** | — | **Absent** | 🚨 HIGH — castle on flat open grassland looks ridiculous. Civic 'stone' ground never checked. |
| **guard_post** | Settlement edge/gate, line-of-sight | **No rule** | — | **Absent** | 🚨 HIGH — guard post at town centre is wrong. Needs gate/edge affinity. |
| **smithy** | Water supply (quenching), fire-setback from timber buildings, settlement edge, road access | **No rule** (catalogue `requires: ['water-supply']` is decorative) | — | **Absent** | 🚨 HIGH — fire hazard in timber village; the `requires` tag has zero placement effect. |
| **bakehouse** | Water supply, fire-setback from timber, communal centre | **No rule** | — | **Absent** | 🚨 HIGH — same fire risk. `requires: ['water-supply']` unenforced. |
| **brewhouse** | Ample water supply, drainage for waste, downstream from well | **No rule** | — | **Absent** | 🚨 HIGH — water-intensive trade; waste-pollution concern. No downstream concept exists. |
| **inn** | Road frontage (travellers), courtyard for coaches, stabling | **No rule** | — | **Absent** | ⚠️ MEDIUM — the E2 site expansion (`expandSite`) provides stabling, but terrain/road siting is generic. |
| **townhouse** | Street frontage in town (burgage lot) | **No rule** | — | **Absent** | ✅ LOW — lot-based placement guarantees street frontage. |
| **cottage** | Arable soil nearby, flat-ish ground | **No rule** | — | **Absent** | ✅ LOW — generic buildability catches worst cases. |
| **tithe-barn** | Fields adjacency, cart access, settlement edge | **No rule** (catalogue-only, generative) | — | **Absent** | 🚨 MEDIUM — tithe barn at town centre is wrong. Needs edge/field affinity. |
| **granary** | Well-drained raised ground, near mill/bakehouse | **No rule** (catalogue-only, generative) | — | **Absent** | ⚠️ LOW — rarely placed yet. |
| **dovecote** | Manor adjacency, sunny south-facing wall, open approaches | **No rule** (catalogue-only, generative) | — | **Absent** | 🚨 MEDIUM — status structure; needs manor adjacency. |
| **stable** | Flat drained ground, near parent establishment | **No rule** (E2 auxiliary) | — | **Absent** | ✅ LOW — E2 adjacency constraints handle this. |

---

## C. Missing primitives

> What the terrain/hydrology/affordance layer cannot currently express, and what siting rules that blocks.

| Missing primitive | Blocks these siting rules | Rough cost to add | Status |
|---|---|---|---|
| **Flow direction as a general-purpose affordance** | "Place tannery/brewery downstream from settlement well" — currently only queried by mill-site-store and riparian-scatter internally | **Half-day** — `flowDirX/Y` already exist in `HydrologyResult`; just need a wrapper in `terrain-affordance.ts` | **EASY WIN** |
| **Prevailing wind direction (per-cell)** | Windmill siting (exposed high ground), tannery/dye-works downwind, smoke dispersal, crop exposure | **2–3 days** — new worldgen climate field (simplex + meta-wind bearing) + affordance wiring + tests | **MODERATE** |
| **Wind exposure (numeric, not just topographic)** | "Sheltered from wind" vs "exposed ridge" — currently approximated by `shelter` = `flatness × (1 − commanding)`, purely topographic | **1–2 days** — requires wind direction field + fetch/proximity-to-ridge computation | **MODERATE** |
| **Soil type / bedrock** | Foundation conditions, well-digging, mining, crop fertility, drainage class | **3–5 days** — new worldgen layer (stratigraphy: bedrock + soil depth + type) composited from elevation + climate + noise | **HIGH** |
| **Ore / mineral presence** | Mining settlements, smithy resource chains, trade goods | **4–8 days** — requires design (distribution model), generation, storage | **HIGH** |
| **Resource adjacency in site scoring** | "Score higher near water/forest/road/ore" — `scoreSite()` supports arbitrary `FitnessTerm[]` but no world-query helper exists | **1–2 days** — `resourcesNear(x, y, radius)` helper + wiring into `scoreSite` term list | **MODERATE** |
| **Building-aspect integration** | "Longhouse ridge perpendicular to prevailing wind", "shrine doorway faces sunrise" | **2–3 days** — connectome siteSelect and scoreSite orientation term | **MODERATE** |
| **Exposure as standalone number** | Separating topographic exposure from meteorological wind exposure | **1 day** — horizon-angle calculation in 8 directions, partially present as `commanding` | **LOW** |

### What DOES exist (free to use now)

| Primitive | Where | How to consume |
|-----------|-------|---------------|
| Height / Elevation | `heightfield.ts:heightMetresAt()` | `TerrainProbe.affordanceAt()` → `elevation` |
| Slope (0..1) | `terrain-affordance.ts` | `affordanceAt()` → `slope` (0..1, 45° = 1) |
| Aspect (downhill direction) | `terrain-affordance.ts` | `affordanceAt()` → `aspectX`, `aspectY` |
| Flatness | `terrain-affordance.ts` | `affordanceAt()` → `flatness` = 1 − slope |
| Water proximity (0..1) | `terrain-affordance.ts` | `affordanceAt()` → `water` (below-sea-level within 6 tiles) |
| Render water distance (signed) | `render-water.ts:getRenderWaterDist()` | Continuous signed distance to rendered water; NOT wired into site scoring |
| River reach class | `river-network.ts:classifyReach()` | Brook/stream/river/major_river via Strahler + flow |
| Strahler order | `hydrology.ts:hydro.strahler` | Per-cell stream order, 1 = headwater |
| Flow direction | `hydrology.ts:flowDirX/Y` | Unit vectors per river cell; NOT a general affordance |
| Flow magnitude | `hydrology.ts:flowField` | Accumulated rain units |
| River half-width | `river-network.ts:reachHalfWidths()` | Per-vertex channel half-widths |
| Prominence / Commanding | `terrain-affordance.ts` | 0..1 dominance: who can see you |
| Shelter | `terrain-affordance.ts` | 0..1 cosiness: flat + low + un-exposed |
| Sunny | `terrain-affordance.ts` / `site-fitness.ts` | 0..1 sunlit from aspect + slope |

### Key observation: **render-water distance is the single largest un-wired primitive**

`getRenderWaterDist()` (`render-water.ts:225`) is a signed distance function (tiles) to the rendered water surface, with bilinear sub-cell precision. It is used for nature-entity foot gating (`water-habitat.ts:canStandAtPoint`) and the settlement parcel model, but **it is NOT used by terrain-affordance.ts or site-fitness.ts**. The affordance layer has its own coarser heuristic (`below-sea-level within WATER_R=6`). Wiring `getRenderWaterDist` into `terrainAffordanceAt()` would instantly improve every water-proximity-based site check at zero new generation cost.

---

## D. The mechanism to add

### Design: a declared resource-requirement field on building presets, enforced in ONE shared location

The current architecture has three separate placement paths with three different constraint sets. The fix is a **declared requirement** on each preset that all three paths read from the same schema.

#### 1. Schema — extend `SiteRule` (or add `SiteConstraint`)

```ts
// New: hard site constraints expressed declaratively
interface SiteConstraint {
  /** Resource proximity (tiles). 'river', 'pond', 'water', 'pond-or-river'. */
  water?: { kind: 'river' | 'pond' | 'water' | 'pond-or-river'; maxDist: number };
  /** Terrain surface types the footprint must sit on */
  terrain?: string[];  // subset of BUILDABLE_TERRAIN
  /** Min site fitness (0..1) from the terrain affordance layer */
  minFitness?: number;
  /** Site profile for fitness calculation */
  profile?: SiteProfile;  // 'prominent' | 'humble'
  /** Downstream/downwind of another feature type (future) */
  downstreamOf?: string;  // feature/preset id
  /** Fire-setback: max distance from any timber building (negative = min distance) */
  fireSetback?: number;   // tiles
}

// Preset declaration — on the same record SITE_RULES lives in, but SEALED
// so runtime agents can register via the same open-registry pattern:
export const SITE_CONSTRAINTS: Record<string, SiteConstraint> = {
  watermill: { water: { kind: 'river', maxDist: 0 }, profile: 'humble' },
  dock:      { water: { kind: 'water', maxDist: 0 }, profile: 'humble' },
  fishery:   { water: { kind: 'pond', maxDist: 0 }, profile: 'humble' },
  smithy:    { fireSetback: 4, profile: 'humble' },
  bakehouse: { fireSetback: 4, profile: 'humble' },
  brewhouse: { water: { kind: 'water', maxDist: 3 }, profile: 'humble' },
  tower:     { profile: 'prominent', minFitness: 0.5 },
  'parish-church': { profile: 'prominent', minFitness: 0.35 },
  // ... existing nearWater entries migrate here
};
export function registerSiteConstraint(preset: string, c: SiteConstraint): void { … }
```

#### 2. Single enforcement point — `checkSiteConstraints()`

A pure function:

```ts
function checkSiteConstraints(
  constraints: SiteConstraint | undefined,
  tx: number, ty: number, w: number, h: number,
  ctx: { map: GameMap; world: World; terrain: TerrainProbe; … },
): { pass: boolean; reason?: string }
```

Called from:
- Worldgen `fitsAt()` (building-placer.ts) — *replace* the current `nearWater` inline check
- Growth `fitsInLot()` (settlement-growth-system.ts) — *add* where it currently has no site-rule check
- Fate `findBuildingPlacement()` (building-verbs.ts) — *add* a simplified surface check (terrain type + water proximity)

This guarantees that all three placement paths enforce the same requirements. The function is **hard** — returns `false` if any unmet constraint exists, no fallback. Belief that "every valid site is taken" should be handled at the settlement level (skip this building this tick), not by relaxing the constraint.

#### 3. Connectome contract — `lint:world` integration

Register a Contract at level `site`, kind `requirement`, that re-checks site constraints against every placed building:

```ts
registerContract({
  id: 'site.constraints-met',
  level: 'site',
  kind: 'requirement',
  severity: 'warn',    // not error — acceptable in edge cases
  description: 'Every placed building meets its declared SiteConstraint',
  evaluate: (ctx, scope) => { … },
});
```

This makes `npm run lint:world` catch regressions. A building that lost its water proximity due to post-hoc flooding would be flagged.

#### 4. Where it plugs in

| Hook | File | What to add |
|------|------|-----------|
| `SITE_CONSTRAINTS` definition | `settlement-plan.ts` (or its own `site-constraints.ts`) | New record + runtime registry |
| `SITE_RULES` → `SITE_CONSTRAINTS` migration | `settlement-plan.ts` | Merge nearWater + affinity into constraints; keep SITE_RULES for backward compat via a bridge |
| Worldgen `fitsAt()` | `building-placer.ts:700-727` | Replace `nearWater` inline check with `checkSiteConstraints()` call |
| Growth `fitsInLot()` | `settlement-growth-system.ts:155-182` | Add `checkSiteConstraints()` call after the terrain-type check |
| Fate `findBuildingPlacement()` | `building-verbs.ts:80-97` | Add `checkSiteConstraints()` call with simplified world-query surface |
| Render-water distance wiring | `terrain-affordance.ts` | Replace `below-sea-level WATER_R=6` heuristic with `getRenderWaterDist()` for continuous signed-distance water proximity |
| Connectome contract | `world/connectome-contracts.ts` | Register `site.constraints-met` contract |
| Mill pad float fix | `terrain-deformation.ts` | Ensure the settlement pad lift also lifts the water surface adjacent to the pad, or sink the wheel anchor below pad elevation |

---

## E. Ordered fix plan

> Ordered by **what the user sees first** (visual impact) ÷ **effort** (best value first).  
> Size: one-liner / half-day / multi-day.  
> Test pin needed? Save version bump needed?

### #1 — Add `nearWater` to SITE_RULES for smithy, bakehouse, brewhouse, inn

**What**: 4 one-line additions to `settlement-plan.ts:138-148`.  
**Files**: `src/world/settlement-plan.ts`.  
**Size**: **one-liners**.  
**Fixes**: Fire-risk trades avoid dry inland sites; water-intensive trades stay near water. Partially addresses the "smithy in the timber village core" problem.  
**Could break**: Nothing — these buildings currently have NO `nearWater` constraint, adding one only rejects invalid sites (which the spiral fallback already skips).  
**Test pin needed**: No. Worldgen seeds shift slightly (different building counts), but no contract violation.  
**Save version bump**: No.

### #2 — Add edge affinity for smithy, bakehouse, tower, castle_keep, guard_post

**What**: 5 one-line additions to `SITE_RULES`.  
**Files**: `src/world/settlement-plan.ts`.  
**Size**: **one-liners**.  
**Fixes**: Fire-risk trades drift to the settlement edge. Tower/keep drift to the edge first (frontage ordering), getting them out of the centre.  
**Could break**: Same as #1 — ordering changes, no rejections for edge-affine buildings.  
**Note**: Tower/keep really need prominent-site hard gate (#5), but edge affinity is a 90% improvement for zero architectural cost.

### #3 — Fix settlement pad float (mill wheel above water)

**What**: The mill's wheel dips into drawn water, but the settlement ground pad lifts the building ~0.12 m above base terrain while the water surface stays at base level.  
**Files**: `src/world/terrain-deformation.ts` (pad lift logic), `src/render/iso/iso-building.ts` (wheel emplacement).  
**Size**: **half-day**.  
**Fixes**: The **user-visible bug** — mill wheel above water. This is what the user reported.  
**Could break**: Other building on-pad placements shift relative to water (normally invisible — only the mill's protruding wheel exposes the gap).  
**Test pin needed**: Yes — building placement (especially mill wheel visual alignment) needs a pixel-level regression pin.  
**Save version bump**: No (visual only, not world state).

### #4 — Generalize `checkSiteConstraints()` for all 3 placement paths

**What**: Extract the new `checkSiteConstraints()` function (see §D) and call it from worldgen `fitsAt()`, growth `fitsInLot()`, and Fate `findBuildingPlacement()`.  
**Files**: New `src/world/site-constraints.ts`; edits to `building-placer.ts`, `settlement-growth-system.ts`, `building-verbs.ts`.  
**Size**: **multi-day** (< 1 week).  
**Fixes**: The **architectural gap** — three different placement paths with three different constraint sets. Once this exists, adding a new constraint for any building type automatically gates all three paths.  
**Could break**: Growth path currently doesn't check `nearWater`; adding it will reject some growth placements that previously succeeded. Fate path currently doesn't check terrain type at all; adding it will reject verb placements that worked before. Both are strict improvements, but may surprise developers used to the lenient paths.  
**Test pin needed**: Yes — integration tests verifying each path respects the same constraints.  
**Save version bump**: No.

### #5 — Wire render-water distance into terrain-affordance ts

**What**: Replace the coarse `below-sea-level WATER_R=6` heuristic in `terrainAffordanceAt()` with `getRenderWaterDist()` for the `water` affordance key. This gives every site-scored building continuous signed-distance water proximity.  
**Files**: `src/world/terrain-affordance.ts` (change the `water` field calculation), `src/world/render-water.ts` (already memoised).  
**Size**: **half-day**.  
**Fixes**: All site-fitness water-proximity checks improve in accuracy. Replaces the false-negative/positive from the below-sea-level heuristic (which misses lakes above sea level and flags ocean-deep cells at map edge).  
**Could break**: Terrain-affordance values change for every tile, shifting all site-fitness scores. Any test that pins affordance output must update.  
**Test pin needed**: Yes — `tests/unit/site-fitness.test.ts`, `tests/unit/terrain-affordance.test.ts`.  
**Save version bump**: No.

### #6 — Add hard prominence-rejection for Focus buildings

**What**: In `findCentralPlacement()`, reject sites below `minFitness` threshold for 'prominent' profile buildings (church, manor, tower when wired).  
**Files**: `src/world/building-placer.ts` (findCentralPlacement), `src/world/site-fitness.ts` (expose minFitness).  
**Size**: **half-day** (after #4 provides the constraint schema).  
**Fixes**: Church in a hollow, tower in a valley. These are the most visually obvious terrain-siting failures.  
**Could break**: A settlement whose centre sits in a valley might get no church (the focus is skipped). Rare — the spiral with `FOCUS_FITNESS_SLACK = 2` gives 2 extra rings to find a better site before rejecting.  
**Test pin needed**: Yes — `tests/unit/settlement-plan.test.ts`.  
**Save version bump**: No.

### #7 — Add `site.constraints-met` connectome contract

**What**: Register a `site`-level `requirement` contract that re-checks every placed building against `SITE_CONSTRAINTS`. Makes `npm run lint:world` catch regressions.  
**Files**: `src/world/connectome-contracts.ts` (register the contract).  
**Size**: **half-day** (after #4 provides `checkSiteConstraints`).  
**Fixes**: Catches post-hoc flooding that drowns a mill's wheel, or a growth/carve that removes a building's water proximity.  
**Could break**: The linter gains new warnings on worlds with edge-case placements.  
**Test pin needed**: Yes — `tests/unit/settlement-plan-s4.test.ts` or new contract tests.  
**Save version bump**: No.

### #8 — Add `flowDirX/Y` as a general terrain affordance

**What**: Expose `HydrologyResult.flowDirX/Y` through `terrainAffordanceAt()` as `flowDirX`, `flowDirY` affordance keys.  
**Files**: `src/world/terrain-affordance.ts` (add fields), `src/terrain/hydrology-store.ts` or similar (accessor for hydrology result).  
**Size**: **half-day**.  
**Fixes**: Unblocks "place downstream of X" rules currently impossible. Also enables mill-wheel face to derive from actual flow direction (currently static per blueprint).  
**Could break**: Affordance output changes (new keys added, existing keys unchanged). Consumers reading unknown keys defensively (which the typed `Record<string, unknown>` affordance contract already handles).  
**Test pin needed**: Yes — `tests/unit/terrain-affordance.test.ts`.  
**Save version bump**: No.

### #9 — Convert dock to flush-or-nothing

**What**: Reuse `flushFootprintForHint` from `settlement-plan.ts` for the dock (same pattern as mill/fishery), with `water: { kind: 'water', maxDist: 0 }` constraint.  
**Files**: `src/world/settlement-plan.ts` (planCivics dock branch or CIVIC_RULES.dock addition), `src/world/building-placer.ts`.  
**Size**: **one-liner** (register dock in CIVIC_RULES as `site: 'water'` with hydrology tag scan), or **half-day** if dock stays in SITE_RULES and gets a new constraint path.  
**Fixes**: Docks currently placed 1 tile inland from water.  
**Could break**: Settlements without a tagged water body within reach get no dock. This is correct behaviour.  
**Test pin needed**: Yes — `tests/unit/settlement-plan.test.ts`.  
**Save version bump**: No.

### #10 — Add prevailing wind field + windmill siting (longer-term)

**What**: A new worldgen climate field (simplex noise on a meta-wind bearing + fetch computation), `windExposure` affordance, and a `windmill` civic/preset with `{ water: { kind: 'river', maxDist: 0 }, minFitness: 0.6, profile: 'prominent' }` constraint.  
**Files**: Multiple — worldgen field, affordance layer, new preset, new SITE_CONSTRAINTS entry.  
**Size**: **multi-day** (3–5 days).  
**Fixes**: Windmills as a built feature (they don't exist in the catalogue yet). Unblocks downwind siting for tannery, dye-works, slaughterhouse.  
**Could break**: Wind-field generation changes world seed determinism. Needs careful test pinning.  
**Test pin needed**: Yes — golden world generation tests.  
**Save version bump**: Yes — worldgen field addition changes produced worlds.

---

## Verifier summary

| Measure | Count |
|---------|-------|
| Claims challenged | 24 |
| CONFIRMED | 22 |
| REFUTED | 0 |
| PARTIAL | 2 |
| UNVERIFIABLE | 0 |

**The two PARTIAL findings:**
- **C6**: `curveRenderElev` exists at `terrain-field.ts:111` but the gamma=1.8 is a world-style configuration, not a function default. The world-style type default is `terrainHeightGamma: 1` (linear). The pinned world uses 1.8. Not a material error in the scout's analysis — the visual divergence between render-space and raw heightfield still exists at gamma≠1.
- **D1**: `fitsInLot()` does check `BUILDABLE_TERRAIN` (growth path) but does NOT check `nearWater`. The scout was correct that the asymmetry exists; minor wording ambiguity was resolved.

---

*Report written 2026-08-10. Scout agents: `scout-a` (site-fitness abstraction), `scout-b` (catalogue enumeration), `scout-c` (terrain primitives), `scout-d` (runtime vs worldgen). Adversarial verifier: `reviewer`. Synthesis: parent orchestrator.*

---

## Verification pass (independent re-read, 2026-08-10)

This run *did* spawn scouts and a `reviewer` (22/24 confirmed, 0 refuted). Re-checked the three
load-bearing conclusions against source. **The thesis verdict holds; both proposed root causes do not.**

### CONFIRMED — the thesis reversal. The watermill is the best-constrained building in the codebase.
`mill-site-store.ts` is a hydrology-derived affordance layer: it tags dry, buildable bank cells
orthogonally adjacent to a wheel-scale reach (Strahler `MIN_ORDER 2`–`MAX_ORDER 6`, `:34-35`), carries a
`waterFace` cardinal and `flowDir`, and keys off the RENDER water memo (`buildRenderWaterTypeMemo`), not
raw tiles. It is genuinely consumed: `building-placer.ts:526` pulls hints near the settlement,
`settlement-plan.ts:848-856` seats the footprint **flush-or-nothing** ("a settlement off any such stream
simply gets no watermill — better than a wheel turning on dry grass"), and `building-placer.ts:613`
rotates the whole asset so the wheel faces the tagged flank. The `else` branch at `:864` is explicitly the
map-less legacy/test path. **The mill's XY siting is not the bug.**

### REFUTED — "settlement pad float bug", the report's #1 fix for the symptom the user sees
Three errors, and the sign is fatal:
1. **Wrong direction.** `settlement-deformation.ts:62` levels the pad to
   `sum / cells.length - SETTLE_DEPTH_M` — mean base grade **MINUS** 0.12 m. The doc comment at `:34-37`
   is unambiguous: *"How far a foundation settles BELOW the mean grade under it… The whole footprint
   drops by this."* The footprint is settled **down**, not lifted up. Acting on this fix would push mills
   further into the ground.
2. **Wrong file.** The constant is in `settlement-deformation.ts`, not `terrain-deformation.ts`.
3. **Magnitude ~10× off.** The report claims a ~21 px gap; the same doc comment computes it at
   *"~20 px/m vertical… a couple of pixels, felt more than seen"* — i.e. ≈2.4 px.

### REFUTED — "the connectome contract system is empty scaffolding (`CONTRACT_CONTRACTS = []`)"
That is the declaration of a **registry populated at import time**, not the final state.
`connectome-contracts.ts:96-98` defines `registerContract`, and **ten contracts register** from
`scaling-contracts.ts:207`, `road-contracts.ts:88,135`, `wall-contracts.ts:145-148`,
`defense-contracts.ts:368-370`. `map-generator.ts` carries bare side-effect imports (e.g.
`import '@/world/connectome/road-contracts'`) precisely to trigger this. `npm run lint:world` currently
reports 44 findings on main — impossible against an empty registry. **The contract system is live, and is
the correct home for new site rules**, exactly as the gate audit independently concluded.

### The actual remaining suspect for the user's symptom — the Z axis, which no report addressed
The mill is seated flush on a bank cell **in XY**. Nothing reconciles its **elevation** against the water
surface. By construction that bank cell is the lip of an incision: `REACH_CARVE`
(`river-deformation.ts:35-39`) cuts `brook` 1.0 m, `stream` 2.4 m, `river` 4.5 m, `major_river` 6.5 m. At
the ~20 px/m vertical quoted above, a mill correctly seated on a `stream` bank renders **≈48 px** above
the water, and on a `river` bank **≈90 px** — one to two orders of magnitude more than the pad effect the
report blamed, and a direct match for "far too high above water level". The settle pad does not help: it
levels to the mean grade *of the bank-top footprint*, which is still bank-top.

`settlement-deformation.ts:80-81` notes civic precincts (well/graveyard/**mill**) sit off the burgage
lots and "floated on [their] raw" grade before being padded — so a float problem here has been hit and
partially patched once already, in XY-pad terms rather than water-surface terms.

This is precisely the user's own diagnosis, and both fixes they proposed are the right shape: either
**notch the terrain** (extend the mill pad down toward the water line rather than to mean bank grade), or
**author a taller mill** whose entrance meets bank grade while the wheel and undercroft reach the water.
The second needs no worldgen determinism change and no save bump, so it is the cheaper first move.

**Not verified:** the report's building-by-building requirement matrix (section B) and the claim that
only 2 of ~20 types carry hard constraints. That part is plausible and matches the `wards`/`districts`
"declared but unconsumed" pattern found in the urban-form audit, but it was not spot-checked here.
