// Derive the CommandAffordances available for a target: the intersection of the
// capability registry (which verbs exist, their targetKind/cost/shape), the
// spirit's belief-granted unlocks, and the live context (cost/cooldown via the
// preview gate). Pure and deterministic — the same computation the powers panel,
// hover popover, and inspector all render (spec §2, §8).
import type { Command, CommandCtx, CommandTarget } from '@/sim/command/types';
import type { SpiritId } from '@/core/spirit';
import { listCapabilities, capFootprint, capShape, acceptedTargetKinds } from '@/sim/command/registry';
import { derivePreview } from '@/sim/command/preview';
import type { CommandAffordance } from './types';

/** Minimal belief-unlock view (structural; `BeliefPowerView[]` is assignable —
 *  `verb` is a plain string so the query's view drops in without a cast). */
export interface VerbUnlock {
  verb: string;
  unlocked: boolean;
}

/**
 * All divine-tier affordances issuable at `target`, gated by belief-unlock + preview.
 * Belief-gated verbs (smite→storm, summon_storm→flood) reflect `unlocks`; ungated
 * verbs are always unlocked. Locked verbs are INCLUDED (rendered greyed) so the
 * inspector can show the full vocabulary and what it takes to earn each power.
 */
export function affordancesForTarget(
  target: CommandTarget,
  source: SpiritId,
  ctx: CommandCtx,
  unlocks: ReadonlyArray<VerbUnlock>,
): CommandAffordance[] {
  const unlockByVerb = new Map(unlocks.map((u) => [u.verb, u.unlocked]));
  const out: CommandAffordance[] = [];
  for (const def of listCapabilities()) {
    if (def.tier !== 'divine') continue;                       // player surface = divine verbs only
    if (!acceptedTargetKinds(def).includes(target.kind)) continue; // verb applies to this target shape
    const cmd: Command = { verb: def.verb, source, target, seq: 0 };
    out.push({
      verb: def.verb,
      label: def.describe(cmd),
      targetKind: target.kind,
      footprint: capFootprint(def),
      shape: capShape(def),
      // gated verbs reflect belief-unlock; ungated verbs (whisper/omen/…) are open
      unlocked: unlockByVerb.get(def.verb) ?? true,
      preview: derivePreview(cmd, ctx),
    });
  }
  return out;
}
