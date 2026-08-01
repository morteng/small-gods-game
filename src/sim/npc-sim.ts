import { Random } from '@/core/noise';
import type { NpcRole, NpcPersonality, NpcNeeds, Entity } from '@/core/types';
import { npcProps, forEachNpc } from '@/world/npc-helpers';
import type { World } from '@/world/world';
import { clamp01 } from '@/core/math';
// Re-exported (consolidated from ~14 local copies into `@/core/math`) so the sim
// modules importing `clamp01` from this file keep working unchanged.
export { clamp01 };

// 1:1-REALTIME NOTE: the belief/need economy below is deliberately REAL-TIME
// tuned (rates are per 1 Hz fire = per real second at rate 1), NOT day-keyed.
// It's the live gameplay loop — whispers visibly move faith, meaning decays
// fast enough to drive prayers while you watch. Under the honest 24 h day this
// means belief moves a lot over a real day of ambient play; that is the
// intended idle-game direction. (Day-keyed lifecycle — mortality/births/
// growth/claims — runs on fiction days instead; see those systems.)
export const SIM_TICK_MS = 1000;
const FAITH_DECAY_BASE = 0.002;
const NEED_FAITH_BOOST = 0.001;
const COMFORT_THRESHOLD = 0.6;   // EVERY need above this → secularization pressure
const DESPERATION_THRESHOLD = 0.4; // ANY need below this → desperation pressure
const COMFORT_DECAY = 0.004;     // max extra faith decay from comfort, per fire
const ABANDON_DECAY = 0.006;     // extra faith decay while praying unanswered, per fire
const MEANING_DECAY = 0.004;     // the divine need decays fast enough to drive prayers

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

  p.needs.safety     = clamp01(p.needs.safety     - 0.001);
  p.needs.prosperity = clamp01(p.needs.prosperity - 0.001);
  p.needs.community  = clamp01(p.needs.community  - 0.0005);
  p.needs.meaning    = clamp01(p.needs.meaning    - MEANING_DECAY);

  p.mood = computeMood(p.needs);
}

export function tickAllNpcEntities(world: World): void {
  forEachNpc(world, tickNpcEntity);
}
