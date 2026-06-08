import { describe, it, expect, vi } from 'vitest';
import { renderMap, createIsoRenderMap } from '@/render/iso/iso-renderer';
import type { RenderContext, GameMap, NpcInstance } from '@/core/types';
import { createIsoCamera } from '@/render/iso/iso-camera';
import { blueprintEntity } from '@/blueprint/entity';
import { synthesizeBlueprint } from '@/blueprint/presets';

function makeMap(w: number, h: number, fill = 'grass'): GameMap {
  const tiles = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) {
      row.push({ type: fill, x, y, walkable: true, state: 'realized' });
    }
    tiles.push(row);
  }
  return { width: w, height: h, tiles, pois: [], buildings: [] } as unknown as GameMap;
}

function makeMockCtx() {
  return {
    save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn(),
    fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    closePath: vi.fn(), fill: vi.fn(), drawImage: vi.fn(),
    ellipse: vi.fn(), arc: vi.fn(),
    fillStyle: '', strokeStyle: '',
  } as unknown as CanvasRenderingContext2D;
}

function makeRc(w = 8, h = 6): RenderContext {
  return {
    map: makeMap(w, h),
    camera: createIsoCamera(),
    canvasWidth: 800,
    canvasHeight: 600,
    npcs: [
      { id: 'n1', name: 'Alice', role: 'farmer', seed: 1, tileX: 2, tileY: 2,
        direction: 'down', frame: 0, frameTimer: 0 } as NpcInstance,
    ],
    npcSheets: new Map(),
    visualMap: null,
    blobMap: null,
    tileAtlas: null,
    terrainSheets: new Map(),
    buildingSprites: new Map(),
    treeSheets: new Map(),
    world: { entities: new Map(), query: () => [] } as any,
  };
}

describe('iso-renderer: integration', () => {
  it('renders without throwing on a populated RenderContext', () => {
    const ctx = makeMockCtx();
    const rc = makeRc();
    expect(() => renderMap(ctx, rc)).not.toThrow();
    expect((ctx.fill as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });
});

describe('iso-renderer: vegetation', () => {
  it('draws vegetation entities returned by world.query', () => {
    const veg = [
      { id: 'oak1', kind: 'oak_tree', x: 2, y: 2 },
      { id: 'fern1', kind: 'fern', x: 3, y: 3 },
    ];
    const rc = makeRc();
    rc.world = { entities: new Map(), query: () => veg } as any;
    const ctx = makeMockCtx();
    renderMap(ctx, rc);
    // each vegetation entity draws a canopy fill (shadows removed)
    expect((ctx.fill as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('billboards the real tree sprite when its sheet is loaded (not the placeholder)', () => {
    const rc = makeRc();
    rc.npcs = []; // isolate: NPCs also draw billboards
    rc.world = { entities: new Map(), query: () => [{ id: 'oak1', kind: 'oak_tree', x: 2, y: 2 }] } as any;
    rc.treeSheets = new Map([['green', {} as HTMLImageElement]]);
    const ctx = makeMockCtx();
    renderMap(ctx, rc);
    // the loaded sheet is drawn via drawImage; placeholder path would not call it
    expect((ctx.drawImage as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  it('ignores non-vegetation entities from world.query', () => {
    const rc = makeRc();
    rc.world = { entities: new Map(), query: () => [{ id: 'c1', kind: 'cottage', x: 1, y: 1 }] } as any;
    const ctx = makeMockCtx();
    expect(() => renderMap(ctx, rc)).not.toThrow();
  });

  it('does not draw vegetation when devMode.showVegetation === false', () => {
    const veg = [
      { id: 'oak1', kind: 'oak_tree', x: 2, y: 2 },
      { id: 'fern1', kind: 'fern', x: 3, y: 3 },
    ];
    const rc = makeRc();
    rc.npcs = []; // isolate: NPCs also draw shadow ellipses
    rc.world = { entities: new Map(), query: () => veg } as any;
    rc.devMode = { showVegetation: false } as any;
    const ctx = makeMockCtx();
    renderMap(ctx, rc);
    // No buildings/NPCs and vegetation hidden ⇒ nothing draws a canopy/shadow ellipse.
    expect((ctx.ellipse as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('skips the world query entirely when both buildings and vegetation are hidden', () => {
    const queried: object[] = [];
    const rc = makeRc();
    rc.world = { entities: new Map(), query: () => { queried.push({}); return []; } } as any;
    rc.devMode = { showVegetation: false, showBuildings: false } as any;
    const ctx = makeMockCtx();
    renderMap(ctx, rc);
    expect(queried.length).toBe(0);
  });
});

describe('iso-renderer: buildings from descriptor entities', () => {
  it('draws building entities returned by world.query (not map.buildings)', () => {
    const rc = makeRc();
    const cottage = blueprintEntity('b1', synthesizeBlueprint('cottage')!, 2, 2);
    rc.world = { entities: new Map(), query: () => [cottage] } as any;
    const ctx = makeMockCtx();
    expect(() => renderMap(ctx, rc)).not.toThrow();
    // building body fills (walls + roof) land on top of terrain fills
    expect((ctx.fill as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  it('draws a round building (yurt) without throwing', () => {
    // Round geometry now flows through the parametric pipeline (cylinder + cone/
    // ellipsoid parts — see building-spec.test.ts), not Canvas2D ellipses. With no
    // resolvers wired in this mock, the yurt falls back to the flat block; the
    // renderer must still draw it cleanly.
    const rc = makeRc();
    const yurt = blueprintEntity('y1', synthesizeBlueprint('yurt')!, 3, 3);
    rc.world = { entities: new Map(), query: () => [yurt] } as any;
    const ctx = makeMockCtx();
    expect(() => renderMap(ctx, rc)).not.toThrow();
    expect((ctx.fill as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  it('skips buildings when the buildings layer is hidden', () => {
    const rc = makeRc();
    const cottage = blueprintEntity('b1', synthesizeBlueprint('cottage')!, 2, 2);
    rc.world = { entities: new Map(), query: () => [cottage] } as any;
    rc.devMode = { showBuildings: false } as any;
    const ctx = makeMockCtx();
    expect(() => renderMap(ctx, rc)).not.toThrow();
  });
});

describe('iso-renderer: factory', () => {
  it('back-compat renderMap export runs without throwing', () => {
    const ctx = makeMockCtx();
    expect(() => renderMap(ctx, makeRc())).not.toThrow();
  });

  it('createIsoRenderMap() returns a callable renderMap that does not throw', () => {
    const fn = createIsoRenderMap();
    const ctx = makeMockCtx();
    expect(() => fn(ctx, makeRc())).not.toThrow();
    expect((ctx.fill as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });
});
