# Rival power-economics + contention depth — spec

**Status:** implementing 2026-07-20 · Track 3 remainder (handoff plan §5.2, ROADMAP Track 3)
**Canon:** VISION §4 (anti-snowball counter-loop), §5 (rivals learn the player; player-modelling
lives in rivals, not Fate). One power formula for every god.

## Reality check (code, 2026-07-20)

The economy is ALREADY symmetric at the mechanism level — this spec tunes and deepens it, it
does not build a parallel one:

- Rivals are plain non-player `Spirit`s. Same `power` field, same regen
  (`SpiritSystem`: `faith × (1 + 2·understanding) × (1 + 2·devotion)` summed over own believers
  × `POWER_REGEN_RATE 0.02`/s), same cost table (`divine-actions.ts`: whisper 1, omen 3,
  miracle 10, answer_prayer 2), same `insufficient_power` gate in the shared command executor.
- `RivalSpirit.maxPower` (20) is **display-only** — nothing clamps regen for anyone.
- `RivalSituation` (rival-claims.ts) is entirely player-relative: `playerPower`,
  `playerFollowersInSettlement`, own followers/deltas, prayer pressure. **No other-rival data.**
- `undermineStrategy` hardcodes `PLAYER_SPIRIT_ID` as the victim. `expandStrategy` picks the
  settlement where the *player* is weakest — other rivals are invisible opposition.
- Domain-matched claiming (M0), stance coaching ±0.2 (Fate), claim collisions (deterministic,
  no pre-reservation) are all live. Unanswered prayers already bleed faith (`ABANDON_DECAY`).

## Decisions

- **D1 — power stays uncapped for ALL spirits.** `maxPower` remains display normalization
  (document at the field). Anti-snowball lives in spend pressure (D3), mutual contention (D5),
  and Fate stance coaching — not in a bank ceiling. (A cap would have to hit the player too to
  stay symmetric, and that changes player feel — out of scope.)
- **D2 — idle-poor guard.** A rival with `power < WHISPER_COST` skips the situation build
  entirely (it cannot afford even the cheapest act; the sweep is the expensive part).
- **D3 — spend/save policy (the "economics").** Named constants in `rival-spirit.ts`:
  - `AMBITION_BANK = MIRACLE_COST` (import, never a raw 10).
  - `WEALTH_PRESSURE = 0.25` — in `expandStrategy`, miracle probability becomes
    `min(0.95, 0.2 + 0.5·aggression + WEALTH_PRESSURE · min(1, (power − AMBITION_BANK) / AMBITION_BANK))`
    (the pressure term is 0 below the bank). A rival sitting on 2× a miracle always leans miracle
    — banked power flows back out.
  - **Save-for-miracle:** in `expandStrategy`, when `aggression > 0.6`,
    `AMBITION_BANK/2 ≤ power < AMBITION_BANK`, and the chosen settlement is *contested*
    (opposing followers > own there), roll `rng() < 0.5` → return `null` (hold the whisper,
    bank for the big play). A war chest, not a dribble.
- **D4 — other-rival awareness in `RivalSituation`.** New fields, built in the SAME NPC pass
  (no extra world scans):
  - `opposingFollowersInSettlement: Record<string, number>` — player + every other non-player
    spirit's practising believers per POI (the true opposition field).
  - `otherRivals: { id: SpiritId; power: number; followerTotal: number;
    followersInSettlement: Record<string, number> }[]` — every non-player spirit ≠ self with
    `ai.personality`, deterministic order (sorted by id).
  - Cohort (P1) tier: fold other-rival counts in IF the existing cohort fold-in generalizes
    cheaply; otherwise leave the fields NPC-tier-only with an honest comment + spec note here.
- **D5 — contention targeting** (no new command verbs; contention = who you aim at):
  - `undermineStrategy`: victim = the **strongest opponent god overall** (player or other
    rival) by follower total; strike their strongest settlement. Jealousy is about the biggest
    god, not specifically the player.
  - `expandStrategy`: "weakest settlement" now measured against `opposingFollowersInSettlement`
    (all opposition), not player-only.
  - `defendStrategy` / `coexistStrategy`: unchanged (defend already reacts to losses whoever
    inflicted them).
  - `RivalAction` gains transient `targetSpiritId?: SpiritId` (the god being contested) —
    never persisted.
- **D6 — dispute event.** When `RivalSystem` emits an action whose `targetSpiritId` is another
  NON-PLAYER spirit, it also logs a `rival_dispute` event:
  `{ type: 'rival_dispute', spiritId: <actor rival>, data: { otherRivalId, poiId } }` —
  following the existing system event-emission pattern (as `belief_cross` does). Deterministic.
- **D7 — surfacing.** `GameQuery.divineInbox` gains a tiding generator: scan the event log over
  `TICKS_PER_DAY` for `rival_dispute`, coalesce per settlement →
  `"Spirits contend over {settlement}"` (kind `'tiding'`, low salience, anchored at the POI).
  Auto-expires by falling out of the horizon, same as claim notices.
- **D8 — caps untouched.** Contention reuses whisper/omen effect magnitudes (already capped);
  `set_rival_stance` ±0.2 untouched. No new belief-delta paths.
- **D9 — no WCV / SAVE change.** All new situation data is derived live; `RivalAction` is
  transient. Nothing new is persisted on `Spirit`.

## Acceptance

- Unit: situation carries other-rival fields (deterministic order); undermine strikes the
  dominant OTHER rival when it dwarfs the player; expand counts all opposition; wealth pressure
  raises miracle odds only above the bank; save-for-miracle holds under the exact conditions;
  idle-poor guard skips the sweep; `rival_dispute` logged only for rival-vs-rival targets;
  tiding surfaces + expires at horizon.
- Existing pins updated honestly (rival-brain / rival-claims / rival-spirit / rival-system),
  same-seed determinism test extended, `timeline-replay-rivals` stays green.
- Full server CI green before push. No WCV bump (sim behavior only, no gen output).
