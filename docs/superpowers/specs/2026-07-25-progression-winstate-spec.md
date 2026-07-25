# Spec — Progression & win-state (Track 5)

**Date:** 2026-07-25 · **Status:** spec · **Brainstorm:** [../2026-07-25-progression-winstate-brainstorm.md](../2026-07-25-progression-winstate-brainstorm.md)
**Canon:** VISION 1.1.0 — §5 (god lifecycle), §7 (the Arc), §8 tenets 2/4/6/8
**Track:** ROADMAP Track 5 — the last ⬜ track.

> **Thesis:** a god is only as real as its belief. The sim already computes that
> number every second and discards it. Make it persistent, give it a name, and the
> arc's spine — tiers, fading, supplanting, the win-check — all hang off it.

**Cost: $0.** Sim only. No art, no LLM tier change, no paid gate.

---

## T5.0 — The reality number *(P0 — nothing else is measurable without it)*

**New module `src/sim/god-tier.ts`** — pure, no imports from systems, so tests and
UI can share it.

```ts
export type GodTier = 'nameless' | 'small' | 'cult' | 'major';
```

**Two derived scalars, both computed in the loop `SpiritSystem` already runs:**

- `beliefMass` — `Σ faith × (1 + 2·understanding) × (1 + 2·devotion)` over both
  population tiers. Already computed as `total`; today it is discarded.
- `intimacy` — mass-weighted mean of `understanding × devotion`, in `[0,1]`.
  Accumulated in the same pass (`Σ contribution·u·d / Σ contribution`), so the
  cost is one extra multiply-add per believer.
  **Named tier only.** `CohortBelief` carries `sumFaith`/`sumU`/`sumD`/
  `sumContribution` but *not* `Σ contribution·u·d`, and a mean-of-products is not
  a product-of-means — computing statistical intimacy from the available means
  would silently mix an exact sum with an approximation. Adding `sumUD` to
  `CohortBelief` is a codec bump and belongs to **T5.3**, where hollow major gods
  make statistical intimacy actually load-bearing. This mirrors M3's ruling that
  the named tier carries the full loop while the statistical tier records what it
  can. `beliefMass` is exact over **both** tiers.

**Tier edges**, calibrated against `FICTION_POP_BY_SIZE` (36/72/144/288) and a
measurement of the shipped default world (6 believers → mass 3.744):

| Tier | Mass | Anchor |
|---|---|---|
| `nameless` | < 1 | fewer than ~2 marginal believers — "nothing but names" |
| `small` | 1 – 40 | the default world starts here (3.7) |
| `cult` | 40 – 200 | one settlement converted at moderate depth (≈52) |
| `major` | ≥ 200 | multi-settlement (≈207) or a broad hollow church (≈423) |

**Hysteresis is mandatory** — a god sitting on an edge must not flicker its title
every tick. Each boundary is an independent in/out pair resolved against the
*previously committed* tier, exactly the `zoom-band.ts` pattern (±20% dead-zone).
`tierFor(mass, prev)` is pure and total.

**Storage.** `Spirit` gains `beliefMass?`, `intimacy?`, `tier?` — all **optional**,
so pre-T5.0 saves degrade for free and re-derive within one second. Spirits are
snapshotted wholesale via `structuredClone` (`snapshot.ts`), so **no snapshot.ts
change is needed** — the same free ride `ai` takes.

**No behaviour change in T5.0.** It only makes the number real and visible.

## T5.1 — Fading *(the god lifecycle — VISION §5, symmetric across all gods)*

A god whose mass stays below `FADE_MASS` (= the `nameless` edge, 1.0) for a
**sustained window** fades. Sustained, not instantaneous — one bad hour must not
kill a god.

- Window: `FADE_SUSTAIN_TICKS = 2 × TICKS_PER_DAY` (two game days). Per the
  house rule, constants meaning fiction-days are `TICKS_PER_DAY` multiples —
  never raw tick literals.
- `Spirit.belowSinceTick?: number` — set on first tick below the line, cleared on
  any tick at/above it. Rides the snapshot free; a scrub restores fade pressure
  correctly.
- Crossing the window sets `faded: true` and emits **`god_faded`**. Returning
  above the line clears it and emits **`god_returned`**. Both are new
  `events.ts` union members.

**What fading costs you — and the softlock it must not cause.**
A faded god **keeps `whisper` and loses everything else** (omen, dream, miracle,
answer-prayer, smite, summon-storm). This is canon, not a fudge: tenet 6 makes
whisper "the primal, contested channel," and *Small Gods* is a tortoise
whispering to one novice. Without the carve-out a faded player has no path back
and the lose-state is a dead end.

Enforced at the **single** existing choke point — the per-action guards in
`src/sim/divine-actions.ts` — so every caller (player commands, rival AI, Fate,
the bus) inherits it with no per-caller work.

**Symmetry is the payoff.** `RivalSystem` skips faded rivals and
`eligibleClaimants` (`rival-claims.ts`) excludes them, so starving a rival's last
settlement now actually kills it. That is Track 3's long-promised "supplanting"
with something behind it at last.

## T5.2 — Tier consequences *(what the title actually gates)*

Deferred to its own slice — the honest MVP is that tier is *legible* before it is
*mechanical*. Candidates, to be specced when T5.0/T5.1 are live: action
vocabulary by tier, cost scaling, reach/range, and the deferred Track 1 remnant
(devotion costly-acts gating).

## T5.3 — Major gods as endgame antagonists

Seeded high-mass / near-zero-intimacy spirits with priesthood-backed settlements.
Needs worldgen work (temples, doctrine) and should follow T5.2.

## T5.4 — Win by attribution

"The name mortals reach for in crisis **and** in plenty" — needs an attribution
ledger over answered prayers and settlement events, scored across both need
states. A real subsystem; it lands *after* the lifecycle it scores.

---

## Slice order

| # | Slice | Why here |
|---|---|---|
| **T5.0** | the reality number (`beliefMass` · `intimacy` · `tier`) | Everything else is a function of it. No behaviour change; ~free (the loop exists). |
| **T5.1** | fading (sustained-below → `faded`, whisper-only, symmetric) | The god lifecycle. Gives Track 3 its escalation as a side effect. |
| **T5.2** | tier consequences | Needs T5.0 live to tune against. |
| **T5.3** | major gods | Needs worldgen; the Act 3 antagonist. |
| **T5.4** | win by attribution | Scores the lifecycle — must come last. |

**T5.0 + T5.1 ship together** — a number nothing reads is not worth shipping, and
fading is the smallest consequence that makes it matter.

---

## Contracts (test targets)

1. `tierFor` is pure, total, and hysteretic — sweeping mass up then down yields no
   flicker at any edge, and the up/down paths differ only inside the dead-zones.
2. Tier edges match the calibration table (a 6-believer default world is `small`).
3. `intimacy` is 0 when U·D is 0 for all believers, 1 only when all are maxed, and
   is mass-weighted (one deep believer outweighs many shallow ones).
4. `beliefMass` counts **both** population tiers (named + cohorts), like the power
   loop it rides in; `intimacy` is named-tier-only and a cohorts-only spirit
   reports `intimacy` 0 with non-zero mass (documented, not a bug — see T5.0).
5. A god below the line for `FADE_SUSTAIN_TICKS − 1` is **not** faded; at the
   window it is, and `god_faded` fires **once** (the `depletedAlready` pattern).
6. A faded god can `whisper` and **cannot** omen/dream/miracle/answer-prayer/
   smite/summon-storm — asserted through the real guards, not a mock.
7. Returning above the line clears `faded`, emits `god_returned`, and restores the
   full action set.
8. Faded rivals are skipped by `RivalSystem` and excluded from `eligibleClaimants`.
9. Snapshot round-trip preserves `faded` / `belowSinceTick`; a **pre-T5.0 save**
   (no new fields) loads and re-derives within one tick.
10. `src/sim/` stays `Math.random`-free (the existing guard covers the new module).

---

## Reality check (2026-07-25) — T5.0 + T5.1 SHIPPED

Implemented per the slice table. No T5.2–T5.4 work: tier is now *legible*, not yet
*mechanical* beyond the fade rule.

- **`src/sim/god-tier.ts`** is the pure half — `tierFor` (hysteretic, total),
  `stepFading` (pure decision over the persisted pressure state), `isSilenced`,
  and the calibrated edges. `SpiritSystem` keeps the total it was already
  computing; the only added work is one multiply-add per believer for `intimacy`.
- **`Spirit` gained five optional fields** (`beliefMass`, `intimacy`, `tier`,
  `belowSinceTick`, `faded`) and **`snapshot.ts` was not touched** — spirits ride
  the snapshot via wholesale `structuredClone`, the free ride `ai` already takes.
  A pre-T5.0 save loads and re-derives within one tick (pinned by test).
- **Both transitions log once** via the `depletedAlready` pattern already in the
  system, now driven off the persisted `faded` flag instead of a side Set (so a
  timeline scrub can't desync the "already told you" state — the flag scrubs
  with the spirit).
- **The silencing gate went in at the existing per-action guards** in
  `divine-actions.ts` plus `canAfford`, so player commands, rival AI, Fate, and
  the dev bus inherit it with no per-caller work, and affordance previews agree
  with the sim.
- **Symmetry shipped:** `RivalSystem` skips faded rivals before the situation
  sweep, and `eligibleClaimants` drops them.

**Empirically checked, and it mattered.** `instantiateRivals` gives rivals
settlements but **no named believers**, so the obvious worry was that every rival
would fade on game-day 2 and Track 3 would die silently on every fresh world.
Measured through the real boot order (`seedWorld` → rivals → cohorts): the
statistical tier's believers *do* count, and a fresh default world starts at
**player 6.80 · rival-1 4.86 · rival-2 3.24** — all `small`, all 3×+ clear of
`FADE_MASS`. Pinned as a regression test so nobody can raise the fade line and
silently kill the rivals.

**Ambiguities resolved.** `intimacy` is named-tier-only (see T5.0 — `CohortBelief`
has no `Σ contribution·u·d`, and T5.3 is where hollow major gods make that codec
bump worth paying). A corrupted/non-finite mass reads as **nothing** rather than
crowning a god `major`, matching `stepFading`'s treatment of non-finite as
starving. Fade pressure **restarts** rather than resumes after any recovery tick —
a god that claws back a believer gets the full window again.

**Not built:** any consumer of `tier` beyond legibility and the fade rule (T5.2),
major gods (T5.3), the attribution ledger and win-check (T5.4). The player's fade
is currently a soft lose-state with no UI — surfacing it is Track 6 work.
