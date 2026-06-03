import { describe, it, expect } from 'vitest';
import { applyWhisperBonus, WHISPER_BONUS_CLAMP } from '@/llm/state-writeback';
import type { Entity } from '@/core/types';

function npcWith(faith: number): Entity {
  return {
    id: 'npc1', kind: 'npc', x: 0, y: 0,
    properties: { beliefs: { player: { faith, understanding: 0.2, devotion: 0.1 } } },
  } as unknown as Entity;
}

describe('applyWhisperBonus', () => {
  it('exposes a 0.10 clamp constant', () => {
    expect(WHISPER_BONUS_CLAMP).toBeCloseTo(0.10, 5);
  });

  it('applies a positive bonus to faith', () => {
    const npc = npcWith(0.4);
    const applied = applyWhisperBonus(npc, 0.07, 'player');
    expect(applied).toBeCloseTo(0.07, 5);
    expect((npc.properties as any).beliefs.player.faith).toBeCloseTo(0.47, 5);
  });

  it('clamps a too-large bonus to ±0.10', () => {
    const npc = npcWith(0.4);
    const applied = applyWhisperBonus(npc, 0.5, 'player');
    expect(applied).toBeCloseTo(0.10, 5);
    expect((npc.properties as any).beliefs.player.faith).toBeCloseTo(0.50, 5);
  });

  it('clamps a negative bonus to -0.10 and keeps faith ≥ 0', () => {
    const npc = npcWith(0.05);
    const applied = applyWhisperBonus(npc, -0.9, 'player');
    expect(applied).toBeCloseTo(-0.10, 5);
    expect((npc.properties as any).beliefs.player.faith).toBe(0);
  });

  it('initializes belief if the spirit is unknown to the npc', () => {
    const npc = { id: 'n', kind: 'npc', x: 0, y: 0, properties: { beliefs: {} } } as unknown as Entity;
    const applied = applyWhisperBonus(npc, 0.08, 'player');
    expect(applied).toBeCloseTo(0.08, 5);
    expect((npc.properties as any).beliefs.player.faith).toBeCloseTo(0.08, 5);
  });
});
