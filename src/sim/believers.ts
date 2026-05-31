import type { World } from '@/world/world';
import type { SpiritBelief, NpcNeeds, NpcActivity } from '@/core/types';
import { forEachNpc, npcProps } from '@/world/npc-helpers';

export const PLAYER_SPIRIT_ID = 'player';

/** A durable believer: faith and devotion both high enough to resist decay. */
export function isDurable(b: SpiritBelief | undefined): boolean {
  return !!b && b.faith > 0.3 && b.devotion > 0.4;
}

/** NPCs with any faith (>0) in the player. */
export function countPlayerBelievers(world: World): number {
  let n = 0;
  forEachNpc(world, (e) => {
    const b = npcProps(e).beliefs[PLAYER_SPIRIT_ID];
    if (b && b.faith > 0) n++;
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
  if (faith < 0.15) return 'about to abandon you';
  if (activity === 'worship') return 'praying — needs you now';
  if (needs.meaning > 0.6 && devotion < 0.4) return 'comfortable — drifting away';
  if (faith > 0.3 && devotion > 0.4) return 'devoted';
  if (faith > 0.3 && devotion < 0.4) return 'ripe to deepen';
  return 'wavering';
}
