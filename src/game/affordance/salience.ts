// One salience brain, three lenses: inbox (global), hover (local), Fate (bias).
//
// This is the inbox's inline scoring (`game-query.ts`) extracted so hover
// suggestions (P3) can reuse the exact same computation — global and local
// salience must never disagree. Pure and deterministic: NO LLM, no `Math.random`
// (this feeds `src/game` but mirrors the sim's determinism discipline so it is
// safe on the frame/hover path).

/** Fate's promotion boost — a surfaced item jumps a full band above the pack. */
export const FATE_SURFACE_BOOST = 1;

/** What a plea over each need is FOR, in the player's inbox/hover/inspector
 *  language (M0.b). Shared here so every lens words a plea identically. */
export const PRAYER_SUBJECT_TEXT: Record<keyof import('@/core/types').NpcNeeds, string> = {
  safety:     'protection',
  prosperity: 'bread',
  community:  'fellowship',
  meaning:    'an answer',
};

/**
 * The read-only signal bundle behind one salient act. Discriminated by the
 * situation kind the inbox already recognises. Hover (P3) builds the same signals
 * per (verb, target), so the two lenses share one scoring function.
 */
export type Situation =
  // `needDeficit` (M0.b): deficit of the plea's SUBJECT need — pre-M0 this was
  // always the meaning deficit; now a starving peasant's bread-plea scores by hunger.
  | { kind: 'prayer'; faith: number; needDeficit: number; surfaced?: boolean }
  | { kind: 'opportunity'; severity: number; surfaced?: boolean }
  | { kind: 'threat'; rivalBelievers: number; surfaced?: boolean }
  // Track-3 rival claims (both surface as inbox `threat` items):
  //  a plea aging toward a rival's grasp (still answerable) …
  | { kind: 'prayer_contested'; faith: number; urgency: number; surfaced?: boolean }
  //  … and one already lost — a rival answered a prayer you ignored.
  | { kind: 'prayer_claimed'; faith: number; surfaced?: boolean }
  // WP-C: a faith/mood turning point (belief_cross / mood_cross), coalesced per
  // settlement. NEWS, not a call to act — scored strictly below every threat floor
  // (0.4) so tidings can never drown out threats or pleas. `count` = crossings folded
  // into the item.
  | { kind: 'tiding'; count: number; surfaced?: boolean }
  // M1: the chronicler's daily annal. Pure atmosphere, never a call to act — fixed
  // floor BELOW even an ordinary tiding, so it can never outrank real news.
  | { kind: 'chronicle'; surfaced?: boolean };

/**
 * Score how salient acting on a situation is right now (higher = more urgent).
 * Fate biases via `surfaced` (the +1 promotion boost), it never computes the base.
 */
export function scoreAffordance(sit: Situation): number {
  let base: number;
  switch (sit.kind) {
    case 'prayer':      base = sit.faith * (0.4 + 0.6 * sit.needDeficit); break;
    case 'opportunity': base = 0.5 + 0.5 * sit.severity; break;
    case 'threat':      base = 0.4 + Math.min(0.5, sit.rivalBelievers * 0.05); break;
    // A contested plea outranks an ordinary one (a rival is circling) and climbs
    // as the claim window closes; a plea already lost ranks highest — a soul slipped.
    case 'prayer_contested': base = 0.7 + 0.25 * Math.min(1, sit.urgency) + 0.05 * sit.faith; break;
    case 'prayer_claimed':   base = 0.95 + 0.05 * sit.faith; break;
    // Low-priority news: 0.1 floor, +0.05 per coalesced crossing, hard-capped at
    // 0.35 — always below the 0.4 threat floor.
    case 'tiding':           base = 0.1 + Math.min(0.25, 0.05 * sit.count); break;
    // Below even the tiding floor — atmosphere, not news.
    case 'chronicle':        base = 0.05; break;
  }
  return sit.surfaced ? base + FATE_SURFACE_BOOST : base;
}
