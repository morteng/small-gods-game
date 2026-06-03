import { describe, it, expect } from 'vitest';
import { buildWhisperPrompt } from '@/llm/whisper-prompt-builder';
import type { Entity } from '@/core/types';
import type { WhisperTurn } from '@/llm/npc-attention-store';

function npc(understanding: number): Entity {
  return {
    id: 'npc1', kind: 'npc', x: 3, y: 4,
    properties: {
      name: 'Maeve', role: 'farmer',
      personality: { assertiveness: 0.3, skepticism: 0.6, piety: 0.4, sociability: 0.5 },
      beliefs: { player: { faith: 0.4, understanding, devotion: 0.1 } },
      needs: { safety: 0.5, prosperity: 0.4, community: 0.6, meaning: 0.3 },
      mood: 0.5, activity: 'idle', homePoiId: 'poi_east', recentEventIds: [],
    },
  } as unknown as Entity;
}

describe('buildWhisperPrompt', () => {
  it('includes the new whisper text and the NPC name', () => {
    const p = buildWhisperPrompt({ npc: npc(0.5), whisperText: 'Heed the river', recentTurns: [], playerSpiritId: 'player' });
    expect(p.user).toContain('Heed the river');
    expect(p.user).toContain('Maeve');
  });

  it('asks for dialogue, mood_delta and belief_bonus JSON', () => {
    const p = buildWhisperPrompt({ npc: npc(0.5), whisperText: 'x', recentTurns: [], playerSpiritId: 'player' });
    expect(p.system + p.user).toMatch(/belief_bonus/);
    expect(p.system + p.user).toMatch(/dialogue/);
  });

  it('includes the last turns (capped at 6) for continuity', () => {
    const turns: WhisperTurn[] = Array.from({ length: 9 }, (_, i) => ({ whisper: `w${i}`, dialogue: `d${i}`, tick: i }));
    const p = buildWhisperPrompt({ npc: npc(0.5), whisperText: 'now', recentTurns: turns, playerSpiritId: 'player' });
    expect(p.user).toContain('w8');
    expect(p.user).not.toContain('w2');
  });

  it('flags low comprehension when understanding is low', () => {
    const p = buildWhisperPrompt({ npc: npc(0.05), whisperText: 'x', recentTurns: [], playerSpiritId: 'player' });
    expect(p.user.toLowerCase()).toMatch(/confus|garbl|barely|cannot|can't|unclear/);
  });

  it('flags clear comprehension when understanding is high', () => {
    const p = buildWhisperPrompt({ npc: npc(0.9), whisperText: 'x', recentTurns: [], playerSpiritId: 'player' });
    expect(p.user.toLowerCase()).toMatch(/clear|grasp|understands/);
  });
});
