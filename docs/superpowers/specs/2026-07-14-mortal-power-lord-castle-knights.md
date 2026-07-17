# Spec — Mortal Power: the lord, the castle, the knights

**Date:** 2026-07-14 · **Status:** spec · **Brainstorm:** [../2026-07-14-mortal-power-and-proactive-fate-brainstorm.md](../2026-07-14-mortal-power-and-proactive-fate-brainstorm.md)
**Canon:** VISION 1.1.0 — §3 (belief), §6 (emergent identity), §8 tenets 1/2/9, §9 rows 11–12 (the gap this spec closes)
**Engine:** [Proactive Fate](2026-07-14-proactive-fate-arcs-portents.md) — supplies the arc machinery; this spec supplies its first arc library.

> **Thesis:** oppression manufactures need, and need is what a small god feeds on. **A castle is a
> belief engine.**
> **The trap:** topple the lord and you remove the fear that feeds you.

**Cost: $0.** Sim, prompt, and parametric geometry only. The paid img2img spend gate stays **OFF**.

---

## M0 — Give need a DIRECTION *(P0 — nothing else matters until this ships)*

**The engine cannot currently see this design.** Verified by reading:

- `computeMood()` (`src/sim/npc-sim.ts:55`) is the **flat mean** of the four needs, and `tickNpcEntity`
  reads *only* that mean. ⇒ **A lord who drains `prosperity` by X and supplies `safety` by X moves faith
  by exactly zero.** The castle is a *no-op*.
- `worship` fires **only** on `meaning < 0.3` (`npc-activity-system.ts:104`); low `community`
  **pre-empts** it; low `safety`/`prosperity` have **no branch at all**. Meanwhile `work` self-restores
  `prosperity` (+0.3) and `sleep` self-restores `safety`. ⇒ **A starving peasant cannot pray.**
- `worship` is the sole channel `answer_prayer` feeds and rivals claim ⇒ **the whole belief economy runs
  on one need out of four.**

### M0.a — `worship` fires on the LOWEST need *(~10 lines; the highest-leverage change in the design)*

Replace the fixed `meaning`-only branch with an argmin over the four needs against per-need thresholds.
A starved peasant now prays. **This one branch is what makes the castle a belief engine.**

### M0.b — A prayer gets a SUBJECT

Add `prayerNeed?: keyof NpcNeeds` to `NpcProperties`, set where `prayerSince` is set
(`updatePrayerLedger`, `rival-claims.ts:157`). Then:

- `answerPrayer` restores **the need actually asked for** (not always `meaning`);
- rivals can **domain-match** their claims — `rival-claims.ts`'s own header admits the current collapse
  to *"territorial presence"* because *"rivals carry no domain vector today"*. **This unblocks Track 3's
  stated deferral as a side effect.**
- the chronicler can narrate **what was asked for**;
- VISION §6 (identity from whom you serve) becomes *measurable*: a god that answers `prosperity`
  prayers under a tyrant **becomes a god of the poor, by arithmetic.**

### M0.c — Extraction must beat the self-restore pump

`prosperity` has a **+0.3 `SELF_AGENCY_RESTORE`** on every completed `work`. A tithe modelled as a
per-tick drain is fighting that pump and will lose. Three candidate models — **recommend (c)**:

| | model | verdict |
|---|---|---|
| (a) | a persistent, inverted `raiders` settlement event | Cheapest. Reuses the entire event pipeline — **and Fate's existing `nudge_event_severity` / `force_next_event` can coach the lord's greed with no new tooling.** Good for v1. |
| (b) | a real per-NPC wealth stock | New subsystem, new save fields, a new cohort field, cascades into the statistical tier. **Too big.** |
| (c) | **scale `SELF_AGENCY_RESTORE` by the settlement's tithe rate** | **One line, and by far the most honest fiction: *you work as hard and you get less.*** |

> ⚠ **Cohort double-accounting.** `SettlementCohorts` carries mean needs + belief sums and
> `SpiritSystem` folds them into power regen **identically to named souls**. Any lord effect that
> touches only named NPCs will make the power numbers **silently lie**. Every M0/M3 effect must hit
> both tiers.

**What already works, free:** *secularization.* A lord who raises `safety` pushes `avgNeeds` up; cross
0.6 and `COMFORT_DECAY` fires and the player's faith bleeds, resisted only by `devotion`. *"The castle
keeps them safe, and safety makes them forget you"* needs **no engine work at all.** It is the strongest
half of the thesis and it is already in the math.

---

## M1 — The chronicler's voice *(cheapest atmosphere in the game)*

**The architectural gift** (from the research): the monastic chronicler does not *explain* events, he
**annotates** them — disaster ⇒ therefore sin ⇒ name the sin. He infers backwards from outcome and
attributes cause to God, sin, or portent, **never to politics**. Alcuin blamed Lindisfarne on the
Northumbrians' drunkenness, fornication, *and their haircuts*.

> **A narrator who explains everything by sin and portent literally cannot contradict the simulation,
> because he is not making causal claims about it.** He records our numbers faithfully and tells you
> what they *mean*, morally. The register and the "sim is truth" architecture (VISION §10) want the
> same thing. It is also **cheap** — parataxis needs no long-range coherence, so the fast tier holds it.

**Seam:** a new `src/llm/chronicle-prompt-builder.ts` beside `npc-prompt-builder.ts`, driven off
`gameQuery.events(sinceId)` — the event log already has a cursor, and `SimEvent` is pure structured data
with **no prose in it** (prose is templated downstream in four places). Clean substrate.

⚠ **Hard constraint: the chronicler is STRICTLY READ-ONLY over the log.** `state-writeback.ts:94`
currently accepts free-text `response.new_events` and appends them. A chronicler that writes back would
violate VISION §10. **Read-only, no exceptions.**

**Register spec (the prompt):** short annalistic clauses joined by "and"; record numbers, dates,
feast-days, what was taken, the weather, the condition of a corpse; break the list into sudden lament,
then resume the list; **praise a man and condemn him in the same sentence and do not reconcile the two**
(Orderic Vitalis on the Harrying: he cannot commend William, and thinks of the children); portents come
**first** and *explain* what follows; never say "I do not know why" — say **what sin it was for**.

---

## M2 — Epithets *(lowest effort, highest flavour)*

There is **no name generator** today: three hardcoded arrays (`NEWBORN_NAMES` has ten entries), and
`RivalSpirit.title` is the only epithet field in the codebase.

**Epithets are conferred, contested, and often hostile.** William was *the Bastard* until he was *the
Conqueror* — **victory renames you**. Æthelred *the Unready* is a pun (*unræd* = "ill-advised"). The
Byzantines gave Robert *the Magnificent* — **the nickname is conferred by the audience you were showing
off to.**

**Seam:** `NpcProperties.memories` are already distilled and salience-tagged, and
`interaction-memory.ts:55` already reduces events to one-liners. **An epithet is a salience-argmax over
that ring.** Add `epithet?: string`, thread through `NpcView`/`NpcDetail`, the inspector, and the
attention panel.

---

## M3 — The lord

**No new role needed.** `NpcRole` already has **`noble`** and **`soldier`**, both already carry piety
modifiers and are both in `WORKING_ROLES`. The lord is a `noble`; the knights are `soldier`s. `fateRole`
is the existing archetype hook (today: `preacher|skeptic|refugee`).

**No new belief category.** ⛔ The lord **never** gets a `beliefs[]` entry — that would invent a fifth
category of god and force `SpiritSystem` to grant a mortal **divine power regen** (see brainstorm §6).
**He competes for allegiance, never for belief.** He is a *need-satisfier*, which is tenet 9 (*"mortals
act first; the god is the margin"*) at its most vivid: **he does not steal your believers — he removes
the crisis that made them believers.**

**Free path to *real* competition, zero canon damage:** **a lord who endows a shrine to a rival god**
grants that rival territorial presence (`ai.settlements`) → `isRivalPresent()` → prayer-claiming rights
via `rival-claims.ts`. **He fights you by proxy, through machinery that already ships.**

**Lord state** is settlement-scoped (`LordState { npcId, tithe, garrison, unrest, keepTier }`), and
`buildRivalSituation` → `buildLordSituation` is the same pure-function pattern. Fate coaches him with a
`set_lord_stance` tool — for which `set_rival_stance` (fate-tools.ts:111, parser at :301) is a
line-for-line template.

**Dynasty is free:** `lineageId` already groups by root ancestor, and `birthNpc` already dilutes
inherited faith (0.4) and understanding (0.05). *The strongman dies abroad leaving a child heir* needs
no new lineage machinery.

---

## M4 — The castle

**The pleasant surprise: the primitive already exists and the game never calls it.**
`placeComplexOnPatch` (`src/world/place-complex.ts`) plants a **motte-and-bailey on an arbitrary hilltop
with no settlement** — raises the motte, cuts the ditch (spoil-conserved), commits ring barriers, drops
`castle_keep` on the motte top, arcs the bailey away from the approach. **Its only caller today is the
studio.** And `siteSelect()` already scores sites against `DEFENSIVE_SITE_WEIGHTS` — the game currently
hands it *one* candidate, so its argmax is a no-op. **Feed it N hilltops and it chooses for free.**

**Timber → stone is a data change, not a code change.** `complex-types.ts` already frames the ladder
(ringwork → motte-and-bailey → … → concentric) as *a wealth/era ladder*, and `specFromComplexType` reads
`motteHeight` off the complexType. A `stone_keep` entry with a stone `barrierType` gives us **a visible
power bar** for the lord's rise.

**The village huddles under the keep.** Both placement cost functions are additive scalar sums
(`settlement-plan.ts:989`, `settlement-growth-system.ts:519`), and `site-fitness.ts` `scoreSite()`
already takes a **composable list of weighted terms**. A `keepProximity` term flows through `fitnessAt`
with **zero structural change** — and it inverts today's grow-walls-around-a-town into *castle first,
village accretes under it*, which is exactly the Norman mechanism: **the nucleated village is a
byproduct of an extraction technology.** A concentrated peasantry is a harvestable one.

### ⚠ The two real blockers

**1. There is no runtime POI creation anywhere in the codebase.** POIs come from the `WorldSeed` at
generation time, and *everything* keys off `poiId`: `growSettlement` (hard-returns `false` without one),
`homePoiId`, `SettlementCohorts`, `activeEvents`, `RivalSpirit.settlements`, and — critically — **Fate's
`validPoiIds` drift guard**. **A castle that is not a POI is invisible to every gameplay system in the
game.** Study `src/world/causal-site.ts` — transient sites with poi-*compatible* ids that Fate already
handles specially — as the "a place that isn't a settlement" precedent. *This is the single biggest
unknown in the spec.*

**2. Two incompatible wall systems, and all the good geometry is on the wrong one.**
`deriveSettlementRing` (`enclosure.ts`) has terrain-seeking radii, the canonical piece-grid, coverage
towers (`run.towers`), per-segment `defends`, gate half-edge repair, wet-sealing, hoardings — but it is
**welded to an existing town** (`traceRing` returns `null` below 6 building cells; an empty hilltop has
zero). `placeComplexOnPatch`'s ring is a **bare 28-gon with the gate hardcoded due south**, no towers,
no segment classification. **A planted motte-and-bailey today renders *worse* than a peasant palisade.**
Compounding it: `towersEnabled(run)` gates towers to crenellated stone/brick, so a **timber** palisade
gets none *by design* — a deliberate decision is owed here, not a patch.

---

## M5 — Knights

**Model a knight as `kind: 'npc'`, `role: 'soldier'`.** You inherit movement, pathfinding, y-sorting,
the animation rig, sim ticks, belief, memory, and mortality. ⛔ **Do not add an entity kind** — the
render graph draws *only* barriers, blueprint entities, and `category: 'vegetation'`; `prop` and
`terrain-feature` are effectively **invisible** (see the "sea_arch trick" scar in `entity-kinds.ts`). A
new moving category means touching `world-render-graph.ts`, the GPU instanced pass, and the y-sort. The
*mount* is an LPC sprite-layer problem, not an entity-kind problem.

Knights patrol out from the keep along the existing road/desire-line network and carry the extraction
(M0.c). **The economic loop from the history is exact:** a knight is expensive (horse, mail, lance) ⇒ he
must extract from those who have none ⇒ to extract efficiently you must concentrate the population ⇒ the
village. **Feudalism falls out of an upkeep cost paid from a radius.**

---

## M6 — The Peace of God *(the player's answer to the castle)*

The best find in the research, and the answer to *"what is the player's move against a warlord that
isn't a lightning bolt?"*

> Bishops convene an open-air assembly. They **parade the relics out of the churches into the field**.
> Crowds gather to venerate them. The knights are made to **swear oaths, on those relics, before that
> crowd**, not to prey on peasants, clergy, pilgrims, or cattle. The sanction is excommunication.

**A complete gameplay verb.** A religion converts *accumulated popular belief* into *a binding
constraint on armed men*, with a relic as the transaction medium and a crowd as the witness.

Mechanically it is the ideal counter-move because **it spends `devotion`, not `power`** — which finally
makes devotion do something a player can *feel*, and it is unavailable to a god who only ever bought
cheap transactional faith. **The fearful-faith trap (VISION §3) acquires a consequence.**

Needs new capability-registry verbs (`proclaim_peace`, `bind_oath`) — ⚠ **register them with
`implemented: true` or the whole story pack is silently rejected at boot** (`story-pack-live-verbs.test.ts`
exists because that already happened once).

---

## Arc library for proactive Fate

The narrative shapes this content supplies to [the Fate spec](2026-07-14-proactive-fate-arcs-portents.md) §4.2:
`strongman_dies_abroad` · `exile_returns_crowned` · `kingmaker_discarded` · `brother_from_within` ·
`victory_that_loses` · `martyr_by_accident` · `the_null_event`.

**The pilgrimage window** is the flagship: the lord departs to cut a dash abroad (piety *and* status —
Fulk Nerra was a serial penitent *and* burned his wife at the stake; **do not build a "pious" trait that
trades off against "cruel" — they multiply**). His lands wobble. He may not come home. **That is a
window, and a window is a gift to a small god.**

---

## Slice order

| # | Slice | Why here |
|---|---|---|
| **M0** | need-direction (a: worship-lowest-need · b: `prayerNeed` · c: tithe scales self-restore) | **Everything else is invisible without it.** Also closes VISION §9 rows 11–12 and unblocks Track 3's domain-matching deferral. |
| **M1** | the chronicler | Cheapest atmosphere-per-token in the game. Independent of everything. |
| **M2** | epithets | Deterministic, tiny, enormous flavour. Independent. |
| **M3** | the lord (`noble` + `LordState` + `set_lord_stance`) | Needs M0 to be measurable. |
| **M4** | the castle (wire `placeComplexOnPatch`; `keepProximity`; timber→stone) | **Blocked on the POI question — resolve that first, in its own spike.** |
| **M5** | knights | Needs M3 + M4. |
| **M6** | the Peace of God | Needs M3 (something to bind) and gives `devotion` a job. |

**M0 · M1 · M2 are independent of the castle and can ship immediately.** M0 is the one that matters.

---

## Reality check (2026-07-16) — M0.a + M0.b SHIPPED

Implemented as specified (branch `feat/m0-need-direction`): `worship` now fires on the lowest
need via per-need `WORSHIP_THRESHOLDS` (`meaning` 0.3 unchanged; material needs 0.15 —
desperation-only, so ambient behavior barely drifts until an extractor exists), the plea check
now PRECEDES the socialize branch (the pre-emption bug), `prayerNeed` rides `NpcProperties`
(set by the activity system, cleared by the ledger/answer), `answerPrayer` restores the need
actually asked for and logs `need` on the `answer_prayer` event, and every player lens words
the subject identically via `PRAYER_SUBJECT_TEXT` (inbox detail + salience deficit, hover
why-tag, inspector subtitle, NPC LLM prompt).

**M0.c deliberately deferred to M3:** no tithe producer exists anywhere yet (verified —
zero non-barn `tithe` references), so the `SELF_AGENCY_RESTORE` scaling would be dead code
with no honest test. It stays the recommended model (c) and is a one-line change inside the
activity system's self-agency switch once `LordState.tithe` exists.

---

## Reality check (2026-07-17) — M3 SHIPPED (the lord + `set_lord_stance` + M0.c closed)

Implemented per the slice table: **the lord = `noble` role + `LordState` + `set_lord_stance`**,
plus the M0.c tithe scaling this section deferred here. No new entity kind, no new belief
category, no M4/M5/M6 work.

- **`LordState { npcId, lineageId, tithe, garrison, unrest, keepTier }`** lives on
  `World.lords` (keyed by poiId), captured/restored by the snapshot exactly like
  `activeEvents` — a scrub un-seats a lord who rose after the restore point; pre-lord saves
  restore to no seats and re-attach within a game hour. `lineageId` was ADDED to the spec's
  field list: succession needs the vacated seat's house after the holder's entity has flipped
  to `remains` (dynasty preference is unimplementable without it).
- **`LordSystem`** (`GAME_HOUR_HZ`, rng-free — selection is an argmin, the economy is
  relaxation arithmetic): eldest resident noble takes a vacant seat (`lord_risen`, chronicler-
  consumed); succession prefers the seat's lineage, falls back to the eldest noble of any
  house, and the seat **lapses** when no noble remains; `garrison` = hourly headcount of
  resident soldiers (derived truth, M5 gives them patrols); `unrest` relaxes toward the tithe
  (0.02/game-hour — sim history, persisted).
- **M0.c closed, model (c) as recommended:** the `work` self-restore is scaled by
  `1 − tithe` (`workRestoreScale`/`titheRateFor`, one read in the activity system's
  self-agency switch). No lord ⇒ the pre-M3 economy bit-for-bit.
- **The cohort double-accounting warning honoured:** `applyCohortTithe` (in `cohorts.ts`,
  the single mutation choke point) relaxes each occupied statistical band's prosperity MEAN
  toward the same tithed equilibrium `0.5 × (1 − tithe)` per game hour — recovery when the
  tithe eases is free, counts never move (the P1 conservation audit is over counts).
  *Resolution note:* statistical BELIEF response to the extraction is deliberately absent —
  statistical belief drift and statistical pleas are P2 of the two-tier-population epic, not
  M3's to build; the statistical tier feels the tithe in its recorded needs, and the named
  tier carries the full pray-answer-claim loop.
- **`set_lord_stance`** follows `set_rival_stance` line-for-line: authoring-tier verb
  (settlement target — the seat is settlement-scoped), tithe delta capped ±0.2 at the LLM
  boundary AND in the verb apply, clamped [0,1]; parser drift-guarded against
  `validLordPoiIds` (absent set ⇒ every call drops, logged — the safe default); rejections
  log-and-drop, never killing a deliberation.
- **The shrine-endowment proxy shipped** as the second `set_lord_stance` lever
  (`endowRival`): the lord endows a rival's shrine → the settlement joins the rival's
  `ai.settlements` → `isRivalPresent()` → prayer-claiming rights, logged `shrine_endowed`.
  The player's spirit is rejected `invalid_target` — a mortal's patronage never feeds the
  player belief-side (⛔ the lord himself never enters the belief table, brainstorm §6).
- **Fate sees the seats:** `describeLordsForFate` (via `buildLordSituation` — the
  `buildRivalSituation` pure-function pattern, counting BOTH population tiers) rides the
  prompt; its enumerated poiIds are the drift-guard set.

**Ambiguities resolved (minimal honest slice):** unrest is a plain relaxation toward the
tithe (no revolt mechanics — a consumer for `unrest` beyond the Fate digest is future work);
`keepTier` is persisted but always 0 until M4 resolves the runtime-POI blocker; `garrison`
is an honest headcount only (knights/patrols are M5); no worldgen-time seeding — seats
attach lazily on the first hourly fire, which also covers strangers/births growing a noble
line later.

---

## Reality check (2026-07-17) — M6 SHIPPED (the Peace of God)

Implemented per the slice table: **M6 needs M3 (something to bind) and gives `devotion` a
job** — no M4/M5 work (still blocked/ordered as specced). Both verbs registered
`implemented: true` (the story-pack allowlist reads `Object.keys(CAPABILITY_REGISTRY)`, so
packs may name them from day one).

- **`proclaim_peace`** (divine tier, settlement target): the open-air assembly. Requires a
  seated lord and pays **`PROCLAIM_PEACE_DEVOTION_COST` from the resident congregation's
  devotion pool** (`devotionPoolAt`, drawn down pro-rata — every believer keeps the same
  fraction). `cost: 0` in the registry is deliberate: the power gate must never fire, and a
  devotion shortfall rejects `precondition_failed` — `insufficient_power` would lie. A
  power-rich, devotion-poor god (the cheap-fear build — smite bleeds devotion by design)
  **cannot call this crowd**: the fearful-faith trap's consequence, as briefed.
- **The oath is data on the seat:** `LordState.peace?: PeaceOath { spiritId, untilTick,
  titheCap, sworn[] }`. Every armed man PRESENT (resident soldiers + the seated lord —
  `armedMenOf`) swears at the assembly; the tithe clamps to `PEACE_TITHE_CAP` (0.05, half
  the customary `DEFAULT_TITHE`) immediately and unrest eases by `PEACE_UNREST_RELIEF`.
  Duration `PEACE_DURATION_TICKS = 7 × TICKS_PER_DAY` (fiction-day constants rule). One
  peace per seat at a time.
- **`bind_oath`** (divine tier, npc target): brings ONE later armed man — a new soldier, or
  an **unsworn successor lord** — before the relics of a standing peace, for
  `BIND_OATH_DEVOTION_COST`. Only the spirit whose relics were paraded may bind more men.
  **Dynasty passes the seat, not the oath:** succession seats an heir UNBOUND (the cap does
  not hold him until the player binds him) — the felt loop that makes the verb matter.
- **Enforcement with real teeth:** `LordSystem` (hourly) reaps a lapsed oath
  (`peace_lapsed`) and holds a SWORN seat-holder to `titheCap` (tithe creep is re-clamped
  every fire); `set_lord_stance` clamps Fate's tithe coaching to the cap while the oath
  binds (`boundTitheCap` at the verb apply — Fate's greed lever hits the oath and stops).
- **Both population tiers, by construction:** the binding effect IS the tithe cap, which
  flows through the two shipped M0.c choke points — `workRestoreScale(titheRateFor(...))`
  for named souls, `applyCohortTithe` for the statistical bands. No second accounting path
  exists to drift.
- **Events consumed for real** (sim-event-boundary guard): `peace_proclaimed` /
  `oath_sworn` / `peace_lapsed` are narrated by the chronicler (weighted 8/5/6), the first
  and last join the seek/landing interest band (`interest-predicate.ts`), a lapse surfaces
  as a divine-inbox **tiding** ("the armed men there are no longer bound" — windowed off
  the log like the portent tidings, no stored state), and the assembly/oath enter witness
  memory rings (`rememberEvent`). Fate's lord digest names an active peace per seat and
  says explicitly whether the holder is sworn (and therefore uncoachable above the cap).
- **Snapshot:** `PeaceOath` rides `LordState` through the existing `World.lords`
  capture/restore (structuredClone; deep — tested). Pre-M6 saves restore to unbound seats,
  no migration.

**Ambiguities resolved (minimal honest slice):** the spec's two named verbs were split
assembly-vs-latecomer (proclaim binds all armed men present, bind_oath binds one more) —
the historically honest reading that also gives each verb non-redundant teeth. The
DEVOTION SPEND touches the NAMED tier only: statistical cohort devotion sums (`sumD`) are
structurally zero in P1 (statistical belief drift is P2 of the two-tier epic — the same
resolution M3 recorded for statistical belief response), and the cohort `sumContribution`
invariant cannot be rescaled exactly from running sums anyway, so folding the statistical
tier in would add exactly 0 to the pool today while risking a lying power number.
Excommunication (the historical sanction) is future work — today the oath cannot be
BROKEN, only lapse or die with its swearer; a `peace_broken` beat wants revolt/defiance
mechanics that don't exist yet (the same future-work bucket as unrest consumers).

---

## Reality check (2026-07-17) — M4 SHIPPED (the runtime castle, S1–S5)

Blocker 1 (runtime POI creation) was resolved by its own spike, and all five slices
shipped: see **[../2026-07-17-m4-runtime-poi-spike.md](../2026-07-17-m4-runtime-poi-spike.md)
§7 (binding decisions), §8 (S1/S2 notes) and §9 (S3/S4/S5 notes)** — the spike is the
canonical record. Headlines: `RuntimePoiStore` + directory projection + heightfield-inert
rule + ownership-tagged scrub-safe stamps (S1/S2); sim adoption proven end-to-end and
`floodPoi` live-directory fallback (S3); the **`found_castle` AUTHORING-tier verb** —
mortal power made concrete, requires a seated M3 lord (a god cannot buy a castle with
belief-power; Fate/dev coaching triggers the lord's act), deterministic `siteSelect` over
a real dry-land candidate lattice, garrison rehomed (never spawned), one castle per seat,
owned-stamp deformation-memo key (S4); runtime complex rings exempt from
`gate.road-connected` with desire-line trample as the access story (S5). Still open from
this section: blocker 2 (the bare 28-gon ring vs `deriveSettlementRing` geometry),
`keepProximity` growth weights, timber→stone `keepTier` progression, and any automatic
foundation trigger / Fate tool exposure.
