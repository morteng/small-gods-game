import { describe, it, expect, vi } from 'vitest';
import { renderFields, type PropertyField } from '@/dev/PropertyGrid';
import { renderDetail } from '@/dev/inspector/inspector-detail';
import { World } from '@/world/world';
import { EventLog } from '@/core/events';
import { SimClock } from '@/core/clock';
import type { Entity, GameMap } from '@/core/types';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

function npcEntity(): Entity {
  return {
    id: 'npc_1', kind: 'npc', x: 1, y: 1, tags: ['npc'],
    properties: {
      name: 'Ada', role: 'farmer', recentEventIds: [],
      personality: { assertiveness: 0.5, skepticism: 0.2, piety: 0.8, sociability: 0.6 },
      beliefs: { player: { faith: 0.7, understanding: 0.4, devotion: 0.3 } },
      needs: { safety: 0.6, prosperity: 0.5, community: 0.7, meaning: 0.4 },
      relationships: [], parentIds: [], lineageId: 'npc_1', birthTick: 0,
      mood: 0.5, whisperCooldown: 0, activity: 'idle', activityDuration: 0,
      direction: 'down', frame: 0, frameTimer: 0, homeX: 1, homeY: 1, seed: 1,
    },
  } as unknown as Entity;
}

function detailDeps(world: World) {
  return {
    world, map: null, spirits: new Map(), decorations: [],
    eventLog: new EventLog(new SimClock()), seed: null, devMode: null,
    onEdit: vi.fn(), onDelete: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(),
    onNavigate: vi.fn(), onFocusCamera: vi.fn(),
  };
}

describe('renderDetail', () => {
  it('renders rich read-only NPC sections + editable basics', () => {
    const world = new World(emptyMap());
    world.addEntity(npcEntity());
    const host = document.createElement('div');
    renderDetail(host, { type: 'entity', id: 'npc_1' }, detailDeps(world));
    const text = host.textContent ?? '';
    expect(text).toContain('Beliefs');
    expect(text).toContain('Needs');
    expect(text).toContain('Personality');
    expect(text).toContain('faith');
  });

  it('shows "no longer present" for a missing entity', () => {
    const host = document.createElement('div');
    renderDetail(host, { type: 'entity', id: 'ghost' }, detailDeps(new World(emptyMap())));
    expect(host.textContent).toContain('no longer present');
  });

  it('renders the world summary for a world selection', () => {
    const host = document.createElement('div');
    renderDetail(host, { type: 'world' }, detailDeps(new World(emptyMap())));
    expect(host.textContent).toContain('Generation');
  });
});

describe('renderFields', () => {
  it('renders rows with dev classes and emits onChange for editable fields', () => {
    const host = document.createElement('div');
    const fields: PropertyField[] = [
      { key: 'name', label: 'Name', type: 'string' },
      { key: 'role', label: 'Role', type: 'enum', options: ['farmer', 'priest'] },
      { key: 'kind', label: 'Kind', type: 'string', readonly: true },
    ];
    const rec: Record<string, unknown> = { name: 'Ada', role: 'farmer', kind: 'npc' };
    const onChange = vi.fn();
    renderFields(host, fields, k => rec[k], onChange);

    expect(host.querySelectorAll('.sg-dev-row').length).toBe(3);
    const input = host.querySelector('.sg-dev-input') as HTMLInputElement;
    input.value = 'Bob';
    input.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith('name', 'Bob');

    const select = host.querySelector('.sg-dev-select') as HTMLSelectElement;
    expect(select.disabled).toBe(false);
  });
});
