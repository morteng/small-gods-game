import type { Spirit } from '@/core/spirit';
import type { EventLog } from '@/core/events';
import type { Entity } from '@/core/types';
import { clamp01 } from '@/sim/npc-sim';
import { npcProps } from '@/world/npc-helpers';

export const WHISPER_COST = 1;
export const WHISPER_FAITH_BOOST = 0.15;
export const WHISPER_UNDERSTANDING_BOOST = 0.03;
export const WHISPER_COOLDOWN = 5;

/**
 * Apply a whisper from `spirit` to `npc` (Entity). Mutates both. Appends a whisper event
 * to the log. Returns true on success, false if power/cooldown disallows.
 */
export function whisper(spirit: Spirit, npc: Entity, log: EventLog): boolean {
  if (spirit.power < WHISPER_COST) return false;
  const p = npcProps(npc);
  if (p.whisperCooldown > 0) return false;

  spirit.power -= WHISPER_COST;

  const existing = p.beliefs[spirit.id];
  if (existing) {
    existing.faith = clamp01(existing.faith + WHISPER_FAITH_BOOST);
    existing.understanding = clamp01(existing.understanding + WHISPER_UNDERSTANDING_BOOST);
  } else {
    p.beliefs[spirit.id] = {
      faith: WHISPER_FAITH_BOOST,
      understanding: WHISPER_UNDERSTANDING_BOOST,
      devotion: 0,
    };
  }
  p.whisperCooldown = WHISPER_COOLDOWN;

  const appended = log.append({ type: 'whisper', spiritId: spirit.id, npcId: npc.id });
  p.recentEventIds.push(appended.id);
  if (p.recentEventIds.length > 8) p.recentEventIds.shift();

  return true;
}
