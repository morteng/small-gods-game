# Brainstorm — Progression & win-state (Track 5)

**Date:** 2026-07-25 · **Status:** brainstorm
**Canon:** VISION 1.1.0 — §5 (the cast of gods + god lifecycle), §7 (the Arc), §8 tenets 2/4/8
**Track:** ROADMAP Track 5 — the last ⬜ track, and the arc's spine.

---

## The gap, stated honestly

The engine is mature and the belief model is closed. What's missing is that
**belief has no consequence for the god holding it.** Verified in code today:

- `Spirit` carries exactly one scalar — `power` — and it is **uncapped by design**
  (Track 3 note). It is a spend-bucket, not a measure of what you *are*.
- There is no tier, no fading threshold, no major god, no win-state. `grep` for
  `godTier|fadingThreshold|majorGod|winState` returns **nothing**.
- A god with zero believers emits `power_depleted` once and then sits there,
  fully alive, forever. VISION §5's "god lifecycle" is **entirely unimplemented**.

So: you can grow belief, spend belief, and lose belief to rivals — and none of it
changes what you *are*, and none of it can ever *end*.

## The insight this track turns on

`SpiritSystem.tick()` **already computes the number.** Every sim second it walks
both population tiers and sums, per spirit:

```
contribution = faith × (1 + 2·understanding) × (1 + 2·devotion)
```

…and then **throws the total away** after multiplying it by `POWER_REGEN_RATE`.

That total is not a power-regen input. It is *how real the god is* — mass of
belief, weighted by exactly the two qualities VISION says make belief durable.
Tier, fading, and the win-check are all pure functions of a number the sim is
already paying for. **This is the M0 of Track 5: the decisive half is small.**

## Two axes, not one

Mass alone can't express VISION §5's central asymmetry — major gods are
**powerful but hollow**, "beatable precisely because they stopped answering
needs." Force can't dislodge them; intimacy can. So the same loop derives a
second number for free:

- **`beliefMass`** — how *big* (the sum above). Drives tier and fading.
- **`intimacy`** — how *deep* per believer: the mass-weighted mean of
  `understanding × devotion`. Drives hollowness.

A small god has tiny mass and (if played well) high intimacy. A major god has
enormous mass and near-zero intimacy. That is the endgame matchup in two floats,
and it makes "undercut them with intimacy" a thing the sim can actually score.

## Tiers, anchored to real population numbers

Not invented — calibrated against `FICTION_POP_BY_SIZE` (small 36 · medium 72 ·
large 144 · huge 288) and a measurement of the shipped default world:

| Situation | Souls | Mass | Tier |
|---|---|---|---|
| Default world at t=0 (measured: 6 believers @ 0.624) | 6 | **3.7** | small |
| One small settlement converted, moderate depth (f .5/U .3/D .4) | 36 | **52** | cult |
| Two-to-three settlements, deeper | 144 | **207** | major |
| A hollow regional church (f .5/U .2/D .2 — broad, shallow) | 432 | **423** | major |

Edges land at **1 · 40 · 200**, with hysteresis so a god on a boundary can't
flicker between titles.

## The fading rule — and the softlock it must not cause

Canon: faith→0 across believers shrinks a god toward "nothing but names" (the
tortoise), and this applies to **you, rivals, and great gods alike**.

The obvious implementation — faded gods can't act — **softlocks the player**: at
zero believers you'd have no way to earn a believer back. Resolution, and it is
canon-faithful rather than a fudge: **a faded god keeps the whisper.** Tenet 6
makes whisper "the primal, contested channel," and the whole of *Small Gods* is
a tortoise whispering to one novice. Everything else (omen, dream, miracle,
answer-prayer, smite, storm) goes dark until belief returns.

That single carve-out turns the lose-state into the game's best story beat
instead of a dead end.

## What this unlocks elsewhere

- **Track 3 gets its escalation.** "Supplanting = starving rivals until they
  fade" has been in the roadmap since the start with nothing behind it. Fading is
  symmetric, so taking a rival's last settlement now genuinely kills them.
- **Track 1's deferred remnant** (devotion costly-acts gating) gets its gate.
- **Fate gets stakes it can read** — tier and fade-pressure are exactly the
  "story beat" signals `FateTrigger` is built to wake on.

## Deliberately NOT in the first slices

Win-by-attribution needs an attribution ledger ("the name reached for in crisis
*and* in plenty") — that's a real subsystem, and it should land *after* the
lifecycle it scores. Major gods as seeded antagonists need worldgen work. Act 0
and the Book are Track 6 surfaces. Slice order in the spec.
