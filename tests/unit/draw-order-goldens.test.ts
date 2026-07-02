import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { buildEntityDrawList } from '@/render/iso/entity-draw-list';
import { buildYSortBucket, type YSortEntry } from '@/render/iso/iso-ysort';
import { chunkBarrierRun } from '@/render/parametric-barrier-source';
import { BARRIER_DEFAULTS, type BarrierRun } from '@/world/barrier';
import type { IsoItemCtx } from '@/render/iso/iso-sprites';
import type { TileBounds } from '@/render/iso/iso-projection';
import type { GameMap, RenderContext, Entity, NpcInstance } from '@/core/types';
import type { BarrierPiece, SpritePack } from '@/render/iso/sprite-canvas';

// WP-E — draw-order goldens. Deterministic, GPU-free pins over `buildEntityDrawList`
// (src/render/iso/entity-draw-list.ts) for the draw-order fixes shipped on
// `fix/terrain-features`: the barrier/building KIND_PRIORITY split, unfloored barrier
// sort keys (sortTx/sortTy), and the per-chunk CHUNK_DEPTH_SPAN_MAX cap
// (src/render/parametric-barrier-source.ts). Read those two files + iso-ysort.ts
// before touching this file — the sort contract is: ascending (sortTx??tx)+(sortTy??ty),
// tie→z, tie→kindPriority, tie→input order (JS stable sort).
//
// These tests build tiny synthetic worlds and read the STRUCTURE of the emitted
// DrawItem[] (item.t sequence + a few identifying fields) rather than canvas pixels —
// "pure list inspection", no WebGPU/canvas needed. No art resolvers are stubbed except
// where a scene specifically needs an 'image' item (barrier pieces / building packs);
// everywhere else entities fall through to their headless procedural fallback shapes
// (flat building = 3 polys, npc = 1 circle, tree = trunk poly + canopy circle), which is
// exactly what `entity-draw-list-parity.test.ts` already relies on.

function emptyMap(): GameMap {
  return {
    tiles: [], width: 200, height: 200, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as unknown as GameMap;
}

const ic: IsoItemCtx = {
  atlas: { getCharacter: () => null } as unknown as IsoItemCtx['atlas'],
  originX: 0, originY: 0,
};
// Generous region so every entity placed below (all within [0,100)) is query-visible —
// `buildEntityDrawList` region-culls buildings/vegetation/barriers/npcs off `bounds`.
const bounds: TileBounds = { minTx: -5, minTy: -5, maxTx: 150, maxTy: 150 };

function buildingStub(
  id: string, x: number, y: number, w: number, h: number, extraProps: Record<string, unknown> = {},
): Entity {
  return {
    id, kind: 'cottage', x, y,
    properties: { blueprint: { rb: { parts: [], footprint: { w, h } } }, ...extraProps },
  } as unknown as Entity;
}

function canvasStub(w: number, h = w): HTMLCanvasElement {
  return { width: w, height: h } as unknown as HTMLCanvasElement;
}

function packStub(w: number): SpritePack {
  return { albedo: canvasStub(w) };
}

/** A composed barrier piece with a caller-chosen (possibly fractional) y-sort key,
 *  identified in the output by its albedo's `width` (see barrierPieceItem: dw = pack.albedo.width). */
function pieceStub(sortX: number, sortY: number, idWidth: number, refX = sortX, refY = sortY): BarrierPiece {
  return { pack: packStub(idWidth), refX, refY, anchorNX: 0, anchorNY: 0, sortX, sortY };
}

function rcOf(world: World, opts: {
  npcs?: NpcInstance[];
  deco?: Array<{ tileX: number; tileY: number; assetId: string }>;
  barrierArt?: Map<string, BarrierPiece[]>;
  buildingArt?: Map<string, SpritePack>;
  decoImages?: Map<string, HTMLImageElement>;
} = {}): RenderContext {
  return {
    map: world.tiles, world,
    npcs: opts.npcs ?? [],
    generatedDecorations: opts.deco ?? [],
    visualMap: null,
    resolveParametricBarrierArt: opts.barrierArt ? (e: Entity) => opts.barrierArt!.get(e.id) ?? null : undefined,
    resolveParametricBuildingArt: opts.buildingArt ? (e: Entity) => opts.buildingArt!.get(e.id) ?? null : undefined,
    resolveDecorationImage: opts.decoImages ? (id: string) => opts.decoImages!.get(id) ?? null : undefined,
  } as unknown as RenderContext;
}

const imgDw = (i: { t: string; dw?: number }): number => (i.t === 'image' ? (i.dw as number) : -1);
const types = (items: ReturnType<typeof buildEntityDrawList>): string[] => items.map((i) => i.t);

describe('Scene 1 — wall behind a building on the same tile row (barrier/building tie-break)', () => {
  // KIND_PRIORITY deliberately splits building (4) from barrier (5): "rings stand
  // outside every building's visual extent... the wall is the nearer object and must
  // draw after it" (entity-draw-list.ts). Before the split they shared priority 4 and
  // an exact depth tie resolved in arbitrary insertion order — one cause of buildings
  // poking through walls.
  it('at an EXACT depth tie, the building draws before the barrier chunk in front of it', () => {
    const world = new World(emptyMap());
    world.addEntity(buildingStub('b1', 5, 5, 1, 1)); // sortTx=5, sortTy=5 -> depth key 10
    world.addEntity({ id: 'w1', kind: 'wall_run', x: 5, y: 5 });
    const barrierArt = new Map<string, BarrierPiece[]>([
      ['w1', [pieceStub(5, 5, 7)]], // depth key 10 — an exact tie with the building
    ]);

    const items = buildEntityDrawList(rcOf(world, { barrierArt }), bounds, ic);

    expect(types(items)).toEqual(['poly', 'poly', 'poly', 'image']); // building's 3 flat-block faces, then the wall
    expect(imgDw(items[3])).toBe(7);
  });

  it('regression: an UNFLOORED barrier depth that narrowly beats a building draws the barrier ON TOP, even though the FLOORED value would have placed it behind', () => {
    const world = new World(emptyMap());
    world.addEntity(buildingStub('b1', 5, 5, 1, 1)); // depth key 10 (integer)
    world.addEntity({ id: 'w1', kind: 'wall_run', x: 5, y: 5 });
    // floor(5.7) + floor(4.6) = 5 + 4 = 9   -> a floored key would have sorted this BEFORE
    //                                          the building (the historical bug: barrier
    //                                          entries carried only Math.floor(tx)/(ty)).
    // 5.7 + 4.6 = 10.3                       -> the real (unfloored) key correctly sorts
    //                                          this AFTER the building.
    const barrierArt = new Map<string, BarrierPiece[]>([
      ['w1', [pieceStub(5.7, 4.6, 11)]],
    ]);

    const items = buildEntityDrawList(rcOf(world, { barrierArt }), bounds, ic);

    expect(types(items)).toEqual(['poly', 'poly', 'poly', 'image']);
    expect(imgDw(items[3])).toBe(11);
  });

  it('sanity check: a barrier strictly BEHIND a building (smaller depth key) still draws first', () => {
    const world = new World(emptyMap());
    world.addEntity(buildingStub('b1', 5, 5, 1, 1)); // depth key 10
    world.addEntity({ id: 'w1', kind: 'wall_run', x: 0, y: 0 });
    const barrierArt = new Map<string, BarrierPiece[]>([
      ['w1', [pieceStub(1, 1, 3)]], // depth key 2 — well behind the building
    ]);

    const items = buildEntityDrawList(rcOf(world, { barrierArt }), bounds, ic);

    expect(types(items)).toEqual(['image', 'poly', 'poly', 'poly']);
    expect(imgDw(items[0])).toBe(3);
  });
});

describe('Scene 2 — a diagonal wall descending a slope (chunk depth-span cap + monotonic order)', () => {
  it("chunks a 45° run so every chunk's own depth span stays within the cap, in strictly increasing depth order", () => {
    // dir = (1/√2, 1/√2) -> depthRate = |dx+dy| = √2, the WORST case for the cap: this
    // bearing puts the most (x+y) depth per tile of any straight run.
    const run: BarrierRun = { kind: 'wall', path: [[0, 0], [10, 10]], ...BARRIER_DEFAULTS.wall, gates: [] };
    const chunks = chunkBarrierRun(run);
    expect(chunks.length).toBeGreaterThan(1); // the depth cap must actually bite on this bearing

    // Each chunk's OWN depth span = |Δ(x+y)| along its localised run — exactly what the
    // (module-private) CHUNK_DEPTH_SPAN_MAX = 2 bounds, so no single chunk's midpoint sort
    // key can be ambiguous against a building footprint wider than the cap.
    for (const c of chunks) {
      const [ldx, ldy] = c.localRun.path[1];
      expect(Math.abs(ldx + ldy)).toBeLessThanOrEqual(2 + 1e-6);
    }
    // Consecutive chunk midpoints strictly increase in depth (the chunker walks the path
    // forward; a ring's draw order must never backtrack along a single straight run).
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].sortX + chunks[i].sortY).toBeGreaterThan(chunks[i - 1].sortX + chunks[i - 1].sortY);
    }

    // Now drive it end-to-end through the entity draw list: each chunk becomes one
    // identifiable image item (dw = its index+1), and the emitted order must match the
    // chunk array's order exactly — the draw list must consume sortX/sortY as-is, never
    // re-floor or otherwise re-derive a coarser key that could scramble a fine-grained ring.
    const world = new World(emptyMap());
    world.addEntity({ id: 'w1', kind: 'wall_run', x: 0, y: 0 });
    const barrierArt = new Map<string, BarrierPiece[]>([
      ['w1', chunks.map((c, i) => pieceStub(c.sortX, c.sortY, i + 1, c.refX, c.refY))],
    ]);

    const items = buildEntityDrawList(rcOf(world, { barrierArt }), bounds, ic);

    expect(items.every((i) => i.t === 'image')).toBe(true);
    expect(items.map(imgDw)).toEqual(chunks.map((_, i) => i + 1));
  });

  it('a cross-depth (screen-horizontal) run keeps full-length chunks and still draws in order', () => {
    // dir (√2/2, −√2/2) has |dx+dy| = 0: the whole chunk sits at one iso depth, so the
    // cap never bites and chunks stay at CHUNK_TILES length — but ties on depth must
    // still resolve by input/path order (stable sort), not scramble.
    const run: BarrierRun = { kind: 'wall', path: [[0, 8], [8, 0]], ...BARRIER_DEFAULTS.wall, gates: [] };
    const chunks = chunkBarrierRun(run);
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) expect(c.sortX + c.sortY).toBeCloseTo(8, 6); // one shared depth

    const world = new World(emptyMap());
    world.addEntity({ id: 'w1', kind: 'wall_run', x: 0, y: 8 });
    const barrierArt = new Map<string, BarrierPiece[]>([
      ['w1', chunks.map((c, i) => pieceStub(c.sortX, c.sortY, i + 1, c.refX, c.refY))],
    ]);

    const items = buildEntityDrawList(rcOf(world, { barrierArt }), bounds, ic);
    expect(items.map(imgDw)).toEqual(chunks.map((_, i) => i + 1)); // stable: path order preserved
  });
});

describe('Scene 3 — infra props (bridge deck + approach) sort like ordinary buildings', () => {
  // FINDING (not pinned): the plan's literal scene 3 ("river/road/deck ordering... approach
  // road draws before the deck") does not apply to this function. Reading
  // `WorldRenderGraph.nodes()` (src/render/graph/world-render-graph.ts) shows the entity
  // stream only ever yields 'building' | 'vegetation' | 'barrier' | 'npc' | 'decoration'
  // nodes — rivers are pure terrain (no node, no edge) and roads surface only as
  // `RenderEdge`s via `edges()`/`projectRoadEdges`, never as members of `buildEntityDrawList`'s
  // sorted `entries`. The trailing comment in entity-draw-list.ts confirms this by design
  // ("Roads are not DrawItems at all: a road IS the terrain..."). So there is no river/road
  // vs. deck y-sort to pin here.
  //
  // What IS real and testable: a crossing deck (`crossing-structures.ts` `deckEntity`, class
  // 'prop') and a stair-flight "approach" (`stair-structures.ts`) are both ordinary
  // blueprint-carrying entities — `blueprintOf()` only checks for `properties.blueprint`, so
  // the draw list treats them exactly like any building, with no special-casing. The one
  // deck-specific behaviour is G4 `liftElev`: it must ride only the entity that authored it.
  it('a deck and an approach structure sort by the SAME footprint-based key as any building, and liftElev only rides its own entity', () => {
    const world = new World(emptyMap());
    // deck: footprint 3x1 at (10,10) -> sortTx=10+3-1=12, sortTy=10+1-1=10 -> depth 22
    world.addEntity(buildingStub('deck1', 10, 10, 3, 1, { liftElev: 1.5 }));
    // approach: footprint 1x1 at (13,10) -> sortTx=13, sortTy=10 -> depth 23 (further along the bank)
    world.addEntity(buildingStub('approach1', 13, 10, 1, 1));

    const buildingArt = new Map<string, SpritePack>([
      ['deck1', packStub(10)],
      ['approach1', packStub(20)],
    ]);
    const items = buildEntityDrawList(rcOf(world, { buildingArt }), bounds, ic);

    expect(types(items)).toEqual(['image', 'image']);
    expect(imgDw(items[0])).toBe(10); // deck (depth 22) draws first
    expect(imgDw(items[1])).toBe(20); // approach (depth 23) draws after
    expect((items[0] as { liftElev?: number }).liftElev).toBe(1.5);      // authored on the deck
    expect((items[1] as { liftElev?: number }).liftElev).toBeUndefined(); // approach foot-samples
  });
});

describe('Scene 4 — building cluster with npc + vegetation interleaved (y-sort stability)', () => {
  it('an exact depth tie across EVERY drawable kind resolves by ascending KIND_PRIORITY: deco, vegetation, building, barrier, npc', () => {
    const world = new World(emptyMap());
    world.addEntity(buildingStub('b1', 2, 2, 1, 1));         // depth 4
    world.addEntity({ id: 't1', kind: 'english-oak', x: 2, y: 2 }); // depth 4 (tree: trunk poly + canopy circle)
    world.addEntity({ id: 'w1', kind: 'wall_run', x: 2, y: 2 });    // depth 4 via the stubbed piece below
    const npcs = [{ id: 'n1', role: 'villager', tileX: 2, tileY: 2 }] as unknown as NpcInstance[];
    const decoImg = { naturalWidth: 0, width: 42, naturalHeight: 0, height: 42 } as unknown as HTMLImageElement;

    const items = buildEntityDrawList(rcOf(world, {
      npcs,
      deco: [{ tileX: 2, tileY: 2, assetId: 'sign' }],
      decoImages: new Map([['sign', decoImg]]),
      barrierArt: new Map([['w1', [pieceStub(2, 2, 77)]]]),
    }), bounds, ic);

    expect(types(items)).toEqual(['image', 'poly', 'circle', 'poly', 'poly', 'poly', 'image', 'circle']);
    expect(imgDw(items[0])).toBe(42); // decoration first
    expect((items[1] as { color: string }).color).toBe('#5a4030'); // tree trunk
    expect((items[2] as { color: string }).color).toBe('#3a6e3a'); // tree canopy — vegetation before building
    expect(imgDw(items[6])).toBe(77); // barrier after building
    expect((items[7] as { color: string }).color).toBe('#d4a574'); // npc last
  });

  it('a building cluster with npc + vegetation at DIFFERENT depths interleaves in ascending depth order', () => {
    const world = new World(emptyMap());
    world.addEntity(buildingStub('near', 1, 1, 1, 1));   // depth 2
    world.addEntity({ id: 'tree', kind: 'english-oak', x: 5, y: 0 }); // depth 5
    world.addEntity(buildingStub('tied', 2, 3, 1, 1));   // depth 5 — ties the tree; vegetation (3) < building (4)
    const npcs = [{ id: 'n1', role: 'villager', tileX: 4, tileY: 4 }] as unknown as NpcInstance[]; // depth 8

    const items = buildEntityDrawList(rcOf(world, { npcs }), bounds, ic);

    expect(types(items)).toEqual([
      'poly', 'poly', 'poly',           // 'near' building (depth 2)
      'poly', 'circle',                 // tree: trunk + canopy (depth 5, draws before the tie)
      'poly', 'poly', 'poly',           // 'tied' building (depth 5)
      'circle',                          // npc (depth 8, drawn last)
    ]);
  });
});

describe('buildYSortBucket — same-kind ties preserve input order (the stability the scenes above rely on)', () => {
  it('two entries with identical kind + depth key + z draw in ARRAY order, not swapped', () => {
    const a: YSortEntry = { id: 'a', kind: 'npc', tx: 3, ty: 3, z: 0, kindPriority: 6 };
    const b: YSortEntry = { id: 'b', kind: 'npc', tx: 3, ty: 3, z: 0, kindPriority: 6 };

    expect(buildYSortBucket([a, b]).map((e) => e.id)).toEqual(['a', 'b']);
    expect(buildYSortBucket([b, a]).map((e) => e.id)).toEqual(['b', 'a']); // order follows input, not id
  });
});
