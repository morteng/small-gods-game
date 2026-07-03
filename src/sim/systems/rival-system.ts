/**
 * RivalSystem — drives rival spirits to act ("activate, don't perfect").
 *
 * Each tick it asks every rival (a non-player Spirit with an `ai` profile) to
 * decide an action via the existing `decideRivalAction` sketch, maps it to a real
 * registry verb, picks a deterministic target with `ctx.rng`, and emits a command
 * onto the shared channel — the SAME gate the player uses. Rivals therefore spend
 * power and shift NPC belief toward themselves.
 *
 * Real strategy quality, target heuristics, learning, and reconciling the sketched
 * RivalAction power costs with the canonical divine-action costs are Track 3.
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

export class RivalSystem implements System {
  readonly name = 'rival-system';
  readonly tickHz = 0.5; // decide roughly every 2 sim seconds; action cooldowns gate further

  constructor(private readonly queue: CommandQueue) {}

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

    // ── baseline strategy actions, now fed REAL situation data ──
    for (const spirit of ctx.spirits.values()) {
      if (spirit.isPlayer || !spirit.ai?.personality) continue;

      const view = spiritToRivalView(spirit);
      if (!view) continue;

      const action = decideRivalAction(
        view,
        ctx.now,
        buildRivalSituation(ctx.world, ctx.spirits, spirit.id),
        () => ctx.rng.next(),
      );
      if (!action) continue;

      const verb = mapVerb(action.type);
      const settlements = spirit.ai.settlements ?? [];
      const target = verb === 'whisper'
        ? pickNpcTarget(ctx.world, settlements, ctx.rng)
        : pickSettlementTarget(settlements, ctx.rng);
      if (!target) continue;

      this.queue.emit({ verb, source: spirit.id, target });
      spirit.ai.lastActionTick = ctx.now;
    }
  }
}
