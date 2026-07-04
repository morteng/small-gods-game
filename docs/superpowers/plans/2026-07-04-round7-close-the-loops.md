# Round 7 — Close the Loops + Let There Be Night

**Status: LAUNCHED 2026-07-04, base SHA `7ab7d08` (main, WCV 81).**
Commissioned from the 2026-07-04 codebase-audit synthesis
(`docs/superpowers/2026-07-04-codebase-audit-synthesis.md`) — Track A (P0 items 1–5, 7 + the
SimEvent guard 12), the scrub-ghost structural fix (item 6 + persistence insurance 14), and
Track B day/night (item 8) as the round's visible payoff.

**Theme:** the audit's dominant pattern was *features built one integration point short of the
player*. Round 7 closes the P0 gameplay loops so the sim is honest (rivals actually think, Fate's
levers actually move things, belief economics actually work) and lights the single
highest-visible-payoff dark feature (day/night + window glow).

**Merge order: WP-A → WP-B → WP-C → WP-D → WP-E.**
(A is isolated in rival code; B and C both touch `divine-actions.ts` — C rebases over B; D
serializes system state that C may extend — D rebases over C; E is renderer-side, near-isolated.)

**No WCV bump expected** (no worldgen output changes). **SAVE_VERSION unchanged** — all new
snapshot state rides optional fields (established trample pattern). Sim stays deterministic
(`ctx.rng` only; guard test enforces).

---

## WP-A — Rival brain: strategies read the situation; stance recomputes policy

Audit P0 #1 (found independently by two auditors). `decideRivalAction` strategy functions all
take `_context` unused (decisions are pure rng+power) while `RivalSystem` pays a full NPC sweep
per 0.5 Hz tick to build the `RivalSituation` they discard. And `s.ai.policy` is computed once at
spawn, so `set_rival_stance`'s personality deltas (Fate's anti-snowball coaching lever) move
numbers **no decision path reads** — the lever is inert.

- Strategies consume `buildRivalSituation` output: per-settlement follower counts/deltas,
  unanswered-prayer pressure, own power — target choice and action choice must be data-driven
  (e.g., press where the player is weak/absent, claim where pressure is highest, consolidate when
  losing ground).
- Stance path: after `set_rival_stance` mutates personality, policy is **recomputed** from the
  mutated personality (or decisions read personality live — whichever is cleaner). A stance change
  must provably alter the action distribution.
- Preserve anti-snowball caps (±0.2 both sides of the LLM boundary) and determinism.
- Tests: same rng seed + two different situations → different decisions; stance change → policy
  change → behavior change; caps hold.

Key files: `src/sim/rival-spirit.ts` (≈162–210), `src/sim/rival-claims.ts`,
`src/sim/command/authoring-verbs.ts` (≈141, stance apply), `src/game/fate/` (tool boundary).

## WP-B — Belief economy closure: flood bootstrap, conviction locality, propagation tuning

Audit P0 #2, #4, #7 — one coherent belief-economics commission.

- **`summon_storm` circular bootstrap**: the `flood` domain is seeded only by floods, and floods
  are produced only by `summon_storm` itself. Give flood a symmetric ungated bootstrap mirroring
  storm's (omen/dream witnessed over water-adjacent suffering seeds flood understanding, and/or
  natural heavy-rain events stamp a small `floodOffsetM`). Consistent with VISION: a god's
  vocabulary = what its believers think it can do. (`src/sim/command/registry.ts` ≈201,
  `src/sim/divine-actions.ts` ≈391, 413.)
- **Conviction locality**: `aggregateDomain` means over ALL faith-bearers world-wide while seeding
  is per-settlement — one fully-convinced town can never unlock `smite` (bar 0.5) once believers
  spread. Switch to best-settlement (or per-settlement) conviction; handle settlement-less NPCs
  explicitly. (`src/sim/belief-domains.ts` ≈129–148.)
- **Propagation vs decay**: typical social propagation ~0.0004 faith/tick vs baseline decay
  0.001/tick — organic spread withers; conversion is effectively divine-only. Tune so a
  congregation above a modest size self-sustains with zero divine input while an isolated believer
  still decays. Tuning must be generative (formula/constants), not per-world hand-tuning.
- Tests: flood reachable from a fresh world via the bootstrap path; devout-town smite unlock;
  self-sustaining-congregation sim test (N believers, K ticks, no divine actions → faith holds;
  lone believer → decays).

## WP-C — The SimEvent boundary: crossings reach the player, memory ring completes, guard test

Audit P0 #3, #5 + P2 #12 — everything about events dying between producer and consumer.

- **Faith turning points → divine inbox**: `belief_cross`/`mood_cross` fire on every threshold
  crossing and surface only in the `?legacyui` glyph strip. Route them into the divine inbox as
  transient, auto-expiring, low-priority items rendered by the WebGPU chrome (reuse the existing
  inbox item machinery; add a kind only if needed). They must not drown out threats/pleas.
- **NPC memory ring**: `recentEventIds` records ~4 of ~12 SimEvent kinds — omen/miracle witnesses,
  deaths, own faith surges never enter it, so LLM narration is half-blind. Push ids at the missing
  emit sites (`src/sim/divine-actions.ts`, `src/sim/systems/npc-sim-system.ts`, mortality). Ring
  cap respected.
- **Guard test** (the `story-pack-live-verbs` lesson, next boundary over): a test asserting every
  `SimEvent` variant has ≥1 emit site and ≥1 real consumer. Dead variants (the possession family)
  either get wired minimally, deleted, or listed in an explicit in-test `KNOWN_DEAD` allowlist
  with a comment — no silent dead weight.

## WP-D — Scrub-ghost reset pattern + persistence insurance

Audit P0 #6 (structural) + P2 #14. Tick-system singletons carry state outside the snapshot and
never reset on restore: `SettlementEventSystem.cooldowns`, `NpcSimSystem.beliefSides/moodSides`,
`AbandonmentSystem.everBelieved/lapsed/announced`, `FateTrigger.claimTicks`. A committed scrubbed
timeline inherits eligibility/edge-detection state from the discarded future.

- **ONE pattern**: systems with internal state implement `serialize()/hydrate()` (or an
  `onRestore` reset where reconstruction is cheap/derivable), driven by snapshot/timeline restore.
  Snapshot gains an optional `systems?: Record<string, unknown>` field — SAVE_VERSION unchanged.
  Old saves (field absent) → systems reset cleanly.
- **Insurance**: snapshot `waterLevelM` (latent until the climate seam wires); cap
  `TimelineController.discardedFutures` growth; use-or-delete the dead `snap.eventId`.
- Tests: scrub-back + commit → no ghost state (e.g., a cooldown from the discarded future no
  longer suppresses an event; a belief_cross edge that fired in the discarded future re-fires);
  snapshot roundtrip with and without the optional field.

## WP-E — Let there be night: solar cycle + window glow

Audit P1 #8 — the single highest visible-payoff wiring in the codebase. A complete deterministic
solar/lunar model exists (`src/studio/solar.ts`) but runs only in the studio; runtime lighting is
static. Night window-glow is fully plumbed (emissive glass → shader `emissive × uNight`) but dead
behind a hardcoded `nightFactor: 0`, and `nightFactorForTick` (`src/core/calendar.ts` ≈38) has
zero callers.

- **Single authority**: `nightFactorForTick(state.clock)` drives `uNight` every frame; the solar
  model drives sun direction/elevation into the banded-lighting directional sun.
- Ambient dims at night but stays clamped for gameplay readability (the game must remain fully
  playable at midnight — err on the readable side); dusk/dawn color shift welcome if cheap.
- Window glow visible at night on lit-window buildings; zero effect at noon; grey-massing
  buildings (reseed freeze) must not glow garishly.
- Pure function of the clock (deterministic, scrub-safe); no per-frame allocation; WebGPU only.
  Default ON, no settings toggle required.
- Verify visually (offline render or browser + forced clock), not just by uniform values.

---

## Gates (round exit criteria)

1. `npm run build` green (tsc + vite).
2. Full suite green (~3664 tests; triage load-flakes per the round-6 protocol — re-run failing
   files alone before blaming the round).
3. `npm run lint:world` — 0 errors on both lint seeds.
4. Browser E2E: night render (forced late clock → dimmed scene + window glow, pixel-diff vs noon),
   a belief_cross inbox item appearing live, rival stance change observable via dev bus.
5. One push to main, deploy green.

## Deferred (named, not commissioned)

Fate authoring verbs as Fate tools + fateRole + inbox spotlight (Track C — next round candidate);
FateDirector/StoryAgent + parsePack ingest (wants conversation UI); visual polish batch (tavern
dormers, church notch, keep chimney, manor windows); scarcityMod dynamics; branch cards for
answer_prayer/dream; rival power-economics depth beyond what WP-A needs.
