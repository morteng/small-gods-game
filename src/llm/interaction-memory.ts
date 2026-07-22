/**
 * Interaction memory — distill an interaction into a compact, salience-tagged
 * MemoryEntry, store it in a bounded ring on the NPC, and select entries for
 * prompts. Pure & deterministic (no Math.random, no time-of-day): memory is
 * only ever written on player-driven interactions, never in a tick system.
 */
import type { MemoryEntry, MemoryKind, NpcProperties } from '@/core/types';
import type { LLMResponse } from '@/llm/state-writeback';
import { clamp01 } from '@/core/math';

type BeliefDelta = NonNullable<LLMResponse['belief_delta']>;

/** Hard ceiling on stored memories per NPC. */
export const MEMORY_MAX = 20;

const KIND_WEIGHT: Record<MemoryKind, number> = {
  miracle: 1.0,
  answer: 0.6,
  dream: 0.4,
  whisper: 0.2,
  backfill: 0.1,
  // A mortal↔mortal chat is the most forgettable thing a soul carries — below
  // even ambient narration, so a full ring evicts these first and never loses a
  // divine deed to small talk.
  social: 0.08,
};

/** Distill an LLM response into a one-line summary. Consolidates the two former
 *  createInteractionSummary functions (re-exported from their old homes). */
export function distillInteraction(npcName: string, response: LLMResponse, spiritName: string): string {
  const parts: string[] = [];

  if (response.dialogue) {
    const preview = response.dialogue.length > 50 ? response.dialogue.slice(0, 50) + '...' : response.dialogue;
    parts.push(`${npcName} said: "${preview}"`);
  }

  if (response.belief_delta) {
    const changes: string[] = [];
    const b = response.belief_delta;
    if (b.faith) changes.push(`faith${b.faith > 0 ? '+' : ''}${b.faith.toFixed(2)}`);
    if (b.understanding) changes.push(`understanding${b.understanding > 0 ? '+' : ''}${b.understanding.toFixed(2)}`);
    if (b.devotion) changes.push(`devotion${b.devotion > 0 ? '+' : ''}${b.devotion.toFixed(2)}`);
    if (changes.length > 0) parts.push(`Belief changed: ${changes.join(', ')}`);
  }

  if (response.mood_delta) {
    parts.push(`Mood ${response.mood_delta > 0 ? 'improved' : 'worsened'} by ${Math.abs(response.mood_delta).toFixed(2)}`);
  }

  return parts.join('; ') || `${npcName} interacted with ${spiritName}`;
}

/** Templated one-line summary for a non-LLM divine action. */
export function summarizeDivineAct(kind: MemoryKind, npcName: string, spiritName: string): string {
  switch (kind) {
    case 'dream': return `${spiritName} sent ${npcName} a dream`;
    case 'answer': return `${spiritName} answered ${npcName}'s prayer`;
    case 'miracle': return `${spiritName} worked a miracle for ${npcName}`;
    default: return `${spiritName} touched ${npcName}`;
  }
}

/** Deterministic 0..1 salience from the kind weight + the magnitude of belief/mood change. */
export function computeSalience(kind: MemoryKind, beliefDelta?: BeliefDelta, moodDelta?: number): number {
  const b = beliefDelta ?? {};
  const beliefMag = Math.abs(b.faith ?? 0) + Math.abs(b.understanding ?? 0) + Math.abs(b.devotion ?? 0);
  const moodMag = Math.abs(moodDelta ?? 0);
  return clamp01(KIND_WEIGHT[kind] + 2 * beliefMag + moodMag);
}

/** Push an entry; if over MEMORY_MAX, evict the entry minimizing (salience, tick)
 *  — lowest salience first, oldest as tiebreak. Mutates props.memories in place.
 *  The single ring-write chokepoint, so epithet conferral (M2) rides it — no
 *  interaction site can forget to confer. */
export function recordMemory(props: NpcProperties, entry: MemoryEntry): void {
  const mems = props.memories ?? (props.memories = []);
  mems.push(entry);
  if (mems.length > MEMORY_MAX) {
    let worst = 0;
    for (let i = 1; i < mems.length; i++) {
      const m = mems[i], w = mems[worst];
      if (m.salience < w.salience || (m.salience === w.salience && m.tick < w.tick)) worst = i;
    }
    mems.splice(worst, 1);
  }
  conferEpithet(props);
}

// ── Epithets (M2 — deed-derived bynames; mortal-power spec) ──────────────────
// "An epithet is a salience-argmax over that ring." Conferred by what a god
// actually DID to this mortal; victory renames you. Deterministic, no LLM.

/** A deed must be felt this strongly to earn a byname. A miracle (1.0) or an
 *  answered prayer (0.6) qualifies outright; a dream or whisper only when it
 *  moved the soul (kind weight + 2×belief-delta + mood-delta ≥ this). */
export const EPITHET_THRESHOLD = 0.5;

const EPITHET_BY_KIND: Record<MemoryKind, string | null> = {
  miracle:  'Miracle-touched',
  answer:   'the Answered',        // count-escalated below
  dream:    'the God-dreamt',
  whisper:  'the Whispered-to',
  backfill: null,                  // ambient narration confers nothing
  social:   null,                  // small talk names no one
};

/** The byname this ring currently earns, or null. Argmax salience (oldest wins
 *  ties — the same landmark rule as selectMemoriesForPrompt); answered prayers
 *  escalate with repetition ("the Twice-Answered"). */
export function epithetFor(memories: MemoryEntry[] | undefined): string | null {
  if (!memories || memories.length === 0) return null;
  const best = memories.reduce((b, m) =>
    m.salience > b.salience || (m.salience === b.salience && m.tick < b.tick) ? m : b);
  if (best.salience < EPITHET_THRESHOLD) return null;
  if (best.kind === 'answer') {
    const n = memories.filter(m => m.kind === 'answer').length;
    return n >= 3 ? 'the Thrice-Answered' : n === 2 ? 'the Twice-Answered' : 'the Answered';
  }
  return EPITHET_BY_KIND[best.kind];
}

/** Confer/refresh the sticky byname: a ring that earns one names the mortal; a
 *  ring that no longer does (eviction) never STRIPS an earned name. */
export function conferEpithet(props: NpcProperties): void {
  const e = epithetFor(props.memories);
  if (e) props.epithet = e;
}

/** Select up to maxCount summaries for a prompt: always include the highest-salience
 *  landmark, fill the rest with the most recent, output chronological (tick-ascending). */
export function selectMemoriesForPrompt(memories: MemoryEntry[], maxCount: number): string[] {
  if (maxCount <= 0) return [];
  if (memories.length <= maxCount) return memories.map(m => m.summary);
  const landmark = memories.reduce((best, m) =>
    m.salience > best.salience || (m.salience === best.salience && m.tick < best.tick) ? m : best);
  const recent = memories.slice(-(maxCount - 1));
  const chosen = recent.includes(landmark) ? memories.slice(-maxCount) : [landmark, ...recent];
  return [...chosen].sort((a, b) => a.tick - b.tick).map(m => m.summary);
}
