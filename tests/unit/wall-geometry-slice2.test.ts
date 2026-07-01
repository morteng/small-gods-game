import { describe, it, expect } from 'vitest';
import { runElements } from '@/render/parametric-barrier-source';
import { evaluateContracts } from '@/world/connectome-contracts';
import '@/world/connectome/wall-contracts';
import type { BarrierRun, PlacedBarrier } from '@/world/barrier';
import type { DiagnosticContext } from '@/world/connectome-diagnostics';

const ringPath: [number, number][] = [[0, 0], [12, 0], [12, 10], [0, 10], [0, 0]];

const palisadeRing: BarrierRun = {
  kind: 'palisade', path: ringPath, height: 1.3, thickness: 0.5, material: 'timber',
  posts: true, centroid: [6, 5], gates: [{ t: 6, width: 3, kind: 'gate' }],
};
const stoneRing: BarrierRun = {
  kind: 'wall', path: ringPath, height: 1.5, thickness: 1, material: 'stone', crenellated: true,
  centroid: [6, 5], gates: [{ t: 6, width: 3, kind: 'gate' }],
};

describe('slice 2 geometry — timber corner posts + gate frames', () => {
  it('a palisade ring emits a corner POST per corner and a gate FRAME', () => {
    const els = runElements(palisadeRing);
    expect(els.some((e) => e.key.startsWith('post:'))).toBe(true);
    expect(els.some((e) => e.key.startsWith('gateframe:'))).toBe(true);
    // …and NO masonry drum towers (that's the stone ring's job).
    expect(els.some((e) => e.key.startsWith('tower:'))).toBe(false);
  });

  it('a masonry ring uses towers, not timber posts', () => {
    const els = runElements(stoneRing);
    expect(els.some((e) => e.key.startsWith('tower:'))).toBe(true);
    expect(els.some((e) => e.key.startsWith('post:'))).toBe(false);
  });
});

function ctxWith(run: BarrierRun): DiagnosticContext {
  return {
    world: { query: () => [] } as unknown as DiagnosticContext['world'],
    map: { width: 16, height: 16, tiles: [], barrierRuns: [{ id: 'r_ring', run } as PlacedBarrier] } as unknown as DiagnosticContext['map'],
  };
}
const decls = [
  { contract: 'wall.corners-resolved', scope: { poi: 'r', entities: ['r_ring'] } },
  { contract: 'gate.framed', scope: { poi: 'r', entities: ['r_ring'] } },
];

describe('slice 2 contracts — corners resolved + gate framed', () => {
  it('is clean for a crenellated stone ring and a timber ring', () => {
    for (const run of [stoneRing, palisadeRing]) {
      const rep = evaluateContracts(ctxWith(run), { declarations: decls });
      expect(rep.byRule['wall.corners-resolved'] ?? 0).toBe(0);
      expect(rep.byRule['gate.framed'] ?? 0).toBe(0);
    }
  });

  it('flags a PLAIN (non-crenellated) stone ring — neither towers nor posts resolve it', () => {
    const plain: BarrierRun = { ...stoneRing, crenellated: false };
    const rep = evaluateContracts(ctxWith(plain), { declarations: decls });
    expect(rep.byRule['wall.corners-resolved']).toBe(1);
    expect(rep.byRule['gate.framed']).toBe(1);
  });
});
