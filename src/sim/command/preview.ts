/**
 * Presentation-layer preview adapter for the agent-driven UI.
 *
 * `previewCommand` (command-system.ts) is the write-path gate: it returns a single
 * `RejectionReason | null`. The UI wants a *structured* preview — cost + can-I-pay +
 * why-blocked — to render affordance chips. `derivePreview` composes the registry
 * cost with `previewCommand`'s verdict; it adds NO new gating and never mutates. It
 * lives beside the command channel (not in the renderer) so it stays deterministic
 * and testable, but the write path (`executeCommand`) is untouched.
 */
import type { Command, CommandCtx, RejectionReason } from './types';
import { getCapability, effectiveCost } from './registry';
import { previewCommand } from './command-system';

export interface Preview {
  /** Power the verb would spend (0 for editor/authoring tiers). Radius-scaled
   *  verbs (B3, e.g. an area `summon_storm`) report the ACTUAL cost for THIS
   *  command's target — read through `effectiveCost`, never the registry's
   *  static base — so this figure can never lie about what casting would
   *  actually charge. */
  cost: number;
  /** Can the source afford it? False only when the gate is `insufficient_power`. */
  affordable: boolean;
  /** Why the command would be rejected right now, or null if it would apply. */
  blockedReason: RejectionReason | null;
}

export function derivePreview(cmd: Command, ctx: CommandCtx): Preview {
  const def = getCapability(cmd.verb);
  const cost = def ? effectiveCost(def, cmd) : 0;
  const blockedReason = previewCommand(cmd, ctx);
  return { cost, affordable: blockedReason !== 'insufficient_power', blockedReason };
}
