# Brainstorm + Spec — Road-wear economy: usage-statistical road formation and crossing upgrades

**Date:** 2026-07-17 · **Status:** spec (brainstorm folded in, §1)
**Builds on (read these first):** `src/sim/trample.ts` + `src/sim/systems/trample-system.ts` (desire lines), `src/world/road-graph.ts` (RoadClass, static `classForConnection`), `src/world/road-evolution.ts` (the per-year condition/wear/overgrowth economy — the money model already exists), `src/world/connectome/crossing-structures.ts` + `src/blueprint/presets/bridges.ts` (crossing tiers as parametric blueprints, picked ONCE at gen), `src/world/runtime-poi.ts` (M4 — THE precedent for runtime structure change), `src/world/connectome/road-contracts.ts` (lint contracts + the runtime-exemption precedent).

> **Thesis:** the road network should be a *record of use*, not a decree of worldgen. One
> statistic — sustained traffic weighted by the wealth of the places it joins — drives the whole
> ladder from "no path" → trail → path → track → road → king's highway, **and the same statistic
> drives crossings**: a seldom-used path gets a strategically placed log over the stream; more
> use and more wealth buy planks, then a railed bridge, then real foundations. Nothing is
> hand-placed on this ladder. Everything falls out of the connectome's usage economy.

**Cost: $0.** Sim + parametric geometry only. The img2img spend gate stays OFF (new bridge tiers
render as grey massing like everything else until a funded reseed).

---

## 1 · Brainstorm — what the shipped systems already give us, and the one seam that's missing

Walk the ladder and notice how much already exists:

| Rung | Shipped mechanism | What's missing |
|---|---|---|
| no path → **trail** | `TrampleGrid` (3 Hz deposit + spill, 0.25 Hz promote/decay, PROMOTE_HI/REVERT_LO hysteresis) — emergent, deterministic, snapshot-riding | nothing; this rung is done |
| trail → **path** (a real graph edge) | — | **the adoption seam**: trample deliberately caps at `dirt` ("Trails are ground wear, not roads", `trample.ts` header). Nothing ever converts a sustained corridor into a `RoadEdge`. |
| path → track → road → **highway** | `RoadClass` exists on every edge; carve width, grade envelope, surface, deck width all already *key on class* (`road-state.ts`, `DECK_WIDTH_T`) | class is assigned ONCE at gen from endpoint importance/size (`classForConnection`) and never moves again |
| condition / decay / overgrowth | `road-evolution.ts` — per-year, vitality-driven (live residents vs expected), climate-aware, time-skip-composable, `evolvedAtTick` on the graph | it moves *condition within* a class, never the class itself |
| crossing tiers | `bridgeClassFor(env)` already ladders log-plank → timber-beam → timber-arch → dressed-stone from era/economy/road-rank; `BRIDGE_RECIPES` has the massing for every tier | the tier is computed ONCE at world build and frozen into a static entity |
| runtime structure change | `RuntimePoiStore` (M4): snapshot-authoritative store, owned physical stamps, reconcile both directions on every restore | crossings need to become the **second consumer** of this pattern |

So the epic is not "build a road economy" — the economy is 80% shipped. The epic is **one new
statistic and three conversions**:

1. a per-edge **use** statistic (traffic integral × endpoint vitality/wealth) that both ladders read;
2. class transitions ON the existing year-scale evolution pass;
3. crossing tier re-realization at runtime (RuntimePoiStore pattern);
4. the deep one — **adoption**: trample corridor → real `RoadEdge` (the explicit renegotiation of
   the trample guardrail, and the only slice that touches graph topology).

**Key framing decision (brainstormed, resolved):** the trample system and the road-wear economy
stay **two systems at two timescales** joined by one explicit seam, not one merged system.
Trample is real-time ground wear (its deposit/decay equilibrium is deliberately real-time tuned —
see the 1:1-realtime note in `trample-system.ts`; re-keying it would shift the balance ~250,000:1).
The road economy is a fiction-year process. Merging them was considered and rejected: the trample
grid answers "where do feet fall *this hour*", the edge economy answers "what has this route
*earned* over years". The adoption seam is where a persistent answer to the first question is
promoted into the second — once, explicitly, with a graph edit — after which the corridor is
roads' business and trample's opt-out-by-terrain rule (roads never take wear) applies as today.

**Guardrail renegotiation, stated plainly:** `trample.ts`'s "a trail caps at `dirt`, it NEVER
produces road-class tiles, so it can never feed the road graph / roads-lead-to-gates lint
contracts" stays TRUE at the trample layer forever. Adoption does not make trample write road
tiles — it makes the *road graph* claim a corridor (S4's `adoptDesireLine` builds a RoadEdge and
rasterizes it through the normal graph path), releasing those cells from the trample grid. The
header comment gets amended in the S4 commit to name the adoption seam, not silently deleted.

---

## 2 · The unified statistic: per-edge `use` (S1)

**One number, two consumers** (road class + crossing tier). Definition:

```
use01(edge) = clamp01( wTraffic · trafficNorm(edge) + wWealth · wealth(edge) )
```

- **trafficNorm** — a *measured* traffic integral, not an inferred one. New sparse tally,
  `RoadUseTally`: the existing 3 Hz `TrampleDepositSystem` fire is extended (same loop, same
  throttle — no new system) so an NPC standing on a road/bridge tile increments a per-edge pass
  counter instead of depositing trample (roads are trample-inert today; this makes the same
  footfall *visible* to the economy instead of discarded). Tile → edgeId lookup is a rasterized
  `Uint16Array` edge-index memoized on `graph.rev` (rebuilt on class change / adoption, ~one
  `rasterizeRoadGraph` walk). Patrols already walk castle roads (M5), so a castle approach earns
  use for free. At each year-pass the raw count is normalized by edge length × elapsed years
  against a per-class expected-passes constant, folded into an EMA (`edge.use.ema01`), and the
  counter reset. Between settlements with no live NPC flow (pure cohort tier), a floor term
  derived from the existing `CLASS_TRAFFIC`/vitality inference keeps statistical-tier routes from
  reading as dead — **both population tiers must feed use** (the M0 cohort double-accounting
  lesson: any economy that only sees named souls silently lies).
- **wealth** — the *purse* behind the traffic: mean endpoint prosperity read from
  `SettlementCohorts` (two-tier P0/P1 shipped — cohorts are the economy's source of truth),
  scaled by the same `poiVitality` (live residents vs expected) `road-evolution.ts` already
  computes. A lord's seat contributes its tithe posture (see §3 king's-highway gate).
- Weights start `wTraffic = 0.65, wWealth = 0.35` (traffic decides *whether*, wealth decides
  *how fast/far up the ladder*) — tuned in the studio harness, not in prod.

**Persistence:** `edge.use?: { ema01: number; tallies: number; sinceTick: number }` — a new
OPTIONAL field on `RoadEdge`, persisted verbatim with the graph exactly like `dynamics?`
(absent = new edge, no save migration). The raw inter-pass tally rides the Snapshot as an
optional field `roadUse?: [edgeId, count][]` beside `trample?`/`lords?`/`runtimePois?` — the
established optional-snapshot-field precedent. **No SAVE_VERSION bump.**

**Determinism:** counters are pure integer arithmetic off deterministic movement; the year-pass
normalization is pure over (graph, elapsedYears, cohorts). No RNG anywhere (`no-random-in-sim`
guard applies — the tally lives in `src/sim/`).

**Non-consumer for now:** `road-evolution.ts`'s `trafficFor` keeps its vitality inference in S1
(swap-in of measured `use` is an S2 line item, behind the same year gate, so condition and class
read the same number).

---

## 3 · Consumer 1 — the class ladder (S2)

**Cadence:** class transitions run inside the existing year-scale pass —
`advanceRoadEvolution`'s ≥ `ROAD_EVOLUTION_MIN_APPLY_YEARS` (0.5 y) gate, fired by the 0.1 Hz
`RoadEvolutionSystem` heartbeat and by the D2 time-skip (`time-skip.ts` already calls
`advanceRoadEvolution` — class transitions compose with skips for free, same call site). **Never
the 3 Hz trample pass.** Any new duration constant that means fiction-days is a `TICKS_PER_DAY`
multiple — no raw tick literals.

**The ladder** (graph-side; the trample rungs below `path` stay trample's):

```
path  ⇄  track  ⇄  road  ⇄  highway
```

- **Promotion:** one step per year-pass, when `use.ema01 ≥ PROMOTE[nextClass]` for **N_up = 2
  consecutive applies** (≥ 1 fiction-year sustained — a festival spike doesn't pave a road).
- **Demotion:** `use.ema01 < DEMOTE[class]` for **N_down = 4 consecutive applies** (≥ 2 years —
  the world forgets slower than it learns; a demoted road also keeps its physical `wear`/
  `overgrowth`, so an abandoned highway reads as a ruined highway before it reads as a track).
- **Hysteresis:** `PROMOTE[c] > DEMOTE[c]` with a real gap (start: promote 0.35/0.55/0.75,
  demote 0.15/0.30/0.50 for track/road/highway), same anti-flicker design as
  `TRAMPLE.PROMOTE_HI/REVERT_LO`. Streak counters live in `edge.use` (persisted).
- **Surface follows class with a wealth gate:** promotion to `road`+ flips `surface: 'stone'`
  only when `wealth ≥ STONE_WEALTH_MIN`; a poor busy road stays a wide dirt road. (Surface
  changes rasterize through the normal mask path; every post-gen `tile.type` write from the
  re-raster **must `bumpTilesRev(map)`** — the trample bumpers are the precedent.)
- **King's highway (top tier) is lord-gated:** `highway` promotion additionally requires a
  gripping lord seat (M3/M5 `grippingSeatOf`) at ≥1 endpoint whose dominion funds it — the
  fiction is that only mortal power builds at that scale, and it hands Fate/chronicle a beat
  ("the lord's new road") for free. No seat → the edge saturates at `road`.

**Physical consequences are already wired:** class drives carve width, grade envelope
(`gradeEnvelope`), analytic ribbon width, deck width — a promotion just bumps `graph.rev` and
the carve/surface/deformation caches re-derive, exactly as condition changes do today. The
polyline does NOT re-route on promotion (the road widens where it lies; re-routing a promoted
edge is an explicit non-goal — see §8).

**Events:** each transition appends a `SimEvent` (`road_promoted` / `road_demoted`, edge id,
endpoint POIs, old→new class) through the round-7 SimEvent boundary — feeding tidings/inbox,
the chronicler, and Fate's era-authoring across skips (a skip that promotes three roads should
narrate as an era of road-building; `settleArcsAcrossSkip` is the composition precedent).

---

## 4 · Consumer 2 — the crossing tier ladder (S0 studio + S3 runtime)

**Tiers** (extends the shipped `BridgeClass` ladder downward by one rung):

```
0 log        — ONE squared log + a flat treadway, no rails, no abutment masonry
              (new `bridge-log` recipe in BRIDGE_RECIPES; additive prims — the WCV-101
              carpentry-round precedent says no ART bump for additive parts)
1 log-plank  — driven-pile trestle, proud pile heads, no rails      (shipped)
2 timber-beam— flat plank deck on stone footings, post-and-rails    (shipped)
3 timber-arch— hump-backed railed span, stone footings              (shipped)
4 stone-arch — dressed masonry, parapets, cutwaters (grand tier)    (shipped)
```

**The same `use` statistic drives it, one tier behind:** a crossing on an edge may hold at most
`tierFor(class) − LAG` where `LAG = 1` (bridges are expensive — the road earns its class first,
the crossing catches up a year-pass later), floored at tier 0 whenever any adopted/graph edge
crosses water. Wealth can buy the lag back (`wealth ≥ RICH_CROSSING_MIN` ⇒ LAG 0) — a rich
town bridges ahead of its traffic. Tier changes obey the SAME hysteresis/streak rules as class
(no flapping decks). Demotion of the *class* never physically un-builds a bridge — a stranded
stone bridge on a demoted track is exactly the medieval landscape we want; it just stops being
maintained (existing overgrowth/condition economy).

**Runtime re-realization — the RuntimePoiStore pattern's second consumer (S3).** New
snapshot-authoritative `CrossingTierStore`:

- Entry: `{ crossingId, edgeId, tier, upgradedAtTick, entityId }`. Rides the Snapshot as
  optional `crossingTiers?` (serialize/hydrate, deep-clone both ways — the aliasing lesson from
  `RuntimePoiStore.serialize`). **No SAVE_VERSION bump.**
- On tier change at the year-pass: despawn the old span entity, rebuild via the existing
  deterministic seam `buildBridgeObject(spec, opts)` with the tier override, respawn through
  `World` (entities already ride `Snapshot.entities`, so entity state itself scrubs for free).
- On every snapshot restore: `reconcileCrossingTiers(world, map, store)` re-derives which span
  entity should exist per crossing and replaces mismatches — scrub to before an upgrade shows
  the log again; scrub forward rebuilds the arch byte-identically (determinism: same spec +
  same tier ⇒ same entity). This mirrors `reconcileRuntimePoiStamps` exactly; note the
  runtime-poi header's rule — a second owner system **joins the established reconcile pattern
  rather than inventing a parallel one** — which is precisely what this is.
- Gen-time behaviour is UNCHANGED in S3: worldgen still picks the initial tier via
  `bridgeClassFor` (no WCV bump); the store starts empty and only records *deviations* from the
  gen-time pick. (Folding the gen-time pick itself onto the use-prior is §8 Q6.)

---

## 5 · The deep slice — desire-line → RoadEdge adoption (S4, LAST)

The seam that closes the bottom of the ladder. Runs at the year-pass (not 3 Hz), read-only over
the trample grid until the moment it commits.

**Detection:** a candidate corridor is a 4-connected chain of *promoted* trample cells whose two
ends each land within R tiles of an **anchor** (POI position, gate portal node, or existing road
node), where the chain's mean trample wear has held ≥ `ADOPT_WEAR_MIN` across `N_adopt = 4`
consecutive year-passes (streaks tracked in a small sparse corridor ledger riding the snapshot —
optional field, same precedent). Corridor tracing is a deterministic skeleton walk over the
promoted set (no RNG).

**Commit (`adoptDesireLine`):**
1. Build a `RoadEdge` — `class: 'path'`, `surface: 'dirt'`, `feature: 'road'`,
   **`emergent: true`** (new optional field), polyline = the traced trampled cells (the
   geometry IS the desire line — that's the whole point; no walker re-route).
2. **Junction handling:** an end that lands mid-edge on an existing road **splits** that edge at
   the nearest polyline cell into two edges sharing a new `junction` node (Slice-0 never split
   edges; this is the first splitter — it must preserve `dynamics`/`use` on both halves by
   copy, keep ids stable-ish via suffixing `re42a/re42b`, and bump `graph.rev`). An end at a
   POI/gate node just connects.
3. Rasterize the new edge through the normal mask path (`dirt` path-class carve over cells that
   are already dirt — near-no-op visually, but the cells are now road-owned), `bumpTilesRev`.
4. Release the corridor cells from the trample grid (delete from `accum`/`promoted` WITHOUT
   reverting the tile — the road owns it now), so trample's guardrail stays intact.
5. Emit `road_adopted` SimEvent (Fate/chronicle: "the mill path became a road").

**Contract compliance:** adopted edges are evaluated by the standard contracts. Where an
emergent path legitimately can't satisfy an authored-world contract (e.g. `roads-lead-to-gates`
for a trail that meets a wall mid-run), the edge's `emergent: true` grants an explicit
**exemption tag in the contract evaluator** — the same explicit-exemption precedent the runtime
castle rings set for `gate.road-connected`. Exemptions are named and logged, never silent.

**Scrub safety:** the graph itself is part of the persisted map state; adoption mutates it
post-gen. S4 therefore records adoptions in the corridor ledger (snapshot-authoritative) and the
restore path replays graph membership from it — scrubbing to before an adoption must show the
un-adopted trail (trample reconcile already restores the dirt), scrubbing forward re-adopts
identically. This is the hairiest reconcile in the epic and is exactly why S4 is **last**.

---

## 6 · Studio harness FIRST (S0) — dev viz lives in the studios, the shipped game stays clean

Per the standing directive (dev tools in studios, not the game):

- **Crossing-tier ladder scene** — a new scene in the studio shell (`src/studio/`, pattern:
  `zoo-studio.ts`): ONE stream, crossed at every tier side by side (`bridge-log` → …
  → `bridge-stone-arch`, all from `BRIDGE_RECIPES` via `bridgeBlueprintByName`), plus a
  **use/wealth dial pair** that steps a live "subject" crossing through the tiers as the
  thresholds compute — the tuning loop for §4's constants, live, no reload (studio never
  reloads to refresh — user rule).
- **Road-class dial in `?studio=site`** (`site-studio.ts`): select a road edge, drag a `use`
  override, watch class/hysteresis/carve-width respond through the real `stepEdgeClass` code
  path (the studio drives the same pure functions the sim calls — no forked logic).
- Optional overlay (studio-only): per-edge `use.ema01` heat tint on the road ribbon.

Nothing in this slice touches the sim; it front-loads the geometry (`bridge-log` recipe) and
the tuning surface so every later slice is verified visually the day it lands.

---

## 7 · Slice plan

| Slice | Ships | Tests | Files (primary) | Non-goals |
|---|---|---|---|---|
| **S0 — studio ladder** | `bridge-log` recipe; crossing-tier ladder scene; site-studio road-class dial; pure `tierForUse`/`stepEdgeClass` fns (unwired) | recipe golden (geometry hashes for the new preset only — additive, no ART bump expected); pure-fn unit tests for thresholds/hysteresis; studio smoke | `src/blueprint/presets/bridges.ts`, `src/studio/` (new scene + site dial), new `src/world/road-use.ts` (pure half) | no sim wiring; no persistence; no WCV |
| **S1 — the use statistic** | `RoadUseTally` (3 Hz piggyback), tile→edge raster memo, year-pass fold into `edge.use` EMA; snapshot fields `roadUse?` + `edge.use?` | determinism (same replay ⇒ same tallies); snapshot round-trip incl. scrub; no-random guard stays green; memo invalidates on `graph.rev`; cohort-tier floor covered | `src/sim/systems/trample-system.ts`, `src/world/road-use.ts`, `src/world/road-graph.ts` (field), `src/core/snapshot.ts` | no behaviour reads `use` yet (viz in studio only); no SAVE_VERSION bump |
| **S2 — class evolution on existing edges** | promotion/demotion at the year-pass w/ hysteresis + streaks; surface wealth gate; lord gate on `highway`; `road_promoted/demoted` SimEvents; time-skip composition; `road-evolution` reads measured use | hysteresis/streak unit matrix; skip-vs-live parity (N years skipped ≡ N years ticked, the `stepRoadDynamics` sub-step precedent); `bumpTilesRev` asserted on re-raster; event emission; content-version pin test untouched | `src/world/road-evolution.ts`, `src/sim/systems/road-evolution-system.ts`, `src/sim/time-skip.ts`, `src/world/road-use.ts` | no polyline re-route on promotion; no crossing changes; no adoption |
| **S3 — crossing runtime upgrades** | `CrossingTierStore` + snapshot `crossingTiers?`; tier steps at year-pass (LAG rule); despawn/rebuild via `buildBridgeObject`; `reconcileCrossingTiers` on restore | scrub-back un-builds / scrub-forward rebuilds byte-identically; store serialize aliasing (deep-clone) test; lag + wealth-buyback unit; deterministic entity identity | new `src/world/crossing-tier-store.ts`, `src/world/connectome/crossing-structures.ts`, `src/core/snapshot.ts`, game restore path | gen-time tier pick unchanged (no WCV); ancillary buildings untouched; no demolition on class demotion |
| **S4 — desire-line adoption (LAST)** | corridor detection ledger; `adoptDesireLine` (edge build from trampled cells, junction split, raster, trample release); `emergent` flag + named contract exemptions; `road_adopted` event; scrub replay of adoptions | corridor trace determinism; junction-split invariants (dynamics/use preserved, graph.rev bump, 4-connectivity); contracts green on probe seeds or exemption asserted; scrub round-trip; trample guardrail test updated *explicitly* | `src/world/road-use.ts` (adoption), `src/world/road-graph.ts` (split), `src/sim/trample.ts` (release seam + header amendment), `src/world/connectome/road-contracts.ts` | no multi-corridor merging; no adoption-triggered crossings beyond the tier-0 floor; no gen-time changes |

**Version implications, summarized:** all persisted additions are optional fields following the
`lords?`/`runtimePois?`/`dynamics?` precedent ⇒ **no SAVE_VERSION bump anywhere in S0–S4**.
**No WCV bump** — no slice changes worldgen output (S0's new recipe is studio-reachable only;
S3 leaves the gen pick alone). If §8 Q6 later folds the use-prior into gen, THAT round bumps
WCV (and updates `tests/unit/content-version.test.ts` in the same commit, per the standing
gotcha). ART_RECIPE_VERSION: expected untouched (additive prims precedent); confirm against
`assetgen-golden` pins when `bridge-log` lands.

---

## 8 · Open questions (decisions for the user / integrator)

1. **King's-highway funding — narrative gate or real spend?** S2 specs the lord seat as a
   *gate* (boolean). Should promotion to `highway` actually SPEND from the lord economy
   (tithe/garrison trade-off, M3), making road-building compete with knights for the same
   purse? Costlier to tune, much better fiction.
2. **Does trample feed edge `use` before adoption?** Spec'd NO (road tallies only; trails earn
   adoption through the wear ledger instead). Arguable YES: a trail shadowing a road's corridor
   could count toward that edge's use. Keeping them separate is cleaner; ruling wanted.
3. **Demotion floor:** can an adopted (`emergent`) path be fully demoted OUT of the graph
   (reverting to trample-owned dirt that then fades), closing the loop downward — or is
   adoption a one-way door (spec'd: one-way for S4; un-adoption deferred)?
4. **Tier-0 rendering for un-adopted trails:** should a *trail* (pre-adoption) that crosses a
   stream get the strategically-placed log already, or is any crossing structure adoption-gated
   (spec'd: adoption-gated — a log is the first *built* thing)? The user's vision reads as the
   former; it needs a home for a structure on a non-graph corridor, which is extra machinery.
5. **Weights & thresholds** (`wTraffic/wWealth`, PROMOTE/DEMOTE ladders, N_up/N_down, LAG,
   STONE_WEALTH_MIN): S0's studio dials exist to settle these empirically — sign-off wanted on
   the *shape* (one-step-per-pass, promote-fast/demote-slow) before tuning.
6. **Gen-time convergence (future round):** should `classForConnection` eventually become just
   the PRIOR for `use` (fresh worlds seeded with expected use, then everything moves through
   this one economy)? That is the clean end-state but is a WCV-bumping worldgen change —
   explicitly out of scope here; flagging so the roadmap can carry it.
7. **Rival/Fate hooks:** should Fate get a constrained tool to nudge an edge's use/wealth
   (era-authoring: "the pilgrim road"), or does it only *observe* the SimEvents in S2? Spec'd
   observe-only; a `nudge_road_use` tool is a natural follow-up under the ±cap discipline.

---

## 9 · Decisions (2026-07-17, user-ratified)

Rulings on §8, in force for the slice plan. Where a ruling overrides a spec'd default above,
this section wins.

1. **Gate now, spend later.** `highway` requires a gripping lord seat (boolean gate) in S2.
   Upgrading to a real tithe spend waits until the lord economy has a competing drain (revolt /
   pressure consumer) — spending from a purse nothing else drains is fake tension.
2. **Separate.** Trample footfall never feeds edge `use`; trails earn adoption through the wear
   ledger only. (As spec'd.)
3. **One-way in S4; reversibility is a named follow-up.** Un-adoption (an `emergent` path
   demoted out of the graph, reverting to trample dirt that fades) is wanted eventually — the
   full circle of a path being born and forgotten — but not in the first cut of the hairiest
   slice.
4. **The trail gets its log — OVERRIDES the §4 adoption-gated default.** A *promoted trample
   corridor* (pre-adoption) that crosses a stream gets the strategically-placed tier-0 log:
   the corridor ledger (§5) gains an optional crossing-site entry
   `{ corridorId, x, y, tier: 0, entityId }` and S3's `CrossingTierStore`/reconcile machinery
   owns the entity exactly as it owns edge crossings (same store, `edgeId | corridorId` union
   key — no parallel system). Adoption (S4) inherits the site onto the new edge. The log on the
   humble trail is the epic's founding image; it must not wait for graph membership. Slice
   impact: S3 grows the union key + corridor-crossing detection (promoted-cell chain crossing a
   water run ≤ 3 tiles wide); S4's inheritance is a ledger re-key.
5. **Threshold shape approved** (one step per year-pass, promote-fast 2 / demote-slow 4).
   Numbers settle in the S0 studio dials.
6. **Gen-time use-prior convergence: deferred to the roadmap.** (As spec'd.)
7. **Fate observes in S2** (`road_promoted/demoted/adopted` SimEvents → tidings/chronicle/eras).
   A constrained `nudge_road_use` tool joins the Fate-pacing epic later, under the ±cap
   discipline. (As spec'd.)
