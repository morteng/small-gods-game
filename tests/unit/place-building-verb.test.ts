import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { EventLog } from '@/core/events';
import { SimClock } from '@/core/clock';
import { createRng } from '@/core/rng';
import { CAPABILITY_REGISTRY } from '@/sim/command/registry';
import type { Command, ApplyCtx } from '@/sim/command/types';
import type { BuildingDescriptor } from '@/world/building-descriptor';
import type { GameMap } from '@/core/types';

function realizedMap(w = 40, h = 40): GameMap {
  const tiles = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' as const });
    tiles.push(row);
  }
  return { tiles, width: w, height: h, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

function applyCtx(world: World): ApplyCtx {
  return { world, spirits: new Map(), log: new EventLog(new SimClock()), rng: createRng(7), now: 100 };
}

const cmd = (payload: Record<string, unknown>): Command => ({
  verb: 'place_building', source: 'fate', target: { kind: 'none' }, payload, seq: 1,
});

describe('place_building', () => {
  const cap = CAPABILITY_REGISTRY.place_building;

  it('is registered, implemented, authoring tier', () => {
    expect(cap).toBeDefined();
    expect(cap.implemented).toBe(true);
    expect(cap.tier).toBe('authoring');
  });

  it('rejects an unknown preset and a missing location', () => {
    const ctx = applyCtx(new World(realizedMap()));
    expect(cap.precondition!(cmd({ preset: 'nope', at: { x: 5, y: 5 } }), ctx)).toBe('invalid_payload');
    expect(cap.precondition!(cmd({ preset: 'cottage' }), ctx)).toBe('invalid_target');
  });

  it('places a descriptor-carrying building near the target', () => {
    const ctx = applyCtx(new World(realizedMap()));
    expect(cap.precondition!(cmd({ preset: 'cottage', at: { x: 10, y: 10 } }), ctx)).toBeNull();
    expect(cap.apply!(cmd({ preset: 'cottage', at: { x: 10, y: 10 } }), ctx)).toBe(true);
    const placed = ctx.world.query({}).filter(e => e.tags?.includes('building'));
    expect(placed.length).toBe(1);
    const d = placed[0].properties?.descriptor as BuildingDescriptor;
    expect(d.preset).toBe('cottage');
  });

  it('is deterministic for a fixed seed', () => {
    const run = () => {
      const ctx = applyCtx(new World(realizedMap()));
      cap.apply!(cmd({ preset: 'cottage', at: { x: 10, y: 10 } }), ctx);
      const b = ctx.world.query({}).filter(e => e.tags?.includes('building'))[0];
      return `${b.x},${b.y}`;
    };
    expect(run()).toEqual(run());
  });
});
