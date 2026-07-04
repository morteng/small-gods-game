# Codebase Audit Synthesis (2026-07-04)

Six parallel read-only auditors swept main @ `86c84ee`, each hunting one defect class, calibrated
on two exemplar audits (barrier 3D masses/joins → WP-U; terrain ground-blend → WP-V). This is the
deduped, ranked master list — the commissioning material for round 7+. Raw reports live in the
session scratchpad (`codebase-audit/1-unwired … 6-persistence`); every finding below was verified
by its auditor with file:line traces, probe numbers, or renders.

**The dominant pattern, across all six dimensions:** features were built *one integration point
short of reaching the player* — a finished mechanism missing a single call site, a signal computed
then dropped, a threshold pinned just past where real data lands. Very little is *broken*; a lot
is *dark*.

## Fixed in round 6 already (same session)

- **Trample trails never repainted live** (persistence F1): `packColorFieldMemo` assumed tile
  types immutable at runtime — false since WCV80 (trample), and also silently broken for
  settlement-growth stamping, perception realize, and the dev brush. Fixed: `GameMap.tilesRev`
  bumped by every runtime tile mutator, folded into the memo key (`core/tile-rev.ts`).
- **All six barrier mass/join defects** (WP-U): stair stubs, gatehouse crowding + floating leaf,
  drum coverage, merlon seam phase, coursing mismatch, slope foot-z anchor.
- **Pads/wear under-firing** (half-firing F5/F6 adjacent): WP-V widened pad coverage + feather,
  added settle-in depth, doorstep + perimeter wear.
- **Docs drift** (audit 3, all five findings): ROADMAP track statuses, TECH_SPEC stale sections,
  VISION belief-power ledger, `lighting.ts` + `road-graph.ts` stale headers → docs-fix branch.

## P0 — Gameplay loops that don't close (round-7 core candidates)

1. **Rivals act blind + Fate's stance lever is inert** (sim F1; half-firing F2 — found
   independently twice). `decideRivalAction` strategy functions all take `_context` unused (pure
   rng+power) while `RivalSystem` pays a full NPC sweep per 0.5 Hz tick to build the situation
   they discard; `s.ai.policy` is set once at spawn and never recomputed, so `set_rival_stance`'s
   personality deltas move numbers no decision path reads. Fix (M): strategies read follower
   deltas/power; stance-apply recomputes policy from mutated personality. `src/sim/rival-spirit.ts:162-210`,
   `src/sim/command/authoring-verbs.ts:141`.
2. **`summon_storm` is unreachable — circular bootstrap** (half-firing F1). The `flood` domain is
   seeded only by floods, and floods are produced only by `summon_storm` itself (autoWeather is
   off + drives lakes, not `floodOffsetM`). `storm` bootstraps via ungated omen; flood has no
   ungated seeder. Fix (S): symmetric bootstrap (omen/dream over water-adjacent suffering, or
   natural-rain flood stamping). `src/sim/command/registry.ts:201`, `divine-actions.ts:391,413`.
3. **Faith turning points are invisible in the shipped UI** (sim F2). `belief_cross`/`mood_cross`
   fire every threshold crossing and surface only in the `?legacyui` glyph strip; the WebGPU
   chrome has no event feed. Fix (S-M): route into the divine inbox as transient items.
4. **Conviction unlock is globally diluted** (half-firing F3). `aggregateDomain` means over ALL
   faith-bearers world-wide while seeding is per-settlement → one fully-convinced town can't
   unlock `smite` (bar 0.5) once believers spread. Fix (S): per-/best-settlement conviction.
   `src/sim/belief-domains.ts:129-148`.
5. **NPC memory ring records 4 of ~12 event kinds** (sim F3) — omen/miracle witnesses, deaths,
   own faith surges never enter `recentEventIds`, so LLM narration is half-blind. Fix (S): push
   ids at the missing emit sites. `src/sim/divine-actions.ts`, `npc-sim-system.ts`.
6. **Scrub/commit carries ghost state in tick-system singletons** (persistence F2-F5, structural).
   `SettlementEventSystem.cooldowns`, `NpcSimSystem.beliefSides/moodSides`,
   `AbandonmentSystem.everBelieved/lapsed/announced`, `FateTrigger.claimTicks` all live outside
   the snapshot and are never reset on restore → a committed scrubbed timeline inherits eligibility/
   edge-detection state from the discarded future (can suppress state-mutating events). Fix (M,
   one pattern): systems get `onRestore` reset or `serialize()/hydrate()` driven by the timeline.
7. **Social belief propagation is net-weaker than baseline decay** (half-firing F4). Typical
   propagation ~0.0004 faith/tick vs decay 0.001 — organic spread withers; conversion is
   effectively divine-only. Tuning (S) + a sim check on whether a congregation self-sustains.

## P1 — Finished-but-dark features worth lighting (the "unwired" tier)

8. **Day/night**: a complete deterministic solar/lunar model (`studio/solar.ts`) runs only in the
   studio; runtime lighting is static. Plus a fully-plumbed **night window-glow** pipeline
   (emissive glass → shader `emissive × uNight`) dead behind `nightFactor: 0` and an uncalled
   `nightFactorForTick` (`calendar.ts:38`). Wiring both (M) transforms after-dark feel.
9. **Fate's world-authoring hands**: `place_building`/`grow_settlement`/`rename_ward`/`retype_ward`
   are implemented, tested, registered — zero emitters (not in FATE_TOOLS/UI/MCP). Exactly the
   "era-authoring half of the D2 loop" the roadmap wants. Plus `fateRole` written by `inject_npc`
   and read by nothing (one prompt-builder line), and Fate inbox spotlighting (`state.surfacedInbox`
   render path built, only the debug hook writes it).
10. **Storylet depth**: `FateDirector`/`StoryAgent` (AI enrichment + pacing) never instantiated —
    `game.ts` always falls back to `DumbDirector`; JSON pack ingest (`parsePack` + schema) never
    called — the reservoir is one hard-coded TS pack.
11. **Smaller unwired**: `branch` cards for answer_prayer/dream (declared, routing hardcoded to
    whisper); area-footprint targeting (plumbed, no capability declares it); `finishTint`
    polychrome + gilt/mossed/soot finishes (no palette assigns them); connectome water override
    (runtime consumes it, only the studio sets it); orphaned `spawnAllPoiNpcs`; `skirt`/`skirtFade`
    ground apron (parked behind reseed freeze).

## P2 — Polish, hygiene, guards

12. **Guard the SimEvent boundary** (sim F6): a test asserting every `SimEvent` variant has ≥1
    emit site and ≥1 real consumer would have caught three findings (the dead possession family,
    the unheard crossings, the starved memory ring) — same pattern as `story-pack-live-verbs`.
13. **Visual (non-barrier)**: tavern dormers read as sunken pits (`solids.ts:783` proportions —
    the one visual blocker outside barriers); church west-tower/nave roof notch (preset `x:0`,
    `w:2` vs nave 3); keep chimney-cube on flat roof; manor corner-straddling windows. Flora
    healthy. (Watermill wheel is a documented deferral.)
14. **Persistence insurance**: snapshot `waterLevelM` before the climate seam is wired (5 LOC);
    cap `TimelineController.discardedFutures` growth; use-or-delete the dead `snap.eventId`.
15. **Half-firing residue**: settlement-event `scarcityMod` is a constant 1.3× (`<3` never flips);
    Fate `nudge_event_severity` validates poi but not active-event presence; volcanic `cap` 0.66
    vs sites at ~0.63 (deliberate margin — leave, but documented here).

## Healthy (checked, explicitly cleared)

Belief-power economy reachable; granted-powers loop closes (storm side); lineage + mind-probe/
memory loops close; snapshot struct thorough (entities/spirits/threads/weather/trample) with dual
version gates; IDB fully guarded; art cache correctly recipe-keyed; flora renders shipped-quality;
in-code comments mostly honest (drift concentrated in ROADMAP/TECH_SPEC, now fixed).

## Suggested round-7 shape

- **Track A (gameplay): "close the loops"** — P0 items 1-5 + 7 are one coherent commission
  (rival/Fate wiring, flood bootstrap, inbox crossings, conviction locality, memory ring, propagation
  tuning) with the SimEvent guard (12) as its lint.
- **Track B (atmosphere): "let there be night"** — solar cycle + window glow (8), the single
  highest visible-payoff wiring in the codebase.
- **Track C (Fate agency)** — authoring verbs as Fate tools + fateRole + spotlight (9), then
  director/pack ingest (10) when conversation UI work resumes.
- **Track D (hygiene)** — scrub-ghost reset pattern (6) + persistence insurance (14) + visual
  polish batch (13).
