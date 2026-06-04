import { describe, it, expect } from 'vitest';
import { DivineActionsController } from '@/game/divine-actions-controller';
import { CommandQueue } from '@/sim/command/command-queue';
import { createState } from '@/core/state';
import { World } from '@/world/world';
import { initNpcProps, npcProps } from '@/world/npc-helpers';
import type { GameMap, Tile, Entity } from '@/core/types';
import type { DivineEffects } from '@/render/divine-effects';

function makeMap(): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 5; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 5; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: 5, height: 5, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

const noopEffects = { trigger() {} } as unknown as DivineEffects;

function setup(activity: string) {
  const state = createState();
  state.map = makeMap();
  state.world = new World(state.map);
  const props = initNpcProps('Maeve', 'farmer', 1) as any;
  props.activity = activity;
  const npc: Entity = { id: 'n1', kind: 'npc', x: 2, y: 2, tags: [], properties: props };
  state.world.addEntity(npc);
  const queue = new CommandQueue();
  const ctrl = new DivineActionsController({ state, queue, divineEffects: noopEffects, now: () => 0 });
  return { state, npc, ctrl };
}

describe('divine-action memory', () => {
  it('answerPrayer records a high-salience landmark on a worshipping NPC', () => {
    const { npc, ctrl } = setup('worship');
    expect(ctrl.answerPrayer(npc)).toBe(true);
    const mems = npcProps(npc).memories ?? [];
    expect(mems).toHaveLength(1);
    expect(mems[0].kind).toBe('answer');
    expect(mems[0].salience).toBeGreaterThanOrEqual(0.6);
  });

  it('dream records a memory', () => {
    const { npc, ctrl } = setup('idle');
    expect(ctrl.dream(npc)).toBe(true);
    expect((npcProps(npc).memories ?? [])[0].kind).toBe('dream');
  });

  it('does not record when the action is gated out', () => {
    const { npc, ctrl } = setup('idle');
    expect(ctrl.answerPrayer(npc)).toBe(false);
    expect(npcProps(npc).memories ?? []).toHaveLength(0);
  });
});
