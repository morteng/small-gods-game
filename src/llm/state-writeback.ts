/**
 * LLM State Writeback — applies structured LLM responses to the sim layer.
 *
 * When the LLM returns a JSON response with belief_deltas, mood_deltas, and
 * new events, this module applies those changes to the NPC's state in the ECS.
 *
 * Safety:
 *   - All deltas are clamped to valid ranges (0-1 for beliefs/needs/mood)
 *   - Events are appended to the event log and NPC's recentEventIds
 *   - Invalid or out-of-range values are logged and skipped
 */

import type { Entity, NpcProperties } from '@/core/types';
import type { SpiritId } from '@/core/spirit';
import { npcProps } from '@/world/npc-helpers';
import type { EventLog } from '@/core/events';

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

// ─── LLM Response Types ─────────────────────────────────────────────────

export interface LLMResponse {
  narration?: string;
  dialogue?: string;
  inner_thought?: string;
  belief_delta?: {
    faith?: number;
    understanding?: number;
    devotion?: number;
  };
  mood_delta?: number;
  new_events?: string[];
}

// ─── Writeback Result ───────────────────────────────────────────────────

export interface WritebackResult {
  /** Which fields were actually changed */
  changedFields: string[];
  /** New narration text (if any) */
  narration?: string;
  /** New dialogue text (if any) */
  dialogue?: string;
  /** Any validation errors */
  errors: string[];
}

// ─── Main Writeback Function ──────────────────────────────────────────

/**
 * Apply LLM response to an NPC's state.
 *
 * @param npc - The NPC entity to update
 * @param response - Parsed LLM JSON response
 * @param spiritId - Which spirit this interaction is from (usually 'player')
 * @param eventLog - Game event log for recording changes
 * @returns WritebackResult with what changed
 */
export function applyLLMWriteback(
  npc: Entity,
  response: LLMResponse,
  spiritId: SpiritId,
  eventLog: EventLog,
): WritebackResult {
  const props = npcProps(npc);
  const result: WritebackResult = {
    changedFields: [],
    errors: [],
  };

  // Store narration/dialogue in result for UI
  if (response.narration) {
    result.narration = response.narration;
  }
  if (response.dialogue) {
    result.dialogue = response.dialogue;
  }

  // Apply belief deltas
  if (response.belief_delta) {
    applyBeliefDelta(props, response.belief_delta, spiritId, result);
  }

  // Apply mood delta
  if (response.mood_delta !== undefined) {
    const delta = clampDelta(response.mood_delta, -0.2, 0.2, 'mood_delta', result);
    if (delta !== 0) {
      props.mood = clamp01(props.mood + delta);
      result.changedFields.push('mood');
    }
  }

  // Add new events
  if (response.new_events && response.new_events.length > 0) {
    for (const eventText of response.new_events.slice(0, 2)) { // Max 2 events
      try {
        const appended = eventLog.append({
          type: 'system_error',
          system: 'llm',
          message: eventText,
        });
        props.recentEventIds.push(appended.id);
        // Keep ring buffer at max 8
        if (props.recentEventIds.length > 8) {
          props.recentEventIds.shift();
        }
        result.changedFields.push('recentEventIds');
      } catch (e) {
        result.errors.push(`Failed to append event: ${e}`);
      }
    }
  }

  return result;
}

// ─── Belief Delta Application ────────────────────────────────────────

function applyBeliefDelta(
  props: NpcProperties,
  delta: NonNullable<LLMResponse['belief_delta']>,
  spiritId: SpiritId,
  result: WritebackResult,
): void {
  // Get or create belief for this spirit
  let belief = props.beliefs[spiritId];
  if (!belief) {
    belief = { faith: 0, understanding: 0, devotion: 0 };
    props.beliefs[spiritId] = belief;
  }

  // Apply faith delta (range: -0.3 to +0.3)
  if (delta.faith !== undefined) {
    const faithDelta = clampDelta(delta.faith, -0.3, 0.3, 'belief.faith', result);
    if (faithDelta !== 0) {
      belief.faith = clamp01(belief.faith + faithDelta);
      result.changedFields.push('beliefs.faith');
    }
  }

  // Apply understanding delta (range: -0.1 to +0.1)
  if (delta.understanding !== undefined) {
    const undDelta = clampDelta(delta.understanding, -0.1, 0.1, 'belief.understanding', result);
    if (undDelta !== 0) {
      belief.understanding = clamp01(belief.understanding + undDelta);
      result.changedFields.push('beliefs.understanding');
    }
  }

  // Apply devotion delta (range: -0.1 to +0.1)
  if (delta.devotion !== undefined) {
    const devDelta = clampDelta(delta.devotion, -0.1, 0.1, 'belief.devotion', result);
    if (devDelta !== 0) {
      belief.devotion = clamp01(belief.devotion + devDelta);
      result.changedFields.push('beliefs.devotion');
    }
  }
}

// ─── Utility Functions ────────────────────────────────────────────────

/**
 * Clamp a delta value to a valid range and log warnings for out-of-range.
 */
function clampDelta(
  value: number,
  min: number,
  max: number,
  fieldName: string,
  result: WritebackResult,
): number {
  if (value < min) {
    result.errors.push(`Field ${fieldName}: value ${value} below minimum ${min}, clamping`);
    return min;
  }
  if (value > max) {
    result.errors.push(`Field ${fieldName}: value ${value} above maximum ${max}, clamping`);
    return max;
  }
  return value;
}

// ─── Whisper Bonus ───────────────────────────────────────────────────

/** Maximum magnitude of the soft, LLM-judged whisper faith bonus (never snapshotted). */
export const WHISPER_BONUS_CLAMP = 0.10;

/**
 * Apply the soft, clamped (±0.10) whisper belief bonus to an NPC's faith in a spirit.
 * Narration-layer sugar on top of the deterministic whisper floor: it is overwritten
 * on snapshot restore, so replay reproduces only the floor.
 * @returns the actual faith delta applied (after ±0.10 clamp), for transcript display.
 */
export function applyWhisperBonus(npc: Entity, bonus: number, spiritId: SpiritId): number {
  const props = npc.properties as unknown as { beliefs: Record<string, { faith: number; understanding: number; devotion: number }> };
  let belief = props.beliefs[spiritId];
  if (!belief) { belief = { faith: 0, understanding: 0, devotion: 0 }; props.beliefs[spiritId] = belief; }
  const delta = Math.max(-WHISPER_BONUS_CLAMP, Math.min(WHISPER_BONUS_CLAMP, bonus));
  belief.faith = clamp01(belief.faith + delta);
  return delta;
}

/**
 * Validate that a parsed LLM response has at least some valid content.
 * Returns true if the response is usable.
 */
export function validateLLMResponse(response: unknown): response is LLMResponse {
  if (typeof response !== 'object' || response === null) {
    return false;
  }

  const r = response as Record<string, unknown>;

  // Must have at least one of: narration, dialogue, belief_delta, mood_delta, new_events
  const hasContent = [
    'narration',
    'dialogue',
    'belief_delta',
    'mood_delta',
    'new_events',
  ].some(key => key in r);

  return hasContent;
}

/**
 * Create a summary of an LLM interaction for storage in NPC's memory.
 * This is used to build context for future LLM calls.
 */
export function createInteractionSummary(
  npcName: string,
  response: LLMResponse,
  spiritName: string,
): string {
  const parts: string[] = [];

  if (response.dialogue) {
    parts.push(`${npcName} said: "${response.dialogue.slice(0, 50)}${response.dialogue.length > 50 ? '...' : ''}"`);
  }

  if (response.belief_delta) {
    const changes: string[] = [];
    if (response.belief_delta.faith) changes.push(`faith${response.belief_delta.faith > 0 ? '+' : ''}${response.belief_delta.faith?.toFixed(2)}`);
    if (response.belief_delta.understanding) changes.push(`understanding${response.belief_delta.understanding > 0 ? '+' : ''}${response.belief_delta.understanding?.toFixed(2)}`);
    if (changes.length > 0) {
      parts.push(`Belief changed: ${changes.join(', ')}`);
    }
  }

  if (response.mood_delta) {
    parts.push(`Mood ${response.mood_delta > 0 ? 'improved' : 'worsened'} by ${Math.abs(response.mood_delta).toFixed(2)}`);
  }

  return parts.join('; ') || `${npcName} interacted with ${spiritName}`;
}
