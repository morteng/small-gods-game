import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '@/world/world';
import { registerBrush, _resetBrushesForTesting } from '@/world/brushes';
import { defaultEntity } from '@/world/brush-helpers';
import type { GameMap } from '@/core/types';

function emptyMap(): GameMap {
  return {
    tiles: [], width: 16, height: 16, villages: [],
    seed: 1, success: true, worldSeed: null,
    stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
}

describe('World', () => {
  beforeEach(() => { _resetBrushesForTesting(); });

  it('addEntity then query by kind returns it', () => {
    const w = new World(emptyMap());
    w.addEntity({ id: 'e1', kind: 'english-oak', x: 5, y: 5, tags: ['tree'] });
    expect(w.query({ kind: 'english-oak' }).map(e => e.id)).toEqual(['e1']);
  });

  it('query by tag returns matching entities', () => {
    const w = new World(emptyMap());
    w.addEntity({ id: 'e1', kind: 'english-oak', x: 5, y: 5, tags: ['tree', 'forest'] });
    w.addEntity({ id: 'e2', kind: 'well', x: 6, y: 6, tags: ['water-source'] });
    expect(w.query({ tag: 'water-source' }).map(e => e.id)).toEqual(['e2']);
  });

  it('query by region returns only entities inside', () => {
    const w = new World(emptyMap());
    w.addEntity({ id: 'inside', kind: 'english-oak', x: 2, y: 2 });
    w.addEntity({ id: 'outside', kind: 'english-oak', x: 50, y: 50 });
    const r = w.query({ region: { x: 0, y: 0, w: 10, h: 10 } });
    expect(r.map(e => e.id)).toEqual(['inside']);
  });

  it('query combines region + kind filters', () => {
    const w = new World(emptyMap());
    w.addEntity({ id: 'a', kind: 'english-oak', x: 2, y: 2 });
    w.addEntity({ id: 'b', kind: 'scots-pine', x: 3, y: 3 });
    w.addEntity({ id: 'c', kind: 'english-oak', x: 80, y: 80 });
    const r = w.query({ region: { x: 0, y: 0, w: 10, h: 10 }, kind: 'english-oak' });
    expect(r.map(e => e.id)).toEqual(['a']);
  });

  it('limit trims the result quietly', () => {
    const w = new World(emptyMap());
    for (let i = 0; i < 10; i++) w.addEntity({ id: `e${i}`, kind: 'english-oak', x: i, y: 0 });
    expect(w.query({ kind: 'english-oak', limit: 3 }).length).toBe(3);
  });

  it('removeEntity drops it from all indexes', () => {
    const w = new World(emptyMap());
    w.addEntity({ id: 'e1', kind: 'english-oak', x: 5, y: 5, tags: ['tree'] });
    w.removeEntity('e1');
    expect(w.query({ kind: 'english-oak' })).toEqual([]);
    expect(w.query({ tag: 'tree' })).toEqual([]);
    expect(w.query({ region: { x: 0, y: 0, w: 10, h: 10 } })).toEqual([]);
  });

  it('setProperty mutates the entity', () => {
    const w = new World(emptyMap());
    w.addEntity({ id: 'e1', kind: 'cottage', x: 5, y: 5, properties: { state: 'intact' } });
    w.setProperty('e1', 'state', 'ruined');
    expect(w.query({ kind: 'cottage' })[0].properties?.state).toBe('ruined');
  });

  it('addEntity with duplicate id throws', () => {
    const w = new World(emptyMap());
    w.addEntity({ id: 'e1', kind: 'english-oak', x: 5, y: 5 });
    expect(() => w.addEntity({ id: 'e1', kind: 'scots-pine', x: 6, y: 6 })).toThrow();
  });

  it('applyBrush calls the brush fn and adds returned entities', () => {
    registerBrush('mock', (region) => [
      defaultEntity('mock', 'english-oak', region.x, region.y),
    ]);
    const m = emptyMap(); m.width = 16; m.height = 16;
    const w = new World(m);
    const ids = w.applyBrush('mock', { x: 3, y: 4, w: 1, h: 1 }, 42);
    expect(ids).toEqual(['mock-english-oak-3-4']);
    expect(w.query({ kind: 'english-oak' }).length).toBe(1);
  });

  it('applyBrush with unknown brush throws', () => {
    const w = new World(emptyMap());
    expect(() => w.applyBrush('no_such_brush', { x: 0, y: 0, w: 1, h: 1 }, 1)).toThrow(/unknown brush/i);
  });

  it('applyBrush drops entities outside the map bounds with a warn', () => {
    registerBrush('outofbounds', () => [
      { id: 'a', kind: 'english-oak', x: -1, y: 0 },
      { id: 'b', kind: 'english-oak', x: 5, y: 5 },
      { id: 'c', kind: 'english-oak', x: 100, y: 100 },
    ]);
    const map = emptyMap(); map.width = 16; map.height = 16;
    const w = new World(map);
    const ids = w.applyBrush('outofbounds', { x: 0, y: 0, w: 16, h: 16 }, 1);
    expect(ids).toEqual(['b']);
  });

  it('flushBrushDiagnostics emits one aggregated warn for drops across brushes', () => {
    registerBrush('oob', () => [
      { id: 'oob-a', kind: 'english-oak', x: -1, y: 0 },
      { id: 'oob-b', kind: 'english-oak', x: 5, y: 5 },
    ]);
    registerBrush('dupe', () => [
      { id: 'oob-b', kind: 'english-oak', x: 6, y: 6 }, // duplicate
      { id: 'dupe-a', kind: 'english-oak', x: 7, y: 7 },
    ]);
    const map = emptyMap(); map.width = 16; map.height = 16;
    const w = new World(map);
    w.applyBrush('oob',  { x: 0, y: 0, w: 16, h: 16 }, 1);
    w.applyBrush('dupe', { x: 0, y: 0, w: 16, h: 16 }, 1);

    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (msg: string) => { warns.push(msg); };
    try { w.flushBrushDiagnostics(); } finally { console.warn = orig; }

    expect(warns.length).toBe(1);
    expect(warns[0]).toMatch(/^\[brush\] dropped 1 duplicate ids, 1 out-of-bounds/);
    expect(warns[0]).toContain('oob');
    expect(warns[0]).toContain('dupe');
  });

  it('flushBrushDiagnostics is silent and idempotent when nothing was dropped', () => {
    registerBrush('clean', () => [{ id: 'ok', kind: 'english-oak', x: 1, y: 1 }]);
    const map = emptyMap(); map.width = 16; map.height = 16;
    const w = new World(map);
    w.applyBrush('clean', { x: 0, y: 0, w: 16, h: 16 }, 1);

    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (msg: string) => { warns.push(msg); };
    try {
      w.flushBrushDiagnostics();
      w.flushBrushDiagnostics();
    } finally { console.warn = orig; }
    expect(warns.length).toBe(0);
  });

  it('flushBrushDiagnostics resets counters so a second flush is silent', () => {
    registerBrush('oob2', () => [{ id: 'x', kind: 'english-oak', x: -1, y: 0 }]);
    const map = emptyMap(); map.width = 16; map.height = 16;
    const w = new World(map);
    w.applyBrush('oob2', { x: 0, y: 0, w: 16, h: 16 }, 1);

    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (msg: string) => { warns.push(msg); };
    try {
      w.flushBrushDiagnostics();
      w.flushBrushDiagnostics();
    } finally { console.warn = orig; }
    expect(warns.length).toBe(1);
  });
});
