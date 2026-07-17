# Spike — M4 runtime POI creation (the castle)

**Date:** 2026-07-17 · **Status:** design spike (read-only investigation, no code)
**Spec:** [specs/2026-07-14-mortal-power-lord-castle-knights.md](specs/2026-07-14-mortal-power-lord-castle-knights.md) — M4, blocker 1
**Question:** what does a runtime-created POI (the castle) need to touch to be a first-class
citizen, and what is the cheapest honest path?

> **Answer in one line:** a snapshot-authoritative `RuntimePoiStore` (the causal-site W-G
> pattern, but permanent) whose entries are real `POI` records **projected into
> `map.worldSeed.pois`** with reconcile-on-restore, two terrain-inertness guards, and
> ownership tags on `map.earthworks`/`map.barrierRuns` so a scrub un-builds the castle.
> Most of the sim adopts a new poiId **automatically** — the systems key off NPC
> `homePoiId`, not the POI table.

---

## 1. Findings

### 1.1 The canonical POI list, and where it lives

There is no `state.pois` / `world.pois`. The single runtime POI table is
**`state.worldSeed.pois`** (aliased as `map.worldSeed.pois`):

- Type `POI` — `src/core/types.ts:135-161`; `WorldSeed.pois: POI[]` — `types.ts:192`.
- Finalized at boot: `bootstrap-world.ts:121-124` runs `planWorldLayout(ws)` and overwrites
  `ws.pois = layout.pois`. After that, **nothing in the game ever mutates it.**
- **Save:** persisted verbatim — `SaveFile.worldSeed` (`src/core/save-file.ts:47`, cloned at
  `:100`); `map.worldSeed` rides `SavedGameMap` too (`:36`). `SAVE_VERSION = 3` (`:20`).
- **Snapshot: NOT captured.** `Snapshot` (`src/core/snapshot.ts:19-73`) carries only
  POI-*keyed* derived state — `activeEvents` (:27), `forcedEvents` (:29), `lords` (:33),
  `statCohorts` (:72) — never the table itself. This is the scrub problem: a POI appended to
  `worldSeed.pois` at tick T would survive a scrub to T−1 unless something reconciles it.

### 1.2 Most of the sim discovers settlements from NPCs, not the POI table

This is the load-bearing surprise of the spike. The settlement-grade systems enumerate
poiIds by scanning the population:

| System | How it finds settlements | Adopts a new poiId? |
|---|---|---|
| `SettlementEventSystem` | scans NPCs' `homePoiId` every roll (`src/sim/systems/settlement-event-system.ts:190-194`) | **automatically**, the moment one NPC is homed there |
| `LordSystem` | scans nobles' `homePoiId` (`src/sim/systems/lord-system.ts:77-83`); succession checks `homePoiId === poiId` (`:65`) | **automatically** — home a noble at the castle and a seat appears |
| rival claims / `buildRivalSituation` | iterates `cohorts.keys()` (`src/sim/rival-claims.ts:107-145`); presence = `spirit.ai.settlements.includes(poiId)` (`:191-195`) | automatically once a cohort entry exists |
| cohorts | seeded **once at worldgen** from `worldSeed.pois` (`src/sim/cohorts.ts:404-423`); named-tier folding keys on `homePoiId` (`:461-469`) | needs an explicit `SettlementCohorts` for the statistical tier; named tier is automatic |
| `growSettlement` | iterates `map.settlementPlans` by `plan.poiId` (`settlement-growth-system.ts:227-262`), then `pois.find(p => p.id === plan.poiId)` (`:300`) | needs BOTH a `SettlementPlan` and a table entry |

The consumers that DO iterate/`find()` the POI table are the **directory** users — name,
position, markers:

- `perception-system.ts:91-99` — iterates cohorts, `pois.find` for the belief-reach anchor;
  **silently skips** a poiId missing from the table.
- Fate's name map — `fate-context.ts:76` (`poiName` from `state.worldSeed.pois`; a missing
  id degrades to the raw id string in the prompt).
- `game.ts` focus/fly-to/target resolution — `:522`, `:855-856`, `:977`
  (`case 'settlement'` → `pois.find(...)?.position ?? null` — a missing id makes the
  command target unresolvable), `nearestPoiId` `:1043-1053`.
- Minimap `src/ui/minimap-panel.ts:227-232`; POI overlay `src/render/map-layers.ts:126-145`
  (radius from `POI_ZONE_RULES[poi.type]`); LLM world summary `src/llm/world-summary.ts:16`.
- Zone roster at runtime: growth reads `getZoneRule(poi.type)` via `presetsForEra`
  (`settlement-growth-system.ts:309`) — and **`poi-zones.ts:96-104` already has a `castle`
  rule** (`castle_keep, manor, tower, guard_post`).

**The fragility pattern:** every `pois.find(p => p.id === poiId)` no-ops silently when a
keyed store (cohorts / lords / activeEvents) holds an id the table lacks. A runtime POI
that is not in the table is *half-alive*: it has events and a lord but no name, no map
marker, no focus target, no perception anchor. That is exactly the spec's "invisible to
every system" — more precisely, *visible to the sim, invisible to the player and to Fate's
prose.*

### 1.3 Fate's drift guard is per-wake, not boot-time — and mostly free

`buildFateContext` (`src/game/fate/fate-context.ts:296-340`) rebuilds `validPoiIds` on
**every wake** from live state: active-thread subjects (`:82`), the triggering flood's POI
(`:307`), live causal-site ids (`:311`). `validLordPoiIds` = currently seated lords
(`describeLordsForFate`, `:190-216`). Enforcement in `fate-tools.ts` is membership only
(`:559`, `:652`, `:662`, `:701`, `:845`).

⇒ **No Fate work is needed for the castle to become addressable.** Seat a lord there
(automatic, §1.2) and `set_lord_stance` validates; open a thread there and
`arm_staged_beat`/`nudge`/`force_next_event` validate. The only table-dependence is the
display name (`:76`).

### 1.4 The causal-site precedent — how close it gets, and where it stops

`src/world/causal-site.ts` is the shipped "place that isn't authored" pattern:
poiId-*compatible* ids (`causal:flood:NNNN`, `:191`), deterministic monotonic counter,
`serialize()/hydrate()` into the snapshot (`snapshot.ts:130`, `:215`) so **scrub/replay
reproduce them exactly** — the W-G pattern. Its header (`:12-15`) states the design choice:
*"deliberately NOT a `WorldSeed.POI` (those are immutable + authored)… so the rest of the
game can treat a causal site as a place for the three things that matter — identity, focus,
Fate addressing — without a schema change."*

But causal sites are **deliberately second-class**, gated by `isSiteId()`
(`fate-tools.ts:544-546`):
- soft/atmosphere beats only; `inject_npc` blocked on a site (`:562-564`);
- `nudge_event` / `force_next_event` dropped — "causal sites have no settlement event"
  (`:653`, `:663`);
- excluded from arc casts (`:742-743`) and from `author_building` (`:846`);
- invisible to zone rules, growth, cohorts, minimap markers, `nearestPoiId`.

Every one of those exclusions is a thing the castle **needs**. Extending causal sites to
full POI-hood means adding a settlement-shaped branch beside every `isSiteId` check *and*
teaching every `pois.find` directory consumer about a second store — strictly more work
than making the castle a real table entry. **The causal-site pattern to keep is the
snapshot-authoritative store; the id-outside-the-table part is what to discard.**

### 1.5 The terrain landmine: `castle` is NOT field-inert

`POI_INFLUENCES.castle = { elevation: { cap: 0.68, radius: 8 }, warp: 0.3 }`
(`src/terrain/poi-influence.ts:387`). The heightfield memo key includes every POI whose
type has an elevation influence (`poiHeightSignature`, `src/world/heightfield.ts:39-48`),
and `computeHeightfield` re-applies POI influences at runtime, recomputed-not-persisted
(`heightfield.ts:8-22`, ~10 render/hydrology call sites pass `map.worldSeed?.pois`).

⇒ Naively appending a `castle`-typed POI to `worldSeed.pois` **re-keys and recomputes the
base heightfield** — the ground moves under gen-time biome classification, hydrology,
roads, and every standing building near the site. A runtime POI must therefore be
**heightfield-inert by rule**, and the castle's terrain must come from the runtime-safe
channel that `placeComplexOnPatch` already uses: `map.earthworks` → the deformation store.
(`applyPoiInfluences` skips unknown types at `poi-influence.ts:431-432`, and
`FIELD_INERT_POI_TYPES` at `:412` shows "terrain-inert by design" is an existing concept.)

### 1.6 What `placeComplexOnPatch` already gets right — and the scrub hole

`placeComplexOnPatch` (`src/world/place-complex.ts:93-211`) commits:

- **earthworks** → `map.earthworks` (`:119-121`) — persisted (`types.ts:84-89`,
  `save-file.ts:91-95`), consumed by `buildEarthworkDeformations` inside
  `getWorldDeformationStore` (`src/world/road-deformation.ts:1035`);
- **ring barriers** → World entities via `placeBarrier` AND `map.barrierRuns` (`:126-135`) —
  both persisted;
- **keep/bailey/well** → blueprint World entities (`:164-208`) — captured in
  `Snapshot.entities`.

It correctly does **not** call `bumpTilesRev`: no `tile.type` changes; the GPU picks the
motte up through the deformation memo key (`road-deformation.ts:980-989` — the key folds in
`e{earthworks.length}`, `w{barrierFoundationCount}`, `d{ditchWallCount}`, so appending
earthworks/rings re-derives and re-uploads the composed heightfield with no extra hook).
Deterministic given `(centre, seed)`. Only caller: the studio (`site-studio.ts:292`).

**The scrub hole:** `restoreSnapshot` rebuilds the World from `snap.entities`
(`snapshot.ts:160-171`) — so a scrub to before the castle **removes the keep and the wall
entities** — but `map.earthworks` and `map.barrierRuns` are map-level state the snapshot
never touches. Result after scrub-back: a bare motte and ditch with wall *footings* carved
into the terrain and no wall on top. The repo already owns the fix pattern: post-snapshot
map mutations are reconciled on restore — `reconcileSettlementTiles` (`snapshot.ts:176`)
and the trample-grid reconcile (`:182-192`). Earthworks/barrierRuns need the same
treatment, which requires **provenance** (which runtime POI owns this earthwork/run).

### 1.7 Connectome and roads: no runtime topology path exists — and Fate will notice

- Road-graph topology is gen-only (`buildRoadGraph` at `map-generator.ts:449`);
  `road-evolution.ts` mutates edge *dynamics* only (`:247-256`); trample and growth carve
  **tiles** only (`trample.ts:157-220`, `settlement-growth-system.ts:326-368`), never
  nodes/edges.
- `gate.road-connected` is a lint **requirement** (`src/world/connectome/wall-contracts.ts:62,146,160`),
  and `describeWorldQualityForFate` runs `evaluateContracts({world, map})` **live on every
  Fate wake** (`fate-context.ts:236-246`). A runtime castle ring with an unwired gate is
  reported to Fate as a world-quality error, every wake, forever.
- Mitigation options are in §4 (slice S5) and §5 (open question 2). Desire lines give an
  *organic* answer for free: NPC/knight traffic to the castle deposits wear and promotes
  dirt trails (`trample.ts`), no roadGraph mutation needed — but trails do not satisfy the
  lint contract as written.
- Minor: `water-dynamics.ts:231-234` builds its POI-centre map (flood/`summon_storm`
  targets) once at init — a runtime castle isn't storm-targetable until that rebuilds.

### 1.8 Versioning

- **`WORLD_CONTENT_VERSION` (101): no bump.** It guards *worldgen output* determinism
  (`content-version.ts`, consumed only by `save-file.ts:98,136`); runtime POI creation
  changes nothing about generation.
- **`SAVE_VERSION` (3): no bump.** A new optional `Snapshot` field is the established
  backward-compatible move (`threads?`/`causalSites?`/`lords?` all shipped that way,
  `snapshot.ts:36-72`); absent field → empty store.
- The save persists `worldSeed` verbatim (`save-file.ts:100`) — projected runtime POIs will
  ride along; reconcile-on-restore makes that harmless (idempotent re-assert from the
  hydrated store).

---

## 2. Consumer map (condensed)

| Consumer | File:line | Reads | New runtime poiId works if… |
|---|---|---|---|
| settlement events | `settlement-event-system.ts:190-194` | NPC `homePoiId` | an NPC is homed there (automatic) |
| lords (M3) | `lord-system.ts:62-92`; snapshot `:110-113,170` | nobles' `homePoiId`; `world.lords` | a noble is homed there (automatic) |
| rivals | `rival-claims.ts:107-195` | `cohorts.keys()`, `ai.settlements` | a cohort entry exists |
| cohorts | `cohorts.ts:404-469`; snapshot `:134-137,230-231` | seeded at gen from table; folds by `homePoiId` | statistical tier explicitly seeded; named tier automatic |
| growth | `settlement-growth-system.ts:227-309` | `settlementPlans` + `pois.find` + `getZoneRule(poi.type)` | plan + table entry both exist |
| perception | `perception-system.ts:91-99` | `pois.find` for anchor position | **table entry** (else silently skipped) |
| Fate validity | `fate-context.ts:296-340`; `fate-tools.ts:559,652,662,701,845` | threads/lords/sites, per wake | free (membership is live-state-driven) |
| Fate naming | `fate-context.ts:76` | table | table entry (else raw id in prose) |
| focus / commands / nearest | `game.ts:522,855,977,1043-1053` | table (id + position) | **table entry** |
| minimap / overlay | `minimap-panel.ts:227-232`; `map-layers.ts:126-145` | table (position/type/name) | **table entry** |
| LLM world summary | `world-summary.ts:16` | table | table entry |
| heightfield / hydrology | `heightfield.ts:39-48,132-155`; ~10 render call sites | table, **elevation-influencing types only** | **must NOT see it** (`castle` has `cap` — §1.5) |
| worldgen (zones, plans, roads, rivals' initial territory) | `map-generator.ts`, `poi-layout.ts`, `road-graph.ts:158-170`, `bootstrap-world.ts:212-217` | table at gen | N/A — gen-only, never re-runs |
| save | `save-file.ts:47,91-100` | worldSeed + map verbatim | free |
| snapshot/scrub | `snapshot.ts:19-73,141-233` | keyed stores only, **not the table** | **needs the new store + reconcile** |

---

## 3. Decision

**Add a `RuntimePoiStore` — the causal-site snapshot pattern with permanent,
first-class-table semantics.**

Concretely:

1. **Store** (`src/world/runtime-poi.ts`, modeled on `causal-site.ts`): entries are full
   `POI` records plus provenance `{ bornTick, cause, complexTypeId }`; ids from a
   deterministic counter (`castle:0001` — must NOT match `isSiteId`'s `causal:` prefix);
   `serialize()/hydrate()`; snapshot gains optional `runtimePois?` (capture beside
   `causalSites` at `snapshot.ts:130`, restore beside `:215`).
2. **Projection, not reader migration:** on add AND on every restore, reconcile
   `map.worldSeed.pois` to be *authored ∪ store entries* (add missing, remove orphans —
   marked `runtime: true` on the `POI` type). Every directory consumer in §2 — perception,
   naming, focus, minimap, zone roster, world summary — works **unchanged**. The
   alternative (a merged `poisOf()` accessor + migrating ~20 call sites) trades two guard
   lines for twenty silent-no-op hazards; rejected.
3. **Terrain-inertness rule (the two guard lines):** `poiHeightSignature`
   (`heightfield.ts:39-48`) and `applyPoiInfluences` (`poi-influence.ts:431`) skip
   `runtime: true` POIs. Pin test: adding a runtime castle changes neither the heightfield
   memo key nor the returned array identity. The castle's terrain is earthworks — the
   channel `placeComplexOnPatch` already writes, which is deformation-keyed, save-persisted,
   and needs no `bumpTilesRev`.
4. **Provenance on the physical stamp:** tag the earthworks and barrier runs the castle
   commits with `ownerPoiId`; a new reconcile step in `restoreSnapshot` (beside
   `reconcileSettlementTiles`, `snapshot.ts:176`) drops entries whose owner is absent from
   the restored store. The deformation memo re-keys automatically (counts change).
5. **Creation is a sim-tick command** (capability-registry verb, e.g. `found_castle`,
   registered `implemented: true` — the story-pack scar), fed by `ctx.rng`, so replay from
   a snapshot reproduces the same castle. `siteSelect` + `DEFENSIVE_SITE_WEIGHTS`
   (`src/blueprint/connectome/earthworks.ts:142,226-244`) finally get their N candidates.

**Why not extend causal sites?** They are engineered to be transient and second-class
(§1.4); the castle needs the exact settlement behaviours the `isSiteId` branches deny. The
store/snapshot half of the pattern is what we reuse.

**Why not "just push into `worldSeed.pois` and snapshot the array"?** No provenance for
reconciling the physical stamp; snapshotting the whole authored table ×40 ring slots is
waste; and it erases the authored/emergent boundary the causal-site header documents.
Projection keeps `worldSeed.pois` as the *directory* while the store stays the *truth* for
runtime entries.

---

## 4. Slice plan

**S1 — `RuntimePoiStore` + snapshot + projection** *(no castle yet; low risk)*
Store, `runtime: true` on `POI`, `Snapshot.runtimePois?`, projection/reconcile of
`map.worldSeed.pois`, the two terrain guards.
Tests: serialize/hydrate round-trip; scrub-back un-exists a runtime POI (projection
removed, directory consumers stop seeing it); save/load round-trip incl. a save whose
`worldSeed` carries stale projections; heightfield inertness pin (memo key + array identity
unchanged when a runtime `castle` POI is added); id-counter monotonicity across restore.

**S2 — Ownership-tagged physical stamp + restore reconcile** *(⚠ the risky one)*
`foundCastle(world, map, state, opts)` wrapping `placeComplexOnPatch`; `ownerPoiId` on the
earthworks/barrier-run records it appends; reconcile in `restoreSnapshot` beside `:176`.
Tests: scrub to before foundation leaves zero orphaned earthworks/runs and the composed
heightfield byte-matches the pre-castle field; scrub to after restores motte + rings +
entities coherently; barrier *entities* (snapshot) and barrier *runs* (reconcile) never
diverge (ghost-wall / floating-footing check); save→load→scrub combined path.
**Risk:** this is the first time map-level terrain state is scrubbed; the
entity-vs-map dual representation of barriers is the likeliest divergence point, and the
deformation rebuild after removal has never been exercised in the removal direction.

**S3 — Sim adoption** *(medium)*
Home the garrison (`homePoiId` = castle id) → settlement events + LordSystem seat arrive
automatically (§1.2); seed a `SettlementCohorts` entry if the statistical tier should exist
from day one (spec's cohort double-accounting warning applies).
Tests: event system rolls events at the castle; a noble homed there is crowned within a
game hour; `set_lord_stance` validates for the castle id on the next Fate wake; perception
anchors on the projected entry.

**S4 — The `found_castle` verb + trigger** *(medium; determinism-sensitive)*
Capability-registry verb (`implemented: true`), command-channel dispatch, deterministic
trigger from M3 `LordState` (e.g. `keepTier` crossing a wealth threshold) and/or a Fate
tool. `siteSelect` over N hilltop candidates derived deterministically from the lord's
settlement neighbourhood.
Tests: replay determinism (same snapshot + same tick stream ⇒ identical castle id, site,
geometry); rejection paths (no viable site) leave no partial state.

**S5 — Roads, growth, and the lint contract** *(scoped-down on purpose)*
`keepProximity` term through `scoreSite`/`fitnessAt` (the spec's zero-structural-change
claim, `settlement-plan.ts:989` / `settlement-growth-system.ts:519`); rely on desire-line
trails for organic castle access; decide the `gate.road-connected` story (open question 2)
— cheapest honest v1 is exempting runtime complex rings from the requirement with an
explicit contract note, since NO runtime road-topology path exists today and inventing one
is its own epic.
Tests: growth cost shifts measurably toward the keep; Fate's world-quality digest stays
clean after a castle is founded.

Deliberately **out of scope** (spec blocker 2, its own decision): replacing the bare 28-gon
ring with `deriveSettlementRing`'s terrain-seeking geometry. S1–S5 are correct with either
wall system.

---

## 5. Open questions for the user

1. **Terrain shelf:** gen-time castles get a `cap: 0.68` ground-easing; a runtime castle
   cannot (heightfield-inert rule). Is motte + earthworks on a `siteSelect`-chosen natural
   hilltop enough, or does M4 want an additional earthwork "terrace" primitive to flatten
   the bailey?
2. **`gate.road-connected`:** exempt runtime complex rings from the contract (v1,
   recommended), or build the game's first runtime road-graph mutation (a spur from the
   nearest road node to the castle gate)? The latter is real scope: `roadGraph` topology is
   currently immutable post-gen by design, and tile carve + deformation + connectome
   projection all key on `graph.rev`.
3. **Population at foundation:** named garrison only (events/lord work immediately), or
   also seed a statistical cohort band? The spec's double-accounting warning says whichever
   we choose must be consistent with how tithe/extraction effects are applied.
4. **Growth at the castle itself:** does the castle POI get its own `SettlementPlan`
   (bailey lots, real growth), or is growth exclusively the *neighbouring village*
   accreting under `keepProximity` (spec's Norman mechanism)? The latter is cheaper and
   more on-theme.
5. **Studio interplay:** the Site studio calls `placeComplexOnPatch` directly
   (`site-studio.ts:292`) without a POI. Should the studio path stay POI-less (pure
   geometry harness), or adopt `foundCastle` so studio placements are scrub-safe too?
6. **Id surface:** `castle:0001` keeps `isSiteId()` false and reads well in Fate prose.
   Any preference for a scheme that encodes the founder (`castle:ironvein:0001`)?

---

## 6. File index (everything cited)

`src/core/types.ts:135-161,192` · `src/core/snapshot.ts:19-233` · `src/core/save-file.ts:20,36-52,91-148` ·
`src/core/content-version.ts:110` · `src/core/tile-rev.ts:9-15` ·
`src/world/causal-site.ts` (whole file; esp. `:12-20,102-134,191,264-282`) ·
`src/world/place-complex.ts:93-211` · `src/world/heightfield.ts:8-48,132-155,229` ·
`src/world/road-deformation.ts:980-1054` · `src/world/terrain-deformation.ts:108-144` ·
`src/world/perception-system.ts:91-99` · `src/world/connectome/wall-contracts.ts:62,145-160` ·
`src/blueprint/connectome/earthworks.ts:142-146,226-244` ·
`src/terrain/poi-influence.ts:301-431` (castle `:387`; inert-types `:412`) ·
`src/map/poi-zones.ts:36-166` (castle rule `:96-104`) · `src/map/map-generator.ts:194-196,338-395,449` ·
`src/sim/systems/settlement-event-system.ts:85,160-236` · `src/sim/systems/lord-system.ts:62-92` ·
`src/sim/systems/settlement-growth-system.ts:109-137,220-334,368,472,519` ·
`src/sim/systems/road-evolution-system.ts` / `src/world/road-evolution.ts:244-256` ·
`src/sim/cohorts.ts:89-132,244-276,404-469` · `src/sim/rival-claims.ts:107-195,237,276` ·
`src/sim/trample.ts:157-220` · `src/sim/lord.ts:31,73-139` ·
`src/game/fate/fate-context.ts:73-92,219-246,296-340` ·
`src/game/fate/fate-tools.ts:544-546,559-564,591,637,652-663,701,740-743,845-846` ·
`src/game/fate/fate-brain-service.ts:58-61` · `src/game/bootstrap-world.ts:121-124,212-217` ·
`src/game.ts:522,855-856,977,1043-1053` · `src/ui/minimap-panel.ts:227-232` ·
`src/render/map-layers.ts:126-145` · `src/render/gpu/water-dynamics.ts:199,231-234` ·
`src/llm/world-summary.ts:16` · `src/studio/site-studio.ts:285-292`

---

## 7. Decisions (2026-07-17, session call — "you choose")

1. **Terrain shelf:** natural hilltop (`siteSelect` + `DEFENSIVE_SITE_WEIGHTS`) + motte/earthworks
   is enough for v1. No terrace primitive until a rendered castle proves it's needed.
2. **`gate.road-connected`:** EXEMPT runtime complex rings, with an explicit contract note.
   Desire-line trample is the organic access story. Runtime road-graph mutation = its own epic, later.
3. **Population at foundation:** named garrison only. No cohort entry ⇒ no statistical tier to
   double-account (vacuously consistent); rival-claims keying off `cohorts.keys()` means a fresh
   castle isn't rival-claimable — acceptable and on-theme. Seed a band only if the bailey grows.
4. **Growth:** no castle `SettlementPlan`. The neighbouring village accretes under `keepProximity`
   (the spec's Norman mechanism).
5. **Studio:** stays POI-less (pure geometry harness); the game path is the single POI creator.
6. **Ids:** plain `castle:0001`; founder/cause live in store provenance, not the id.

Slicing: S1+S2 land together (store+projection+guards are only honest with the scrub reconcile);
S3–S5 follow.

---

## 8. S1+S2 reality check (2026-07-17, implementation session)

**Both slices SHIPPED as one wave** — `src/world/runtime-poi.ts` (store + `projectRuntimePois`
+ `reconcileRuntimePoiStamps`), `src/world/found-castle.ts` (`foundCastle`), guards in
`heightfield.ts`/`poi-influence.ts`, `Snapshot.runtimePois?` + restore reconcile in
`snapshot.ts`, `POI.runtime` / `Earthwork.ownerPoiId` / `PlacedBarrier.ownerPoiId`,
`PlaceComplexOpts.idPrefix`. Tests: `tests/unit/runtime-poi.test.ts` (12) +
`tests/unit/found-castle-scrub.test.ts` (3). No SAVE_VERSION / WORLD_CONTENT_VERSION bump,
as designed (§1.8). Deviations + findings vs the plan:

1. **The store carries the physical stamp, not just tags.** The plan said "ownership tags +
   reconcile drops orphans" — but the snapshot never captures `map.earthworks`/`barrierRuns`,
   so the *re-add* direction (scrub FORWARD to a snapshot where the castle exists, taken
   after a scrub-back removed the stamps) had no data source. Fix: `RuntimePoiEntry` records
   the owned earthworks + runs, and the reconcile is a full re-derivation — drop every
   `ownerPoiId`-tagged map entry, re-append from the live store entries. Idempotent, and the
   forward direction is byte-consistent by construction (pinned by test).
2. **The removal-direction deformation rebuild works** — but the memoized path alone can't
   prove it: after a scrub-back the memo key RETURNS to the pre-castle key (`e`/`w`/`d`
   counts revert), so `getComposedHeightfield` serves the cached pre-castle field — a pass
   that would also pass with broken producers. The test therefore composes UNMEMOIZED
   (fresh `DeformationStore` from the map arrays, `heightAt` per tile) on both sides;
   removal byte-matches pre-castle, forward byte-matches post-castle. Both paths asserted.
3. **The count-keyed memo is a latent collision hazard, not a current bug:** the key folds
   in *counts* (`earthworks.length`, foundation/ditch counts), so two different same-count
   stamp sets share a key. Today unreachable (deterministic replay recreates identical
   stamps; one writer). If S4 ever allows divergent re-rolls at equal counts, fold an
   owned-stamp signature into `road-deformation.ts:key()`.
4. **Both worldSeed clones must be projected.** On the load path `state.worldSeed` and
   `state.map.worldSeed` are DISTINCT `structuredClone`s (`save-file.ts:142-143`) —
   projecting only one leaves half the directory consumers blind. `projectRuntimePois`
   takes the seed list; restore + foundCastle pass both. Pinned by the save→load→scrub test.
5. **`placeComplexOnPatch` has no rejection path of its own** — it commits rings/buildings
   even when `placed === null`. `foundCastle` rolls those back (entities + runs) so a failed
   siting leaves no partial state; the id counter deliberately does NOT rewind (uniqueness
   over prettiness; allocation is by call order so replay determinism holds). Untested in
   anger — no deterministic way to make `siteComplex` reject on the harness map; S4's
   candidate-siting work should add that fixture.
6. **`idPrefix` keeps the studio byte-identical** (absent → legacy bare ids) while castle
   entities mint under `castle:0001:` so two same-type complexes never collide.
7. Confirmed no `bumpTilesRev` needed anywhere in the wave — nothing writes `tile.type`;
   the ground moves purely through the deformation channel, and scrub repaint rides the
   memo re-key.

**S3 note for the next agent:** the garrison homing (`homePoiId = castle id`) needs NO store
changes; perception's anchor works off the projection already. The `water-dynamics.ts`
POI-centre map (§1.7 minor) is still init-time-only — a runtime castle is not storm-targetable
until that rebuilds. *(Closed in S3 below.)*

---

## 9. S3+S4+S5 reality check (2026-07-17, implementation session)

**All three slices SHIPPED.** S3: `tests/unit/castle-sim-adoption.test.ts` (3) + the
`water-dynamics.ts` live fallback. S4: `found_castle` in `src/sim/command/castle-verbs.ts`
+ `chooseCastleSite` in `found-castle.ts` + `CommandCtx.state` + the owned-stamp memo key in
`road-deformation.ts` + `castle_founded` event/chronicler; `tests/unit/found-castle-verb.test.ts`
(4). S5: ring-contract exemption in `wall-contracts.ts`/`defense-contracts.ts`;
`tests/unit/castle-lint-trample.test.ts` (2). Deviations + findings vs the plan:

1. **S4 TIER RESOLUTION: `found_castle` is AUTHORING-tier, not divine.** The castle is
   mortal power made concrete — the precondition requires a SEATED LORD at the target
   settlement (the mortal actor; VISION tenet 9, and M3's rule that a lord never enters
   the belief table), so a god cannot buy a castle with belief-power. Like
   `set_lord_stance`, the verb is how Fate/dev coaching triggers the lord's act. Side
   effect of the tier: the player's divine affordance surfaces (`affordancesForTarget`
   filters `tier === 'divine'`) never show it — NO hover/powers-panel pin changes; only
   the registry count pin moved (28 → 29, same commit).
2. **S3 was almost pure verification, as predicted (§1.2).** Events (forced-event path),
   the LordSystem seat + garrison headcount, Fate's drift guard (`describeLordsForFate`
   names the PROJECTED display name), and the M6 `proclaim_peace` (the castle's lord and
   his men swear) all adopted the castle with zero system changes — the one production
   change was `WaterDynamics.floodPoi` falling back to the LIVE directory on a poiPos
   miss (runtime hits deliberately uncached: a scrub can un-found the place; a stale
   cache would flood a ghost site). Perception's statistical anchor was proven WITH its
   fragility control: the same cohort keyed by an unprojected id realizes nothing.
3. **The §8.3 count-key collision became REACHABLE and was closed.** The verb makes the
   scrub + re-roll flow real: scrub back (counts revert), re-issue `found_castle`, and
   siteSelect can land a SAME-count stamp set at a different site — the old count-only
   key would serve the first castle's composed heightfield for the second's map.
   `road-deformation.ts:key()` now folds an `ownedStampSignature` (ownerPoiId + kind +
   placement + height over owned earthworks/runs); '' when none exist, so every pre-M4
   world keys byte-identically. Pinned by a test that asserts the collision precondition
   (identical ids AND counts, different sites) before asserting distinct fields.
4. **Siting needed an INTERIOR land filter, found by linting, not by eye.** The first
   candidate filter sampled only the site centre + outer-ring circle; probing showed a
   wet-interior site commits `barrier.over-water` / `building.on-water` /
   `claims.unresolved` ERRORS (9 on the probe seed — the S2 harness's lowest-cell siting
   stands in a river). `chooseCastleSite` now samples three radii (curtain, bailey arc,
   yard; 16 bearings each). The S5 lint test runs the VERB's siting seam and pins
   evaluateContracts to zero new errors — the honest claim is "the game path stays
   clean", not "any hand-placed site does".
5. **Candidate-lattice geometry has a real map-size floor:** margin = outer ring + 2 and
   min distance = outer ring + 6 mean a 64² map cannot hold a castle sited off a central
   town at all (the verb declines cleanly). Tests use 96²; real worlds are ≥256². The
   lattice is 3 distance bands × 16 bearings off the founding POI, land-filtered, scored
   by `siteSelect` + `DEFENSIVE_SITE_WEIGHTS` with `purpose: 'subdue-town'` and the
   settlement as the strategic target — siteSelect finally argmaxes over real candidates.
   The probe supplies `height` only (steepFlanks/water/commanding read 0 via
   `readAffordance` defaults) — enriching the probe is future siting-quality work.
6. **`CommandCtx` grew an optional `state`** (injected by `CommandExecutorSystem` like
   `weather`; bus/query/controller preview ctxs pass it) because `found_castle`'s effect
   lives beyond the World: `state.runtimePois` + BOTH worldSeed clones. Preconditions
   degrade gracefully without it (the one-castle-per-seat gate re-checks in the apply).
   One castle per seat rides provenance (`foundedFromPoiId`, new optional field).
7. **Garrison = rehoming, never spawning (§7 Decision 3):** the lord + up to 4 resident
   soldiers (sorted ids, deterministic) flip `homePoiId`/`homeX/homeY` to the castle;
   movement walks them there. No cohort band seeded — a fresh castle is not
   rival-claimable (`cohorts.keys()`), accepted and on-theme. No automatic trigger
   shipped: the deterministic keepTier/wealth trigger and a Fate tool exposure are
   Fate-depth work (the verb is drift-guard-ready — a castle seat enters
   `validLordPoiIds` automatically once its lord is crowned).
8. **S5 exemption is belt-and-braces by construction:** runtime rings never receive
   contract declarations today (declaration builders run at worldgen only), so the
   `ownerPoiId` skip in `settlementRingContracts`/`defenseRingContracts` guards the
   future re-declaration pass, and the lint test additionally pins castle ring ids out
   of Fate's world-quality digest. Desire lines verified: castle-approach soft ground
   promotes to dirt under garrison footfall with `roadGraph.rev` untouched.
9. **`keepProximity` does NOT exist in src** (spec M4's "zero structural change" claim is
   about how it WOULD flow through `scoreSite`/`fitnessAt`) — the neighbouring-village
   accretion weight (§7 Decision 4's growth half) is the spec's NEXT step, not S5's
   shipped scope. Documented deferral, matching the prompt's else-branch.
10. No SAVE_VERSION / WORLD_CONTENT_VERSION bump anywhere in the wave (§1.8 reasoning
    unchanged: nothing about generation changed; snapshot fields stay optional).
