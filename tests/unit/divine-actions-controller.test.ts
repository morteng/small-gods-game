import { describe, it, expect } from 'vitest';
import { DivineActionsController } from '@/game/divine-actions-controller';
import { createState } from '@/core/state';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import { OverlayDispatcher } from '@/ui/overlay-dispatcher';
import { CommandQueue } from '@/sim/command/command-queue';
import type { DivineEffects } from '@/render/divine-effects';
import type { GameMap, Tile } from '@/core/types';

function makeMap(w = 5, h = 5): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: w, height: h, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

function makeWorld() {
  return new World(makeMap());
}

describe('DivineActionsController', () => {
  it('whisper succeeds, sets lastCastTime via injected clock, triggers effect', () => {
    const state = createState();
    const world = makeWorld();
    const props = initNpcProps('Ana', 'farmer', 1) as any;
    props.whisperCooldown = 0; // ensure no cooldown
    world.addEntity({ id: 'n1', kind: 'npc', x: 2, y: 3, properties: props, tags: [] });
    state.world = world;
    const player = state.spirits.get('player')!;
    player.power = 100; // ensure affordable
    let triggers = 0;
    const fx = { trigger: () => { triggers++; } } as unknown as DivineEffects;
    const ctrl = new DivineActionsController({ state, queue: new CommandQueue(), divineEffects: fx, now: () => 12345 });
    const npc = world.query({ kind: 'npc' })[0];
    expect(ctrl.whisper(npc)).toBe(true);
    expect(ctrl.lastCastTime).toBe(12345);
    expect(triggers).toBe(1);
  });

  it('whisper returns false and does not update lastCastTime when power is too low', () => {
    const state = createState();
    const world = makeWorld();
    const props = initNpcProps('Bob', 'farmer', 1) as any;
    props.whisperCooldown = 0;
    world.addEntity({ id: 'n2', kind: 'npc', x: 1, y: 1, properties: props, tags: [] });
    state.world = world;
    const player = state.spirits.get('player')!;
    player.power = 0; // not affordable
    const fx = { trigger: () => {} } as unknown as DivineEffects;
    const ctrl = new DivineActionsController({ state, queue: new CommandQueue(), divineEffects: fx, now: () => 99999 });
    const npc = world.query({ kind: 'npc' })[0];
    expect(ctrl.whisper(npc)).toBe(false);
    expect(ctrl.lastCastTime).toBe(-Infinity);
  });

  it('dream returns true and triggers effect when power is sufficient', () => {
    const state = createState();
    const world = makeWorld();
    const props = initNpcProps('Cara', 'farmer', 1) as any;
    world.addEntity({ id: 'n3', kind: 'npc', x: 1, y: 1, properties: props, tags: [] });
    state.world = world;
    const player = state.spirits.get('player')!;
    player.power = 100;
    let triggerType = '';
    const fx = { trigger: (type: string) => { triggerType = type; } } as unknown as DivineEffects;
    const ctrl = new DivineActionsController({ state, queue: new CommandQueue(), divineEffects: fx, now: () => 0 });
    const npc = world.query({ kind: 'npc' })[0];
    expect(ctrl.dream(npc)).toBe(true);
    expect(triggerType).toBe('dream');
  });

  it('dream returns false and does not trigger effect when power is too low', () => {
    const state = createState();
    const world = makeWorld();
    const props = initNpcProps('Eve', 'farmer', 1) as any;
    world.addEntity({ id: 'n5', kind: 'npc', x: 1, y: 1, properties: props, tags: [] });
    state.world = world;
    const player = state.spirits.get('player')!;
    player.power = 0;
    let triggers = 0;
    const fx = { trigger: () => { triggers++; } } as unknown as DivineEffects;
    const ctrl = new DivineActionsController({ state, queue: new CommandQueue(), divineEffects: fx, now: () => 0 });
    const npc = world.query({ kind: 'npc' })[0];
    expect(ctrl.dream(npc)).toBe(false);
    expect(triggers).toBe(0);
  });

  it('register hooks up dispatcher for whisper action', () => {
    const state = createState();
    const world = makeWorld();
    const props = initNpcProps('Dan', 'farmer', 1) as any;
    props.whisperCooldown = 0;
    world.addEntity({ id: 'n4', kind: 'npc', x: 1, y: 1, properties: props, tags: [] });
    state.world = world;
    const player = state.spirits.get('player')!;
    player.power = 100;
    let triggers = 0;
    const fx = { trigger: () => { triggers++; } } as unknown as DivineEffects;
    const ctrl = new DivineActionsController({ state, queue: new CommandQueue(), divineEffects: fx, now: () => 0 });
    const dispatcher = new OverlayDispatcher();
    ctrl.register(dispatcher);
    const result = (dispatcher as any).handlers.get('whisper')({ npcId: 'n4' });
    expect(result).toBe(true);
    expect(triggers).toBe(1);
  });
});
