import { describe, it, expect } from 'vitest';
import { idFor, EMPTY_CONTEXT, isInRegion, defaultEntity } from '@/world/brush-helpers';

describe('brush-helpers', () => {
  it('idFor is deterministic and includes brush + kind + coords', () => {
    expect(idFor('forest', 'oak_tree', 5, 7)).toBe('forest-oak_tree-5-7');
  });

  it('isInRegion treats region as half-open', () => {
    const r = { x: 0, y: 0, w: 4, h: 4 };
    expect(isInRegion(0, 0, r)).toBe(true);
    expect(isInRegion(3, 3, r)).toBe(true);
    expect(isInRegion(4, 4, r)).toBe(false);
    expect(isInRegion(-1, 0, r)).toBe(false);
  });

  it('EMPTY_CONTEXT returns no entities and no tiles', () => {
    expect(EMPTY_CONTEXT.world.query({})).toEqual([]);
    expect(EMPTY_CONTEXT.world.tileAt(0, 0)).toBeUndefined();
  });

  it('defaultEntity populates tags from the kind catalog', () => {
    const e = defaultEntity('forest', 'english-oak', 5, 7, { variant: 'green' });
    expect(e.id).toBe('forest-english-oak-5-7');
    expect(e.kind).toBe('english-oak');
    expect(e.x).toBe(5);
    expect(e.y).toBe(7);
    expect(e.properties?.variant).toBe('green');
    expect(e.tags).toContain('vegetation');
    expect(e.tags).toContain('tree');
  });

  it('defaultEntity floors coordinates for id but preserves sub-tile x/y', () => {
    const e = defaultEntity('forest', 'english-oak', 5.7, 7.3);
    expect(e.id).toBe('forest-english-oak-5-7');
    expect(e.x).toBe(5.7);
    expect(e.y).toBe(7.3);
  });

  it('defaultEntity appends extra tags after default tags', () => {
    const e = defaultEntity('temple', 'english-oak', 0, 0, {}, ['sacred']);
    expect(e.tags).toContain('vegetation');
    expect(e.tags).toContain('sacred');
  });
});
