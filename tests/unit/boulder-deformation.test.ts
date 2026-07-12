import { describe, it, expect } from 'vitest';
import {
  boulderPadDeformationsFor, buildBoulderPadDeformations, BOULDER_PAD_MIN_SCALE,
} from '@/world/boulder-deformation';
import type { GameMap } from '@/core/types';
import { buildRiparianEntities } from '@/world/riparian-scatter';
import { applyOp } from '@/world/terrain-deformation';
import { WaterType, type HydrologyResult } from '@/core/types';

/** Same synthetic raster as riparian-scatter.test.ts: a 1-wide river column at x=1
 *  flanked by dry banks, descending steeply so riffle boulders cluster in-water too. */
function riverColumn(width: number, height: number, slopePerTile: number, flow: number): HydrologyResult {
  const n = width * height;
  const waterType = new Uint8Array(n).fill(WaterType.Dry);
  const surfaceW = new Float32Array(n).fill(-1);
  const flowField = new Float32Array(n);
  const riverMask = new Uint8Array(n);
  const waterMask = new Uint8Array(n);
  const rx = 1;
  for (let y = 0; y < height; y++) {
    const i = y * width + rx;
    waterType[i] = WaterType.River;
    waterMask[i] = 1;
    riverMask[i] = 1;
    flowField[i] = flow;
    surfaceW[i] = 12.0 - y * slopePerTile;
  }
  return {
    riverMask, flowField,
    drainTo: new Int32Array(n).fill(-1),
    surfaceW, waterMask, waterType,
    flowDirX: new Float32Array(n), flowDirY: new Float32Array(n),
    strahler: new Uint8Array(n), width: new Float32Array(n),
  };
}

const W = 4, H = 400, FLOW = 2000, SEED = 4242;
const GROUND_M = 10;
const ground = (): number => GROUND_M;

describe('boulder-deformation — R5 mini settle pads', () => {
  const hydro = riverColumn(W, H, 0.02, FLOW);
  const pads = boulderPadDeformationsFor(hydro, W, H, SEED, ground);

  it('pads every big DRY bank boulder and nothing else', () => {
    const ents = buildRiparianEntities(hydro, W, H, SEED);
    const bigDry = ents.filter((e) => {
      if (e.kind !== 'granite-boulder') return false;
      const scale = (e.properties as { scale?: number }).scale ?? 1;
      const i = Math.floor(e.y) * W + Math.floor(e.x);
      return scale >= BOULDER_PAD_MIN_SCALE && hydro.waterType[i] === WaterType.Dry;
    });
    expect(bigDry.length).toBeGreaterThan(0); // fixture actually exercises the path
    expect(pads.length).toBe(bigDry.length);
  });

  it('never pads the in-water riffle boulders (the river rules its bed)', () => {
    // Pad ids carry the containing tile — none may sit on the river column x=1.
    for (const p of pads) {
      const [x] = p.id.replace('pad:boulder:', '').split(',').map(Number);
      expect(x).not.toBe(1);
    }
  });

  it('levels a hand-span below grade, at a priority below all engineered ground', () => {
    for (const p of pads) {
      expect(p.op).toBe('level');
      expect(p.target).toBeCloseTo(GROUND_M - 0.08, 5);
      expect(p.priority).toBeLessThan(20); // discs 20 / pads 25 / roads 30 / rivers 40
      // Full mask at the core: the composed height lands ON the pad target.
      expect(applyOp(p, GROUND_M, GROUND_M, 1)).toBeCloseTo(GROUND_M - 0.08, 5);
    }
  });

  it('is deterministic — same raster + seed re-derives identical pads', () => {
    const again = boulderPadDeformationsFor(hydro, W, H, SEED, ground);
    expect(again.map((p) => `${p.id}:${p.target}`)).toEqual(pads.map((p) => `${p.id}:${p.target}`));
  });

  it('a map that never declared a riparian scatter gets NO pads', () => {
    // Bare stub (terrain-detail-style): no riparianSeed → the builder must not invent
    // hydrology-derived pads under entities that were never placed.
    const stub = { seed: 1234, width: 32, height: 32 } as unknown as GameMap;
    expect(buildBoulderPadDeformations(stub)).toEqual([]);
  });
});
