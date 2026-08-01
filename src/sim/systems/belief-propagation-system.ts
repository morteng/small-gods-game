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

import type { Entity, EntityId } from '@/core/types';
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

// ── Communion (R7 WP-B; de-saturated 2026-08-01, scaling P2b S2b.1) ───────────
// The stochastic socialization above transfers an EXPECTED ~0.00045 faith/tick
// (0.2 socialize chance × trust 0.5 × faith 0.6 × (1−skep 0.5) × 0.015) — less
// than the baseline decay of FAITH_DECAY_BASE(0.002)×skepticism ≈ 0.001/tick
// (npc-sim.ts), and it does NOT scale with congregation size (one random
// neighbour per event). So organic faith always withered; conversion was
// divine-action-only. Communion is the deterministic counterpart: living among
// the faithful sustains faith, scaling with how much believing neighbourhood
// surrounds you.
//
//   inflow/tick = COMMUNION_RATE × sociability × (1 − skepticism/2)
//                 × g(S) × (1 − faith),
//   where S = Σ over neighbours with faith > 0.3 of trust × neighbourFaith
//   (trustWeightedBeliefConnections — the congregation term) and g is the
//   congregation curve below.
//
// g, NOT min(1, S): the old saturation made congregation strength FLAT above
// S ≈ 1 (≈5 mutual believers), so a 50-strong congregation was worth exactly
// what a 5-strong one was — the belief economy was sublinear by construction,
// the opposite of what settlement-scaling theory predicts. `congregationCurve`
// is concave (diminishing returns) but UNBOUNDED: bigger congregations keep
// paying, forever, just less per head.
//
// Equilibrium arithmetic for the median NPC (sociability .5, skepticism .5,
// trust ~.5), balancing against decay = 0.002 × 0.5 = 0.001/tick. Write
// A = COMMUNION_RATE × .5 × .75 = 0.00345, and for a mutual congregation of N
// all at faith f, S = (N−1) × 0.5 × f:
//   inflow(f) = A × g(0.5(N−1)·f) × (1−f)
//   • SUSTAIN CONDITION — peak inflow over f must clear decay:
//       max_f g(0.5(N−1)f)(1−f) ≥ 0.001/A = 0.290  ⇒  N ≥ 4.57.
//     FIVE-plus mutual believers self-sustain; four or fewer wither (slowly),
//     and once faith drops under the 0.3 influence threshold both channels cut
//     out entirely. THE OLD CURVE PUT THIS BOUNDARY AT N ≥ 4.56 —
//     holding that tuned equilibrium is what COMMUNION_RATE 0.006 → 0.0092
//     buys, and it is why g is linear (not √) near S = 0: the whole
//     small-congregation arithmetic is unchanged, only the tail moved.
//   • a LONE believer has S = 0 → g(0) = 0 → pure decay → faith → 0.
//     Isolation kills gods.
//   • the resting faith a congregation holds now GROWS with its size, where the
//     old curve pinned every N ≥ 5 to the same saturated f* ≈ 0.556:
//         N =  5 → S = 2.0f  → f* ≈ 0.58   (old 0.556)
//         N =  8 → S = 3.5f  → f* ≈ 0.76   (old 0.556)
//         N = 50 → S = 24.5f → f* ≈ 0.93   (old 0.556)
//     (deterministic channel alone; the stochastic socialization bonus adds on
//     top and lifts all three, preserving the ordering.)
// Generative: the same formula scales with any congregation size/trust — no
// per-world hand-tuning.
const COMMUNION_RATE = 0.0092;

/**
 * Congregation strength from the trust-weighted believing neighbourhood S.
 * The positive root of `g(1 + g) = S`, i.e. `g(S) = (√(1+4S) − 1) / 2` — the
 * simplest curve that is LINEAR as S → 0 (g ≈ S: a lone pair's arithmetic is
 * the pre-2026-08-01 arithmetic) and √-ASYMPTOTIC as S → ∞ (g ≈ √S: a city
 * congregation keeps paying, with diminishing returns per head). Concave and
 * unbounded — never saturating, which was the defect this replaced.
 */
function congregationCurve(s: number): number {
  return (Math.sqrt(1 + 4 * s) - 1) / 2;
}

export class BeliefPropagationSystem implements System {
  readonly name = 'belief_propagation';
  readonly tickHz = 1;
  private rng = new Random(0);

  // ── Probe-only instrumentation seam (interaction-scaling Phase 0) ──────────
  // Optional, settable AFTER construction, default undefined — ZERO behaviour
  // change when unset. Fired once per ACTUALLY APPLIED faith delta (both the
  // deterministic communion inflow and the stochastic edge-propagation kick),
  // so a probe can sum "belief activity" per NPC without re-deriving this
  // module's arithmetic externally.
  onPropagate?: (entityId: EntityId, kind: 'commune' | 'propagate', faithDelta: number) => void;

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
      const delta = COMMUNION_RATE * soc * openness * congregationCurve(s) * (1 - belief.faith);
      if (delta <= 0) continue;
      belief.faith = Math.min(1, belief.faith + delta);
      belief.understanding = Math.min(1, belief.understanding + delta * UNDERSTANDING_FRAC);
      belief.devotion = Math.min(1, belief.devotion + delta * DEVOTION_FRAC);
      this.onPropagate?.(e.id, 'commune', delta);
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
      this.onPropagate?.(e.id, 'propagate', cappedDelta);
    }
  }
}