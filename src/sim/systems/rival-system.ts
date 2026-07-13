/**
 * RivalSystem — drives rival spirits to act.
 *
 * Each tick it asks every off-cooldown rival (a non-player Spirit with an `ai`
 * profile) to decide via `decideRivalAction`, feeding it a real `RivalSituation`
 * (per-settlement follower counts + deltas vs a cooldown-cadence baseline,
 * unanswered-prayer pressure, own power). The strategy chooses both the action
 * AND the target settlement from that data; this system resolves the concrete
 * command target, maps the action to a registry verb, and emits onto the shared
 * channel — the SAME gate the player uses. Rivals therefore spend power and
 * shift NPC belief toward themselves.
 */
import type { System, SystemContext } from '@/core/scheduler';
import type { CommandQueue } from '@/sim/command/command-queue';
import type { CommandTarget, CommandVerb } from '@/sim/command/types';
import { spiritToRivalView } from '@/sim/command/rival-adapter';
import { decideRivalAction, type RivalAction } from '@/sim/rival-spirit';
import { queryNpcs, npcProps } from '@/world/npc-helpers';
import {
  buildRivalSituation, updatePrayerLedger, findClaimablePrayers,
} from '@/sim/rival-claims';
import type { Rng } from '@/core/rng';
import type { World } from '@/world/world';
import type { SettlementCohorts } from '@/sim/cohorts';

/** Map a sketched rival action type onto a real divine command verb. */
function mapVerb(type: RivalAction['type']): CommandVerb {
  switch (type) {
    case 'whisper': return 'whisper';
    case 'miracle': return 'miracle';
    case 'omen': return 'omen';
    // fictional rival-only types collapse onto the nearest real verb
    case 'proselytize': return 'whisper';
    case 'discredit': return 'omen';
    case 'curse': return 'omen';
  }
}

function pickNpcTarget(world: World, settlements: string[], rng: Rng): CommandTarget | null {
  const all = queryNpcs(world);
  if (all.length === 0) return null;
  const claimed = settlements.length > 0
    ? all.filter(e => settlements.includes(npcProps(e).homePoiId ?? ''))
    : [];
  const pool = claimed.length > 0 ? claimed : all;
  return { kind: 'npc', npcId: pool[rng.nextInt(pool.length)].id };
}

function pickSettlementTarget(settlements: string[], rng: Rng): CommandTarget | null {
  if (settlements.length === 0) return null;
  return { kind: 'settlement', poiId: settlements[rng.nextInt(settlements.length)] };
}

/** Resolve the decided action to a command target. The STRATEGY chose the
 *  settlement (that's the situation-driven part); for npc-shaped verbs the system
 *  only resolves *which soul within it*. Falls back to the old own-territory
 *  pickers when the strategy left the target open or the settlement is empty. */
function resolveTarget(
  world: World,
  action: RivalAction,
  verb: CommandVerb,
  settlements: string[],
  rng: Rng,
): CommandTarget | null {
  if (verb === 'whisper') {
    if (action.targetNpcId) return { kind: 'npc', npcId: action.targetNpcId };
    if (action.targetSettlementId) {
      const pool = queryNpcs(world).filter(e => npcProps(e).homePoiId === action.targetSettlementId);
      if (pool.length > 0) return { kind: 'npc', npcId: pool[rng.nextInt(pool.length)].id };
    }
    return pickNpcTarget(world, settlements, rng);
  }
  if (action.targetSettlementId) return { kind: 'settlement', poiId: action.targetSettlementId };
  return pickSettlementTarget(settlements, rng);
}

export class RivalSystem implements System {
  readonly name = 'rival-system';
  readonly tickHz = 0.5; // decide roughly every 2 sim seconds; action cooldowns gate further

  /** `getCohorts` (P1, two-tier population): the statistical tier — when wired,
   *  `buildRivalSituation` folds aggregate cohort believers into the follower
   *  counts so rival strategy weighs the whole population, not just named souls. */
  constructor(
    private readonly queue: CommandQueue,
    private readonly getCohorts?: () => ReadonlyMap<string, SettlementCohorts> | null | undefined,
  ) {}

  tick(ctx: SystemContext): void {
    // ── Track-3 headline: claim the prayers the player leaves unanswered ──
    // Maintain the plea ledger (cheap, unconditional — the divine inbox reads
    // `prayerSince` even when no rival ends up acting), then answer any plea aged
    // past the claim window through the SHARED command queue. The belief shift
    // toward the rival routes through the existing `answerPrayer` loop.
    updatePrayerLedger(ctx.world, ctx.now);
    for (const claim of findClaimablePrayers(ctx.world, ctx.spirits, ctx.now, ctx.rng)) {
      this.queue.emit({
        verb: 'answer_prayer',
        source: claim.rivalId,
        target: { kind: 'npc', npcId: claim.npcId },
      });
      const rival = ctx.spirits.get(claim.rivalId);
      if (rival?.ai) rival.ai.lastActionTick = ctx.now; // claiming counts as this tick's act
    }

    // ── strategy actions: situation-driven target AND action choice ──
    for (const spirit of ctx.spirits.values()) {
      if (spirit.isPlayer || !spirit.ai?.personality) continue;
      const ai = spirit.ai;

      // Cooldown-gate BEFORE the situation sweep — a rival that cannot act this
      // tick must not cost an NPC pass.
      if (ctx.now - (ai.lastActionTick ?? 0) < (ai.actionCooldown ?? 0)) continue;

      const view = spiritToRivalView(spirit);
      if (!view) continue;

      const situation = buildRivalSituation(ctx.world, ctx.spirits, spirit.id, {
        now: ctx.now,
        baseline: ai.followerBaseline,
        cohorts: this.getCohorts?.(),
      });
      // Refresh the trend baseline at cooldown cadence so deltas span at least
      // one decision window (refreshing every tick would zero them out).
      if (ai.baselineTick === undefined || ctx.now - ai.baselineTick >= (ai.actionCooldown ?? 0)) {
        ai.followerBaseline = { ...situation.rivalFollowersInSettlement };
        ai.baselineTick = ctx.now;
      }

      const action = decideRivalAction(view, ctx.now, situation, () => ctx.rng.next());
      if (!action) continue;

      const verb = mapVerb(action.type);
      const target = resolveTarget(ctx.world, action, verb, ai.settlements ?? [], ctx.rng);
      if (!target) continue;

      this.queue.emit({ verb, source: spirit.id, target });
      ai.lastActionTick = ctx.now;
    }
  }
}
