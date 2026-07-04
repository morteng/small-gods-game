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
 *  6. COMMUNION (deterministic, R7 WP-B): every tick, faith an NPC already
 *     holds is reinforced in proportion to the believing neighbourhood around
 *     it, so a congregation of ~5+ self-sustains against baseline decay while
 *     an isolated believer still withers. Arithmetic at COMMUNION_RATE below.
 */

import type { Entity } from '@/core/types';
import { npcProps, forEachNpc } from '@/world/npc-helpers';
import { trustWeightedBeliefConnections } from '@/sim/social-graph';
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

// ── Communion (R7 WP-B): congregation self-sustenance ─────────────────────────
// The stochastic socialization above transfers an EXPECTED ~0.00045 faith/tick
// (0.2 socialize chance × trust 0.5 × faith 0.6 × (1−skep 0.5) × 0.015) — less
// than the baseline decay of FAITH_DECAY_BASE(0.002)×skepticism ≈ 0.001/tick
// (npc-sim.ts), and it does NOT scale with congregation size (one random
// neighbour per event). So organic faith always withered; conversion was
// divine-action-only. Communion is the deterministic counterpart: living among
// the faithful sustains faith, scaling with how much believing neighbourhood
// surrounds you, saturating so dense graphs can't run away.
//
//   inflow/tick = COMMUNION_RATE × sociability × (1 − skepticism/2)
//                 × min(1, S) × (1 − faith),
//   where S = Σ over neighbours with faith > 0.3 of trust × neighbourFaith
//   (trustWeightedBeliefConnections — the congregation term).
//
// Equilibrium arithmetic for the median NPC (sociability .5, skepticism .5,
// trust ~.5), balancing against decay = 0.002 × 0.5 = 0.001/tick:
//   inflow = 0.006 × .5 × .75 × min(1,S) × (1−f) = 0.00225 × min(1,S) × (1−f)
//   • saturated congregation (S ≥ 1): 0.00225(1−f*) = 0.001 → f* ≈ 0.556 —
//     a congregation holds faith ~0.56 with ZERO divine input.
//   • saturation needs S = (N−1)×0.5×f ≥ 1 at f≈0.556 → N ≥ ~4.6:
//     FIVE-plus mutual believers self-sustain.
//   • below saturation: inflow ≤ 0.00225×0.5(N−1)×f(1−f) ≤ 0.00225×0.5(N−1)×0.25
//     < 0.001 for N ≤ 4 → a pair or trio withers (slowly), and once faith drops
//     under the 0.3 influence threshold both channels cut out entirely.
//   • a LONE believer has S = 0 → pure decay → faith → 0. Isolation kills gods.
// Generative: the same formula scales with any congregation size/trust — no
// per-world hand-tuning.
const COMMUNION_RATE = 0.006;

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
      this.communeFrom(e, byId);
      this.propagateBeliefFrom(e, byId);
    }
  }

  /** Deterministic communion inflow — see the COMMUNION_RATE block above.
   *  Only reinforces beliefs the NPC already holds (seeding stays with the
   *  stochastic socialization path), so contagion remains contact-limited. */
  private communeFrom(e: Entity, all: Map<string, Entity>): void {
    const props = npcProps(e);
    const soc = props.personality.sociability;
    if (soc <= 0 || props.relationships.length === 0) return;
    const openness = 1 - 0.5 * props.personality.skepticism;
    for (const [spiritId, belief] of Object.entries(props.beliefs)) {
      const s = trustWeightedBeliefConnections(e, all, spiritId);
      if (s <= 0) continue;
      const delta = COMMUNION_RATE * soc * openness * Math.min(1, s) * (1 - belief.faith);
      if (delta <= 0) continue;
      belief.faith = Math.min(1, belief.faith + delta);
      belief.understanding = Math.min(1, belief.understanding + delta * UNDERSTANDING_FRAC);
      belief.devotion = Math.min(1, belief.devotion + delta * DEVOTION_FRAC);
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