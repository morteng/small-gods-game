import { describe, it, expect } from 'vitest';
import { applyUndo, applyRedo } from '@/game/dev-mode-history';
import { World } from '@/world/world';
import type { GameMap, Tile, UndoAction } from '@/core/types';

function makeMap(w = 4, h = 4): GameMap {
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

describe('dev-mode history reducer', () => {
  it('undo of entity_create removes the entity; redo re-adds it', () => {
    const world = makeWorld();
    const entity = { id: 'e1', kind: 'rock', x: 1, y: 1, properties: {}, tags: [] };
    world.addEntity(entity as any);
    const action: UndoAction = { type: 'entity_create', target: { tileX: 1, tileY: 1, entityId: 'e1' }, before: null, after: JSON.parse(JSON.stringify(entity)) };
    applyUndo(action, world, null);
    expect(world.query({}).find(e => e.id === 'e1')).toBeUndefined();
    applyRedo(action, world, null);
    expect(world.query({}).find(e => e.id === 'e1')).toBeDefined();
  });

  it('undo of entity_update restores the before-snapshot', () => {
    const world = makeWorld();
    const entity = { id: 'e2', kind: 'tree', x: 0, y: 0, properties: { hp: 5 }, tags: [] };
    world.addEntity(entity as any);
    const before = JSON.parse(JSON.stringify(entity));
    world.updateEntity('e2', { properties: { hp: 9 } });
    const upd: UndoAction = { type: 'entity_update', target: { tileX: 0, tileY: 0, entityId: 'e2' }, before, after: { ...entity, properties: { hp: 9 } } };
    applyUndo(upd, world, null);
    expect((world.query({}).find(e => e.id === 'e2')!.properties as any).hp).toBe(5);
  });

  it('undo of entity_delete re-adds the entity', () => {
    const world = makeWorld();
    const entity = { id: 'e3', kind: 'rock', x: 2, y: 2, properties: {}, tags: [] };
    const del: UndoAction = { type: 'entity_delete', target: { tileX: 2, tileY: 2, entityId: 'e3' }, before: JSON.parse(JSON.stringify(entity)), after: null };
    applyUndo(del, world, null);
    expect(world.query({}).find(e => e.id === 'e3')).toBeDefined();
  });

  it('tile_update applies after on redo and before on undo', () => {
    const map = { width: 2, height: 2, tiles: [[{ type: 'grass', walkable: true }, { type: 'grass', walkable: true }], [{ type: 'grass', walkable: true }, { type: 'grass', walkable: true }]] } as any;
    const action: UndoAction = { type: 'tile_update', target: { tileX: 0, tileY: 0 }, before: { type: 'grass' }, after: { type: 'water' } };
    applyRedo(action, null, map);
    expect(map.tiles[0][0].type).toBe('water');
    applyUndo(action, null, map);
    expect(map.tiles[0][0].type).toBe('grass');
  });
});
