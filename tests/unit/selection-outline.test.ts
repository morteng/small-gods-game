import { describe, it, expect } from 'vitest';
import {
  resolveOutlineRect, drawSelectionOutline, drawHoverOutline, drawOutlineRect, sameRect,
  type OutlineWorld,
} from '@/render/selection-outline';
import { createCamera } from '@/render/camera';
import type { Selection } from '@/dev/inspector/selection';

// Minimal duck-typed world: the resolver only calls registry.get / getByPoi.
function fakeWorld(opts: {
  entities?: Record<string, { x: number; y: number }>;
  byPoi?: Record<string, Array<{ x: number; y: number }>>;
}): OutlineWorld['world'] {
  return {
    registry: {
      get: (id: string) => opts.entities?.[id],
      getByPoi: (id: string) => opts.byPoi?.[id] ?? [],
    },
  } as unknown as OutlineWorld['world'];
}

function world(partial: Partial<OutlineWorld>): OutlineWorld {
  return {
    world: partial.world ?? null,
    decorations: partial.decorations ?? [],
    spirits: partial.spirits ?? new Map(),
    seed: partial.seed ?? null,
  };
}

describe('resolveOutlineRect', () => {
  it('tile selection → that 1×1 tile', () => {
    const r = resolveOutlineRect({ type: 'tile', x: 5, y: 7 }, world({}));
    expect(r).toEqual({ x: 5, y: 7, w: 1, h: 1 });
  });

  it('entity selection → the entity tile (floored)', () => {
    const r = resolveOutlineRect(
      { type: 'entity', id: 'npc1' },
      world({ world: fakeWorld({ entities: { npc1: { x: 3.8, y: 9.2 } } }) }),
    );
    expect(r).toEqual({ x: 3, y: 9, w: 1, h: 1 });
  });

  it('missing entity → null', () => {
    const r = resolveOutlineRect({ type: 'entity', id: 'gone' }, world({ world: fakeWorld({}) }));
    expect(r).toBeNull();
  });

  it('decoration selection → its tile; unresolved (-1) → null', () => {
    const decos = [{ tileX: 2, tileY: 4, assetId: 'tree' } as never];
    expect(resolveOutlineRect({ type: 'decoration', index: 0 }, world({ decorations: decos })))
      .toEqual({ x: 2, y: 4, w: 1, h: 1 });
    expect(resolveOutlineRect({ type: 'decoration', index: -1 }, world({ decorations: decos })))
      .toBeNull();
  });

  it('POI with a region → the full area rect', () => {
    const seed = { pois: [{ id: 'p1', region: { x_min: 10, x_max: 14, y_min: 20, y_max: 22 } }] } as never;
    const r = resolveOutlineRect({ type: 'poi', id: 'p1' }, world({ seed }));
    expect(r).toEqual({ x: 10, y: 20, w: 5, h: 3 });
  });

  it('POI with only a position → 1×1', () => {
    const seed = { pois: [{ id: 'p2', position: { x: 8, y: 8 } }] } as never;
    expect(resolveOutlineRect({ type: 'poi', id: 'p2' }, world({ seed })))
      .toEqual({ x: 8, y: 8, w: 1, h: 1 });
  });

  it('POI with neither region nor position falls back to first co-located entity', () => {
    const seed = { pois: [{ id: 'p3' }] } as never;
    const w = world({ seed, world: fakeWorld({ byPoi: { p3: [{ x: 1, y: 2 }] } }) });
    expect(resolveOutlineRect({ type: 'poi', id: 'p3' }, w)).toEqual({ x: 1, y: 2, w: 1, h: 1 });
  });

  it('world and lore selections have no footprint', () => {
    expect(resolveOutlineRect({ type: 'world' }, world({}))).toBeNull();
    expect(resolveOutlineRect({ type: 'lore' }, world({}))).toBeNull();
  });

  it('null selection → null', () => {
    expect(resolveOutlineRect(null, world({}))).toBeNull();
  });
});

describe('sameRect', () => {
  it('true for identical rects, false otherwise (and false with a null)', () => {
    expect(sameRect({ x: 1, y: 2, w: 3, h: 4 }, { x: 1, y: 2, w: 3, h: 4 })).toBe(true);
    expect(sameRect({ x: 1, y: 2, w: 3, h: 4 }, { x: 1, y: 2, w: 3, h: 5 })).toBe(false);
    expect(sameRect({ x: 1, y: 2, w: 1, h: 1 }, null)).toBe(false);
    expect(sameRect(null, null)).toBe(false);
  });
});

// A stub 2D context that records the calls the outline drawer makes.
function stubCtx() {
  const calls: string[] = [];
  let strokeStyle = '';
  const ctx = {
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    beginPath: () => calls.push('beginPath'),
    moveTo: () => calls.push('moveTo'),
    lineTo: () => calls.push('lineTo'),
    closePath: () => calls.push('closePath'),
    stroke: () => calls.push('stroke'),
    strokeRect: () => calls.push('strokeRect'),
    set strokeStyle(v: string) { strokeStyle = v; },
    get strokeStyle() { return strokeStyle; },
    shadowColor: '', shadowBlur: 0, lineWidth: 0, globalAlpha: 1,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, getStroke: () => strokeStyle };
}

describe('drawSelectionOutline', () => {
  it('draws nothing for a non-spatial selection', () => {
    const { ctx, calls } = stubCtx();
    drawSelectionOutline(ctx, { type: 'world' }, createCamera(), 'topdown', world({}), 0);
    expect(calls).toEqual([]);
  });

  it('topdown: strokes a rect for a tile', () => {
    const { ctx, calls } = stubCtx();
    drawSelectionOutline(ctx, { type: 'tile', x: 1, y: 1 }, createCamera(), 'topdown', world({}), 0);
    expect(calls).toContain('strokeRect');
  });

  it('iso: traces a diamond path for a tile', () => {
    const { ctx, calls } = stubCtx();
    drawSelectionOutline(ctx, { type: 'tile', x: 1, y: 1 }, createCamera(), 'iso', world({}), 0);
    expect(calls).toContain('beginPath');
    expect(calls).toContain('closePath');
    expect(calls).toContain('stroke');
  });

  it('hover outline strokes with a faint white style (no glow)', () => {
    const { ctx, calls, getStroke } = stubCtx();
    drawHoverOutline(ctx, { x: 2, y: 3, w: 1, h: 1 }, createCamera(), 'topdown');
    expect(calls).toContain('strokeRect');
    expect(getStroke()).toBe('#ffffff');
  });

  it('drawOutlineRect respects the requested mode geometry', () => {
    const top = stubCtx();
    drawOutlineRect(top.ctx, { x: 0, y: 0, w: 1, h: 1 }, createCamera(), 'topdown',
      { color: '#fff', alpha: 1, shadowBlur: 0, lineWidth: 1 });
    expect(top.calls).toContain('strokeRect');

    const iso = stubCtx();
    drawOutlineRect(iso.ctx, { x: 0, y: 0, w: 1, h: 1 }, createCamera(), 'iso',
      { color: '#fff', alpha: 1, shadowBlur: 0, lineWidth: 1 });
    expect(iso.calls).toContain('closePath');
  });

  it('uses the area color for a multi-tile POI region, point color for a single tile', () => {
    const seed = { pois: [{ id: 'p1', region: { x_min: 0, x_max: 3, y_min: 0, y_max: 3 } }] } as never;
    const area = stubCtx();
    drawSelectionOutline(area.ctx, { type: 'poi', id: 'p1' }, createCamera(), 'topdown', world({ seed }), 0);
    expect(area.getStroke()).toBe('#ffd24a');

    const point = stubCtx();
    drawSelectionOutline(point.ctx, { type: 'tile', x: 0, y: 0 }, createCamera(), 'topdown', world({}), 0);
    expect(point.getStroke()).toBe('#39d0ff');
  });
});
