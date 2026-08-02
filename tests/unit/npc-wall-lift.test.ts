import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { toRenderNpc } from '@/world/npc-helpers';
import { npcItems, type IsoItemCtx } from '@/render/iso/iso-sprites';
import { buildEntityDrawList, WALL_NPC_DEPTH_BIAS } from '@/render/iso/entity-draw-list';
import { chunkBarrierRun, CHUNK_DEPTH_SPAN_MAX } from '@/render/parametric-barrier-source';
import { wallStations, walkZOf } from '@/world/tactical-positions';
import { HEIGHT_UNIT_PX } from '@/render/scale-contract';
import { BARRIER_DEFAULTS, type BarrierRun } from '@/world/barrier';
import type { TileBounds } from '@/render/iso/iso-projection';
import type { GameMap, RenderContext, Entity, NpcInstance, NpcProperties } from '@/core/types';
import type { BarrierPiece, SpritePack } from '@/render/iso/sprite-canvas';

// MANNING THE WALLS — W2. The render half of the garrison: a soldier the sim has put on a
// wall-walk (`NpcProperties.wallZ`, tiles above grade) must DRAW up there — feet on the allure,
// over the wall piece carrying him — while every ordinary, grounded townsfolk stays untouched.
//
// Headless and GPU-free, in the style of `draw-order-goldens.test.ts`: synthetic worlds, a stub
// RenderContext, and assertions on the returned DrawItem[] structure. Read
// `src/render/iso/iso-sprites.ts` (the lift), `src/render/iso/entity-draw-list.ts`
// (WALL_NPC_DEPTH_BIAS) and `src/world/tactical-positions.ts` (walkZOf — where the number comes
// from) before touching this file.

// ── stubs ──────────────────────────────────────────────────────────────────────────────────

function emptyMap(): GameMap {
  return {
    tiles: [], width: 200, height: 200, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as unknown as GameMap;
}

function canvasStub(w: number, h = w): HTMLCanvasElement {
  return { width: w, height: h } as unknown as HTMLCanvasElement;
}

/** An LPC sheet stub with no 2D context — `npcBillboard` falls back to LPC_DEFAULT_BODY
 *  ({top:32, bottom:62}) at scale 1, which is exactly what jsdom gives the real renderer. */
const SHEET = canvasStub(64 * 13, 64 * 21);
/** The fallback body's opaque bottom row — the sprite's foot anchor within the 64px frame. */
const BODY_BOTTOM = 62;

const icBase: Omit<IsoItemCtx, 'npcSheets'> = {
  atlas: { getCharacter: () => null } as unknown as IsoItemCtx['atlas'],
  originX: 0, originY: 0,
};
const ic: IsoItemCtx = { ...icBase, npcSheets: new Map([['n1', SHEET]]) };
const bounds: TileBounds = { minTx: -5, minTy: -5, maxTx: 150, maxTy: 150 };

function npcStub(tileX: number, tileY: number, extra: Partial<NpcInstance> = {}): NpcInstance {
  return {
    id: 'n1', name: 'Wat', role: 'soldier', seed: 3,
    tileX, tileY, direction: 'down', frame: 0, frameTimer: 0,
    ...extra,
  } as NpcInstance;
}

function pieceStub(sortX: number, sortY: number, idWidth: number): BarrierPiece {
  return {
    pack: { albedo: canvasStub(idWidth) } as SpritePack,
    refX: sortX, refY: sortY, anchorNX: 0, anchorNY: 0, sortX, sortY,
  };
}

function rcOf(world: World, npcs: NpcInstance[], barrierArt?: Map<string, BarrierPiece[]>): RenderContext {
  return {
    map: world.tiles, world, npcs, generatedDecorations: [], visualMap: null,
    resolveParametricBarrierArt: barrierArt ? (e: Entity) => barrierArt.get(e.id) ?? null : undefined,
  } as unknown as RenderContext;
}

// ── 1. the sim→render seam ─────────────────────────────────────────────────────────────────

describe('toRenderNpc — wallZ crosses the sim/render seam', () => {
  const propsOf = (extra: Partial<NpcProperties> = {}): Entity => ({
    id: 'n1', kind: 'npc', x: 4, y: 6,
    properties: {
      name: 'Wat', role: 'soldier', seed: 3, direction: 'down', frame: 0, frameTimer: 0,
      recentEventIds: [], ...extra,
    },
  } as unknown as Entity);

  it('copies wallZ through when the garrison machine has set it', () => {
    expect(toRenderNpc(propsOf({ wallZ: 1.05 })).wallZ).toBe(1.05);
  });

  it('OMITS the key entirely for a grounded NPC (not an own `wallZ: undefined`)', () => {
    const inst = toRenderNpc(propsOf());
    expect(inst.wallZ).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(inst, 'wallZ')).toBe(false);
  });

  it('carries the garrison pose + facing the sim already wrote (W1 reaching the renderer)', () => {
    // `stationaryAnimation`'s stationed-soldier branch writes 'thrust'/'shoot' into p.animation and
    // directionFromDelta writes p.direction; toRenderNpc must not drop either.
    const inst = toRenderNpc(propsOf({ animation: 'shoot', direction: 'left', wallZ: 1.05 }));
    expect(inst.animation).toBe('shoot');
    expect(inst.direction).toBe('left');
  });
});

// ── 2. the vertical lift ───────────────────────────────────────────────────────────────────

describe('npcItems — wallZ lifts the sprite by exactly one HEIGHT_UNIT_PX per tile of wall', () => {
  it('an on-wall NPC draws HEIGHT_UNIT_PX × wallZ higher than the identical grounded NPC', () => {
    const wallZ = 1.05;                                    // a rampart allure: 3.5 m crest − parapet
    const [ground] = npcItems(ic, npcStub(2, 2));
    const [lifted] = npcItems(ic, npcStub(2, 2, { wallZ }));
    expect(ground.t).toBe('image');
    expect(lifted.t).toBe('image');
    if (ground.t !== 'image' || lifted.t !== 'image') return;

    // sy = (2+2)·(ISO_TILE_H/2) = 128; feet anchor at sy − bb.bottom·scale.
    expect(ground.dy).toBe(128 - BODY_BOTTOM);
    expect(ground.dy - lifted.dy).toBe(Math.round(wallZ * HEIGHT_UNIT_PX));
    expect(lifted.dy).toBe(Math.round(128 - BODY_BOTTOM - wallZ * HEIGHT_UNIT_PX));
    expect(Number.isInteger(lifted.dy)).toBe(true);         // the 1:1 pixel-perfect rule
    // Nothing else about the sprite moves — a lift is vertical only.
    expect(lifted.dx).toBe(ground.dx);
    expect(lifted.dw).toBe(ground.dw);
    expect(lifted.dh).toBe(ground.dh);
  });

  it('a FRACTIONAL wallZ (mid-climb) still lands on a whole pixel', () => {
    const [it7] = npcItems(ic, npcStub(3, 5, { wallZ: 0.37 }));
    if (it7.t !== 'image') throw new Error('expected an image item');
    expect(Number.isInteger(it7.dy)).toBe(true);
  });

  it('composes with the terrain lift: the item hands over its TRUE ground contact as `foot`', () => {
    // The sprite has been pushed up-screen off its own foot, so `liftDrawList`'s derived
    // `(dy + dh − footLift)` would inverse-project the wrong tile. The explicit foot is the
    // unlifted tile point, so the terrain lift adds the ground under the wall ON TOP of this.
    const [lifted] = npcItems(ic, npcStub(2, 2, { wallZ: 1.05 }));
    if (lifted.t !== 'image') throw new Error('expected an image item');
    expect(lifted.foot).toEqual({ sx: 0, sy: 128 });        // worldToScreen(2,2,0) at origin 0,0
  });

  it('wallZ ABSENT ⇒ byte-identical output to today (every ordinary townsfolk)', () => {
    const [plain] = npcItems(ic, npcStub(7, 3));
    if (plain.t !== 'image') throw new Error('expected an image item');
    expect(plain).toEqual({
      t: 'image', src: SHEET,
      frame: { sx: 0, sy: 10 * 64, sw: 64, sh: 64 },        // walk rowBase 8 + 'down' offset 2, idle col
      dx: Math.round((7 - 3) * 64 - 32), dy: (7 + 3) * 32 - BODY_BOTTOM,
      dw: 64, dh: 64,
      shadow: { footLift: 64 - BODY_BOTTOM },
    });
    expect(Object.prototype.hasOwnProperty.call(plain, 'foot')).toBe(false);
  });

  it('wallZ 0 (a man at the stair foot) is treated as grounded, not as a zero-px lift', () => {
    const [zero] = npcItems(ic, npcStub(7, 3, { wallZ: 0 }));
    const [absent] = npcItems(ic, npcStub(7, 3));
    expect(zero).toEqual(absent);
  });

  it('the no-art circle fallback lifts too, so a soldier is never left on the ground', () => {
    const bare: IsoItemCtx = { ...icBase };                 // no sheets at all
    const [ground] = npcItems(bare, npcStub(2, 2));
    const [lifted] = npcItems(bare, npcStub(2, 2, { wallZ: 1.05 }));
    if (ground.t !== 'circle' || lifted.t !== 'circle') throw new Error('expected circle fallbacks');
    expect(ground.cy - lifted.cy).toBeCloseTo(1.05 * HEIGHT_UNIT_PX, 6);
  });
});

// ── 3. draw order over the wall he stands on ───────────────────────────────────────────────

describe('draw order — an on-wall NPC sorts OVER the barrier chunk carrying him', () => {
  /** A wall chunk spanning (0,0)→(2,0) — midpoint (1,0), depth key 1 — with a man on its FAR end
   *  at (0,0), depth 0: the worst case the bias exists for. */
  function scene(npc: NpcInstance) {
    const world = new World(emptyMap());
    world.addEntity({ id: 'w1', kind: 'wall_run', x: 0, y: 0 } as unknown as Entity);
    const art = new Map<string, BarrierPiece[]>([['w1', [pieceStub(1, 0, 77)]]]);
    return buildEntityDrawList(rcOf(world, [npc], art), bounds, ic);
  }

  it('the soldier draws AFTER his chunk even standing on its far (deepest-behind) end', () => {
    const items = scene(npcStub(0, 0, { wallZ: 1.05 }));
    expect(items.map((i) => i.t)).toEqual(['image', 'image']);
    expect((items[0] as { dw: number }).dw).toBe(77);        // the wall chunk
    expect((items[1] as { dw: number }).dw).toBe(64);        // the soldier, on top of it
  });

  it('regression witness: the SAME man grounded loses that comparison and is hidden', () => {
    // Not a bug — a townsfolk at (0,0) genuinely stands behind a wall whose sort key is at (1,0).
    // It is precisely why an on-wall soldier needs the bias, and it pins that grounded NPCs are
    // untouched by this slice.
    const items = scene(npcStub(0, 0));
    expect((items[0] as { dw: number }).dw).toBe(64);        // the man first…
    expect((items[1] as { dw: number }).dw).toBe(77);        // …the wall paints over him
  });

  it('the bias is exactly half the chunker\'s own depth-span cap — never re-tuned by feel', () => {
    expect(WALL_NPC_DEPTH_BIAS * 2).toBe(CHUNK_DEPTH_SPAN_MAX);
  });

  it('empirically: on a REAL crenellated ring, every station out-sorts its own chunk', () => {
    // The derivation above, checked against the geometry both halves actually use — real chunks
    // from `chunkBarrierRun`, real posts from `wallStations`. If the chunker ever changes its
    // sort key or its cap, this fails rather than silently hiding the garrison.
    const run: BarrierRun = {
      kind: 'rampart', path: [[10, 10], [26, 10], [26, 24], [10, 24], [10, 10]],
      ...BARRIER_DEFAULTS.rampart, gates: [], centroid: [18, 17],
    };
    const chunks = chunkBarrierRun(run);
    const stations = wallStations(run);
    expect(walkZOf(run)).toBeGreaterThan(0);
    expect(stations.length).toBeGreaterThan(4);
    expect(chunks.length).toBeGreaterThan(4);

    for (const st of stations) {
      // "His" chunk = the one whose midpoint sort key is nearest him in world space.
      let carrying = chunks[0];
      let best = Infinity;
      for (const c of chunks) {
        const d = Math.hypot(c.sortX - st.x, c.sortY - st.y);
        if (d < best) { best = d; carrying = c; }
      }
      const soldierDepth = st.x + st.y + WALL_NPC_DEPTH_BIAS;
      expect(soldierDepth).toBeGreaterThanOrEqual(carrying.sortX + carrying.sortY - 1e-9);
    }
  });
});
