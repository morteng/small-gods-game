import type { World } from '@/world/world';
import type { SpiritBelief, NpcNeeds, NpcActivity } from '@/core/types';
import { forEachNpc, npcProps } from '@/world/npc-helpers';

export const PLAYER_SPIRIT_ID = 'player';

/** Faith at/above this means they actively practice your cult — an allegiance
 *  that feeds your power and can later lapse. Below it, they've drifted off. */
export const BELIEVER_THRESHOLD = 0.15;
/** Faith at/below this means they've stopped practicing your cult entirely —
 *  turned away (but, per the world's "nothing is ever deleted" rule, still alive
 *  and re-convertible). */
export const LAPSED_FLOOR = 0.02;

/** A durable believer: faith and devotion both high enough to resist decay. */
export function isDurable(b: SpiritBelief | undefined): boolean {
  return !!b && b.faith > 0.3 && b.devotion > 0.4;
}

/** NPCs who actively practice your cult (faith ≥ the believer line). Lapsed
 *  ex-believers linger in the world at near-zero faith but no longer count. */
export function countPlayerBelievers(world: World): number {
  let n = 0;
  forEachNpc(world, (e) => {
    const b = npcProps(e).beliefs[PLAYER_SPIRIT_ID];
    if (b && b.faith >= BELIEVER_THRESHOLD) n++;
  });
  return n;
}

/** NPCs who are durable believers in the player. */
export function countDurableBelievers(world: World): number {
  let n = 0;
  forEachNpc(world, (e) => {
    if (isDurable(npcProps(e).beliefs[PLAYER_SPIRIT_ID])) n++;
  });
  return n;
}

/** One-line, player-facing read of where a believer stands. Order matters. */
export function npcStatusHint(
  b: SpiritBelief | undefined,
  needs: NpcNeeds,
  activity: NpcActivity,
): string {
  const faith = b?.faith ?? 0;
  const devotion = b?.devotion ?? 0;
  if (faith <= LAPSED_FLOOR) return 'turned away from you';
  if (faith < BELIEVER_THRESHOLD) return 'faith fading';
  if (activity === 'worship') return 'praying — needs you now';
  if (needs.meaning > 0.6 && devotion < 0.4) return 'comfortable — drifting away';
  if (faith > 0.3 && devotion > 0.4) return 'devoted';
  if (faith > 0.3 && devotion < 0.4) return 'ripe to deepen';
  return 'wavering';
}
