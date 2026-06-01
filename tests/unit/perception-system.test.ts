import { describe, it, expect } from 'vitest';
import { PerceptionSystem, perceptionReach } from '@/world/perception-system';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { initNpcProps } from '@/world/npc-helpers';
import { identityOracle } from '@/world/oracle';
import { createRng } from '@/core/rng';
import type { GameMap, Tile, Entity } from '@/core/types';

function makeMap(w: number, h: number, type = 'grass'): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) {
      row.push({ type, x, y, walkable: true, state: 'void' });
    }
    tiles.push(row);
  }
  return { tiles, width: w, height: h, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

function setup(faith = 0.5) {
  const map = makeMap(20, 20);
  const world = new World(map);
  const props = initNpcProps('Alice', 'farmer', 42);
  props.beliefs['player'].faith = faith;
  const e: Entity = { id: 'n1', kind: 'npc', x: 10, y: 10, properties: props as unknown as Record<string, unknown> };
  world.addEntity(e);
  const log = new EventLog(new SimClock());
  return { world, log, map, e };
}

describe('PerceptionSystem', () => {
  it('initial tick realizes a bubble around the believer', () => {
    const sys = new PerceptionSystem(identityOracle, () => null);
    const { world, log, map } = setup(0.2);
    sys.tick({ world, log, clock: new SimClock(), spirits: new Map(), rng: createRng(0), dt: 500, now: 1 });
    // Center tile should be realized
    expect(map.tiles[10][10].state).toBe('realized');
    // Far corner should still be void
    expect(map.tiles[0][0].state).toBe('void');
  });

  it('bubble radius grows with faith', () => {
    const a = setup(0.0);
    const b = setup(1.0);
    const sysA = new PerceptionSystem(identityOracle, () => a.map);
    const sysB = new PerceptionSystem(identityOracle, () => b.map);
    sysA.tick({ world: a.world, log: a.log, clock: new SimClock(), spirits: new Map(), rng: createRng(0), dt: 500, now: 1 });
    sysB.tick({ world: b.world, log: b.log, clock: new SimClock(), spirits: new Map(), rng: createRng(0), dt: 500, now: 1 });
    const countA = a.map.tiles.flat().filter(t => t.state === 'realized').length;
    const countB = b.map.tiles.flat().filter(t => t.state === 'realized').length;
    expect(countB).toBeGreaterThan(countA);
  });

  it('emits one region_realized per growth tick', () => {
    const s = setup(0.5);
    const sys = new PerceptionSystem(identityOracle, () => s.map);
    sys.tick({ world: s.world, log: s.log, clock: new SimClock(), spirits: new Map(), rng: createRng(0), dt: 500, now: 1 });
    const regionEvents = s.log.since(0).map(a => a.event).filter(e => e.type === 'region_realized');
    expect(regionEvents.length).toBe(1);
  });

  it('emits tile_collapsed per realized tile, deterministically ordered', () => {
    const s1 = setup(0.0);
    const s2 = setup(0.0);
    const sys1 = new PerceptionSystem(identityOracle, () => s1.map);
    const sys2 = new PerceptionSystem(identityOracle, () => s2.map);
    sys1.tick({ world: s1.world, log: s1.log, clock: new SimClock(), spirits: new Map(), rng: createRng(0), dt: 500, now: 1 });
    sys2.tick({ world: s2.world, log: s2.log, clock: new SimClock(), spirits: new Map(), rng: createRng(0), dt: 500, now: 1 });
    const e1 = s1.log.since(0).map(a => a.event).filter(e => e.type === 'tile_collapsed');
    const e2 = s2.log.since(0).map(a => a.event).filter(e => e.type === 'tile_collapsed');
    expect(e1.length).toBeGreaterThan(0);
    expect(e1).toEqual(e2);
  });

  it('does not re-emit tile_collapsed for already-realized tiles', () => {
    const s = setup(0.0);
    const sys = new PerceptionSystem(identityOracle, () => s.map);
    sys.tick({ world: s.world, log: s.log, clock: new SimClock(), spirits: new Map(), rng: createRng(0), dt: 500, now: 1 });
    sys.tick({ world: s.world, log: s.log, clock: new SimClock(), spirits: new Map(), rng: createRng(0), dt: 500, now: 2 });
    const tileEvents = s.log.since(0).map(a => a.event).filter(e => e.type === 'tile_collapsed') as Array<{ x: number; y: number }>;
    const set = new Set(tileEvents.map(t => `${t.x},${t.y}`));
    expect(set.size).toBe(tileEvents.length);
  });
});

describe('perceptionReach', () => {
  it('opens a base bubble even at zero faith and understanding', () => {
    expect(perceptionReach(0, 0)).toBe(3);
  });

  it('faith is the primary driver (+4 at full faith)', () => {
    expect(perceptionReach(1, 0)).toBe(7);
  });

  it('understanding extends reach secondarily (+2 at full understanding)', () => {
    expect(perceptionReach(0, 1)).toBe(5);
    expect(perceptionReach(1, 1)).toBe(9);
  });

  it('combines both, flooring the sum', () => {
    expect(perceptionReach(0.5, 0.5)).toBe(6); // 3 + floor(2 + 1)
  });
});

describe('PerceptionSystem understanding reach', () => {
  it('realizes more tiles when the dominant belief has higher understanding', () => {
    // setup() adds the entity to the world by reference, so mutating .beliefs
    // in place updates the same object the world holds — do NOT reassign .properties.
    const lowU = setup(0.5);
    (lowU.e.properties as any).beliefs = { player: { faith: 0.5, understanding: 0.0, devotion: 0 } };
    const highU = setup(0.5);
    (highU.e.properties as any).beliefs = { player: { faith: 0.5, understanding: 1.0, devotion: 0 } };

    const sysLow = new PerceptionSystem(identityOracle, () => lowU.map);
    const sysHigh = new PerceptionSystem(identityOracle, () => highU.map);
    sysLow.tick({ world: lowU.world, log: lowU.log, clock: new SimClock(), spirits: new Map(), rng: createRng(0), dt: 500, now: 1 });
    sysHigh.tick({ world: highU.world, log: highU.log, clock: new SimClock(), spirits: new Map(), rng: createRng(0), dt: 500, now: 1 });

    const countLow = lowU.map.tiles.flat().filter(t => t.state === 'realized').length;
    const countHigh = highU.map.tiles.flat().filter(t => t.state === 'realized').length;
    expect(countHigh).toBeGreaterThan(countLow);
  });
});
