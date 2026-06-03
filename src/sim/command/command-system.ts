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
import type { Command, CommandCtx, CommandResult, RejectionReason } from './types';
import type { CommandQueue } from './command-queue';

/** Validate + apply a single command. Deterministic; no RNG. */
export function executeCommand(cmd: Command, ctx: CommandCtx): CommandResult {
  const reject = (reason: RejectionReason): CommandResult =>
    ({ status: 'rejected', verb: cmd.verb, source: cmd.source, reason });

  const def = getCapability(cmd.verb);
  if (!def) return reject('invalid_target');           // unknown verb (defensive)
  if (!def.implemented || !def.apply) return reject('not_implemented');

  if (!ctx.spirits.has(cmd.source)) return reject('unknown_source');

  // Target kind + existence.
  if (def.targetKind === 'npc') {
    if (cmd.target.kind !== 'npc' || !getNpc(ctx.world, cmd.target.npcId)) {
      return reject('invalid_target');
    }
  } else if (def.targetKind === 'settlement') {
    if (cmd.target.kind !== 'settlement') return reject('invalid_target');
  }

  const spirit = ctx.spirits.get(cmd.source)!;
  if (spirit.power < def.cost) return reject('insufficient_power');

  const pre = def.precondition?.(cmd, ctx) ?? null;
  if (pre) return reject(pre);

  // divine-actions.ts pays the cost + appends the SimEvent; false ⇒ lost a race.
  if (!def.apply(cmd, ctx)) return reject('precondition_failed');

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
    const ctxFor: CommandCtx = { world: ctx.world, spirits: ctx.spirits, log: ctx.log };
    for (const cmd of this.queue.drain()) {
      const result = executeCommand(cmd, ctxFor);
      this.onResult?.(result);
    }
  }
}
