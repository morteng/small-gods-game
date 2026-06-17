import { describe, it, expect } from 'vitest';
import { FlotsamSystem } from '@/water/water-flotsam';
import { WaterType, type GameMap, type HydrologyResult } from '@/core/types';

/** A 1-row hydrology strip: cells [0,wetTo) are river flowing east, rest dry. */
function eastRiver(width: number, wetTo = width): HydrologyResult {
  const z = () => new Float32Array(width);
  const waterMask = new Uint8Array(width);
  const waterType = new Uint8Array(width);
  const flowDirX = new Float32Array(width);
  const surfaceW = new Float32Array(width).fill(-1);
  for (let i = 0; i < wetTo; i++) {
    waterMask[i] = 1; waterType[i] = WaterType.River; flowDirX[i] = 1; surfaceW[i] = 0.35;
  }
  return {
    riverMask: waterMask.slice(), flowField: z(),
    drainTo: new Int32Array(width).fill(-1), surfaceW, waterMask, waterType,
    flowDirX, flowDirY: new Float32Array(width), strahler: new Uint8Array(width), width: z(),
  };
}

const mapOf = (width: number): GameMap =>
  ({ width, height: 1, seed: 7, worldSeed: null } as GameMap);
const meanX = (sys: FlotsamSystem) =>
  sys.snapshot().reduce((s, p) => s + p.x, 0) / Math.max(1, sys.snapshot().length);

describe('Water S6 — flotsam advection', () => {
  it('spawns particles on wet cells', () => {
    const map = mapOf(20);
    const hydro = eastRiver(20, 10); // only cells 0..9 are water
    const sys = new FlotsamSystem(7, 50);
    sys.step(map, hydro, 0); // spawn (dt 0 ⇒ no movement)
    const parts = sys.snapshot();
    expect(parts.length).toBe(50);
    expect(parts.every((p) => hydro.waterMask[Math.floor(p.x)] === 1)).toBe(true);
  });

  it('advects particles downstream (flow east ⇒ mean x increases)', () => {
    // Wide strip + few steps so no particle reaches the east edge and recycles
    // to the middle (which would confound the mean).
    const map = mapOf(1000);
    const hydro = eastRiver(1000);
    const sys = new FlotsamSystem(7, 100);
    sys.step(map, hydro, 0);
    const before = meanX(sys);
    for (let i = 0; i < 4; i++) sys.step(map, hydro, 0.1);
    expect(meanX(sys)).toBeGreaterThan(before);
  });

  it('respawns beached flotsam/fish back onto water', () => {
    const map = mapOf(20);
    const hydro = eastRiver(20, 10); // water only in 0..9; east flow pushes toward dry 10+
    const sys = new FlotsamSystem(3, 40);
    for (let i = 0; i < 30; i++) sys.step(map, hydro, 0.1);
    // Flotsam/fish must recycle onto water the moment they beach (birds may skim
    // past the shore briefly, so they're excluded).
    const grounded = sys.snapshot().filter((p) => p.kind !== 'bird');
    expect(grounded.length).toBeGreaterThan(0);
    expect(grounded.every((p) => {
      const cx = Math.floor(p.x);
      return cx >= 0 && cx < 20 && hydro.waterMask[cx] === 1;
    })).toBe(true);
  });

  it('is deterministic for a fixed seed', () => {
    const map = mapOf(100);
    const hydro = eastRiver(100);
    const a = new FlotsamSystem(42, 40);
    const b = new FlotsamSystem(42, 40);
    for (let i = 0; i < 12; i++) { a.step(map, hydro, 0.1); b.step(map, hydro, 0.1); }
    expect(b.snapshot()).toEqual(a.snapshot());
  });

  it('emits circle draw items for live particles', () => {
    const map = mapOf(40);
    const hydro = eastRiver(40);
    const sys = new FlotsamSystem(7, 30);
    sys.step(map, hydro, 0.05);
    const items = sys.drawItems(map, hydro);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((it) => it.t === 'circle')).toBe(true);
  });
});
