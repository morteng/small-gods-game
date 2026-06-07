import { describe, it, expect } from 'vitest';
import {
  resolveOutlineRect, drawSelectionOutline, drawHoverOutline, drawOutlineRect, sameRect,
  fillTileRect, buildingFootprintRect, buildingFootprintAt,
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

// ─── Building footprint highlighting ──────────────────────────────────────

/**
 * Duck-typed world for building tests: entities carry a descriptor footprint,
 * `registry.get` looks up by id, and `query({region})` returns entities whose
 * ORIGIN falls in the region (mirroring the real spatial index, which indexes a
 * building at its origin tile).
 */
function buildingWorld(
  buildings: Array<{ id: string; x: number; y: number; w: number; h: number }>,
): OutlineWorld['world'] {
  const ents = buildings.map((b) => ({
    id: b.id, x: b.x, y: b.y,
    properties: { descriptor: { footprint: { w: b.w, h: b.h } } },
  }));
  return {
    registry: { get: (id: string) => ents.find((e) => e.id === id), getByPoi: () => [] },
    query: ({ region }: { region: { x: number; y: number; w: number; h: number } }) =>
      ents.filter((e) =>
        e.x >= region.x && e.x < region.x + region.w &&
        e.y >= region.y && e.y < region.y + region.h),
  } as unknown as OutlineWorld['world'];
}

function fillCtx() {
  const calls: string[] = [];
  const ctx = {
    save: () => calls.push('save'), restore: () => calls.push('restore'),
    beginPath: () => calls.push('beginPath'), moveTo() {}, lineTo() {},
    closePath: () => calls.push('closePath'),
    fill: () => calls.push('fill'), fillRect: () => calls.push('fillRect'),
    fillStyle: '', globalAlpha: 1,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe('buildingFootprintRect', () => {
  it('returns the full footprint of a building entity', () => {
    const w = buildingWorld([{ id: 'b1', x: 4, y: 4, w: 3, h: 2 }]);
    expect(buildingFootprintRect(w, 'b1')).toEqual({ x: 4, y: 4, w: 3, h: 2 });
  });

  it('returns null for a non-building (no descriptor)', () => {
    const w = fakeWorld({ entities: { npc1: { x: 1, y: 1 } } });
    expect(buildingFootprintRect(w, 'npc1')).toBeNull();
  });
});

describe('resolveOutlineRect — buildings', () => {
  it('an entity selection on a building resolves to its whole footprint', () => {
    const w = world({ world: buildingWorld([{ id: 'b1', x: 2, y: 5, w: 3, h: 3 }]) });
    expect(resolveOutlineRect({ type: 'entity', id: 'b1' }, w)).toEqual({ x: 2, y: 5, w: 3, h: 3 });
  });
});

describe('buildingFootprintAt', () => {
  const w = buildingWorld([{ id: 'b1', x: 4, y: 4, w: 3, h: 2 }]); // covers x4..6, y4..5

  it('resolves the building from its ORIGIN tile', () => {
    expect(buildingFootprintAt(w, 4, 4)).toEqual({ x: 4, y: 4, w: 3, h: 2 });
  });

  it('resolves the building from a NON-origin footprint tile', () => {
    expect(buildingFootprintAt(w, 6, 5)).toEqual({ x: 4, y: 4, w: 3, h: 2 });
  });

  it('returns null just outside the footprint', () => {
    expect(buildingFootprintAt(w, 7, 5)).toBeNull(); // x=7 is past x4..6
    expect(buildingFootprintAt(w, 5, 6)).toBeNull(); // y=6 is past y4..5
  });
});

describe('fillTileRect', () => {
  it('fills one diamond per tile in iso (w*h fills)', () => {
    const { ctx, calls } = fillCtx();
    fillTileRect(ctx, { x: 0, y: 0, w: 3, h: 2 }, createCamera(), 'iso');
    expect(calls.filter((c) => c === 'fill')).toHaveLength(6);
  });

  it('fills one rect per tile in topdown (w*h fillRects)', () => {
    const { ctx, calls } = fillCtx();
    fillTileRect(ctx, { x: 0, y: 0, w: 3, h: 2 }, createCamera(), 'topdown');
    expect(calls.filter((c) => c === 'fillRect')).toHaveLength(6);
  });
});
