/**
 * arc-era.ts — era-authoring across a time-skip (Track 4, Proactive Fate F6).
 *
 * The D2 skip loop's missing half: an arc that SPANS a closed-form time-skip
 * contributes its story to the era summary the skip produces — its shape's
 * logline, which goals came true, the pressures Fate applied (the F5 audit
 * trail), the omens planted and seen, and its final disposition.
 *
 * Everything here is deterministic and sim-side (rng-free — the no-random guard
 * covers this directory). The flow, run by the skip caller (game layer) right
 * after `applySkip` has advanced the world and BEFORE the timeline boundary is
 * committed, so the committed baseline snapshot carries the settled arcs:
 *
 *  1. Capture the arcs live at the moment of the skip — nothing touches arcs
 *     during a closed-form jump, so these are exactly the arcs that spanned it.
 *  2. Run the SAME dispositions sweep the pulse runs (`sweepArcs`): goal truth
 *     is recomputed against the POST-skip world, a worked arc whose goals all
 *     hold LANDS, an arc whose premise collapsed over the era is ABANDONED and
 *     its still-armed beats expire (an unreachable arc never fires its blow).
 *  3. Digest each spanning arc into plain display data for the era summary.
 *
 * The digests feed `buildEraChroniclePrompt` / `renderOfflineEraAnnal`
 * (`@/llm/chronicle-prompt-builder`) — the sim is truth; the summary annotates
 * these outcomes, it never contradicts them.
 */
import type { GameState } from '@/core/state';
import type { ArcStage, FateArc } from './arc-types';
import { getArcShape } from './arc-library';
import { sweepArcs } from './arc-sweep';

/** One spanning arc's era story — plain display data, derived, never persisted. */
export interface EraArcDigest {
  id: number;
  shape: string;
  /** Library title; falls back to the shape key for non-library shapes (the offline stub). */
  title: string;
  /** The shape's one-line story, when the library knows it. */
  logline?: string;
  /** Final disposition AFTER the era settled (post-sweep). */
  stage: ArcStage;
  abandonedReason?: string;
  /** Goal outcomes against the POST-skip world (`met` freshly recomputed). */
  goals: Array<{ predicate: string; met: boolean }>;
  /** Applied pressures aggregated by verb, first-applied order (the F5 audit
   *  ring — counts reflect the bounded `applied[]` ring, honestly). */
  pressures: Array<{ verb: string; count: number }>;
  portentsPlanted: number;
  portentsDiscovered: number;
  /** The omen wordings, where the ledger recorded them (feed the chronicler). */
  omens: string[];
}

function digestArc(arc: FateArc): EraArcDigest {
  const shape = getArcShape(arc.shape);
  const verbCounts = new Map<string, number>();
  for (const p of arc.applied) verbCounts.set(p.verb, (verbCounts.get(p.verb) ?? 0) + 1);
  return {
    id: arc.id,
    shape: arc.shape,
    title: shape?.title ?? arc.shape,
    logline: shape?.logline,
    stage: arc.stage,
    abandonedReason: arc.abandonedReason,
    goals: arc.goals.map((g) => ({ predicate: g.predicate, met: g.met })),
    pressures: [...verbCounts].map(([verb, count]) => ({ verb, count })),
    portentsPlanted: arc.portents.length,
    portentsDiscovered: arc.portents.filter((p) => p.discovered).length,
    omens: arc.portents.map((p) => p.text).filter((t): t is string => !!t && t.length > 0),
  };
}

/**
 * Settle every arc that spanned a just-applied time-skip and digest its story.
 *
 * MUST be called immediately after `applySkip` (post-skip world, pre-commit):
 * the arcs live at that instant are exactly the arcs that were live when the
 * era began. Runs the deterministic dispositions sweep so each digest carries
 * an honest FINAL disposition (landed / abandoned+reason / still building).
 * Tolerates partial state (no arc store ⇒ `[]`, never a throw).
 */
export function settleArcsAcrossSkip(state: GameState): EraArcDigest[] {
  const store = state.fateArcs;
  if (!store) return [];
  const spanning = store.live().map((a) => a.id);
  if (spanning.length === 0) return [];
  sweepArcs(state);
  return spanning
    .map((id) => store.get(id))
    .filter((a): a is FateArc => !!a)
    .map(digestArc);
}
