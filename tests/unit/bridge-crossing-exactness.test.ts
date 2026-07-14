// tests/unit/bridge-crossing-exactness.test.ts
//
// The bridge/road-crossing exactness WP: a stone bridge sat OFFSET beside the road ribbon, its
// deck read as a diagonal under a perpendicular road, and the road's cobble painted straight
// across the open channel at the true crossing point.
//
// ONE root cause behind all three: the crossing was sited from the RAW walker polyline while every
// ribbon the game DRAWS is the SMOOTHED centerline (`smoothCenterline`). At a bend the Catmull-Rom
// corner-cut slides the drawn road up to a tile sideways off the walked cells — so the deck (raw)
// and the road (smoothed) part company, and the deck's yaw came from the chord of two
// independently-snapped raster points rather than the road's own direction.
//
// The fix seats the crossing's two bank CELLS on the ribbon (`CrossingSpec.bankCells` — ONE
// rounding, shared by the deck, the ribbon pin, the raster and the lint, mirroring a gate's
// `gateOpeningCell`), takes the deck's yaw from the threaded road tangent (`CrossingSpec.axis`),
// and makes the road yield to the water the player SEES rather than to the tile raster.

import { describe, it, expect } from 'vitest';
import {
  valleyWithRiver, runScenario, checkScenario, ribbonCells, type SpanScenario,
} from '../helpers/span-scenario';
import { detectCrossings } from '@/world/connectome/detect-crossings';
import { getCrossingOpenings, deckLineCells } from '@/world/connectome/crossing-openings';
import { getRenderWaterMask } from '@/world/render-water';
import { edgeRoadProfile } from '@/world/road-deformation';
import { buildRoadFeatureGeometry } from '@/render/gpu/feature-geometry';
import { applyRoadMask, type RoadEdge, type RoadGraph } from '@/world/road-graph';
import type { GameMap, Tile } from '@/core/types';

// ── A road crossing a river at a BEND — the shipped defect, reproduced ──────────────────────
//
// The road turns as it reaches the water, so the smoothed ribbon cuts the corner and lands off
// the walked staircase exactly where the deck is sited. `renderHalf: 1` + `renderOffset: 1` also
// shifts the drawn channel a row off the raster line (a meander), the WCV-87/89 divergence.

function bendCrossing(): SpanScenario {
  const sc = valleyWithRiver(40, 28, { axisRow: 14, rasterHalf: 0, renderHalf: 1, renderOffset: 1 });
  // Approach from the NW, swing through a hard bend right at the bank, cross, then run east.
  sc.roads = [{
    class: 'road',
    polyline: [
      { x: 4, y: 6 }, { x: 8, y: 8 }, { x: 11, y: 11 }, { x: 13, y: 14 },
      { x: 15, y: 17 }, { x: 20, y: 19 }, { x: 26, y: 20 },
    ],
  }];
  return sc;
}

describe('crossing exactness — the deck sits on the ribbon, not on the walker staircase', () => {
  it('BUG: sited on the raw raster, the drawn ribbon crosses visible water no deck covers', () => {
    const sc = bendCrossing();
    const bug = checkScenario(sc, runScenario(sc, { siteWater: 'raster' }));
    // The harness now judges the SMOOTHED ribbon (it used to judge the raw polyline, which is
    // exactly why it could not see this bug at all). The raster-sited deck leaves ribbon cells
    // standing in open water, and/or seats an abutment in the channel.
    expect(bug.length).toBeGreaterThan(0);
    expect(bug.map((v) => v.code)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^B-(uncovered|end-in-water)$/)]),
    );
  });

  it('FIX: sited on the render water, every ribbon cell over the channel is under the deck', () => {
    const sc = bendCrossing();
    expect(checkScenario(sc, runScenario(sc, { siteWater: 'render' }))).toEqual([]);
  });

  it('the two bank cells are the ONE shared opening: both land on render-DRY ground', () => {
    const sc = bendCrossing();
    const { specs } = runScenario(sc, { siteWater: 'render' });
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      expect(spec.bankCells).toBeDefined();
      for (const [x, y] of spec.bankCells!) {
        expect(sc.renderWater(x, y)).toBe(false);   // an abutment never seats in the channel
      }
    }
  });

  it('deck yaw follows the THREADED ROAD tangent, not the raw bank chord', () => {
    const sc = bendCrossing();
    const { specs, graph } = runScenario(sc, { siteWater: 'render' });
    const spec = specs[0];
    expect(spec.axis).toBeDefined();

    // The road's own direction where it crosses: the smoothed ribbon's secant between the bank
    // cells. The deck's axis must agree with it to a few degrees — the defect had the deck
    // rotated off the road because its chord came from two independently-snapped raster points.
    const ribbon = ribbonCells(graph.edges[0]);
    const near = (c: [number, number]) => ribbon.reduce((best, p) =>
      Math.hypot(p.x - c[0], p.y - c[1]) < Math.hypot(best.x - c[0], best.y - c[1]) ? p : best, ribbon[0]);
    const a = near(spec.bankCells![0]), b = near(spec.bankCells![1]);
    const roadAng = Math.atan2(b.y - a.y, b.x - a.x);
    const deckAng = Math.atan2(spec.axis![1], spec.axis![0]);
    let d = Math.abs(roadAng - deckAng);
    if (d > Math.PI) d = 2 * Math.PI - d;
    expect(d * 180 / Math.PI).toBeLessThan(20);
  });

  it('a crossing whose ribbon cannot reach dry ground DECLINES rather than inventing a wet bank', () => {
    // A road running into an estuary: the whole far side is water, so no bank exists on the
    // ribbon. The detector must fall back to the legacy seat, never emit a wet `bankCells`.
    const sc = valleyWithRiver(30, 20, { axisRow: 10, rasterHalf: 0, renderHalf: 1 });
    sc.renderWater = (_x, y) => y >= 9;                 // everything south of row 9 is open water
    sc.roads = [{ class: 'road', polyline: [{ x: 5, y: 2 }, { x: 5, y: 18 }] }];
    const specs = detectCrossings(
      { nodes: [], edges: [{
        id: 're0', a: 'a', b: 'b', feature: 'road', class: 'road', surface: 'dirt',
        polyline: Array.from({ length: 17 }, (_, i) => ({ x: 5, y: 2 + i })),
        bridgeCells: [10 * 30 + 5],
      }] } as unknown as RoadGraph,
      30,
      { isWater: sc.renderWater, bridgeAt: sc.renderWater },
    );
    for (const spec of specs) {
      if (!spec.bankCells) continue;                    // declined — the legacy seat is used
      for (const [x, y] of spec.bankCells) expect(sc.renderWater(x, y)).toBe(false);
    }
  });
});

// ── The ribbon yields to the visible channel ───────────────────────────────────────────────

/** A map with a straight river band the road must cross, and no hydrology of its own. */
function riverMap(w: number, h: number, riverRows: number[]): GameMap {
  const rows = new Set(riverRows);
  const tiles: Tile[][] = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => rows.has(y)
      ? ({ type: 'river', x, y, walkable: false, state: 'realized' as const })
      : ({ type: 'grass', x, y, walkable: true, state: 'realized' as const })));
  return {
    tiles, width: w, height: h, villages: [], seed: 7, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [], barrierRuns: [],
  } as unknown as GameMap;
}

/** A bending road that crosses the river band — the ribbon corner-cuts off the walked cells. */
function crossingEdge(w: number, riverRows: number[]): RoadEdge {
  const poly: Array<{ x: number; y: number }> = [];
  let x = 4;
  for (let y = 4; y <= 18; y++) { poly.push({ x, y }); if (y < 12) x++; }
  const bridgeCells = poly.filter((p) => riverRows.includes(p.y)).map((p) => p.y * w + p.x);
  return {
    id: 're0', a: 'n0', b: 'n1', feature: 'road', class: 'road', surface: 'stone',
    polyline: poly, bridgeCells,
  } as unknown as RoadEdge;
}

describe('the road ribbon never paints the water the player sees', () => {
  const RIVER_ROWS = [11, 12, 13];

  it('no pavedness segment is emitted over a render-water cell', () => {
    const W = 30, H = 24;
    const map = riverMap(W, H, RIVER_ROWS);
    const edge = crossingEdge(W, RIVER_ROWS);
    map.roadGraph = { nodes: [], edges: [edge] } as unknown as RoadGraph;
    applyRoadMask(map.tiles, {
      width: W, height: H,
      writes: edge.polyline.map((c) => ({
        x: c.x, y: c.y, surface: 'stone',
        bridge: RIVER_ROWS.includes(c.y),         // the walker bridges its own raw cells
      })),
    });

    const wet = getRenderWaterMask(map);
    const geo = buildRoadFeatureGeometry(map);
    // Walk the emitted segments: not one may sit over the visible channel. Before the fix the
    // ribbon (smoothed, corner-cut off the walked cells) painted cobble straight across it.
    const s = geo.segments;
    for (let i = 0; i < geo.segCount; i++) {
      const o = i * 8;
      const mx = Math.round((s[o] + s[o + 2]) / 2), my = Math.round((s[o + 1] + s[o + 3]) / 2);
      expect(wet(mx, my)).toBe(false);
    }
  });

  it('the ribbon threads the crossing: every render-wet ribbon cell lies on the deck line', () => {
    const W = 30, H = 24;
    const map = riverMap(W, H, RIVER_ROWS);
    const edge = crossingEdge(W, RIVER_ROWS);
    map.roadGraph = { nodes: [], edges: [edge] } as unknown as RoadGraph;

    const openings = getCrossingOpenings(map);
    expect(openings.length).toBe(1);
    const deck = new Set(deckLineCells(openings[0]).map(([x, y]) => `${x},${y}`));
    const wet = getRenderWaterMask(map);

    // The BANK-PIN assertion, mirroring the gate one: the drawn ribbon passes through the very
    // cells the deck seats on, and wherever it stands on water it stands on the deck.
    const profile = edgeRoadProfile(map, edge, new Map(), new Map());
    expect(profile).not.toBeNull();
    const line = profile!.centerline;

    for (const bank of [openings[0].a, openings[0].b]) {
      const d = Math.min(...line.map((p) => Math.hypot(p.x - bank[0], p.y - bank[1])));
      expect(d).toBeLessThan(0.6);                // the ribbon threads the shared opening
    }
    for (const p of line) {
      const cx = Math.round(p.x), cy = Math.round(p.y);
      if (wet(cx, cy)) expect(deck.has(`${cx},${cy}`)).toBe(true);
    }
  });
});
