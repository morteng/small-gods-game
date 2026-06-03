/**
 * Command executor — validates and applies commands against the capability
 * registry. Pure `executeCommand` (no RNG, no queue) + the scheduled
 * `CommandExecutorSystem` that drains the queue each tick.
 *
 * Rejections are structured `CommandResult`s — never thrown, never logged as
 * narrative events (a denied whisper is not a story beat). The system is
 * registered FIRST in the scheduler so queued commands apply at the top of a tick.
 */
import type { System, SystemContext } from '@/core/scheduler';
import { getCapability } from './registry';
import { getNpc } from '@/world/npc-helpers';
import type { Command, CommandCtx, ApplyCtx, CommandResult, RejectionReason } from './types';
import type { CommandQueue } from './command-queue';

/**
 * Read-only validation: everything `executeCommand` checks *except* the mutating
 * apply. Returns the rejection reason, or null if the command would be applied.
 * Reused by the player UI to gate optimistic feedback against the same registry.
 */
export function previewCommand(cmd: Command, ctx: CommandCtx): RejectionReason | null {
  const def = getCapability(cmd.verb);
  if (!def) return 'invalid_target';                   // unknown verb (defensive)
  if (!def.implemented || !def.apply) return 'not_implemented';

  if (!ctx.spirits.has(cmd.source)) return 'unknown_source';

  // Target kind + existence.
  if (def.targetKind === 'npc') {
    if (cmd.target.kind !== 'npc' || !getNpc(ctx.world, cmd.target.npcId)) {
      return 'invalid_target';
    }
  } else if (def.targetKind === 'settlement') {
    if (cmd.target.kind !== 'settlement') return 'invalid_target';
  }

  if (ctx.spirits.get(cmd.source)!.power < def.cost) return 'insufficient_power';

  return def.precondition?.(cmd, ctx) ?? null;
}

/** Validate + apply a single command. Deterministic; no RNG of its own. */
export function executeCommand(cmd: Command, ctx: ApplyCtx): CommandResult {
  const reject = (reason: RejectionReason): CommandResult =>
    ({ status: 'rejected', verb: cmd.verb, source: cmd.source, reason });

  const pre = previewCommand(cmd, ctx);
  if (pre) return reject(pre);

  // divine-actions.ts pays the cost + appends the SimEvent; false ⇒ lost a race.
  if (!getCapability(cmd.verb)!.apply!(cmd, ctx)) return reject('precondition_failed');

  return { status: 'applied', verb: cmd.verb, source: cmd.source };
}

export class CommandExecutorSystem implements System {
  readonly name = 'command-executor';
  readonly tickHz = 60; // matches NpcMovementSystem — drains within ~16ms; no-op when empty

  constructor(
    private readonly queue: CommandQueue,
    private readonly onResult?: (r: CommandResult) => void,
  ) {}

  tick(ctx: SystemContext): void {
    const ctxFor: ApplyCtx = {
      world: ctx.world, spirits: ctx.spirits, log: ctx.log,
      rng: ctx.rng, now: ctx.now,
    };
    for (const cmd of this.queue.drain()) {
      const result = executeCommand(cmd, ctxFor);
      this.onResult?.(result);
    }
  }
}
