import { describe, it, expect } from 'vitest';
import { seedWorld } from '@/world/seed-world';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { createRng } from '@/core/rng';
import { queryNpcs, npcProps } from '@/world/npc-helpers';
import { identityOracle } from '@/world/oracle';
import type { GameMap, WorldSeed } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';

function map(): GameMap {
  const tiles = Array.from({ length: 32 }, (_, y) =>
    Array.from({ length: 32 }, (_, x) => ({ x, y, type: 'grass', state: 'void' } as unknown)));
  return { tiles, width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}
function seed(): WorldSeed {
  return {
    name: 'test', pois: [
      { id: 'cradle', type: 'village', name: 'Cradle', position: { x: 16, y: 16 },
        size: 'small', description: '', npcs: [{ name: 'First', role: 'farmer' }] },
    ],
  } as unknown as WorldSeed;
}
function makeSpirits(): Map<SpiritId, Spirit> {
  return new Map([['player',
    { id: 'player', name: 'You', sigil: '✦', color: '#fff', isPlayer: true, power: 10, manifestation: null }]]);
}

describe('seedWorld band', () => {
  it('spawns ~6 NPCs, each a founding believer above the 0.3 reinforcement line', () => {
    const m = map();
    const world = new World(m);
    const clock = new SimClock();
    const log = new EventLog(clock);
    seedWorld({ world, log, clock, spirits: makeSpirits(), rng: createRng(0), worldSeed: seed(), map: m, oracle: identityOracle });

    const npcs = queryNpcs(world);
    expect(npcs.length).toBe(6);
    for (const e of npcs) {
      const b = npcProps(e).beliefs['player'];
      // Above the 0.3 reinforcement threshold so the socially-linked band can
      // self-sustain (below it, communion cuts out and a flock only decays), with
      // a modest understanding/devotion buffer against neglect — but not yet deep.
      expect(b.faith).toBeGreaterThan(0.3);
      expect(b.faith).toBeLessThanOrEqual(0.5);
      expect(b.understanding).toBeGreaterThan(0);
      expect(b.understanding).toBeLessThan(0.3);
      expect(b.devotion).toBeGreaterThan(0);
      expect(b.devotion).toBeLessThan(0.3);
    }
  });

  it('places the band inside the map bounds', () => {
    const m = map();
    const world = new World(m);
    const clock = new SimClock();
    const log = new EventLog(clock);
    seedWorld({ world, log, clock, spirits: makeSpirits(), rng: createRng(0), worldSeed: seed(), map: m, oracle: identityOracle });
    for (const e of queryNpcs(world)) {
      expect(e.x).toBeGreaterThanOrEqual(0);
      expect(e.y).toBeGreaterThanOrEqual(0);
      expect(e.x).toBeLessThan(32);
      expect(e.y).toBeLessThan(32);
    }
  });
});
