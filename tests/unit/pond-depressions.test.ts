import { describe, it, expect } from 'vitest';
import { generateHydrology } from '@/terrain/hydrology';
import { WaterType, type TerrainField, type TerrainConfig } from '@/core/types';

// Rivers R3 — the depression hierarchy keeps small genuine hollows as flat, Lake-typed
// ponds with a real outlet, while EXCLUDING ε-flat-run artifacts structurally and leaving
// existing deep lakes byte-identical. See `src/terrain/hydrology.ts` (POND_* constants).

function field(elev: number[]): TerrainField {
  return {
    elevation: new Float32Array(elev),
    moisture: new Float32Array(elev.length),
    temperature: new Float32Array(elev.length),
  };
}

/**
 * A gentle plane tilting east (drains to the east edge) with a shallow rectangular hollow
 * dug into it. `dig` is the depth below local ground; on a gentle enough slope the hollow
 * is a CLOSED basin whose lowest saddle is its downslope (east) rim.
 */
function slopeWithHollow(w: number, h: number, dig: number): number[] {
  const elev = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) elev[y * w + x] = 0.5 - 0.001 * x; // ~0.001/cell east tilt
  }
  for (let y = 4; y <= 6; y++) {
    for (let x = 4; x <= 6; x++) elev[y * w + x] -= dig; // 3×3 hollow (9 cells)
  }
  return elev;
}

describe('rivers R3 — pond depression hierarchy', () => {
  const W = 11, H = 11;
  const CFG: TerrainConfig = { seed: 1, width: W, height: H, seaLevel: 0.05 };
  const at = (x: number, y: number) => y * W + x;

  it('1 · a shallow hollow on a slope becomes a Lake-typed pond with a real outlet', () => {
    // dig 0.009 → raw depth ≈ 0.008 (∈ [POND_MIN_DEPTH 0.006, LAKE_MIN_FILL 0.01)); 9 cells.
    const r = generateHydrology(field(slopeWithHollow(W, H, 0.009)), CFG);
    expect(r.ponds).toBeDefined();
    expect(r.ponds!.length).toBe(1);
    const p = r.ponds![0];

    // Every hollow cell classifies Lake (waterMask 1, a real water surface — not the −1
    // dry sentinel) and carries the pond id.
    for (let y = 4; y <= 6; y++) {
      for (let x = 4; x <= 6; x++) {
        const i = at(x, y);
        expect(r.waterType[i]).toBe(WaterType.Lake);
        expect(r.waterMask[i]).toBe(1);
        expect(r.surfaceW[i]).toBeGreaterThan(0);
        expect(r.pondId![i]).toBe(0);
      }
    }
    // The record: 3×3 area, depth in the pond band, spill/outlet consistent.
    expect(p.area).toBe(9);
    expect(p.maxDepth).toBeGreaterThanOrEqual(0.004);
    expect(p.maxDepth).toBeLessThan(0.01);
    expect(p.outletCell).toBe(r.drainTo[p.spillCell]);

    // The outlet is a real downstream cell, NOT part of the pond, and flow RESUMES there:
    // following drainTo from the outlet leaves the map (terminates at an outlet, −1).
    expect(p.outletCell).toBeGreaterThanOrEqual(0);
    expect(r.pondId![p.outletCell]).toBe(-1);
    let c = p.outletCell, steps = 0;
    while (r.drainTo[c] >= 0 && steps < W * H) { c = r.drainTo[c]; steps++; }
    expect(r.drainTo[c]).toBe(-1);

    // The pond water level is the spill saddle; the pond surface sits near it (the pond
    // is FLAT, within the pit-fill ε creep).
    expect(p.surfaceW).toBeGreaterThan(0.4);
    expect(r.surfaceW[at(5, 5)]).toBeGreaterThanOrEqual(p.surfaceW);
    expect(r.surfaceW[at(5, 5)]).toBeLessThan(p.surfaceW + 0.001);
  });

  it('2 · a long ε-flat-run plateau forms NO pond (structural exclusion)', () => {
    // A perfectly flat plateau: pit-fill raises the interior by k·ε (a monotone flat run,
    // not a basin). Measured against the RAW saddle, no cell is below it → no members.
    const elev = new Array(20 * 20).fill(0.6);
    const r = generateHydrology(field(elev), { seed: 1, width: 20, height: 20, seaLevel: 0.05 });
    expect(r.ponds!.length).toBe(0);
    for (let i = 0; i < r.pondId!.length; i++) expect(r.pondId![i]).toBe(-1);
  });

  it('3 · a deep basin (fill > LAKE_MIN_FILL) classifies exactly as before and gets NO pond', () => {
    // The documented closed-basin fixture: 5×5 plain at 0.6, centre sunk to 0.2 → deep lake.
    const w = 5, h = 5;
    const elev = new Array(w * h).fill(0.6);
    const C = 2 * w + 2;
    elev[C] = 0.2;
    const base = generateHydrology(field(elev), { seed: 1, width: w, height: h, seaLevel: 0.1 });
    expect(base.waterType[C]).toBe(WaterType.Lake); // unchanged deep-lake classification
    expect(base.ponds!.length).toBe(0);             // deep basin is NOT a pond this round
    expect(base.pondId![C]).toBe(-1);
  });

  it('4 · is deterministic — identical runs produce identical ponds + pondId', () => {
    const elev = slopeWithHollow(W, H, 0.009);
    const a = generateHydrology(field(elev), CFG);
    const b = generateHydrology(field(elev), CFG);
    expect(Array.from(a.pondId!)).toEqual(Array.from(b.pondId!));
    expect(JSON.stringify(a.ponds)).toBe(JSON.stringify(b.ponds));
  });

  it('5 · the volcano scorch mask suppresses a pond (dries it exactly as it dries a lake)', () => {
    const elev = slopeWithHollow(W, H, 0.009);
    // Scorch every hollow cell → the pond has no surviving water cell → dropped.
    const scorchMask = new Uint8Array(W * H);
    for (let y = 4; y <= 6; y++) for (let x = 4; x <= 6; x++) scorchMask[at(x, y)] = 1;
    const r = generateHydrology(field(elev), CFG, { scorchMask });
    expect(r.ponds!.length).toBe(0);
    // The hollow stays dry (not Lake) under scorch — same gate a lake gets.
    expect(r.waterType[at(5, 5)]).not.toBe(WaterType.Lake);
  });

  it('6 · area gates reject a too-small puddle and a too-large depression', () => {
    // Too small: a single 1-cell pit (area 1 < POND_MIN_CELLS 6) at a valid pond depth
    // (~0.008, above POND_MIN_DEPTH) → rejected purely by the area floor.
    const w = 9, h = 9;
    const small = new Array(w * h).fill(0.5);
    small[4 * w + 4] -= 0.008; // one cell, ~0.008 below the flat → 1-cell basin
    const rs = generateHydrology(field(small), { seed: 1, width: w, height: h, seaLevel: 0.05 });
    expect(rs.ponds!.length).toBe(0);

    // Too large: a broad shallow bowl whose area exceeds POND_MAX_CELLS (80). An 11×11
    // hollow (121 cells) at pond depth is a valid depression but too big to be a pond.
    const bw = 24, bh = 24;
    const big = new Array(bw * bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) big[y * bw + x] = 0.5 - 0.0002 * x;
    for (let y = 6; y <= 16; y++) for (let x = 6; x <= 16; x++) big[y * bw + x] -= 0.008;
    const rb = generateHydrology(field(big), { seed: 1, width: bw, height: bh, seaLevel: 0.05 });
    // No kept pond exceeds the cap, and the centre of the broad bowl is NOT projected as a
    // pond cell (the 121-cell depression is rejected wholesale).
    expect(rb.ponds!.every((p) => p.area <= 80)).toBe(true);
    expect(rb.pondId![10 * bw + 10]).toBe(-1);
  });
});
