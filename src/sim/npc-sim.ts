import { Random } from '@/core/noise';
import type { NpcRole, NpcPersonality, SpiritBelief, NpcNeeds, NpcSimState, Entity } from '@/core/types';
import { npcProps, forEachNpc } from '@/world/npc-helpers';
import type { World } from '@/world/world';

export const SIM_TICK_MS = 1000;
const FAITH_DECAY_BASE = 0.002;
const NEED_FAITH_BOOST = 0.001;

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

export function initNpcSim(npcId: string, name: string, role: NpcRole, seed: number): NpcSimState {
  const personality = personalityFromSeed(seed, role);
  const baseFaith = ROLE_FAITH[role] * (0.5 + personality.piety * 0.5);

  const needsRng = new Random(seed ^ 0xdeadbeef);
  const jitter = () => (needsRng.next() - 0.5) * 0.2;

  const needs: NpcNeeds = {
    safety:     clamp01(0.6 + jitter()),
    prosperity: clamp01(0.5 + jitter()),
    community:  clamp01(0.55 + jitter()),
    meaning:    clamp01(0.45 + jitter()),
  };

  const belief: SpiritBelief = {
    faith:         clamp01(baseFaith),
    understanding: 0.1,
    devotion:      0.05,
  };

  return {
    npcId,
    name,
    role,
    personality,
    beliefs: { player: belief },
    needs,
    mood: computeMood(needs),
    recentEvents: [],
    whisperCooldown: 0,
  };
}

export function computeMood(needs: NpcNeeds): number {
  return (needs.safety + needs.prosperity + needs.community + needs.meaning) / 4;
}

export function tickNpcSim(sim: NpcSimState): void {
  // 0. Decrement whisper cooldown
  if (sim.whisperCooldown > 0) sim.whisperCooldown -= 1;

  // 1. Decay faith per spirit
  for (const belief of Object.values(sim.beliefs)) {
    const decay = FAITH_DECAY_BASE * sim.personality.skepticism;
    belief.faith = clamp01(belief.faith - decay);
  }

  // 2. Low-need desperation boosts faith
  const avgNeeds = computeMood(sim.needs);
  if (avgNeeds < 0.4) {
    const desperation = (0.4 - avgNeeds) / 0.4;
    const boost = NEED_FAITH_BOOST * desperation * sim.personality.piety;
    for (const belief of Object.values(sim.beliefs)) {
      belief.faith = clamp01(belief.faith + boost);
    }
  }

  // 3. Slow natural need decay
  sim.needs.safety     = clamp01(sim.needs.safety     - 0.001);
  sim.needs.prosperity = clamp01(sim.needs.prosperity - 0.001);
  sim.needs.community  = clamp01(sim.needs.community  - 0.0005);
  sim.needs.meaning    = clamp01(sim.needs.meaning    - 0.0005);

  // 4. Recompute mood
  sim.mood = computeMood(sim.needs);
}

export function tickAllNpcs(sims: Map<string, NpcSimState>): void {
  for (const sim of sims.values()) {
    tickNpcSim(sim);
  }
}

// ─── Entity-based sim functions (Spec A migration target) ────────────────────

/** Entity-based version of tickNpcSim. Spec A migration target. */
export function tickNpcEntity(e: Entity): void {
  const p = npcProps(e);

  if (p.whisperCooldown > 0) p.whisperCooldown -= 1;

  for (const belief of Object.values(p.beliefs)) {
    const decay = FAITH_DECAY_BASE * p.personality.skepticism;
    belief.faith = clamp01(belief.faith - decay);
  }

  const avgNeeds = computeMood(p.needs);
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
  p.needs.meaning    = clamp01(p.needs.meaning    - 0.0005);

  p.mood = computeMood(p.needs);
}

export function tickAllNpcEntities(world: World): void {
  forEachNpc(world, tickNpcEntity);
}
