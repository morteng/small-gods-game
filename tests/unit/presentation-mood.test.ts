import { describe, it, expect } from 'vitest';
import { computeMood, eventMoodNudge, NEUTRAL_MOOD } from '@/presentation/mood';
import type { GameState } from '@/core/state';

interface FakeNpc {
  needs: { safety: number; prosperity: number; community: number; meaning: number };
  faith: number;
  devotion: number;
}

function fakeState(npcs: FakeNpc[], opts: { rivals?: number; events?: number; tick?: number } = {}): GameState {
  const entities = npcs.map((n) => ({
    properties: {
      needs: n.needs,
      beliefs: { player: { faith: n.faith, understanding: 0.5, devotion: n.devotion } },
      mood: 0.5,
    },
  }));
  const spirits = new Map<string, { id: string; isPlayer: boolean; power: number }>();
  spirits.set('player', { id: 'player', isPlayer: true, power: 100 });
  for (let i = 0; i < (opts.rivals ?? 0); i++) {
    spirits.set(`r${i}`, { id: `r${i}`, isPlayer: false, power: 50 });
  }
  const activeEvents = new Map<string, unknown[]>();
  for (let i = 0; i < (opts.events ?? 0); i++) activeEvents.set(`e${i}`, [{}]);

  return {
    world: { query: () => entities, activeEvents },
    spirits,
    clock: { now: () => opts.tick ?? 0 },
  } as unknown as GameState;
}

const content = (faith: number, devotion: number, need: number): FakeNpc => ({
  needs: { safety: need, prosperity: need, community: need, meaning: need },
  faith,
  devotion,
});

describe('computeMood', () => {
  it('returns NEUTRAL before a world exists', () => {
    const state = { world: null } as unknown as GameState;
    expect(computeMood(state)).toBe(NEUTRAL_MOOD);
  });

  it('high faith + devotion → high reverence', () => {
    const m = computeMood(fakeState([content(0.9, 0.9, 0.8), content(0.8, 0.85, 0.8)]));
    expect(m.reverence).toBeGreaterThan(0.7);
  });

  it('unmet needs → high tension', () => {
    const m = computeMood(fakeState([content(0.1, 0.1, 0.05), content(0.1, 0.1, 0.1)]));
    expect(m.tension).toBeGreaterThan(0.5);
  });

  it('satisfied needs and no rivals → low tension', () => {
    const m = computeMood(fakeState([content(0.5, 0.5, 0.95)]));
    expect(m.tension).toBeLessThan(0.35);
  });

  it('a rival with power raises tension', () => {
    const calm = computeMood(fakeState([content(0.5, 0.5, 0.8)]));
    const contested = computeMood(fakeState([content(0.5, 0.5, 0.8)], { rivals: 2 }));
    expect(contested.tension).toBeGreaterThan(calm.tension);
  });

  it('population and events raise liveliness', () => {
    const sparse = computeMood(fakeState([content(0.5, 0.5, 0.8)]));
    const busy = computeMood(
      fakeState(Array.from({ length: 30 }, () => content(0.5, 0.5, 0.8)), { events: 3 }),
    );
    expect(busy.liveliness).toBeGreaterThan(sparse.liveliness);
  });

  it('all axes stay within [0,1]', () => {
    const m = computeMood(fakeState([content(2, 2, -1)], { rivals: 9, events: 99 }));
    for (const k of ['tension', 'reverence', 'liveliness', 'timeOfDay'] as const) {
      expect(m[k]).toBeGreaterThanOrEqual(0);
      expect(m[k]).toBeLessThanOrEqual(1);
    }
  });
});

describe('eventMoodNudge', () => {
  it('smite spikes tension', () => {
    expect(eventMoodNudge('smite')?.tension).toBeGreaterThan(0);
  });
  it('miracle lifts reverence and eases tension', () => {
    const n = eventMoodNudge('miracle')!;
    expect(n.reverence).toBeGreaterThan(0);
    expect(n.tension).toBeLessThan(0);
  });
  it('unmapped events nudge nothing', () => {
    expect(eventMoodNudge('world_seeded')).toBeNull();
  });
});
