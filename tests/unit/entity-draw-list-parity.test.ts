import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { buildEntityDrawList } from '@/render/iso/entity-draw-list';
import type { DrawItem } from '@/render/iso/draw-list';
import type { IsoAtlas } from '@/render/iso/iso-atlas';
import type { IsoItemCtx } from '@/render/iso/iso-sprites';
import type { TileBounds } from '@/render/iso/iso-projection';
import type { GameMap, RenderContext, Entity, NpcInstance } from '@/core/types';

// R0b safety net: buildEntityDrawList now sources its entity stream from the
// RenderGraph seam (WorldRenderGraph) instead of querying rc.world directly. The
// emitted DrawItem[] must stay BYTE-IDENTICAL — same items, same order, same
// placement — because the graph mirrors the old partition exactly. This frozen
// structural snapshot is the oracle: it was captured from the pre-rewire code and
// must survive the rewire unchanged.

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

// All art resolvers absent → buildings fall to flat blocks, NPCs to circles,
// vegetation to procedural canopy: deterministic, headless, no sheets needed.
const ic: IsoItemCtx = {
  atlas: { getCharacter: () => null } as unknown as IsoAtlas,
  originX: 0, originY: 0,
};
const bounds: TileBounds = { minTx: 0, minTy: 0, maxTx: 31, maxTy: 31 };

function buildingStub(id: string, x: number, y: number, w: number, h: number): Entity {
  return { id, kind: 'cottage', x, y,
    properties: { blueprint: { rb: { parts: [], footprint: { w, h } } } } } as unknown as Entity;
}

function rcOf(world: World, npcs: NpcInstance[], deco: Array<{ tileX: number; tileY: number; assetId: string }>): RenderContext {
  return { map: world.tiles, world, npcs, generatedDecorations: deco, visualMap: null } as unknown as RenderContext;
}

/** Structural projection of a draw list — placement + shape, ignoring canvas refs. */
function normalize(items: DrawItem[]): unknown[] {
  return items.map((i) =>
    i.t === 'image' ? { t: 'image', dx: i.dx, dy: i.dy, dw: i.dw, dh: i.dh, frame: !!i.frame }
    : i.t === 'poly' ? { t: 'poly', n: i.points.length, color: i.color }
    : { t: 'circle', cx: i.cx, cy: i.cy, r: i.r, color: i.color });
}

describe('R0b — buildEntityDrawList parity through the RenderGraph', () => {
  it('emits a stable, y-sorted draw list for a fixed world', () => {
    const world = new World(emptyMap());
    world.addEntity(buildingStub('b1', 5, 5, 2, 2));
    world.addEntity({ id: 'w1', kind: 'wall_run', x: 6, y: 5 }); // bare run → no slabs, but sorts
    world.addEntity({ id: 't1', kind: 'oak_tree', x: 7, y: 7 });
    world.addEntity({ id: 'r1', kind: 'rock_unknown_xyz', x: 8, y: 8 }); // not drawn
    const npcs = [{ id: 'n1', role: 'villager', tileX: 3, tileY: 3 }] as unknown as NpcInstance[];

    const items = buildEntityDrawList(rcOf(world, npcs, []), bounds, ic);
    expect(normalize(items)).toMatchInlineSnapshot(`
      [
        {
          "color": "#d4a574",
          "cx": 0,
          "cy": 176,
          "r": 12,
          "t": "circle",
        },
        {
          "color": "#404048",
          "n": 4,
          "t": "poly",
        },
        {
          "color": "#53535e",
          "n": 4,
          "t": "poly",
        },
        {
          "color": "#6b6b78",
          "n": 4,
          "t": "poly",
        },
        {
          "color": "#5a4030",
          "n": 4,
          "t": "poly",
        },
        {
          "color": "#3a6e3a",
          "cx": 0,
          "cy": 184,
          "r": 168,
          "t": "circle",
        },
      ]
    `);
  });
});
