# Buildability Envelope — Spec

**Status:** spec (2026-06-27). No code yet. Deepens
`docs/superpowers/specs/2026-06-27-structural-parts-kit-brainstorm.md` §3½ (this is **Track T3 / slice
KE** of the structural-parts-kit). Sibling to `project-building-validity-situation` (the Tier-1 auto-fix
this reuses) and `project-grade-reconciliation-features` (the crossing/aqueduct placers this gates).

**User mandate (verbatim, 2026-06-27):**
> *"a connectome must limit what kinds of structures it spawns to technological and economic limits of
> current gameplay. that spreads into the whole connectome, too."*

---

## 1. Thesis

A society must build only what its **TECH** (era × aggregate believer understanding) and **ECONOMY**
(settlement wealth × labour × local resources) permit — and that ceiling must propagate through the
**entire connectome** (buildings, crossings/bridges, aqueducts, walls, roads), not one structure at a
time. The structural-parts-kit *creates* a rich vocabulary (pointed arches, stone aqueducts, vaulted
undercrofts); the **envelope decides who may use it**. This is the god-game progression made physical:
cultivating believer **understanding** literally *unlocks architecture*, and settlement **wealth/labour**
+ *local stone/timber* decides whether the unlocked thing can actually be afforded and supplied.

The envelope is a **pure, deterministic, sim-READ-only capability filter** resolved once per settlement,
then threaded as a predicate into every placer. It writes nothing, contains no `Math.random`, and adds
no new simulation — it is a *query* over state the sim already owns plus a small number of new
**read-only rollups** (flagged honestly below).

---

## 2. Code reality — what exists, what must be added

### 2.1 Tech axis sources

**Era — two layers exist, with a vocabulary divergence to reconcile.**

- **Canonical era** (`src/core/era.ts:11`): `ERAS = ['primordial','ancient','classical','medieval','current']`,
  `type Era`. Resolved per settlement by `resolveSettlementEra(poi, worldSeed)` (`src/core/era.ts:23`):
  `poi.era ?? worldSeed.era ?? 'medieval'`. `POI.era?` (`src/core/types.ts:90`) and `WorldSeed.era?`
  (`src/core/types.ts:121`) carry it. **This is the canonical tech baseline the envelope reads.**
- **Era profiles** (`src/blueprint/eras.ts:33`): `ERA_PROFILES: Record<Era, EraProfile>` already gates
  *materials* (walls/roof/ground), window style, `glazed`, vent per era. `eraPatch()` (`eras.ts:51`) and
  `eraWindowStyle()` (`eras.ts:44`) rewrite a blueprint to its era. **So the material half of era-gating
  already ships** — the envelope reuses `ERA_PROFILES` as its material baseline rather than reinventing it.
- **Roster gating** already era-aware: `presetsForEra(zoneRule, era)` (`src/map/poi-zones.ts:177`) returns
  `rule.buildingsByEra?.[era] ?? rule.buildings`; live growth uses it (`settlement-growth-system.ts:243`).
- **⚠ Divergence to reconcile:** the crossing producer uses its **own open-vocabulary era string** with a
  private `ERA_RANK` (`crossing-builder.ts:34`: `stone-age/neolithic/iron/early-medieval/medieval/late-medieval/renaissance`)
  — *not* the canonical `Era`. The envelope must map canonical `Era` → the crossing/aqueduct ordinal it
  expects (or, better, feed the envelope itself and stop passing raw era/prosperity strings). See §6 SE0.

**Believer understanding — modelled per NPC; NO per-settlement rollup exists.**

- `SpiritBelief { faith; understanding; devotion }` (all 0–1) (`src/core/types.ts:307`), stored per NPC as
  `beliefs: Record<SpiritId, SpiritBelief>` (`src/core/types.ts:466`); seeded with `understanding: 0.1`
  (`src/world/npc-helpers.ts:144`). `understanding` already gates whisper comprehension & prayer efficacy
  (Track 1).
- NPC→settlement membership: `NpcProperties.homePoiId?` (`src/core/types.ts:460`). The query pattern
  exists: `residentsByPoi(world)` (`settlement-growth-system.ts:82`) tallies NPCs by `homePoiId`.
- World-level belief aggregation exists — `aggregateDomain(world, spiritId, domain)`
  (`src/sim/belief-domains.ts:129`) returns `{ conviction, reach, believers }` over **all** living NPCs —
  but it is **global, not settlement-scoped**. **There is no per-settlement understanding rollup today.**
  → **MUST ADD** (SE1): `settlementUnderstanding(world, poiId, spiritId)` — a faith/devotion-weighted mean
  of residents' `understanding`, mirroring `aggregateDomain`'s weighting but filtered by `homePoiId`.

### 2.2 Economy axis sources

| Signal | Status | Reference |
|---|---|---|
| Settlement `size` (`small`–`huge`), `importance` (`low`–`critical`) | **EXISTS but static** (set at worldgen, never recomputed) | `src/core/types.ts:86-87` |
| Live population (labour proxy) | **EXISTS, live** | `residentsByPoi` `settlement-growth-system.ts:82` |
| Housing capacity (built dwelling sum) | **EXISTS, live** | `housingCapacityByPoi` `settlement-growth-system.ts:92`; `DWELLING_CAPACITY` `:42` |
| Expected-population baseline | **EXISTS** | `expectedPopulation(poi)` `src/world/road-evolution.ts:66` |
| Settlement **wealth** | **DOES NOT EXIST as a stored/derived signal.** `EnclosureCtx.wealth?: string` (`src/world/enclosure.ts:29`) is *consumed* by barrier applicability but **nothing computes it** | gap |
| **Local resources** (quarry/forest proximity) | **DOES NOT EXIST as a query.** Quarry/forest *entities* are planted by brushes (`src/world/brushes/quarry.ts`, `forest.ts`: `stone_block`/`boulder`/`ore_vein`, forest flora) but **no proximity/availability query links them to siting** | gap |

→ **MUST ADD** (SE2): a derived **`settlementEconomy`** scalar from signals that already exist —
`size`/`importance` (static baseline) blended with live `residentsByPoi` vs `expectedPopulation`
(a "thriving vs struggling" ratio) and built-structure count. This is a **read-only derivation**, not a
new stored field — it avoids the "wealth has no source" gap by *computing* wealth from live population +
static tier rather than inventing a persisted number.

→ **MUST ADD** (SE3): `localResources(poiId, world, map)` — a cached proximity scan (settlement radius)
counting `stone_block`/`boulder`/`ore_vein` entities (→ `stone` availability) and forest tiles/flora
(→ `timber` availability), plus biome-derived defaults (mountain ⇒ stone; forest ⇒ timber; plains ⇒
neither abundant). Pure read of existing entities/tiles.

### 2.3 Where placers choose structures/materials today (the threading points)

Every decision below is **deterministic, pure branch logic** — ideal for a predicate insert. Confirmed
file:line:

1. **Buildings** — `placeSettlement(...)` (`src/world/building-placer.ts:218`).
   - Roster: `const roster = presetsForEra(zoneRule, era)` (`:377`).
   - Focus presets committed at `:450-453` (`synthesizeBlueprint(presetName)` then place).
   - Fill presets committed at `:466-469`.
   - **Insert point:** after each `synthesizeBlueprint`, before placement — consult envelope, and on a
     miss **snap to the envelope-nearest legal preset/material** instead of skipping silently (§5).
2. **Crossings** — `buildCrossing(spec)` (`src/world/connectome/crossing-builder.ts:48`). Today picks
   between **dressed-stone arch** (`:58`, gate `era>=2 && pros>=1 && importance>=1`), **timber trestle**
   (`:75`, `era>=1 || pros>=1`), **log-plank footbridge** (`:81`, else). Driven by its own era/prosperity
   ordinals + road class — **no ford option exists today** (add `ford` as the sub-minimum tier).
   **Insert point:** an envelope predicate gates each branch; the cascade falls through to the
   envelope-legal floor (ford / log-plank).
3. **Aqueducts** —
   - **Demand gate already a hook:** `needsAqueduct?: (s) => boolean` consumed at
     `aqueduct-placement.ts:88,98`. The envelope supplies this predicate — *gating whether the aqueduct
     exists at all*.
   - **Channel material** `opts.material ?? 'stone'` (`aqueduct-structures.ts:103`).
   - **Elevated-run form** arcade-bay vs plain pier in `emitArcade` (`aqueduct-structures.ts:177-180`).
   **Insert point:** envelope drives `needsAqueduct`, supplies `material`, and adds `canBuildArcade?`.
4. **Walls/defence** — `selectSettlementEnclosure(buildingCount, ctx)` (`src/world/enclosure.ts:84`),
   already filters catalogue barrier types by `applies()` on `{eras, wealth, regions}` (`enclosure.ts:41`);
   `EnclosureCtx { era; wealth?; region? }` (`enclosure.ts:27`). Palisade vs town-wall gate lives in the
   catalogue `applicability` (`barrier-types.ts`). **Insert point:** pass the resolved envelope as the
   single source for `ctx.era`/`ctx.wealth` + an extra `buildabilityGate?(typeId, kind)` predicate.
5. **Roads** — surface tier in `deriveRoadState(input)` (`src/world/road-state.ts:106`): paved/cobble/
   gravel/dirt chosen from `construction = f(importance, eraTech, surfaceStone)` (`:116-127`).
   **Insert point:** add `surfaceEnvelope?(material, construction)` that **caps the paving ceiling** by
   economy (a poor village never cobbles) — falls back to `dirt`.

---

## 3. The `BuildabilityEnvelope` type

Resolved **once per settlement** (region-level is a future generalization; settlement is the unit today
because `homePoiId`/`POI` is the unit the sim already groups by). Lives in **`src/sim/`** so the
`no-random-in-sim` guard (`tests/unit/no-random-in-sim.test.ts` — scans `src/sim/` for `Math.random(`)
mechanically enforces its determinism.

```ts
// src/sim/buildability-envelope.ts  (NEW)

/** Ordered capability ladders — index = ascending sophistication. Snap-to-nearest walks these. */
export type StructureKind =      // crossings + infra, weakest→strongest
  | 'ford' | 'clapper' | 'timber_footbridge' | 'timber_trestle' | 'stone_arch_bridge'
  | 'aqueduct_trestle' | 'aqueduct_arcade';
export type ArchStyle = 'flat' | 'round' | 'segmental' | 'pointed' | 'horseshoe' | 'ogee';
export type RoadSurfaceTier = 'dirt' | 'gravel' | 'cobble' | 'paved';

export interface BuildabilityEnvelope {
  readonly poiId: string;
  readonly era: Era;                 // canonical core Era baseline (resolveSettlementEra)
  readonly tech: number;             // 0..1: era baseline ± aggregate believer understanding
  readonly economy: number;          // 0..1: size/importance × live population health × built mass
  readonly resources: ResourceAvail; // { stone: 0..1; timber: 0..1 }  (local availability)

  // ── derived allow-lists (membership = "permitted to build with") ──
  readonly materials:  ReadonlySet<MaterialId>;   // ∩ era roster ∩ local resource availability
  readonly finishes:   ReadonlySet<FinishId>;     // bare/daub early; limewash/ochre mid; polychrome/gilt rich+advanced
  readonly structures: ReadonlySet<StructureKind>;
  readonly archStyles: ReadonlySet<ArchStyle>;    // round/segmental earlier; pointed/ogee tech-gated
  readonly roadSurfaceCeiling: RoadSurfaceTier;   // economy caps the paving ceiling

  // ── engineering ceilings (scale with tech × economy) ──
  readonly maxSpanM:   number;       // longest clear span (gates aqueduct/bridge arch count & existence)
  readonly maxStoreys: number;       // building height
  readonly maxRiseM:   number;       // tallest single structure (towers, arcades)
}

export interface ResourceAvail { readonly stone: number; readonly timber: number; }

/** The minimal settlement descriptor resolveEnvelope needs (built by the caller from a POI). */
export interface SettlementRef {
  readonly poiId: string;
  readonly poi: POI;                 // for era / size / importance / region
  readonly spiritId: SpiritId;       // whose understanding gates tech (usually the focused god)
}

/**
 * PURE. Reads sim state (era, belief understanding, population, resources); writes NOTHING; no
 * Math.random. Deterministic in (settlement, world snapshot). Lives in src/sim/ so the determinism
 * guard enforces it. Cheap enough to call per settlement per worldgen/growth pass; memoize per poiId
 * within a single generation pass (see §7 perf).
 */
export function resolveEnvelope(s: SettlementRef, world: World, map?: MapView): BuildabilityEnvelope;
```

**Axis composition (deterministic, all in [0,1] unless noted):**

- `era` = `resolveSettlementEra(poi, worldSeed)` — canonical baseline (`src/core/era.ts:23`).
- `tech` = `eraBaseline(era)` (a fixed 0..1 per era, primordial→current = 0…1) **lifted/lowered** by
  `settlementUnderstanding(world, poiId, spiritId)` (NEW, SE1) within a bounded band
  (e.g. `clamp01(eraBaseline + 0.25*(understanding-0.5))`) — *a settlement of deep believers unlocks
  ambitious works a notch early; a backwater stays in timber.* Understanding **shifts**, never replaces,
  the era floor/ceiling (a primordial village can't build a cathedral no matter how devout).
- `economy` = blend of static `SIZE_LEVEL`/`IMPORTANCE_LEVEL` (`road-evolution.ts` tables) with the live
  `residentsByPoi / expectedPopulation` health ratio and built-structure mass (SE2). No persisted wealth
  field needed — it's derived.
- `resources` = `localResources(poiId, world, map)` (SE3).
- Allow-lists derive from `(era, tech, economy, resources)` via small fixed tables:
  `materials = ERA_PROFILES[era] materials ∪ tech-unlocked ∩ resource-available` (no local stone ⇒ drop
  dressed stone even if tech allows — the user's "no quarry ⇒ no ashlar"); `structures`/`archStyles`/
  ceilings from `(tech, economy)` thresholds.

---

## 4. How each placer consults it (capability predicate)

The envelope is resolved by the caller (worldgen / `settlement-growth-system` / connectome builders) and
threaded **down** as a predicate or as the struct itself. Two consult shapes:

- **Allow-list membership:** `envelope.structures.has('stone_arch_bridge')`,
  `envelope.materials.has('dressed_stone')`, `envelope.archStyles.has('pointed')`.
- **Ceiling check:** `spanM <= envelope.maxSpanM`, `storeys <= envelope.maxStoreys`.

Thread points (from §2.3), each a **small additive parameter**, no consumer rewrites:

| Placer | Signature change | Gate |
|---|---|---|
| `placeSettlement` `building-placer.ts:218` | accept `envelope: BuildabilityEnvelope` | filter `roster` (`:377`); on focus/fill miss (`:450`,`:466`) **snap** (§5) |
| `buildCrossing` `crossing-builder.ts:48` | `spec` gains resolved envelope (replaces raw era/prosperity strings) | each branch `:58/:75/:81` requires `structures.has(kind) && span≤maxSpanM`; floor = `ford` |
| `planAqueducts` `aqueduct-placement.ts:88` | supply `needsAqueduct = s => env(s).structures.has('aqueduct_*')` | gates existence at `:98` |
| `buildAqueductStructureEntities` `aqueduct-structures.ts:79` | `opts.material` from envelope; add `canBuildArcade?` | material `:103`; arcade vs pier `:177` |
| `selectSettlementEnclosure` `enclosure.ts:84` | feed `ctx` from envelope + `buildabilityGate?` | `applies()` `:41` + extra predicate |
| `deriveRoadState` `road-state.ts:106` | `input.surfaceEnvelope` | cap at `:120`, fall back `dirt` |

---

## 5. "Snap to envelope-nearest legal choice" auto-fix

When a placer's *desired* choice is out-of-envelope, it must **not** render the anachronism and must
**not** silently drop the structure — it **snaps to the nearest legal option along the ordered ladder**.
This is `project-building-validity-situation`'s **Tier-1 `validate<T>()`** generalized to the envelope:

```ts
/** Walk the ordered ladder downward from `desired` to the first envelope-legal entry. Pure. */
export function snapToEnvelope<T extends string>(
  desired: T, ladder: readonly T[], legal: ReadonlySet<T>,
): T | undefined;  // undefined ⇒ nothing legal ⇒ structure not built (e.g. no crossing → ford never legal is impossible: ford is the floor)
```

- **Materials** ladder: `dressed_stone > brick > rubble_stone > timber > wattle > thatch/hide` — an
  out-of-envelope `dressed_stone` snaps to the richest *legal* lower material; resource-gated so "no
  local stone" snaps a stone wall to timber.
- **Structures** ladder (crossings): `stone_arch_bridge > timber_trestle > timber_footbridge > clapper >
  ford`. A wide gap that the envelope can't span in stone snaps to a trestle, then to a ford even where an
  arch would geometrically fit — *"a low-tech/poor crossing is a ford even where an arch would fit."*
- **Arch styles:** `ogee/pointed > segmental > round > flat`.
- **Road surface:** capped at `roadSurfaceCeiling`.

Snapping is **deterministic** (ladders are fixed arrays; no RNG) and **logged via the existing
validation-fix channel** (Tier-1), not a new sim event — keeps the envelope write-free.

---

## 6. Slice sequence (each shippable, green, freeze-safe)

Each slice is independently testable. Slices SE0→SE3 progressively *enrich the axes*; placer wiring is
incremental (one placer per PR is fine once SE0 lands the predicate shape). **None touch assetgen / golden
hashes.** Worldgen *output* changes when structure choices change ⇒ bump `WORLD_CONTENT_VERSION`
(`src/core/content-version.ts`) on the first slice that alters placement, and clear stale autosave
(known gotcha: stale autosave masks worldgen).

| Slice | Adds | New sim rollups? | Notes |
|---|---|---|---|
| **SE0 — envelope from era only** | `BuildabilityEnvelope`, `resolveEnvelope` reading **only** `resolveSettlementEra`; allow-lists from `ERA_PROFILES` + fixed era→ceiling tables; `snapToEnvelope`; thread the **predicate shape** into all six placers (era-only behaviour ≈ today's era gates, proving the threading) | **No** — reuses `src/core/era.ts` + `ERA_PROFILES` | Cheapest; collapses crossing's private `ERA_RANK` onto canonical `Era`. Proves end-to-end threading with zero behaviour regression risk. |
| **SE1 — understanding aggregation** | `settlementUnderstanding(world, poiId, spiritId)` (faith/devotion-weighted mean of residents' `understanding`, filtered by `homePoiId`); lift `tech` within a bounded band | **Yes** — new read-only rollup (model on `aggregateDomain` `belief-domains.ts:129` + `residentsByPoi` `:82`) | The god-game payoff: cultivating understanding unlocks architecture a notch early. |
| **SE2 — economy/wealth** | `settlementEconomy(world, poi)` from `size`/`importance` × `residentsByPoi`/`expectedPopulation` health × built mass; drive `economy`, `roadSurfaceCeiling`, ceilings | **Yes** — new read-only derivation (no persisted field; composes existing live signals) | Closes the "wealth has no source" gap by *deriving* it. |
| **SE3 — local-resource availability** | `localResources(poiId, world, map)` proximity scan (stone_block/boulder/ore_vein + forest + biome default) → `resources`; intersect into `materials` (no quarry ⇒ no ashlar) | **Yes** — new read-only query over existing brush entities/tiles | Makes "a wealthy but stone-poor town builds big in timber" real. Cache per poiId per pass. |

Placer-wiring order within/after SE0 (independent PRs): crossings (clearest visible win) → aqueduct
demand gate (reuses existing `needsAqueduct` hook) → buildings (needs snap-to-nearest) → walls (mostly
catalogue) → roads (surface ceiling).

---

## 7. Tests & guardrails

**Determinism / no-write (hard requirements):**
- `resolveEnvelope` and all rollups live under `src/sim/` ⇒ `tests/unit/no-random-in-sim.test.ts`
  mechanically forbids `Math.random`. Add the file to that tree intentionally.
- **No-write test:** snapshot `world` (entities + belief) before `resolveEnvelope`, assert deep-equal
  after. The envelope is a pure query.
- **Determinism test:** same `(settlement, world)` → byte-identical envelope across repeated calls and
  across two independently-seeded-but-equal worlds.

**Behavioural (the core requirement):**
- **Poor/low-tech settlement:** `resolveEnvelope` for a primordial/struggling hamlet ⇒
  `!structures.has('aqueduct_arcade')`, `!structures.has('stone_arch_bridge')`,
  `!materials.has('dressed_stone')`, `roadSurfaceCeiling === 'dirt'`; a detected crossing there realizes a
  `ford`/log-plank, never an arch (assert via `buildCrossing` output node material).
- **Rich/high-tech settlement:** current-era, thriving, stone-rich ⇒ unlocks `stone_arch_bridge`,
  `aqueduct_arcade`, `dressed_stone`, `pointed` arch style; an aqueduct is *offered* (`needsAqueduct`
  true) and built in stone with arcades.
- **Understanding lever (SE1):** two settlements identical except aggregate `understanding` — the
  high-understanding one's `tech` is strictly higher and unlocks at least one structure the other can't
  (within the same era — proving understanding *shifts* the era floor, not replaces it).
- **Resource lever (SE3):** identical tech+economy, one with local stone and one without — the stone-poor
  one's `materials` excludes `dressed_stone`; a stone wall there snaps to timber (`snapToEnvelope`).
- **Snap auto-fix:** unit tests on `snapToEnvelope` over each ladder (desired-too-high → nearest legal;
  floor case; empty-legal case).

**Non-goals / guardrails:**
- **MUST NOT write sim state** — capability filter only; no new events, no belief mutation, no
  `World.updateEntity` from the envelope path.
- **No `Math.random`** anywhere in the envelope or its rollups (guard-enforced).
- **No assetgen / golden churn** — pure placement logic; `ART_RECIPE_VERSION` untouched.
- **No connectome fork** — gate the *existing* producers in place via the predicate; don't add a parallel
  path (consistent with the kit's "don't fork the connectome" guardrail).
- **Reconcile, don't duplicate, era vocabularies** — SE0 collapses crossing's private `ERA_RANK` onto the
  canonical `Era`; do not add a third era enum.

---

## 8. Open questions for implementation

1. **Whose understanding?** `SettlementRef.spiritId` — the focused player god, or a max/blend across all
   spirits competing for the settlement? (Rivals, Track 3, will care.) Spec assumes the player god for
   SE1; revisit when rivals land.
2. **Tech band width.** How far can understanding shift the era baseline — a notch (±0.25, proposed) or
   enough to cross an era boundary? Crossing a boundary risks "devout hamlet builds a cathedral"; keeping
   it sub-boundary preserves era as a hard floor. Proposed: sub-boundary.
3. **Economy derivation weights.** SE2 blends static tier vs live health vs built mass — exact weights are
   a tuning knob; start `0.5·tier + 0.3·healthRatio + 0.2·builtMass`, expose for tuning.
4. **Resource radius & caching.** SE3 proximity scan radius and whether it's computed once at worldgen
   (cheap, static) or live (responds to deforestation/quarrying — future). Proposed: worldgen-time cache
   keyed by poiId; recompute on time-skip catch-up only.
5. **Region vs settlement scope.** The mandate says "spreads into the whole connectome." A *crossing
   between two settlements* or a *trunk road* spans settlements — which envelope governs it? Proposed:
   max of the two endpoint envelopes (the richer endpoint can fund the better bridge); generalize to a
   region-level envelope later.
6. **Aqueduct existence vs the demand model.** `needsAqueduct` already encodes hydrological/population
   demand; the envelope ANDs a *capability* gate on top. Confirm the two compose cleanly (demand says
   "wants water"; envelope says "can build the works") rather than one masking the other.
```
