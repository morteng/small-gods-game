// One salience brain, three lenses: inbox (global), hover (local), Fate (bias).
//
// This is the inbox's inline scoring (`game-query.ts`) extracted so hover
// suggestions (P3) can reuse the exact same computation — global and local
// salience must never disagree. Pure and deterministic: NO LLM, no `Math.random`
// (this feeds `src/game` but mirrors the sim's determinism discipline so it is
// safe on the frame/hover path).

/** Fate's promotion boost — a surfaced item jumps a full band above the pack. */
export const FATE_SURFACE_BOOST = 1;

/**
 * The read-only signal bundle behind one salient act. Discriminated by the
 * situation kind the inbox already recognises. Hover (P3) builds the same signals
 * per (verb, target), so the two lenses share one scoring function.
 */
export type Situation =
  | { kind: 'prayer'; faith: number; meaningDeficit: number; surfaced?: boolean }
  | { kind: 'opportunity'; severity: number; surfaced?: boolean }
  | { kind: 'threat'; rivalBelievers: number; surfaced?: boolean }
  // Track-3 rival claims (both surface as inbox `threat` items):
  //  a plea aging toward a rival's grasp (still answerable) …
  | { kind: 'prayer_contested'; faith: number; urgency: number; surfaced?: boolean }
  //  … and one already lost — a rival answered a prayer you ignored.
  | { kind: 'prayer_claimed'; faith: number; surfaced?: boolean };

/**
 * Score how salient acting on a situation is right now (higher = more urgent).
 * Fate biases via `surfaced` (the +1 promotion boost), it never computes the base.
 */
export function scoreAffordance(sit: Situation): number {
  let base: number;
  switch (sit.kind) {
    case 'prayer':      base = sit.faith * (0.4 + 0.6 * sit.meaningDeficit); break;
    case 'opportunity': base = 0.5 + 0.5 * sit.severity; break;
    case 'threat':      base = 0.4 + Math.min(0.5, sit.rivalBelievers * 0.05); break;
    // A contested plea outranks an ordinary one (a rival is circling) and climbs
    // as the claim window closes; a plea already lost ranks highest — a soul slipped.
    case 'prayer_contested': base = 0.7 + 0.25 * Math.min(1, sit.urgency) + 0.05 * sit.faith; break;
    case 'prayer_claimed':   base = 0.95 + 0.05 * sit.faith; break;
  }
  return sit.surfaced ? base + FATE_SURFACE_BOOST : base;
}
