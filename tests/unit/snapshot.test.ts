import { describe, it, expect } from 'vitest';
import { createState } from '@/core/state';
import { captureSnapshot, restoreSnapshot } from '@/core/snapshot';
import { initNpcProps } from '@/world/npc-helpers';
import { World } from '@/world/world';
import type { GameMap, Tile } from '@/core/types';

function attachWorld(state: ReturnType<typeof createState>): void {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 10; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 10; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'void' });
    tiles.push(row);
  }
  const map: GameMap = {
    tiles, width: 10, height: 10, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
  state.map = map;
  state.world = new World(map);
  const props = initNpcProps('Alice', 'farmer', 42);
  state.world.addEntity({ id: 'n1', kind: 'npc', x: 5, y: 5, properties: props as unknown as Record<string, unknown> });
}

describe('snapshot', () => {
  it('captures clock, rng state, spirits, and entity positions', () => {
    const s = createState();
    attachWorld(s);
    s.clock.advance(1234);
    s.rng.next(); s.rng.next();

    const capturedTick = s.clock.now();
    const snap = captureSnapshot(s);

    s.clock.advance(99999);
    s.rng.next();
    s.world!.registry.update('n1', { x: 9, y: 9 });

    restoreSnapshot(s, snap);
    expect(s.clock.now()).toBe(capturedTick);
    expect(s.world!.registry.get('n1')!.x).toBe(5);
    expect(s.world!.registry.get('n1')!.y).toBe(5);
  });

  it('rng state survives the round-trip', () => {
    const s = createState();
    attachWorld(s);
    s.rng.next(); s.rng.next(); s.rng.next();
    const snap = captureSnapshot(s);
    const after = s.rng.next();
    restoreSnapshot(s, snap);
    expect(s.rng.next()).toBe(after);
  });

  it('spirits added after capture are dropped on restore (snapshot is authoritative)', () => {
    const s = createState();
    attachWorld(s);
    const snap = captureSnapshot(s);
    s.spirits.set('rival', {
      id: 'rival', name: 'The Wandering Minstrel', sigil: '◐', color: '#a55',
      isPlayer: false, power: 7, manifestation: null,
      ai: { policy: 'tempt-merchants', cooldowns: { whisper: 12 } },
    });
    expect(s.spirits.size).toBe(2);
    restoreSnapshot(s, snap);
    expect(s.spirits.size).toBe(1);
    expect(s.spirits.has('rival')).toBe(false);
  });

  it('spirit ai cooldowns are deep-cloned and survive the round-trip', () => {
    const s = createState();
    attachWorld(s);
    s.spirits.set('rival', {
      id: 'rival', name: 'Rival', sigil: '◐', color: '#a55',
      isPlayer: false, power: 4, manifestation: null,
      ai: { policy: 'aggressive', cooldowns: { miracle: 5, whisper: 2 } },
    });
    const snap = captureSnapshot(s);
    // Mutate the live state.
    s.spirits.get('rival')!.ai!.cooldowns.miracle = 99;
    s.spirits.get('rival')!.power = 0;
    restoreSnapshot(s, snap);
    expect(s.spirits.get('rival')!.ai!.cooldowns.miracle).toBe(5);
    expect(s.spirits.get('rival')!.power).toBe(4);
  });
});
