import { Random } from '@/core/noise';
import type { NpcRole, NpcPersonality, SpiritBelief, NpcNeeds, Entity } from '@/core/types';
import { npcProps, forEachNpc } from '@/world/npc-helpers';
import type { World } from '@/world/world';

export const SIM_TICK_MS = 1000;
const FAITH_DECAY_BASE = 0.002;
const NEED_FAITH_BOOST = 0.001;
const COMFORT_THRESHOLD = 0.6;   // avg needs above this → secularization pressure
const COMFORT_DECAY = 0.004;     // max extra faith decay from comfort, per tick
const ABANDON_DECAY = 0.006;     // extra faith decay while praying unanswered, per tick
const MEANING_DECAY = 0.004;     // the divine need decays fast enough to drive prayers

const ROLE_FAITH: Record<NpcRole, number> = {
  priest:   0.7,
  elder:    0.5,
  farmer:   0.3,
  merchant: 0.25,
  soldier:  0.2,
  noble:    0.3,
  child:    0.4,
  beggar:   0.5,
};

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

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
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

// ─── Entity-based sim functions ──────────────────────────────────────────────

export function tickNpcEntity(e: Entity): void {
  const p = npcProps(e);

  if (p.whisperCooldown > 0) p.whisperCooldown -= 1;

  const avgNeeds = computeMood(p.needs);
  const inWorship = p.activity === 'worship';

  for (const belief of Object.values(p.beliefs)) {
    let decay = FAITH_DECAY_BASE * p.personality.skepticism;
    // Comfort decay: met needs erode faith (secularization). Resisted by devotion.
    if (avgNeeds > COMFORT_THRESHOLD) {
      decay += COMFORT_DECAY * ((avgNeeds - COMFORT_THRESHOLD) / (1 - COMFORT_THRESHOLD)) * (1 - belief.devotion);
    }
    // Abandonment decay: an unanswered standing plea bleeds faith. Resisted by devotion.
    if (inWorship) {
      decay += ABANDON_DECAY * (1 - belief.devotion);
    }
    belief.faith = clamp01(belief.faith - decay);
  }

  // Desperation boost: low needs make existing believers cling harder (fear breeds belief).
  if (avgNeeds < 0.4) {
    const desperation = (0.4 - avgNeeds) / 0.4;
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
