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
import { SilentEventLog } from '@/core/events';
import type { Command, CommandCtx, ApplyCtx, CommandResult, RejectionReason } from './types';
import type { CommandQueue } from './command-queue';
import type { AuthorCommandLog } from './author-command-log';

/**
 * Read-only validation: everything `executeCommand` checks *except* the mutating
 * apply. Returns the rejection reason, or null if the command would be applied.
 * Reused by the player UI to gate optimistic feedback against the same registry.
 */
export function previewCommand(cmd: Command, ctx: CommandCtx): RejectionReason | null {
  const def = getCapability(cmd.verb);
  if (!def) return 'invalid_target';                   // unknown verb (defensive)
  if (!def.implemented || !def.apply) return 'not_implemented';

  // Editor (god-mode) and authoring (Fate) tiers are spiritless: no power, no
  // spirit registration (Fate acts as source 'fate', never a Spirit). Targeting +
  // validation is entirely the verb's precondition (it inspects cmd.target/payload).
  if (def.tier === 'editor' || def.tier === 'authoring') {
    return def.precondition?.(cmd, ctx) ?? null;
  }

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
    private readonly authorLog?: AuthorCommandLog,
    /** W-H: the deterministic water stepper, so weather verbs (`summon_storm`) can lay
     *  a flood during their command apply. Injected by the game; null in headless. */
    private readonly getWeather?: () => import('@/sim/water/weather-stepper').WeatherStepper | null,
  ) {}

  tick(ctx: SystemContext): void {
    const ctxFor: ApplyCtx = {
      world: ctx.world, spirits: ctx.spirits, log: ctx.log,
      rng: ctx.rng, now: ctx.now,
      weather: this.getWeather?.() ?? null,
    };
    const replaying = ctx.log instanceof SilentEventLog;

    // Replay: re-emit recorded author commands due at this tick BEFORE draining,
    // so they re-apply in the same drain order (and RNG position) as live.
    if (replaying && this.authorLog) {
      for (const c of this.authorLog.at(ctx.now)) {
        this.queue.emit({ verb: c.verb, source: c.source, target: c.target, params: c.params, payload: c.payload });
      }
    }

    for (const cmd of this.queue.drain()) {
      const result = executeCommand(cmd, ctxFor);
      // Live only: record applied editor commands as replayable history.
      // Only editor-tier authoring is replayed via AuthorCommandLog; authoring-tier
      // (Fate) commands persist via the full-state world snapshot, not replay.
      if (!replaying && this.authorLog && result.status === 'applied'
          && getCapability(cmd.verb)?.tier === 'editor') {
        this.authorLog.record(ctx.now, cmd);
      }
      this.onResult?.(result);
    }
  }
}
