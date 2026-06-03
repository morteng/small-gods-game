import { describe, it, expect, vi } from 'vitest';
import { mountInspector } from '@/dev/inspector/Inspector';
import { World } from '@/world/world';
import { EventLog } from '@/core/events';
import { SimClock } from '@/core/clock';
import type { Entity, GameMap } from '@/core/types';
import type { GameState } from '@/core/state';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

function state(world: World): GameState {
  return {
    world, map: null, spirits: new Map(), generatedDecorations: [],
    eventLog: new EventLog(new SimClock()), worldSeed: null,
  } as unknown as GameState;
}
function npc(id: string): Entity {
  return { id, kind: 'npc', x: 1, y: 1, tags: ['npc'],
    properties: { name: id, role: 'farmer', recentEventIds: [],
      personality: { assertiveness: .5, skepticism: .5, piety: .5, sociability: .5 },
      beliefs: {}, needs: { safety: .5, prosperity: .5, community: .5, meaning: .5 },
      relationships: [], parentIds: [], lineageId: id, birthTick: 0, mood: .5,
      whisperCooldown: 0, activity: 'idle', activityDuration: 0, direction: 'down',
      frame: 0, frameTimer: 0, homeX: 1, homeY: 1, seed: 1 },
  } as unknown as Entity;
}

describe('mountInspector', () => {
  it('selectHit shows the panel and renders entity detail', () => {
    const world = new World(emptyMap()); world.addEntity(npc('npc_1'));
    const container = document.createElement('div');
    const insp = mountInspector({
      container, getState: () => state(world),
      onEdit: vi.fn(), onDelete: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(), onFocusCamera: vi.fn(),
    });
    insp.update();
    insp.selectHit({ type: 'entity', tileX: 1, tileY: 1, entity: world.registry.get('npc_1') } as any);
    expect(insp.isVisible()).toBe(true);
    expect(insp.element.textContent).toContain('Beliefs');
    insp.destroy();
  });

  it('clicking a tree leaf selects that entity', () => {
    const world = new World(emptyMap()); world.addEntity(npc('npc_1'));
    const container = document.createElement('div');
    const insp = mountInspector({
      container, getState: () => state(world),
      onEdit: vi.fn(), onDelete: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(), onFocusCamera: vi.fn(),
    });
    insp.show(); insp.update();
    // Expand the npc kind group so its entity leaves render.
    const npcGroup = Array.from(insp.element.querySelectorAll('.sg-dev-tree-node'))
      .find(n => (n.textContent ?? '').includes('npc (')) as HTMLElement;
    expect(npcGroup).toBeDefined();
    npcGroup.click();
    const leaf = Array.from(insp.element.querySelectorAll('.sg-dev-tree-node'))
      .find(n => (n.textContent ?? '').includes('npc_1')) as HTMLElement;
    expect(leaf).toBeDefined();
    leaf.click();
    expect(insp.element.textContent).toContain('Personality');
    insp.destroy();
  });
});
