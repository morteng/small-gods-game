// tests/unit/road-ribbon-legal-probe.test.ts — whole-centerline ribbon legality on
// GENERATED worlds (road A*/drawing fix round, S2c).
//
// The `roads.ribbon-legal` contract's strengthened clause: the FINAL drawn centerline of
// every road edge (bow pins + fillets + deck pins applied — what the ribbon paints along)
// must never round onto an illegal cell (unwalkable rock, water without a deck, curtain,
// building, protected green). Gen self-heals via `reconcileCenterlineBows` (plain-smoothing
// bows re-fitted through the walked cells) + `reconcileCenterlineLegality` (residual grazes
// pinned back), so a freshly generated world must report ZERO violations and zero
// unreconciled fillet spans.
//
// These are real end-to-end `generateWithNoise` worlds on multiple probe seeds — kept at
// 48×48 so the suite stays fast; the full default-world seeds (12345/777/999) are covered
// by `npm run lint:world` (same contract) and the road-audit harness.
import { describe, it, expect } from 'vitest';
import { generateWithNoise } from '@/map/map-generator';
import { planFilletReconcile, planRibbonLegality } from '@/world/road-deformation';
import type { WorldSeed } from '@/core/types';

function makeSeed(): WorldSeed {
  return {
    name: 'ribbon-probe',
    size: { width: 48, height: 48 },
    biome: 'temperate',
    pois: [
      { id: 'a', type: 'village', name: 'A', position: { x: 6, y: 24 } },
      { id: 'b', type: 'village', name: 'B', position: { x: 42, y: 24 } },
      { id: 'c', type: 'village', name: 'C', position: { x: 24, y: 6 } },
    ],
    connections: [
      { from: 'a', to: 'b', type: 'road', style: 'dirt' },
      { from: 'a', to: 'c', type: 'road', style: 'dirt' },
      { from: 'b', to: 'c', type: 'road', style: 'dirt' },
    ],
    constraints: [],
  };
}

describe('roads.ribbon-legal on generated worlds (probe seeds)', () => {
  // Multiple seeds: hills/water layouts differ, so smoothing bows land in different places.
  for (const seed of [12345, 777, 999]) {
    it(`seed ${seed}: zero centerline-legality violations and zero unreconciled spans`, async () => {
      const { map, world } = await generateWithNoise(48, 48, seed, makeSeed());
      expect(map.roadGraph).toBeDefined();

      // Whole-line invariant: the drawn centerline never crosses an illegal cell.
      const violations = planRibbonLegality(map, world);
      expect(violations).toEqual([]);

      // Span invariant: every divergent span reconciled onto legal cells (no fallback residue).
      const badSpans = planFilletReconcile(map, world).filter((s) => s.badCells.length > 0);
      expect(badSpans).toEqual([]);
    });
  }
});
