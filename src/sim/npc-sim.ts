import { Random } from '@/core/noise';
import type { NpcRole, NpcPersonality, NpcNeeds, Entity } from '@/core/types';
import { npcProps, forEachNpc } from '@/world/npc-helpers';
import type { World } from '@/world/world';
import { clamp01 } from '@/core/math';
// Re-exported (consolidated from ~14 local copies into `@/core/math`) so the sim
// modules importing `clamp01` from this file keep working unchanged.
export { clamp01 };

// 1:1-REALTIME NOTE: the BELIEF half below is deliberately REAL-TIME tuned
// (rates are per 1 Hz fire = per real second at rate 1), NOT day-keyed. It's the
// live gameplay loop — whispers visibly move faith. Under the honest 24 h day
// this means belief moves a lot over a real day of ambient play; that is the
// intended idle-game direction. (Day-keyed lifecycle — mortality/births/
// growth/claims — runs on fiction days instead; see those systems.)
//
// The NEED half is NOT, and the difference is the whole of S2c. R8 converted the
// day from 240 ticks to 86,400 fires — a 360× stretch — and every rate here was
// left per-fire. That was CORRECT for any need whose INFLOW is also per-fire:
// `work` restores prosperity and `socialize` restores community on the same
// stretched clock, so those ratios survived the conversion untouched. It was
// wrong — by exactly 360× — for every need whose inflow is gated by something
// that is NOT per-fire:
//
//   • `meaning`  — inflow is A GOD'S ATTENTION (`answer_prayer`) plus the
//     festival. A god cannot answer 86,400 times a day, so `meaning` drained
//     full-to-empty in 250 REAL SECONDS and pinned at zero. Measured: 99.04% of
//     all NPC-time in `worship`, `socialize` fired 0 times in a game-hour, and
//     because a praying mortal cannot work/sleep/socialize the OTHER three needs
//     collapsed behind it (all four means < 0.12 after one game-hour).
//   • `safety`   — inflow is `sleep`, gated to NIGHT. A 15-hour waking day is
//     54,000 fires, so 0.001/fire emptied it 54× over before bedtime.
//   • `prosperity` — inflow is `work`, per-fire for working roles (fine), but
//     the vagrant roles (child/beggar/elder) have no work channel at all, so for
//     them it behaved like `meaning`.
//
// So the four rates are now denominated PER DAY and divided by the day, which
// states the fiction intent directly and survives any future tick-rate change.
// Per-day is also what the ORIGINAL constants meant: 0.004/fire × a 240-fire day
// = 0.96/day, i.e. "a full measure of meaning erodes in about a day". That
// fiction is restored here; only the denomination moved. See
// `RITE_MEANING_RESTORE` / `MORTAL_MEANING_CEILING` in `npc-activity-system.ts`
// for the mortal half of the meaning economy (rites cope; gods console).
export const SIM_TICK_MS = 1000;

/** 1 Hz fires in one solar day. Under 1:1 realtime a calendar day IS a 24-hour
 *  solar day and a fire is `SIM_TICK_MS`, so this is the seconds in a day —
 *  derived rather than written as 86,400 so a tick-rate change carries. */
export const FIRES_PER_DAY = (24 * 60 * 60 * 1000) / SIM_TICK_MS;

const FAITH_DECAY_BASE = 0.002;
const NEED_FAITH_BOOST = 0.001;
const COMFORT_THRESHOLD = 0.6;   // EVERY need above this → secularization pressure
const DESPERATION_THRESHOLD = 0.4; // ANY need below this → desperation pressure
const COMFORT_DECAY = 0.004;     // max extra faith decay from comfort, per fire
const ABANDON_DECAY = 0.006;     // extra faith decay while praying unanswered, per fire

// ── Need erosion, denominated PER DAY (see the note above) ───────────────────

/** A full measure of `meaning` erodes in ONE DAY with no god and no rite. The
 *  mortal channel (`RITE_MEANING_RESTORE`) outruns this 4:1 while a mortal is at
 *  the shrine, which is what sets the ~25% worship duty cycle: duty = decay/rite. */
export const MEANING_DECAY = 1.0 / FIRES_PER_DAY;

/** A waking day away from your own bed costs ~0.27 of `safety` (0.4/day over the
 *  15 waking hours), which a night's `sleep` restores several times over. The
 *  REAL pressure on safety is Fate's — raiders, plague — and those event effects
 *  are per-fire and unchanged, so they still dominate this baseline drift. */
export const SAFETY_DECAY = 0.4 / FIRES_PER_DAY;

/** A day without work leaves you destitute (1.0/day). A working mortal restores
 *  `SELF_AGENCY_RESTORE` many times an hour and sits near full; this rate is what
 *  the ROLES WITH NO WORK CHANNEL (child/beggar/elder) and a fully-tithed peasant
 *  (`workRestoreScale` → 0) actually fall at — a day of hunger, not 17 minutes. */
export const PROSPERITY_DECAY = 1.0 / FIRES_PER_DAY;

/** Belonging fades slowest of the four (0.5/day) — but it is the one need whose
 *  channel is genuinely per-fire, so this rate sets how often a mortal walks to
 *  the green (~1.7×/day from the `COMMUNITY_THRESHOLD` band). It must also be
 *  slow enough that a mortal held at the shrine by a standing plea for an hour or
 *  two does not have its belonging starve out from under it — that cross-need
 *  starvation is what turned one collapsed need into all four. */
export const COMMUNITY_DECAY = 0.5 / FIRES_PER_DAY;

const ROLE_PIETY_BONUS: Record<NpcRole, number> = {
  priest:   0.3,
  elder:    0.1,
  farmer:   0.0,
  merchant: -0.1,
  soldier:  -0.1,
  noble:    0.0,
  child:    0.05,
  beggar:   0.1,
};

/** Fraction of a divine signal's effect an NPC absorbs, gated by understanding.
 *  understanding=0 → SIGN_RESPONSE_FLOOR; understanding=1 → 1.0. */
export const SIGN_RESPONSE_FLOOR = 0.5;
export function signResponse(understanding: number): number {
  const u = clamp01(understanding);
  return SIGN_RESPONSE_FLOOR + (1 - SIGN_RESPONSE_FLOOR) * u;
}

export function personalityFromSeed(seed: number, role: NpcRole): NpcPersonality {
  const rng = new Random(seed);
  const piety = clamp01(rng.next() + ROLE_PIETY_BONUS[role]);
  return {
    assertiveness: rng.next(),
    skepticism:    rng.next(),
    piety,
    sociability:   rng.next(),
  };
}

export function computeMood(needs: NpcNeeds): number {
  return (needs.safety + needs.prosperity + needs.community + needs.meaning) / 4;
}

/** Fixed iteration order → deterministic argmin tie-break. Deliberately the
 *  same order as `NEED_KEYS` in `npc-activity-system`, so the need a mortal
 *  is desperate about and the need they actually pray about (`prayerSubject`)
 *  break ties the same way. */
const NEED_KEYS: readonly (keyof NpcNeeds)[] = ['safety', 'prosperity', 'community', 'meaning'];

/**
 * Need DIRECTION (VISION §9 row 11): the axis under most pressure right now,
 * and its level. `computeMood` remains the scalar mean — that is the mood/UI
 * number and has other consumers; this is the one belief reads, because a
 * mortal starving in a safe village is suffering, and the mean cannot see it.
 */
export function lowestNeed(needs: NpcNeeds): { need: keyof NpcNeeds; value: number } {
  let need = NEED_KEYS[0];
  let value = needs[need];
  for (const k of NEED_KEYS) {
    if (needs[k] < value) { need = k; value = needs[k]; }
  }
  return { need, value };
}

// ─── Entity-based sim functions ──────────────────────────────────────────────

export function tickNpcEntity(e: Entity): void {
  const p = npcProps(e);

  if (p.whisperCooldown > 0) p.whisperCooldown -= 1;

  // VISION §9 row 11 — needs reach belief as a DIRECTION, not a scalar mean.
  // Belief reads the WORST need: suffering on one axis is suffering however
  // well-served the other three are, and "comfort" means ALL needs met, not a
  // comfortable average. (Under the old mean, a pressure that drained
  // `prosperity` while supplying `safety` in equal measure was a literal no-op
  // on faith — tenet 1 says belief is born from need, and the engine could not
  // see WHICH need.) It is also the same axis the mortal prays about:
  // `prayerSubject` picks the lowest need past its worship threshold.
  const worstNeed = lowestNeed(p.needs).value;
  const inWorship = p.activity === 'worship';

  for (const belief of Object.values(p.beliefs)) {
    let decay = FAITH_DECAY_BASE * p.personality.skepticism;
    // Comfort decay: met needs erode faith (secularization). Resisted by devotion.
    // Gated on the worst need, so one collapsing axis suspends secularization.
    if (worstNeed > COMFORT_THRESHOLD) {
      decay += COMFORT_DECAY * ((worstNeed - COMFORT_THRESHOLD) / (1 - COMFORT_THRESHOLD)) * (1 - belief.devotion);
    }
    // Abandonment decay: an unanswered standing plea bleeds faith. Resisted by devotion.
    if (inWorship) {
      decay += ABANDON_DECAY * (1 - belief.devotion);
    }
    belief.faith = clamp01(belief.faith - decay);
  }

  // Desperation boost: a collapsing need makes existing believers cling harder
  // (fear breeds belief) — keyed on the worst axis, not the average, so the
  // boost tracks the same suffering the mortal is on their knees about.
  if (worstNeed < DESPERATION_THRESHOLD) {
    const desperation = (DESPERATION_THRESHOLD - worstNeed) / DESPERATION_THRESHOLD;
    const boost = NEED_FAITH_BOOST * desperation * p.personality.piety;
    for (const belief of Object.values(p.beliefs)) {
      belief.faith = clamp01(belief.faith + boost);
    }
  }

  p.needs.safety     = clamp01(p.needs.safety     - SAFETY_DECAY);
  p.needs.prosperity = clamp01(p.needs.prosperity - PROSPERITY_DECAY);
  p.needs.community  = clamp01(p.needs.community  - COMMUNITY_DECAY);
  p.needs.meaning    = clamp01(p.needs.meaning    - MEANING_DECAY);

  p.mood = computeMood(p.needs);
}

export function tickAllNpcEntities(world: World): void {
  forEachNpc(world, tickNpcEntity);
}
