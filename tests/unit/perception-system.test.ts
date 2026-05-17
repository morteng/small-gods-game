import { describe, it, expect } from 'vitest';
import { PerceptionSystem } from '@/world/perception-system';
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
