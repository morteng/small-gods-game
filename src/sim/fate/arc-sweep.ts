/**
 * arc-sweep.ts — the dispositions sweep (Track 4, Proactive Fate F5; spec §3).
 *
 * "An arc whose preconditions have become unreachable must be ABANDONED, not
 * forced." Checked every pulse (FatePulse calls this — deterministic, sim-side,
 * rng-free, so the offline no-LLM Fate folds honestly too):
 *
 *  1. Goal truth is recomputed first (`met` is never trusted stale).
 *  2. LANDED: a live arc past 'seeded' (Fate has applied pressure) whose goals
 *     ALL hold has arrived — stage 'landed'. A merely-seeded arc never lands:
 *     an intention Fate did nothing for is not a story, it is a coincidence.
 *  3. ABANDONED: a live library arc whose shape's `seedWhen` preconditions no
 *     longer ALL hold has lost its premise — folded with the failed predicates
 *     as `abandonedReason`, and every still-armed staged beat carrying its
 *     arcId is EXPIRED (spec §7: an unreachable arc never fires its beat).
 *     Non-library shapes (the offline stub) carry no `seedWhen` and are never
 *     precondition-folded.
 *
 * Everything here tolerates partial state (test harnesses) — a missing store or
 * staging buffer is a no-op, never a throw.
 */
import type { GameState } from '@/core/state';
import type { StagingBuffer } from '@/sim/threads/staging-buffer';
import { getArcShape } from './arc-library';
import { evalArcPredicate } from './arc-predicates';

export interface ArcSweepResult {
  landed: number[];
  /** Live 'building' arcs promoted to 'imminent' this sweep (the rising-action curve). */
  escalated: number[];
  abandoned: Array<{ id: number; reason: string }>;
}

/**
 * Expire every still-armed staged beat linked to an arc (called when the arc
 * folds — by the sweep AND by the LLM `abandon_arc` path). A fired beat is
 * history and stays; the ledger keeps its entries (they too are history).
 * Returns how many beats were expired.
 */
export function expireArcBeats(state: GameState, arcId: number): number {
  const staging: StagingBuffer | undefined = state.staging;
  if (!staging) return 0;
  const beats = staging.armedForArc(arcId);
  for (const b of beats) staging.markExpired(b.id);
  return beats.length;
}

/** Run the dispositions sweep. Called once per pulse (before the idle check). */
export function sweepArcs(state: GameState): ArcSweepResult {
  const result: ArcSweepResult = { landed: [], escalated: [], abandoned: [] };
  const store = state.fateArcs;
  if (!store) return result;
  store.recomputeGoals(state);
  for (const arc of store.live()) {
    // LANDED: every goal holds AND Fate actually worked toward it (past 'seeded').
    if (arc.stage !== 'seeded' && arc.goals.length > 0 && arc.goals.every((g) => g.met)) {
      store.land(arc.id);
      result.landed.push(arc.id);
      console.info(`[fate] arc ${arc.id} "${arc.shape}" LANDED — every goal holds`);
      continue;
    }
    // ESCALATED (rising action): a live 'building' arc NEAR its landing is promoted
    // to 'imminent' — its pressure budget is spent (it must now land or fold) OR a
    // portent has been discovered AND at least half its goals already hold. Purely
    // deterministic (no rng, only the safe near-landing rule); the nuanced starved
    // case is left to the LLM via the prompt digest, never forced here. A GOALLESS
    // arc can never land, so it never escalates — 'imminent' means near a landing.
    if (arc.stage === 'building' && arc.goals.length > 0) {
      const total = arc.goals.length;
      const met = arc.goals.reduce((n, g) => (g.met ? n + 1 : n), 0);
      const nearByBudget = arc.pressureBudget === 0;
      const nearByPortent = arc.portents.some((p) => p.discovered) && met >= Math.ceil(total / 2);
      if ((nearByBudget || nearByPortent) && store.escalate(arc.id)) {
        result.escalated.push(arc.id);
        console.info(`[fate] arc ${arc.id} "${arc.shape}" ESCALATED — 'building' → 'imminent', nearing its landing`);
        continue;
      }
    }
    // ABANDONED: the premise collapsed — the shape's seedWhen no longer holds.
    const shape = getArcShape(arc.shape);
    if (!shape || shape.seedWhen.length === 0) continue;
    const failed = shape.seedWhen.filter((p) => !evalArcPredicate(p, state));
    if (failed.length === 0) continue;
    const reason = `preconditions no longer hold: ${failed.join(', ')}`;
    store.abandon(arc.id, reason);
    const expired = expireArcBeats(state, arc.id);
    result.abandoned.push({ id: arc.id, reason });
    console.info(
      `[fate] arc ${arc.id} "${arc.shape}" abandoned — ${reason}` +
      (expired ? ` (${expired} staged beat(s) expired, never to fire)` : ''),
    );
  }
  return result;
}
