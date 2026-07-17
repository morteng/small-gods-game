/**
 * arc-advance.ts — the weaving substrate (Track 4, Proactive Fate F5; spec §4.5).
 *
 * `advance_arc` lets Fate apply ONE pressure in service of SEVERAL live arcs at
 * once — but a claimed arc must actually hold an UNMET goal the pressure
 * plausibly moves (spec §8.4: `advances()` checks a GOAL, never mere subject
 * overlap). This module owns that check: a static, allowlisted map from goal
 * predicate → the capability-registry verbs that plausibly move it. Both sides
 * are pinned by guard tests (every key ∈ ARC_PREDICATES, every verb ∈
 * CAPABILITY_REGISTRY — the sim-currency discipline): a pressure can only ever
 * be a LEGAL SIM MUTATION the world already knows how to produce.
 *
 * Pure data + pure functions of it — sim-side, deterministic, rng-free.
 */
import type { CommandVerb } from '@/sim/command/types';
import type { ArcGoal } from './arc-types';

/**
 * Which registry verbs plausibly move each goal predicate. Deliberately tight:
 * an entry means "this lever can push the world toward that condition", not
 * "this lever touches the same settlement". Goals with no entry (has_rival,
 * has_settlements, …) cannot be claimed by advance_arc at all — Fate holds no
 * lever that creates them.
 */
export const GOAL_ADVANCING_VERBS: Record<string, readonly CommandVerb[]> = {
  /** Force/worsen a crisis event; a squeezed tithe breeds unrest and dispute. */
  settlement_in_crisis: ['bias_event', 'nudge_severity', 'set_lord_stance'],
  /** Force/swell a festival, harvest, or caravan. */
  settlement_thriving: ['bias_event', 'nudge_severity'],
  /** A preacher (or any stranger the story bends) arriving seeds belief. */
  player_has_believers: ['inject_npc'],
  /** A standing power can only ARRIVE — Fate injects, it does not anoint. */
  has_prominent_mortal: ['inject_npc'],
  /** Devotion follows a voice: a preacher among the flock. */
  has_devout_follower: ['inject_npc'],
};

/** Does this verb plausibly move this goal predicate? Unknown predicate ⇒ false. */
export function verbAdvancesGoal(verb: string, predicate: string): boolean {
  return (GOAL_ADVANCING_VERBS[predicate] ?? []).includes(verb as CommandVerb);
}

/** Spec §4.5 / §8.4 `advances()`: true iff the arc holds an UNMET goal this verb
 *  plausibly moves. A met goal earns no claim — there is nothing left to advance. */
export function pressureAdvancesGoals(verb: string, goals: readonly Pick<ArcGoal, 'predicate' | 'met'>[]): boolean {
  return goals.some((g) => !g.met && verbAdvancesGoal(verb, g.predicate));
}

/** The verbs that could still advance this arc (union over its UNMET goals) —
 *  the context digest's raw material. */
export function advancingVerbsFor(goals: readonly Pick<ArcGoal, 'predicate' | 'met'>[]): CommandVerb[] {
  const out = new Set<CommandVerb>();
  for (const g of goals) {
    if (g.met) continue;
    for (const v of GOAL_ADVANCING_VERBS[g.predicate] ?? []) out.add(v);
  }
  return [...out];
}
