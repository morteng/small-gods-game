// tests/unit/bridge-deck-carries-road.test.ts
//
// WCV-98 / ART-v34. WCV-97 made the crossing's two bank cells THE shared opening and drove both
// probe seeds to ZERO `bridge.seating` errors — and the bridges still read wrong in game. The lint
// was honest about what it judged; it just wasn't judging the things that were broken:
//
//   1. THE DECK CARRIED NO ROAD. The terrain's painted ribbon deliberately stops at the banks (the
//      ground under a span is the carved channel BED, metres below the deck and under the water
//      plane), which leaves the deck as the ONLY surface the road can cross on — and the deck part
//      emitted a bare structural slab + parapets. So the road ended at the river and a blank stone
//      slab crossed it. Every earlier test asserted GEOMETRY (is the deck on the ribbon?), never
//      "is there a road ON it" — which is why this shipped.
//   2. DECKS SEATED ON A TERRAIN THAT ISN'T THERE. Clearance was sampled from the RAW seed
//      heightfield, which contains no river (the channel is a DEFORMATION), so every bank→bed drop
//      read ~0 and every deck landed on the 1.2 m clearance floor — buried up to 42 px inside one
//      bank, or floating 57 px over the road it was supposed to carry.
//   3. TWO DECKS ON ONE CROSSING. Two raster runs whose ribbon scans resolved to the SAME opening
//      each emitted a spec, stacking two identical slabs (z-fighting) on one crossing.
//
// These are the assertions that would have caught them. Note what is NOT asserted: that the
// terrain's pavedness paints across the deck. It deliberately does not — see the last block.

import { describe, it, expect } from 'vitest';
import { buildBridgeObject } from '@/world/connectome/crossing-structures';
import type { CrossingSpec } from '@/world/connectome/crossing-builder';
import { deckPartType } from '@/blueprint/parts/bridge';
import { getCrossingOpenings, deckLineCells } from '@/world/connectome/crossing-openings';
import { getRenderWaterMask } from '@/world/render-water';
import { edgeRoadProfile } from '@/world/road-deformation';
import { buildRoadFeatureGeometry, roadPavednessAt, segDist, SHOULDER_LIP_TILES } from '@/render/gpu/feature-geometry';
import { applyRoadMask, type RoadEdge, type RoadGraph } from '@/world/road-graph';
import { PX_PER_METRE } from '@/render/scale-contract';
import type { ResolvedPart } from '@/blueprint/types';
import type { Entity, GameMap, Tile } from '@/core/types';

// ── Fixtures ───────────────────────────────────────────────────────────────────────────────

/** A crossing with a properly seated shared opening: banks at (10,10) and (14,10), road running +x. */
function seatedSpec(over: Partial<CrossingSpec> = {}): CrossingSpec {
  return {
    id: 'crossing@re0#0', waterRef: 'w', spanTiles: 4, roadClass: 'road',
    era: 'late-medieval', prosperity: 'modest',
    banks: [{ x: 10, y: 10 }, { x: 14, y: 10 }],
    bankCells: [[10, 10], [14, 10]],
    axis: [1, 0],
    ...over,
  };
}

/** Deck part params off a built bridge entity (the resolved blueprint's `deck` part). */
function deckParams(e: Entity): Record<string, unknown> {
  const rb = (e.properties as { blueprint: { rb: { parts: Array<{ id: string; params?: Record<string, unknown> }> } } }).blueprint.rb;
  const deck = rb.parts.find((p) => p.id === 'deck');
  expect(deck, 'the bridge object has a deck part').toBeTruthy();
  return deck!.params ?? {};
}

/** A map with a straight river band, and a BENDING road crossing it (mirrors the exactness test's
 *  fixture). The bend matters: the road's own `bridge` tiles overwrite the river cells it walks —
 *  the raster forgets the channel exactly at the crossing — so a road whose smoothed ribbon never
 *  leaves its walked cells leaves no visible water behind at all. The bend makes the drawn ribbon
 *  corner-cut off the staircase, which is both realistic and the shape of the original defect. */
function riverCrossingMap(w: number, h: number, riverRows: number[]): { map: GameMap; edge: RoadEdge } {
  const rows = new Set(riverRows);
  const tiles: Tile[][] = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => rows.has(y)
      ? ({ type: 'river', x, y, walkable: false, state: 'realized' as const })
      : ({ type: 'grass', x, y, walkable: true, state: 'realized' as const })));
  const map = {
    tiles, width: w, height: h, villages: [], seed: 7, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [], barrierRuns: [],
  } as unknown as GameMap;
  const poly: Array<{ x: number; y: number }> = [];
  let x = 4;
  for (let y = 4; y <= 18; y++) { poly.push({ x, y }); if (y < 12) x++; }
  const edge = {
    id: 're0', a: 'n0', b: 'n1', feature: 'road', class: 'road', surface: 'stone',
    polyline: poly,
    bridgeCells: poly.filter((p) => rows.has(p.y)).map((p) => p.y * w + p.x),
  } as unknown as RoadEdge;
  map.roadGraph = { nodes: [], edges: [edge] } as unknown as RoadGraph;
  applyRoadMask(map.tiles, {
    width: w, height: h,
    writes: poly.map((c) => ({ x: c.x, y: c.y, surface: 'stone', bridge: rows.has(c.y) })),
  });
  return { map, edge };
}

// ── 1. The deck CARRIES the road ───────────────────────────────────────────────────────────

describe('the bridge deck carries the road across', () => {
  it('the deck declares the roadway of the road it carries', () => {
    const e = buildBridgeObject(seatedSpec(), { roadSurfaceFor: () => 'cobble' });
    expect(e, 'a seated crossing builds a bridge').toBeTruthy();
    // THE regression: without this the span is a bare slab and the road stops dead at the bank.
    expect(deckParams(e!).roadway).toBe('cobble');
  });

  it('the roadway is the SAME surface the painted ribbon uses — resolved per road edge', () => {
    // The resolver is keyed by the crossing's own edge id (parsed out of the spec id), so the deck
    // asks about the road it actually carries — not some other edge's surface.
    const seen: string[] = [];
    buildBridgeObject(seatedSpec({ id: 'crossing@re7#2' }), {
      roadSurfaceFor: (edgeId) => { seen.push(edgeId); return 'dirt'; },
    });
    expect(seen).toEqual(['re7']);
  });

  it('emits a running-surface course ON TOP of the deck slab, inset between the parapets', () => {
    const ctx = { materials: { walls: 'stone', roof: 'stone' }, footprint: { w: 6, h: 4 } };
    const part = (roadway?: string): ResolvedPart => ({
      id: 'deck', type: 'deck', at: { x: 0, y: 0 }, size: { w: 6, h: 4 },
      params: {
        lengthM: 10, widthM: 4, thicknessM: 0.6, baseZM: 2, camberM: 0,
        yawDeg: 0, parapet: 'both', ...(roadway ? { roadway } : {}),
      },
      features: [],
    });

    type Box = { prim: 'box'; at: [number, number, number]; size: [number, number, number]; material?: string; work?: string };
    const boxes = (ps: ReturnType<typeof deckPartType.toPrims>): Box[] =>
      ps.filter((p) => p.prim === 'box') as unknown as Box[];

    const bare = deckPartType.toPrims(part(), ctx);
    const paved = deckPartType.toPrims(part('cobble'), ctx);
    // Exactly one new prim: the roadway course.
    expect(paved.length).toBe(bare.length + 1);

    const slab = boxes(paved).find((p) => p.size[2] > 0.2)!;
    const course = boxes(paved).find((p) => p.material === 'stone' && p.work === 'cobble')!;
    expect(course, 'a cobble-sett stone course is emitted').toBeTruthy();

    // It rides the deck TOP (not buried in the slab, not floating above it).
    expect(course.at[2]).toBeCloseTo(slab.at[2] + slab.size[2], 5);
    // It is thin (a surface course, not a second slab) and fits between the parapets.
    expect(course.size[2]).toBeLessThan(slab.size[2]);
    expect(course.size[1]).toBeLessThan(slab.size[1]);
  });

  it('an unset roadway leaves the deck byte-identical (no default is injected)', () => {
    const ctx = { materials: { walls: 'timber', roof: 'timber' }, footprint: { w: 4, h: 3 } };
    const p: ResolvedPart = {
      id: 'deck', type: 'deck', at: { x: 0, y: 0 }, size: { w: 4, h: 3 },
      params: { lengthM: 6, widthM: 3, thicknessM: 0.5, dir: 'ew', parapet: 'none' },
      features: [],
    };
    // 1 slab, no parapets, no course — the historic bare deck.
    expect(deckPartType.toPrims(p, ctx)).toHaveLength(1);
  });
});

// ── 2. No shared opening ⇒ NO deck (the phantom slabs) ──────────────────────────────────────

describe('the deck seats on the shared opening when there is one', () => {
  it('the shared opening — not the raw walker banks — sites the deck', () => {
    // The raw banks and the ribbon-seated opening DISAGREE (that is the whole defect: the walker's
    // staircase and the drawn ribbon part company at a bend). The deck must follow the opening.
    const e = buildBridgeObject(seatedSpec({
      banks: [{ x: 6, y: 6 }, { x: 18, y: 18 }],   // raw walker line — a long diagonal, nowhere near
    }))!;
    const params = deckParams(e);
    // Span comes from the OPENING (10,10)→(14,10): 4 tiles + the 1-tile abutment margin, and the
    // yaw from its axis — not from the 17-tile diagonal chord of the raw banks.
    expect(params.yawDeg).toBeCloseTo(0, 6);
    expect(params.lengthM as number).toBeCloseTo(5 * 2, 6);   // (spanLen 4 + 1) tiles × 2 m/tile
  });

  it('a crossing with no opening still bridges (the road really does cross water) — from the raw line', () => {
    // The detector DECLINES an opening when the drawn road does not cross dry-to-dry there. Those
    // crossings are still real road×water claims the world must resolve (`claims.unresolved` /
    // `road.on-water` both error if nothing bridges them), so the span falls back to the raw walker
    // banks rather than leaving the road fording open water. It is NOT guaranteed to sit on the
    // drawn ribbon — the repair for that is upstream, where the road router puts its nodes.
    const noOpening: CrossingSpec = {
      id: 'crossing@re0#0', waterRef: 'w', spanTiles: 3, roadClass: 'road',
      era: 'late-medieval', prosperity: 'modest',
      banks: [{ x: 10, y: 10 }, { x: 13, y: 10 }],   // raw walker banks; no bankCells, no axis
    };
    const e = buildBridgeObject(noOpening);
    expect(e).toBeTruthy();
    // …and it still carries its road, and still seats on the terrain it is given.
    expect(deckParams(e!).yawDeg).toBeCloseTo(0, 6);
  });
});

// ── 2b. One opening, one crossing ───────────────────────────────────────────────────────────

describe('one opening is one crossing', () => {
  it('two raster runs that resolve to the same opening emit ONE spec, not two stacked decks', () => {
    const W = 30, H = 24;
    const { map } = riverCrossingMap(W, H, [11, 12, 13]);
    const openings = getCrossingOpenings(map);
    const keys = openings.map((o) => `${o.a}|${o.b}`);
    expect(new Set(keys).size, 'duplicate openings on one edge').toBe(keys.length);
  });
});

// ── 3. The deck SEATS on its banks, read off the terrain the renderer draws ─────────────────

describe('the deck seats on its banks (composed terrain, not the raw seed field)', () => {
  const reliefM = 48, zPxPerM = 20;

  /** Bank elevation at both banks, a carved bed between — what a COMPOSED heightfield looks like. */
  const carved = (bankElev: number, bedElev: number) => (x: number, _y: number): number =>
    (x <= 10 || x >= 14) ? bankElev : bedElev;

  it('the deck underside lands just proud of the bank, over a real channel', () => {
    const bankElev = 0.60, bedElev = 0.50;
    const e = buildBridgeObject(seatedSpec(), {
      deckElevAt: carved(bankElev, bedElev), reliefM, zPxPerM,
    })!;
    const props = e.properties as { liftElev: number };
    // The object is lifted to the BED (its arches spring from there).
    expect(props.liftElev).toBeCloseTo(bedElev, 6);

    // …and its underside rises to the bank + the 0.6 m the siter adds. In SCREEN px:
    //   bank − bed = (bankElev − bedElev) · reliefM · zPxPerM  must equal  (baseZM − 0.6) · PX_PER_METRE
    const baseZM = deckParams(e).baseZM as number;
    const deckSeatPx = (baseZM) * PX_PER_METRE;
    const bankAboveBedPx = (bankElev - bedElev) * reliefM * zPxPerM;
    expect(deckSeatPx - bankAboveBedPx).toBeCloseTo(0.6 * PX_PER_METRE, 4);

    // Read the RAW seed field instead (no channel in it ⇒ bank == bed) and the clearance collapses
    // onto the 1.2 m floor — the shipped bug, which buried decks in one bank and floated others.
    const flat = buildBridgeObject(seatedSpec(), {
      deckElevAt: () => bankElev, reliefM, zPxPerM,
    })!;
    expect(deckParams(flat).baseZM).toBeCloseTo(1.2, 6);
    expect(baseZM).toBeGreaterThan(1.2);
  });

  it('never seats the deck BELOW its bank', () => {
    // Deep ravine, shallow brook, dead-flat ford — the underside is always ≥ the bank.
    for (const [bank, bed] of [[0.9, 0.4], [0.55, 0.52], [0.5, 0.5]] as const) {
      const e = buildBridgeObject(seatedSpec(), { deckElevAt: carved(bank, bed), reliefM, zPxPerM })!;
      const baseZM = deckParams(e).baseZM as number;
      const seatPx = baseZM * PX_PER_METRE;                       // deck underside above the bed
      const bankPx = (bank - bed) * reliefM * zPxPerM;            // bank above the bed
      expect(seatPx).toBeGreaterThanOrEqual(bankPx);
    }
  });
});

// ── 4. …and the painted ribbon still does NOT cross the open channel ────────────────────────

describe('the painted ribbon yields to the visible channel', () => {
  const RIVER_ROWS = [11, 12, 13];

  it('emits no ribbon segment over the water, so the road never paints ACROSS the channel', () => {
    const W = 30, H = 24;
    const { map } = riverCrossingMap(W, H, RIVER_ROWS);
    const wet = getRenderWaterMask(map);
    const geo = buildRoadFeatureGeometry(map);
    const s = geo.segments;
    for (let i = 0; i < geo.segCount; i++) {
      const o = i * 8;
      const mx = Math.round((s[o] + s[o + 2]) / 2), my = Math.round((s[o + 1] + s[o + 3]) / 2);
      expect(wet(mx, my), `ribbon segment ${i} sits over the visible channel`).toBe(false);
    }
  });

  it('any paint that touches water is carriageway SHOULDER at the abutment, not road on the river', () => {
    const W = 30, H = 24;
    const { map, edge } = riverCrossingMap(W, H, RIVER_ROWS);
    const wet = getRenderWaterMask(map);
    const geo = buildRoadFeatureGeometry(map);
    const openings = getCrossingOpenings(map);
    expect(openings.length).toBe(1);
    const deck = new Set(deckLineCells(openings[0]).map(([x, y]) => `${x},${y}`));
    const line = edgeRoadProfile(map, edge, new Map(), new Map())!;
    const half = line.x.carriageHalf + SHOULDER_LIP_TILES;

    // Pavedness is a DISTANCE FIELD around the drawn centreline, so a dry segment near the bank
    // still tints water cells inside its own carriageway — those cells are the abutment shoulder
    // (and the abutment masonry stands on them). What must never happen is paint reaching BEYOND
    // the carriageway onto the open channel: that would be the road visibly running over the river.
    // The road crosses the water on the DECK's roadway course, asserted above — not on the terrain.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!wet(x, y) || deck.has(`${x},${y}`)) continue;
        if (roadPavednessAt(geo, x, y) <= 0.01) continue;
        const d = Math.min(...line.centerline.slice(0, -1).map((p, i) =>
          segDist(p.x, p.y, line.centerline[i + 1].x, line.centerline[i + 1].y, x, y).d));
        expect(d, `painted water cell ${x},${y} lies OUTSIDE the carriageway`).toBeLessThanOrEqual(half);
      }
    }
  });
});
