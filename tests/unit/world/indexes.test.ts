import { describe, it, expect, beforeEach } from 'vitest';
import { SpatialIndex, KindIndex, TagIndex } from '@/world/indexes';

describe('SpatialIndex', () => {
  let idx: SpatialIndex;
  beforeEach(() => { idx = new SpatialIndex(4); });

  it('returns nothing for an empty index', () => {
    expect(idx.queryRect({ x: 0, y: 0, w: 10, h: 10 })).toEqual([]);
  });

  it('finds an entity inside the query rect', () => {
    idx.add('a', 5, 5);
    expect(idx.queryRect({ x: 0, y: 0, w: 10, h: 10 })).toEqual(['a']);
  });

  it('excludes entities outside the rect', () => {
    idx.add('a', 5, 5);
    idx.add('b', 50, 50);
    expect(idx.queryRect({ x: 0, y: 0, w: 10, h: 10 })).toEqual(['a']);
  });

  it('handles entities on grid-cell boundaries (x = cellSize)', () => {
    idx.add('a', 4, 4);   // cell (1,1) lower corner
    idx.add('b', 3, 3);   // cell (0,0) upper corner
    const r = idx.queryRect({ x: 3, y: 3, w: 2, h: 2 }).sort();
    expect(r).toEqual(['a', 'b']);
  });

  it('remove() drops the entity', () => {
    idx.add('a', 5, 5);
    idx.remove('a', 5, 5);
    expect(idx.queryRect({ x: 0, y: 0, w: 10, h: 10 })).toEqual([]);
  });

  it('queryRect with w/h spanning multiple cells returns all', () => {
    for (let i = 0; i < 10; i++) idx.add(`e${i}`, i, i);
    const r = idx.queryRect({ x: 0, y: 0, w: 10, h: 10 });
    expect(r.length).toBe(10);
  });

  it('sub-tile coords stay in their containing cell', () => {
    idx.add('a', 3.9, 3.9);
    idx.add('b', 4.0, 4.0);
    expect(idx.queryRect({ x: 3, y: 3, w: 1, h: 1 })).toEqual(['a']);
  });
});

describe('KindIndex', () => {
  it('byKind returns ids inserted under that kind', () => {
    const idx = new KindIndex();
    idx.add('a', 'oak_tree');
    idx.add('b', 'oak_tree');
    idx.add('c', 'pine_tree');
    expect(new Set(idx.byKind('oak_tree'))).toEqual(new Set(['a', 'b']));
    expect(idx.byKind('pine_tree')).toEqual(['c']);
    expect(idx.byKind('not_real')).toEqual([]);
  });

  it('remove() drops the id', () => {
    const idx = new KindIndex();
    idx.add('a', 'oak_tree');
    idx.remove('a', 'oak_tree');
    expect(idx.byKind('oak_tree')).toEqual([]);
  });
});

describe('TagIndex', () => {
  it('byTag returns ids that have that tag', () => {
    const idx = new TagIndex();
    idx.add('a', ['vegetation', 'tree']);
    idx.add('b', ['vegetation', 'small']);
    idx.add('c', ['water-source']);
    expect(new Set(idx.byTag('vegetation'))).toEqual(new Set(['a', 'b']));
    expect(idx.byTag('water-source')).toEqual(['c']);
    expect(idx.byTag('nonexistent')).toEqual([]);
  });

  it('handles empty/undefined tags gracefully', () => {
    const idx = new TagIndex();
    idx.add('a', undefined);
    idx.add('b', []);
    expect(idx.byTag('any')).toEqual([]);
  });

  it('remove() drops the id from every tag', () => {
    const idx = new TagIndex();
    idx.add('a', ['x', 'y']);
    idx.remove('a', ['x', 'y']);
    expect(idx.byTag('x')).toEqual([]);
    expect(idx.byTag('y')).toEqual([]);
  });
});
