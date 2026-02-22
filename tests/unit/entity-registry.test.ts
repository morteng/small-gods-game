import { describe, it, expect, beforeEach } from 'vitest';
import { SpatialHashGrid } from '@/world/spatial-hash';
import { EntityRegistry } from '@/world/entity-registry';
import type { WorldEntity } from '@/core/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEntity(overrides: Partial<WorldEntity> & { id: string }): WorldEntity {
  return {
    category:              'building',
    type:                  'cottage',
    tileX:                 0,
    tileY:                 0,
    era:                   'medieval',
    religiousSignificance: 'neutral',
    state:                 'intact',
    metadata:              {},
    ...overrides,
  } as WorldEntity;
}

// ─── SpatialHashGrid ─────────────────────────────────────────────────────────

describe('SpatialHashGrid', () => {
  let grid: SpatialHashGrid;
  beforeEach(() => { grid = new SpatialHashGrid(16); });

  it('add + getInRadius', () => {
    grid.add('a', 5, 5);
    grid.add('b', 10, 10);
    grid.add('c', 100, 100);
    expect(grid.getInRadius(5, 5, 8)).toContain('a');
    expect(grid.getInRadius(5, 5, 8)).toContain('b');
    expect(grid.getInRadius(5, 5, 8)).not.toContain('c');
  });

  it('remove cleans up', () => {
    grid.add('x', 3, 3);
    grid.remove('x');
    expect(grid.getInRadius(3, 3, 5)).not.toContain('x');
    expect(grid.size).toBe(0);
  });

  it('move updates position', () => {
    grid.add('m', 0, 0);
    grid.move('m', 50, 50);
    expect(grid.getInRadius(0, 0, 5)).not.toContain('m');
    expect(grid.getInRadius(50, 50, 5)).toContain('m');
  });

  it('getInRect', () => {
    grid.add('r1', 5, 5);
    grid.add('r2', 15, 15);
    grid.add('r3', 30, 30);
    const res = grid.getInRect(0, 0, 20, 20);
    expect(res).toContain('r1');
    expect(res).toContain('r2');
    expect(res).not.toContain('r3');
  });

  it('returns nothing for empty radius', () => {
    grid.add('z', 100, 100);
    expect(grid.getInRadius(0, 0, 5)).toHaveLength(0);
  });

  it('handles boundary of radius exactly', () => {
    grid.add('edge', 10, 0);
    // radius = 10 exactly → distance = 10 → should be included
    const res = grid.getInRadius(0, 0, 10);
    expect(res).toContain('edge');
  });
});

// ─── EntityRegistry ──────────────────────────────────────────────────────────

describe('EntityRegistry — CRUD', () => {
  let reg: EntityRegistry;
  beforeEach(() => { reg = new EntityRegistry(); });

  it('add and get', () => {
    const e = makeEntity({ id: 'e1', tileX: 5, tileY: 5 });
    reg.add(e);
    expect(reg.get('e1')).toBe(e);
    expect(reg.size).toBe(1);
  });

  it('throws on duplicate id', () => {
    reg.add(makeEntity({ id: 'dup' }));
    expect(() => reg.add(makeEntity({ id: 'dup' }))).toThrow();
  });

  it('remove returns entity', () => {
    const e = makeEntity({ id: 'r1' });
    reg.add(e);
    const removed = reg.remove('r1');
    expect(removed).toBe(e);
    expect(reg.get('r1')).toBeUndefined();
    expect(reg.size).toBe(0);
  });

  it('remove unknown id returns undefined', () => {
    expect(reg.remove('nope')).toBeUndefined();
  });

  it('update changes entity fields', () => {
    reg.add(makeEntity({ id: 'u1', tileX: 3, tileY: 3, state: 'intact' }));
    reg.update('u1', { state: 'ruined' });
    expect(reg.get('u1')!.state).toBe('ruined');
  });

  it('has()', () => {
    reg.add(makeEntity({ id: 'h1' }));
    expect(reg.has('h1')).toBe(true);
    expect(reg.has('h99')).toBe(false);
  });
});

describe('EntityRegistry — spatial queries', () => {
  let reg: EntityRegistry;
  beforeEach(() => {
    reg = new EntityRegistry();
    reg.add(makeEntity({ id: 'near',  tileX: 5, tileY: 5 }));
    reg.add(makeEntity({ id: 'mid',   tileX: 15, tileY: 15 }));
    reg.add(makeEntity({ id: 'far',   tileX: 100, tileY: 100 }));
  });

  it('getInRadius', () => {
    // near=(5,5) mid=(15,15): dist=√200≈14.1, need radius≥15 to include both
    const res = reg.getInRadius(5, 5, 15);
    expect(res.map(e => e.id)).toContain('near');
    expect(res.map(e => e.id)).toContain('mid');
    expect(res.map(e => e.id)).not.toContain('far');
  });

  it('getInRect', () => {
    const res = reg.getInRect(0, 0, 20, 20);
    expect(res.map(e => e.id)).toContain('near');
    expect(res.map(e => e.id)).toContain('mid');
    expect(res.map(e => e.id)).not.toContain('far');
  });

  it('getAtTile exact', () => {
    const res = reg.getAtTile(5, 5);
    expect(res.map(e => e.id)).toContain('near');
    expect(res.map(e => e.id)).not.toContain('mid');
  });

  it('getAtTile respects footprint', () => {
    const cottage = makeEntity({ id: 'c1', tileX: 10, tileY: 10, footprint: { w: 3, h: 3 } });
    reg.add(cottage);
    // Interior cell
    expect(reg.getAtTile(11, 11).map(e => e.id)).toContain('c1');
    // Edge cell
    expect(reg.getAtTile(12, 12).map(e => e.id)).toContain('c1');
    // Outside
    expect(reg.getAtTile(13, 10).map(e => e.id)).not.toContain('c1');
  });

  it('move updates spatial position', () => {
    reg.update('near', { tileX: 50, tileY: 50 });
    expect(reg.getAtTile(5, 5).map(e => e.id)).not.toContain('near');
    expect(reg.getAtTile(50, 50).map(e => e.id)).toContain('near');
  });
});

describe('EntityRegistry — index queries', () => {
  let reg: EntityRegistry;
  beforeEach(() => {
    reg = new EntityRegistry();
    reg.add(makeEntity({ id: 'b1', poiId: 'poi1', category: 'building' }));
    reg.add(makeEntity({ id: 'b2', poiId: 'poi1', category: 'building' }));
    reg.add(makeEntity({ id: 't1', poiId: 'poi2', category: 'tree', type: 'oak' }));
  });

  it('getByPoi', () => {
    const res = reg.getByPoi('poi1');
    expect(res.map(e => e.id)).toContain('b1');
    expect(res.map(e => e.id)).toContain('b2');
    expect(res.map(e => e.id)).not.toContain('t1');
  });

  it('getByCategory', () => {
    const trees = reg.getByCategory('tree');
    expect(trees.map(e => e.id)).toContain('t1');
    expect(trees.map(e => e.id)).not.toContain('b1');
  });

  it('removeByPoi removes all entities for that POI', () => {
    const removed = reg.removeByPoi('poi1');
    expect(removed).toHaveLength(2);
    expect(reg.get('b1')).toBeUndefined();
    expect(reg.get('b2')).toBeUndefined();
    expect(reg.get('t1')).toBeDefined();
  });
});

describe('EntityRegistry — occupancy', () => {
  let reg: EntityRegistry;
  beforeEach(() => {
    reg = new EntityRegistry();
    reg.add(makeEntity({ id: 'block', tileX: 10, tileY: 10, footprint: { w: 3, h: 3 } }));
  });

  it('isOccupied true inside footprint', () => {
    expect(reg.isOccupied(10, 10)).toBe(true);
    expect(reg.isOccupied(11, 11)).toBe(true);
    expect(reg.isOccupied(12, 12)).toBe(true);
  });

  it('isOccupied false outside footprint', () => {
    expect(reg.isOccupied(13, 10)).toBe(false);
    expect(reg.isOccupied(9, 9)).toBe(false);
  });

  it('canPlace with margin', () => {
    // 1-tile margin: anything within 1 tile of the footprint is blocked
    expect(reg.canPlace(15, 10, 2, 2, 1)).toBe(true);   // far enough
    expect(reg.canPlace(12, 10, 2, 2, 1)).toBe(false);  // within margin
  });
});

describe('EntityRegistry — serialization', () => {
  it('round-trips toJSON / fromJSON', () => {
    const orig = new EntityRegistry();
    orig.add(makeEntity({ id: 's1', tileX: 3, tileY: 7, type: 'shrine', poiId: 'pA' }));
    orig.add(makeEntity({ id: 's2', tileX: 5, tileY: 2, category: 'tree' }));

    const json = orig.toJSON();
    const loaded = EntityRegistry.fromJSON(json);

    expect(loaded.size).toBe(2);
    expect(loaded.get('s1')?.tileX).toBe(3);
    expect(loaded.getByPoi('pA')).toHaveLength(1);
    expect(loaded.getByCategory('tree')).toHaveLength(1);
  });
});
