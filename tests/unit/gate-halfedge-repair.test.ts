// tests/unit/gate-halfedge-repair.test.ts — gate-commit-time half-edge repair (synthesis 2.1)
//
// The Watabou pattern: a committed gate must own BOTH half-edges — an interior corridor that
// reaches a REAL street cell, and a routable approach cell outside. A gate failing either check
// SLIDES along the ring in the same commit step (never post-hoc road repair).
import { describe, it, expect } from 'vitest';
import { repairGateHalfEdges } from '@/world/enclosure';
import { gatePoint, type BarrierRun, type BarrierGate } from '@/world/barrier';

/** A 12×12 square stone ring around centroid (10,10); perimeter 48 tiles. */
function squareRun(gates: BarrierGate[]): BarrierRun {
  return {
    kind: 'wall',
    path: [[4, 4], [16, 4], [16, 16], [4, 16], [4, 4]],
    height: 1.5, thickness: 1, material: 'stone', crenellated: true,
    gates,
    centroid: [10, 10],
  };
}

const never = (): boolean => false;
/** The town core street cell every scenario targets. */
const isStreet = (x: number, y: number): boolean => x === 10 && y === 10;

describe('repairGateHalfEdges', () => {
  it('verifies a healthy gate without moving it', () => {
    const run = squareRun([{ t: 6, width: 3, kind: 'gate' }]);   // top side, (10,4)
    const res = repairGateHalfEdges(run, { isStreet, blocked: never, offBank: never });
    expect(res).toEqual({ verified: 1, moved: 0, unrepaired: 0 });
    expect(run.gates[0].t).toBe(6);
  });

  it('slides a gate whose INTERIOR corridor is blocked to the nearest position that reaches a street', () => {
    // A building slab blocks the whole inside face of the top wall (y=5, x=5..15) except a
    // one-cell doorway column at x=13 — the only interior corridor down to the core.
    const blocked = (x: number, y: number): boolean => y === 5 && x >= 5 && x <= 15 && x !== 13;
    const run = squareRun([{ t: 6, width: 3, kind: 'gate' }]);   // committed at (10,4), corridor blocked
    const res = repairGateHalfEdges(run, { isStreet, blocked, offBank: never });
    expect(res.moved).toBe(1);
    expect(res.unrepaired).toBe(0);
    // Slid east until its OPENING spans the x=13 doorway column (the gate-width leaf covers
    // ~±1.5 tiles, so the first passing candidate may sit a cell shy of the column itself).
    const [gx, gy] = gatePoint(run, run.gates[0]);
    expect(Math.round(gy)).toBe(4);                              // still on the top side
    expect(Math.abs(Math.round(gx) - 13)).toBeLessThanOrEqual(1);
  });

  it('slides a gate whose EXTERIOR approach is blocked (building just outside the opening)', () => {
    // Open interior, but structures crowd the outside of the top-centre wall (y 2..3, x 8..12).
    const blocked = (x: number, y: number): boolean => (y === 2 || y === 3) && x >= 8 && x <= 12;
    const run = squareRun([{ t: 6, width: 3, kind: 'gate' }]);
    const res = repairGateHalfEdges(run, { isStreet, blocked, offBank: never });
    expect(res.moved).toBe(1);
    const [gx, gy] = gatePoint(run, run.gates[0]);
    expect(Math.round(gy)).toBe(4);                              // still on the top side
    expect(Math.round(gx)).toBeGreaterThan(12);                  // clear of the outside blockage
  });

  it('never slides onto an off-bank (water / far-bank) candidate', () => {
    // Interior blocked at the gate; the +k slide direction fronts water — repair must go −k.
    const blocked = (x: number, y: number): boolean => y === 5 && x >= 9 && x <= 11;
    const offBank = (x: number, y: number): boolean => x > 10 && y <= 4;  // the NE approach is river
    const run = squareRun([{ t: 6, width: 3, kind: 'gate' }]);
    const res = repairGateHalfEdges(run, { isStreet, blocked, offBank });
    expect(res.moved).toBe(1);
    const [gx] = gatePoint(run, run.gates[0]);
    expect(Math.round(gx)).toBeLessThan(10);                     // slid landward (−k), not into the river
  });

  it('leaves an unrepairable gate in place (the logged stitch remains the last resort)', () => {
    const blocked = (x: number, y: number): boolean => y >= 5 && y <= 15; // whole interior solid
    const run = squareRun([{ t: 6, width: 3, kind: 'gate' }]);
    const res = repairGateHalfEdges(run, { isStreet, blocked, offBank: never });
    expect(res).toEqual({ verified: 0, moved: 0, unrepaired: 1 });
    expect(run.gates[0].t).toBe(6);                              // untouched
  });

  it('skips gaps and respects spacing against other real gates', () => {
    const blocked = (x: number, y: number): boolean => y === 5 && x >= 5 && x <= 15 && x !== 13;
    const run = squareRun([
      { t: 6, width: 3, kind: 'gate' },
      { t: 30, width: 6, kind: 'gap' },                          // a water gap — never touched
      { t: 11, width: 3, kind: 'gate' },                         // sits at (15,4) near the corner
    ]);
    repairGateHalfEdges(run, { isStreet, blocked, offBank: never });
    expect(run.gates[1].t).toBe(30);                             // gap untouched
    // Both real gates end at least min-spacing (4.5) apart on the ring.
    const total = 48;
    const d = Math.abs(run.gates[0].t - run.gates[2].t);
    expect(Math.min(d, total - d)).toBeGreaterThanOrEqual(4.5);
  });

  it('is deterministic — identical inputs produce identical repairs', () => {
    const blocked = (x: number, y: number): boolean => y === 5 && x >= 5 && x <= 15 && x !== 7;
    const a = squareRun([{ t: 6, width: 3, kind: 'gate' }]);
    const b = squareRun([{ t: 6, width: 3, kind: 'gate' }]);
    repairGateHalfEdges(a, { isStreet, blocked, offBank: never });
    repairGateHalfEdges(b, { isStreet, blocked, offBank: never });
    expect(a.gates[0].t).toBe(b.gates[0].t);
  });
});
