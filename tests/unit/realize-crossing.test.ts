import { describe, it, expect } from 'vitest';
import { realizeCrossing } from '@/world/connectome/realize-crossing';
import { buildCrossing, type CrossingSpec } from '@/world/connectome/crossing-builder';

const RICH: CrossingSpec = {
  id: 'x', waterRef: 'reach#q', spanTiles: 8, roadClass: 'highway',
  era: 'late-medieval', prosperity: 'rich', biome: 'river-meadow',
  banks: [{ x: 10, y: 10 }, { x: 18, y: 10 }], // 8 tiles apart along +x
};

describe('realizeCrossing', () => {
  it('returns nothing when the crossing has no bank anchors', () => {
    const noBanks = buildCrossing({ ...RICH, banks: undefined });
    expect(realizeCrossing(noBanks)).toEqual([]);
  });

  it('places the deck span at the midpoint, oriented along the banks', () => {
    const ps = realizeCrossing(buildCrossing(RICH));
    const span = ps.find((p) => p.category === 'span')!;
    expect(span.at).toEqual({ x: 14, y: 10 });      // midpoint of (10,10)-(18,10)
    expect(span.dir).toEqual({ x: 1, y: 0 });        // along +x
  });

  it('places piers strictly between the two banks', () => {
    const ps = realizeCrossing(buildCrossing(RICH));
    const piers = ps.filter((p) => p.category === 'pier');
    expect(piers.length).toBeGreaterThan(0);
    for (const p of piers) {
      expect(p.at.x).toBeGreaterThan(10);
      expect(p.at.x).toBeLessThan(18);
    }
  });

  it('places every building from the connectome (deck shops, gatehouse, apron, mill)', () => {
    const site = buildCrossing(RICH);
    const ps = realizeCrossing(site);
    const buildings = ps.filter((p) => p.category === 'building');
    // shops×2 + gatehouse + toll + guard + shrine + mill = 7
    expect(buildings).toHaveLength(7);
    // each placement carries the cascaded site params
    expect(buildings.every((b) => b.params.era === 'late-medieval' && b.params.prosperity === 'rich')).toBe(true);
  });

  it('a poor footbridge realizes only the span + piers (no buildings)', () => {
    const poor = buildCrossing({ id: 'p', waterRef: 'r', spanTiles: 3, roadClass: 'path', era: 'stone-age', prosperity: 'poor', banks: [{ x: 4, y: 4 }, { x: 7, y: 4 }] });
    const ps = realizeCrossing(poor);
    expect(ps.some((p) => p.category === 'span')).toBe(true);
    expect(ps.filter((p) => p.category === 'building')).toHaveLength(0);
  });

  it('apron buildings sit inland of their bank (off the water), not on the span', () => {
    const ps = realizeCrossing(buildCrossing(RICH));
    // The near apron's toll/guard step back from x=10 toward x<10 (inland, away from far bank).
    const tollOrGuard = ps.filter((p) => p.kind === 'building(toll_booth)' || p.kind === 'building(guard_post)');
    expect(tollOrGuard.length).toBe(2);
    for (const b of tollOrGuard) expect(b.at.x).toBeLessThan(10);
  });
});
