import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { EventLog } from '@/core/events';
import { SimClock } from '@/core/clock';
import { createRng } from '@/core/rng';
import { CAPABILITY_REGISTRY } from '@/sim/command/registry';
import type { Command, ApplyCtx } from '@/sim/command/types';
import { blueprintOf } from '@/blueprint/entity';
import type { GameMap } from '@/core/types';
import { initNpcProps } from '@/world/npc-helpers';

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

  it('places a blueprint-carrying building near the target', () => {
    const ctx = applyCtx(new World(realizedMap()));
    expect(cap.precondition!(cmd({ preset: 'cottage', at: { x: 10, y: 10 } }), ctx)).toBeNull();
    expect(cap.apply!(cmd({ preset: 'cottage', at: { x: 10, y: 10 } }), ctx)).toBe(true);
    const placed = ctx.world.query({}).filter(e => e.tags?.includes('building'));
    expect(placed.length).toBe(1);
    const b = placed[0];
    const stored = blueprintOf(b)!;
    expect(stored.rb.preset).toBe('cottage');
    // door cell stays walkable; a non-door footprint cell becomes solid
    const [dx, dy] = stored.collision.doorCells[0].split(',').map(Number); // {1,1} for cottage body
    const ox = b.x, oy = b.y;
    expect(ctx.world.tiles.tiles[oy + dy][ox + dx].walkable).toBe(true);
    expect(ctx.world.tiles.tiles[oy][ox].walkable).toBe(false); // top-left corner {0,0} — not the door
  });

  it('places near a settlement target resolved via a resident npc', () => {
    const world = new World(realizedMap());
    // seed a resident whose homePoiId the settlement target resolves to
    const props = initNpcProps('Resident', 'farmer', 1);
    props.homePoiId = 'v1';
    world.addEntity({ id: 'npc1', kind: 'npc', x: 15, y: 15, properties: props as unknown as Record<string, unknown> });
    const ctx = applyCtx(world);
    const settlementCmd: Command = {
      verb: 'place_building', source: 'fate',
      target: { kind: 'settlement', poiId: 'v1' }, payload: { preset: 'cottage' }, seq: 1,
    };
    expect(cap.precondition!(settlementCmd, ctx)).toBeNull();
    expect(cap.apply!(settlementCmd, ctx)).toBe(true);
    expect(ctx.world.query({}).filter(e => e.tags?.includes('building')).length).toBe(1);
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
