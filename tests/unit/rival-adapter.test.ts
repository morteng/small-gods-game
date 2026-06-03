import { describe, it, expect } from 'vitest';
import { rivalToSpirit, spiritToRivalView } from '@/sim/command/rival-adapter';
import { createRivalSpirit } from '@/sim/rival-spirit';
import { createRng } from '@/core/rng';
import type { Spirit } from '@/core/spirit';

describe('rival ⇄ spirit adapter', () => {
  it('rivalToSpirit produces a non-player Spirit with a populated ai profile', () => {
    const rng = createRng(42);
    const rival = createRivalSpirit('rival-1', 'Sablethorn', () => rng.next(), {
      title: 'The Root', settlements: ['poi1', 'poi2'], color: '#a0f',
    });
    const s = rivalToSpirit(rival);

    expect(s.id).toBe('rival-1');
    expect(s.isPlayer).toBe(false);
    expect(s.power).toBe(rival.power);
    expect(s.color).toBe('#a0f');
    expect(s.ai).toBeDefined();
    expect(s.ai!.policy).toBe(rival.strategy);
    expect(s.ai!.personality).toEqual(rival.personality);
    expect(s.ai!.settlements).toEqual(['poi1', 'poi2']);
  });

  it('spiritToRivalView round-trips the behavioural fields', () => {
    const rng = createRng(7);
    const rival = createRivalSpirit('rival-2', 'Goldentongue', () => rng.next(), { settlements: ['poiX'] });
    const s = rivalToSpirit(rival);
    s.ai!.lastActionTick = 55;

    const view = spiritToRivalView(s);
    expect(view).not.toBeNull();
    expect(view!.id).toBe('rival-2');
    expect(view!.strategy).toBe(rival.strategy);
    expect(view!.personality).toEqual(rival.personality);
    expect(view!.settlements).toEqual(['poiX']);
    expect(view!.lastActionTick).toBe(55);
    expect(view!.power).toBe(s.power);
  });

  it('returns null for a player spirit (no ai profile)', () => {
    const player: Spirit = { id: 'player', name: 'You', sigil: '✦', color: '#fff', isPlayer: true, power: 10, manifestation: null };
    expect(spiritToRivalView(player)).toBeNull();
  });
});
