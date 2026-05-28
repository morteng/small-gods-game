/**
 * BeliefPropagationSystem — spread faith/understanding/devotion along social
 * graph edges when NPCs socialize.
 *
 * Rules:
 *  1. Each tick, every NPC with sociability > 0 has a chance to "socialize"
 *     with a relationship neighbor. Probability = sociability × 0.4.
 *  2. On socialization, the NPC picks a random relationship neighbor and
 *     receives a belief-delta proportional to:
 *       trust × neighborFaith × (1 - skepticism) × PROPAGATION_RATE
 *  3. Understanding and devotion receive smaller fractional boosts.
 *  4. Unreciprocated belief (neighbor believes, NPC doesn't) is seeded with
 *     a tiny faith starting value.
 *  5. Threshold: neighbor's faith must be > 0.3 for the edge to matter.
 */

import type { Entity } from '@/core/types';
import { npcProps, forEachNpc } from '@/world/npc-helpers';
import { Random } from '@/core/noise';
import type { System, SystemContext } from '@/core/scheduler';

/** Base faith transfer per socialization event */
const PROPAGATION_RATE = 0.015;

/** Fraction of faith transferred to understanding */
const UNDERSTANDING_FRAC = 0.3;

/** Fraction of faith transferred to devotion */
const DEVOTION_FRAC = 0.15;

/** Faith threshold for a neighbor to be influential */
const INFLUENCE_THRESHOLD = 0.3;

/** Minimum sociability to socialize at all */
const MIN_SOCIABILITY = 0.1;

/** Starting faith when a new spirit belief is seeded via social graph */
const SEED_FAITH = 0.05;

export class BeliefPropagationSystem implements System {
  readonly name = 'belief_propagation';
  readonly tickHz = 1;
  private rng = new Random(0);

  tick(ctx: SystemContext): void {
    // Build a convenient lookup from the ECS
    const byId = new Map<string, Entity>();
    forEachNpc(ctx.world, e => byId.set(e.id, e));

    // Seed RNG from world RNG so the sim stays deterministic
    this.rng = new Random(ctx.rng.next() * 0x7fffffff);

    for (const e of byId.values()) {
      this.propagateBeliefFrom(e, byId);
    }
  }

  private propagateBeliefFrom(e: Entity, all: Map<string, Entity>): void {
    const props = npcProps(e);
    if (props.personality.sociability < MIN_SOCIABILITY) return;
    if (props.relationships.length === 0) return;

    // Compute socialization probability per tick
    const socializeChance = props.personality.sociability * 0.4;
    if (this.rng.next() >= socializeChance) return;

    // Pick a random relationship neighbor
    const rel = props.relationships[Math.floor(this.rng.next() * props.relationships.length)];
    const neighbor = all.get(rel.npcId);
    if (!neighbor) return;

    const nProps = npcProps(neighbor);

    // For each spirit the neighbor believes in above threshold
    for (const [spiritId, nBelief] of Object.entries(nProps.beliefs)) {
      if (nBelief.faith <= INFLUENCE_THRESHOLD) continue;

      // Get or seed the NPC's belief in this spirit
      let myBelief = props.beliefs[spiritId];
      if (!myBelief) {
        // Seed a new belief
        props.beliefs[spiritId] = { faith: SEED_FAITH, understanding: 0, devotion: 0 };
        myBelief = props.beliefs[spiritId];
      }

      // Faith delta: trust × neighborFaith × (1 - skepticism) × base rate
      const skepticism = props.personality.skepticism;
      const rawDelta = rel.trust * nBelief.faith * (1 - skepticism) * PROPAGATION_RATE;

      // Clamp to avoid runaway propagation in dense graphs
      const cappedDelta = Math.min(rawDelta, 0.05);

      myBelief.faith = Math.min(1, myBelief.faith + cappedDelta);
      myBelief.understanding = Math.min(1, myBelief.understanding + cappedDelta * UNDERSTANDING_FRAC);
      myBelief.devotion = Math.min(1, myBelief.devotion + cappedDelta * DEVOTION_FRAC);
    }
  }
}