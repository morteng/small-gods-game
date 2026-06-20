import { describe, it, expect } from 'vitest';
import { buildRiverSurfaceField } from '@/render/gpu/river-surface-field';
import { WaterType, type GameMap, type HydrologyResult } from '@/core/types';

/**
 * A W×H world, flat terrain at `bank`, with a single river column at x=`col`,
 * rows 1..H-2, carved to `bed`. drainTo links each river cell to the one below.
 */
function makeWorld(W: number, H: number, col: number, bank: number, bed: number) {
  const N = W * H;
  const heights = new Float32Array(N).fill(bank);
  // The un-incised base grade: flat `bank` everywhere (the channel cells are only
  // carved in `heights`). The surface field references THIS for the bank top.
  const base = new Float32Array(N).fill(bank);
  const waterType = new Uint8Array(N);
  const drainTo = new Int32Array(N).fill(-1);
  const strahler = new Uint8Array(N);
  const width = new Float32Array(N);
  const surfaceW = new Float32Array(N).fill(-1);
  const rows: number[] = [];
  for (let y = 1; y <= H - 2; y++) rows.push(y * W + col);
  for (let k = 0; k < rows.length; k++) {
    const c = rows[k];
    heights[c] = bed;
    waterType[c] = WaterType.River;
    strahler[c] = 2;
    width[c] = 1;
    drainTo[c] = k < rows.length - 1 ? rows[k + 1] : -1;
  }
  const map = {
    width: W, height: H, tiles: [], villages: [], seed: 7, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as unknown as GameMap;
  const hydro = {
    riverMask: new Uint8Array(N), flowField: new Float32Array(N), drainTo, surfaceW,
    waterMask: new Uint8Array(N), waterType, flowDirX: new Float32Array(N), flowDirY: new Float32Array(N),
    strahler, width,
  } as unknown as HydrologyResult;
  return { map, heights, base, hydro, col, rows };
}

describe('buildRiverSurfaceField', () => {
  it('places the water surface above the bed but below the banks (contained, never floating)', () => {
    const { map, heights, base, hydro, col } = makeWorld(13, 9, 6, 0.50, 0.44);
    const surf = buildRiverSurfaceField(map, heights, hydro, base);
    const W = map.width;
    const mid = 4 * W + col;                 // a mid-reach river cell
    expect(surf[mid]).toBeGreaterThan(heights[mid]);   // water sits above the carved bed
    expect(surf[mid]).toBeLessThan(0.50);              // …and below the bank top
  });

  it('keeps a minimum depth so a weakly-carved reach never vanishes', () => {
    // bed only a hair below the bank → bankMin−inset would dip below the bed; the
    // min-depth clamp must keep the surface above the bed regardless.
    const { map, heights, base, hydro, col } = makeWorld(13, 9, 6, 0.50, 0.499);
    const surf = buildRiverSurfaceField(map, heights, hydro, base);
    const W = map.width;
    const mid = 4 * W + col;
    expect(surf[mid]).toBeGreaterThan(heights[mid]);   // strictly wet, not discarded
  });

  it('leaves off-channel terrain untouched (surface == terrain there → discarded in-shader)', () => {
    const { map, heights, base, hydro } = makeWorld(13, 9, 6, 0.50, 0.44);
    const surf = buildRiverSurfaceField(map, heights, hydro, base);
    const W = map.width;
    const far = 4 * W + 0;                    // x=0, six tiles from the channel
    expect(surf[far]).toBe(heights[far]);
  });

  it('dilates the water plateau onto the immediate banks (so the ribbon width samples it)', () => {
    const { map, heights, base, hydro, col } = makeWorld(13, 9, 6, 0.50, 0.44);
    const surf = buildRiverSurfaceField(map, heights, hydro, base);
    const W = map.width;
    const mid = 4 * W + col;
    const bank = 4 * W + (col - 1);           // first dry cell beside the channel
    expect(surf[bank]).not.toBe(heights[bank]);        // overwritten by dilation
    expect(surf[bank]).toBeCloseTo(surf[mid], 5);      // …to the channel water level
  });

  it('returns a field the size of the map', () => {
    const { map, heights, base, hydro } = makeWorld(10, 8, 5, 0.5, 0.45);
    const surf = buildRiverSurfaceField(map, heights, hydro, base);
    expect(surf).toHaveLength(map.width * map.height);
  });
});
