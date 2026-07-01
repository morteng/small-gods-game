import { describe, it, expect } from 'vitest';
import {
  emptyEdits, hasEdits, countEdits, applyPoiEdits, cleanConnections,
  makeAddedPoi, connectNearest, applyEditsToSeed,
} from '@/studio/world-node-edits';
import type { POI, Connection, WorldSeed } from '@/core/types';

const poi = (id: string, x: number, y: number, extra: Partial<POI> = {}): POI =>
  ({ id, type: 'village', position: { x, y }, ...extra });

describe('PoiEdits overlay', () => {
  it('empty overlay is a no-op and reports no edits', () => {
    const pois = [poi('a', 10, 10), poi('b', 20, 20)];
    const e = emptyEdits();
    expect(hasEdits(e)).toBe(false);
    expect(countEdits(e)).toBe(0);
    expect(applyPoiEdits(pois, e)).toEqual(pois);
  });

  it('moves a node to a new position (rounded, integer tiles)', () => {
    const e = emptyEdits();
    e.moved.set('a', { x: 30.4, y: 41.6 });
    const out = applyPoiEdits([poi('a', 10, 10), poi('b', 20, 20)], e);
    expect(out.find((p) => p.id === 'a')!.position).toEqual({ x: 30, y: 42 });
    expect(out.find((p) => p.id === 'b')!.position).toEqual({ x: 20, y: 20 });
    expect(hasEdits(e)).toBe(true);
  });

  it('retunes params (only defined fields win, others preserved)', () => {
    const e = emptyEdits();
    e.params.set('a', { size: 'huge', era: 'ancient' });
    const out = applyPoiEdits([poi('a', 10, 10, { size: 'small', importance: 'high' })], e);
    const a = out[0];
    expect(a.size).toBe('huge');
    expect(a.era).toBe('ancient');
    expect(a.importance).toBe('high');   // untouched field preserved
    expect(a.position).toEqual({ x: 10, y: 10 });
  });

  it('removes a node and appends added nodes', () => {
    const e = emptyEdits();
    e.removed.add('b');
    e.added.push(makeAddedPoi('c', 'castle', 55, 66, 'large'));
    const out = applyPoiEdits([poi('a', 10, 10), poi('b', 20, 20)], e);
    expect(out.map((p) => p.id)).toEqual(['a', 'c']);
    const c = out.find((p) => p.id === 'c')!;
    expect(c.position).toEqual({ x: 55, y: 66 });
    expect(c.size).toBe('large');
    expect(countEdits(e)).toBe(2);
  });

  it('does not double-count a removed-then-re-added id', () => {
    const e = emptyEdits();
    e.removed.add('c');
    e.added.push(makeAddedPoi('c', 'village', 5, 5));
    const out = applyPoiEdits([poi('a', 1, 1)], e);
    expect(out.map((p) => p.id)).toEqual(['a']);   // removed wins over added for the same id
  });
});

describe('connection cleanup + linking', () => {
  const conns: Connection[] = [
    { from: 'a', to: 'b', type: 'road' },
    { from: 'b', to: 'c', type: 'road' },
    { from: 'a', to: 'c', type: 'road' },
  ];
  it('drops connections referencing a removed POI', () => {
    const out = cleanConnections(conns, new Set(['b']));
    expect(out).toEqual([{ from: 'a', to: 'c', type: 'road' }]);
  });
  it('connects an added POI to its nearest existing neighbour', () => {
    const added = makeAddedPoi('new', 'village', 12, 12);
    const c = connectNearest(added, [poi('a', 10, 10), poi('far', 200, 200)]);
    expect(c).toBeTruthy();
    expect(c!.from).toBe('new');
    expect(c!.to).toBe('a');              // (10,10) is nearer than (200,200)
    expect(c!.type).toBe('road');
  });
  it('returns null when there is no neighbour to link to', () => {
    expect(connectNearest(makeAddedPoi('lonely', 'village', 0, 0), [])).toBeNull();
  });
});

describe('applyEditsToSeed', () => {
  const base: WorldSeed = {
    name: 'test', island: true, size: { width: 100, height: 100 },
    pois: [poi('a', 10, 10), poi('b', 20, 20), poi('c', 80, 80)],
    connections: [{ from: 'a', to: 'b', type: 'road' }, { from: 'b', to: 'c', type: 'road' }],
  } as unknown as WorldSeed;

  it('folds move + remove + add into a regenerable seed with linked roads', () => {
    const e = emptyEdits();
    e.moved.set('a', { x: 15, y: 15 });
    e.removed.add('c');
    e.added.push(makeAddedPoi('d', 'castle', 22, 22));
    const seed = applyEditsToSeed(base, e);
    expect(seed.pois!.map((p) => p.id)).toEqual(['a', 'b', 'd']);   // c removed, d added
    expect(seed.pois!.find((p) => p.id === 'a')!.position).toEqual({ x: 15, y: 15 });
    // b→c connection dropped (c removed); a→b survives; d linked to nearest (b at 20,20)
    const froms = seed.connections!.map((c) => `${c.from}->${c.to}`);
    expect(froms).toContain('a->b');
    expect(froms).not.toContain('b->c');
    expect(froms).toContain('d->b');
    // base is not mutated
    expect(base.pois!.length).toBe(3);
  });
});
