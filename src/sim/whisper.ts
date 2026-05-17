import type { Spirit } from '@/core/spirit';
import type { EventLog } from '@/core/events';
import type { NpcSimState } from '@/core/types';
import { clamp01 } from '@/sim/npc-sim';

export const WHISPER_COST = 1;
export const WHISPER_FAITH_BOOST = 0.15;
export const WHISPER_UNDERSTANDING_BOOST = 0.03;
export const WHISPER_COOLDOWN = 5;

/**
 * Apply a whisper from `spirit` to `npc`. Mutates both. Appends a whisper event
 * to the log. Returns true on success, false if power/cooldown disallows.
 *
 * NOTE: in PR 3 a `whisperEntity` variant is added alongside that takes an
 * Entity instead of NpcSimState; Task 3.6 renames it back to `whisper`.
 */
export function whisper(spirit: Spirit, npc: NpcSimState, log: EventLog): boolean {
  if (spirit.power < WHISPER_COST) return false;
  if (npc.whisperCooldown > 0) return false;

  spirit.power -= WHISPER_COST;

  const existing = npc.beliefs[spirit.id];
  if (existing) {
    existing.faith = clamp01(existing.faith + WHISPER_FAITH_BOOST);
    existing.understanding = clamp01(existing.understanding + WHISPER_UNDERSTANDING_BOOST);
  } else {
    npc.beliefs[spirit.id] = {
      faith: clamp01(WHISPER_FAITH_BOOST),
      understanding: clamp01(WHISPER_UNDERSTANDING_BOOST),
      devotion: 0,
    };
  }
  npc.whisperCooldown = WHISPER_COOLDOWN;

  npc.recentEvents.push('whisper');
  if (npc.recentEvents.length > 5) npc.recentEvents.shift();

  log.append({ type: 'whisper', spiritId: spirit.id, npcId: npc.npcId });
  return true;
}
