// Synthetic span-structure scenarios — bridges & stairs interrogated against RENDER-water
// invariants (what reads right to the player), via `tests/helpers/span-scenario.ts`.
//
// These reproduce the shipped regression (decks sited on the raster river no longer cover the
// wider / meandered render ribbon; stairs pile up at a shared bank) as failing checks, and lock
// the fix: with the pipeline sited on RENDER water + deck-width reconciliation + stair spacing,
// every scenario reads clean.
import { describe, it, expect } from 'vitest';
import {
  valleyWithRiver, runScenario, checkScenario, type SpanScenario,
} from '../helpers/span-scenario';

/** A vertical road crossing a horizontal river at column `col`, from y0 (below) to y1 (above). */
function crossingRoad(col: number, y0: number, y1: number, cls: 'highway' | 'road' | 'track' | 'path' = 'road') {
  const poly = [];
  for (let y = y0; y <= y1; y++) poly.push({ x: col, y });
  return { class: cls, polyline: poly };
}

describe('span-scenario harness — bridges cover the VISIBLE channel', () => {
  it('baseline: render == raster, a clean brook — deck covers it sited either way', () => {
    const sc: SpanScenario = { ...valleyWithRiver(40, 24, { axisRow: 12, rasterHalf: 0, renderHalf: 0 }) };
    sc.roads = [crossingRoad(20, 6, 18)];
    // With render == raster, siting on raster already reads correctly.
    expect(checkScenario(sc, runScenario(sc, { siteWater: 'raster' }))).toEqual([]);
  });

  it('WIDE render ribbon (raster thin, render 5 wide): raster-sited deck is too short → uncovered', () => {
    // Raster is a single flow cell at row 12; the player sees a 5-cell ribbon (half=2).
    const sc: SpanScenario = { ...valleyWithRiver(40, 24, { axisRow: 12, rasterHalf: 0, renderHalf: 2 }) };
    sc.roads = [crossingRoad(20, 4, 20)];
    const bug = checkScenario(sc, runScenario(sc, { siteWater: 'raster' }));
    expect(bug.some((x) => x.code === 'B-uncovered')).toBe(true);          // visible water pokes past the deck
    // The fix: site on render water → deck spans the full visible ribbon.
    expect(checkScenario(sc, runScenario(sc, { siteWater: 'render' }))).toEqual([]);
  });

  it('ASYMMETRIC ribbon (render widens to ONE side of the raster line, overlapping it): raster-sited bank sits in water', () => {
    // A meander shifts the drawn ribbon to one side of the flow line but still overlaps it (both
    // come from the same centreline) — the walker bridges the thin raster cell, so a flanking bank
    // lands in the wider visible water. Modelled with an explicit render band that includes the
    // raster row and extends past it on one side.
    const base = valleyWithRiver(40, 24, { axisRow: 12, rasterHalf: 0, renderHalf: 1 });
    const sc: SpanScenario = { ...base, renderWater: (_x, y) => y >= 12 && y <= 15 };  // ribbon 12..15, raster at 12
    sc.roads = [crossingRoad(20, 4, 20)];
    const bug = checkScenario(sc, runScenario(sc, { siteWater: 'raster' }));
    expect(bug.some((x) => x.code === 'B-uncovered' || x.code === 'B-end-in-water')).toBe(true);
    expect(checkScenario(sc, runScenario(sc, { siteWater: 'render' }))).toEqual([]);
  });
});

describe('span-scenario harness — stairs foot on the road, climb, and do not pile up', () => {
  // A steep bank rising north of a river; several parallel roads climb out of the valley.
  function steepBank(): SpanScenario {
    const axisRow = 10;
    return {
      width: 48, height: 28, reliefM: 40,
      // Flat at/below the river, then a steep climb north (+y) of it.
      elevAt: (_x, y) => (y <= axisRow ? 0 : Math.min(1, (y - axisRow) * 0.02)),
      rasterWater: (_x, y) => y === axisRow,
      renderWater: (_x, y) => Math.abs(y - axisRow) <= 1,
      roads: [
        crossingRoad(20, 4, 22),
        crossingRoad(22, 4, 22),
        crossingRoad(24, 4, 22),
      ],
    };
  }

  it('three roads climbing one bank: stairs emerge, stay on the road, off the water, and spaced out', () => {
    const sc = steepBank();
    const res = runScenario(sc, { siteWater: 'render' });
    // Stairs DO emerge on the steep climb (the feature still works)…
    expect(res.stairEntities.length).toBeGreaterThan(0);
    // …and the cross-edge spacing rule keeps parallel roads' flights from jamming together.
    expect(checkScenario(sc, res).filter((x) => x.code.startsWith('S-'))).toEqual([]);
  });
});
