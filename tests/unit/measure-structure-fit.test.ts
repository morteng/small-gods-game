// tests/unit/measure-structure-fit.test.ts
// Phase B3 — the PURE terrain-fit core (scripts/lib/measure-structure-fit.ts) driven by
// synthetic heightfields. Deliberately NO world / no manifold / no renderer here: the core
// takes an injected terrain sampler, so each rule is a tiny pure fixture. Tooling, not
// shipped geometry — no golden pins.
import { describe, it, expect } from 'vitest';
import { measureStructureFit, type FitCell } from '../../scripts/lib/measure-structure-fit';

describe('measureStructureFit — flat ground', () => {
  it('reports zero clearance and zero slope on a flat field of any height', () => {
    // A flat field at an arbitrary absolute height — RELATIVE relief must read as 0.
    const r = measureStructureFit({ x: 10, y: 20 }, { w: 4, h: 3 }, () => 42);
    expect(r.minClearanceM).toBe(0);
    expect(r.maxClearanceM).toBe(0);
    expect(r.meanClearanceM).toBe(0);
    expect(r.maxSlopeMvTile).toBe(0);
    expect(r.referenceM).toBe(42);
    expect(r.cells).toHaveLength(12);
    for (const c of r.cells) {
      expect(c.terrainM).toBe(42);
      expect(c.clearanceM).toBe(0);
    }
  });

  it('footprint origin floors the placement anchor', () => {
    const r = measureStructureFit({ x: 3.9, y: 7.2 }, { w: 2, h: 2 }, (x, y) => x * 100 + y);
    expect(r.origin.x).toBe(3);
    expect(r.origin.y).toBe(7);
    expect(r.cells[0]).toMatchObject({ x: 3, y: 7 });
  });
});

describe('measureStructureFit — tilted ground', () => {
  it('reports the plane slope as maxSlope (metres per tile)', () => {
    // h(x,y) = 0.5 * x → each tile to the +x raises by 0.5 m; maxSlope must match.
    const r = measureStructureFit({ x: 0, y: 0 }, { w: 4, h: 3 }, (x) => 0.5 * x);
    expect(r.maxSlopeMvTile).toBeCloseTo(0.5, 10);
  });

  it('steeper tilt is reported proportionally', () => {
    const r = measureStructureFit({ x: 0, y: 0 }, { w: 3, h: 2 }, (x) => 2 * x);
    expect(r.maxSlopeMvTile).toBeCloseTo(2, 10);
  });

  it('a 1×1 footprint has no adjacent cells, so maxSlope is 0', () => {
    const r = measureStructureFit({ x: 5, y: 5 }, { w: 1, h: 1 }, (x, y) => x + y);
    expect(r.cells).toHaveLength(1);
    expect(r.maxSlopeMvTile).toBe(0);
  });
});

describe('measureStructureFit — gap / float', () => {
  it('a cell below the anchor grade reads as negative clearance (float)', () => {
    // Anchor at origin reference 0; a dip at (2,0) drops to -3 m → clearance -3.
    const ground = (x: number, y: number) => (x === 2 && y === 0 ? -3 : 0);
    const r = measureStructureFit({ x: 0, y: 0 }, { w: 3, h: 2 }, ground);
    const dipped = r.cells.find((c: FitCell) => c.x === 2 && c.y === 0);
    expect(dipped?.clearanceM).toBe(-3);
    expect(r.minClearanceM).toBe(-3);
    expect(r.minClearanceM).toBeLessThan(0);
  });

  it('a cell above the anchor grade reads as positive clearance', () => {
    const ground = (x: number) => (x === 1 ? 1.5 : 0);
    const r = measureStructureFit({ x: 0, y: 0 }, { w: 2, h: 1 }, ground);
    expect(r.cells.find((c) => c.x === 1)?.clearanceM).toBe(1.5);
    expect(r.maxClearanceM).toBe(1.5);
  });
});

describe('measureStructureFit — determinism', () => {
  it('is object-equal across repeated runs over the same sampler', () => {
    const ground = (x: number) => Math.sin(x) * 2 + Math.cos(x * 3) * 1.5; // deterministic, non-trivial
    const a = measureStructureFit({ x: 12, y: -4 }, { w: 5, h: 4 }, ground);
    const b = measureStructureFit({ x: 12, y: -4 }, { w: 5, h: 4 }, ground);
    expect(a).toEqual(b);
    // and the report is fully JSON-serialisable (no functions/undefined leaks).
    expect(() => JSON.stringify(a)).not.toThrow();
  });
});
