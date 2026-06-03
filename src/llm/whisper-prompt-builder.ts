import type { Entity, NpcProperties } from '@/core/types';
import type { SpiritId } from '@/core/spirit';
import type { WhisperTurn } from '@/llm/npc-attention-store';

export interface WhisperPromptContext {
  npc: Entity;
  whisperText: string;
  recentTurns: WhisperTurn[];
  playerSpiritId: SpiritId;
}

import type { BuiltPrompt } from '@/llm/npc-prompt-builder';

const MAX_TURNS = 6;

const SYSTEM = [
  "You are narrating a mortal's reaction to a god's whisper in a low-fantasy world of small gods and mortal belief.",
  'The god speaks directly into the mortal\'s mind; the mortal does not see the god.',
  'Reply ONLY with strict JSON: {"dialogue": string, "mood_delta": number, "belief_bonus": number}.',
  'dialogue: the mortal\'s spoken or inner reaction (1-2 sentences, in-character).',
  'mood_delta: -0.2..0.2, how the whisper shifts their mood.',
  'belief_bonus: -0.1..0.1, how APT the whisper was for this mortal right now (a fitting, well-timed whisper earns more; a jarring or irrelevant one can be negative).',
].join(' ');

function comprehensionNote(understanding: number): string {
  if (understanding < 0.2) {
    return 'This mortal barely comprehends divine signals — the whisper arrives confused and garbled, words they cannot quite place.';
  }
  if (understanding < 0.6) {
    return 'This mortal partially comprehends divine signals — the whisper lands as a strong intuition, half-understood.';
  }
  return 'This mortal clearly grasps divine signals — the whisper is understood almost as plain speech.';
}

export function buildWhisperPrompt(ctx: WhisperPromptContext): BuiltPrompt {
  const p = ctx.npc.properties as unknown as NpcProperties;
  const b = p.beliefs[ctx.playerSpiritId] ?? { faith: 0, understanding: 0, devotion: 0 };
  const recent = ctx.recentTurns.slice(-MAX_TURNS);

  const lines: string[] = [];
  lines.push(`Mortal: ${p.name}, a ${p.role}.`);
  lines.push(`Personality — assertiveness ${p.personality.assertiveness.toFixed(2)}, skepticism ${p.personality.skepticism.toFixed(2)}, piety ${p.personality.piety.toFixed(2)}, sociability ${p.personality.sociability.toFixed(2)}.`);
  lines.push(`Belief in you — faith ${b.faith.toFixed(2)}, understanding ${b.understanding.toFixed(2)}, devotion ${b.devotion.toFixed(2)}.`);
  lines.push(`Needs — safety ${p.needs.safety.toFixed(2)}, prosperity ${p.needs.prosperity.toFixed(2)}, community ${p.needs.community.toFixed(2)}, meaning ${p.needs.meaning.toFixed(2)}.`);
  lines.push(`Mood ${p.mood.toFixed(2)}; currently ${p.activity}.`);
  lines.push(comprehensionNote(b.understanding));
  if (recent.length) {
    lines.push('Recent whisper exchanges (oldest first):');
    for (const t of recent) lines.push(`  you whispered: "${t.whisper}" → they reacted: "${t.dialogue}"`);
  }
  lines.push(`You now whisper: "${ctx.whisperText}"`);
  lines.push('Return the mortal\'s reaction as JSON.');

  const user = lines.join('\n');
  return { system: SYSTEM, user, estimatedTokens: Math.ceil((SYSTEM.length + user.length) / 4) };
}
