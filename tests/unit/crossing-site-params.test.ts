import { describe, it, expect } from 'vitest';
import { makeCrossingSiteResolver } from '@/world/connectome/site-params';
import { bridgeClassFor } from '@/world/connectome/buildability-envelope';
import type { WorldSeed } from '@/core/types';

const FALLBACK = { era: 'late-medieval', prosperity: 'modest' };

/** PROSPERITY_RANK as `crossing-builder` / `crossing-structures` score it — the table the
 *  resolver's wealth vocabulary has to land on. Duplicated here on purpose: if either consumer
 *  re-buckets, this test should fail rather than silently agree. */
const ECONOMY: Record<string, number> = {
  destitute: 0, poor: 0, modest: 1, comfortable: 1, rich: 2, opulent: 3,
};

function seed(pois: WorldSeed['pois']): WorldSeed {
  return {
    id: 'w', name: 'w', description: '', size: { width: 100, height: 100 },
    biome: 'temperate', era: 'medieval', pois, connections: [], constraints: [],
  } as WorldSeed;
}

describe('makeCrossingSiteResolver', () => {
  it('reads era and prosperity off the NEAREST positioned POI', () => {
    const r = makeCrossingSiteResolver(seed([
      { id: 'city', type: 'city', position: { x: 10, y: 10 }, size: 'large' },
      { id: 'hamlet', type: 'village', position: { x: 60, y: 60 }, size: 'small' },
    ]), FALLBACK);
    expect(r(11, 11).prosperity).toBe('rich');
    expect(r(59, 59).prosperity).toBe('poor');
    expect(r(11, 11).era).toBe('medieval');   // from the world, no POI override
  });

  it('takes the STRONGER of size and importance, so a small critical site still scores', () => {
    const r = makeCrossingSiteResolver(seed([
      { id: 'keep', type: 'castle', position: { x: 5, y: 5 }, size: 'small', importance: 'critical' },
    ]), FALLBACK);
    expect(ECONOMY[r(5, 5).prosperity]).toBe(3);
  });

  it('falls to the wilderness floor beyond the settlement catchment', () => {
    const r = makeCrossingSiteResolver(seed([
      { id: 'city', type: 'city', position: { x: 0, y: 0 }, size: 'huge' },
    ]), FALLBACK);
    expect(r(2, 2).prosperity).toBe('opulent');
    expect(r(90, 90).prosperity).toBe('poor');   // out of reach of anyone who would pay
  });

  it("honours a POI's own era override", () => {
    const r = makeCrossingSiteResolver(seed([
      { id: 'ruin', type: 'ruins', position: { x: 1, y: 1 }, size: 'small', era: 'ancient' },
    ]), FALLBACK);
    expect(r(1, 1).era).toBe('ancient');
  });

  it('returns the fallback verbatim when the world has no positioned POIs', () => {
    expect(makeCrossingSiteResolver(seed([]), FALLBACK)(5, 5)).toEqual(FALLBACK);
    expect(makeCrossingSiteResolver(null, FALLBACK)(5, 5)).toEqual(FALLBACK);
  });

  // THE POINT OF THE MODULE: the old constant site resolved every crossing in every world the
  // same way, so only road class varied and exactly two bridge looks could generate. Locality
  // has to move the outcome, or none of this is worth the indirection.
  it('makes the SAME road class build differently in a rich town and a poor one', () => {
    const r = makeCrossingSiteResolver(seed([
      { id: 'city', type: 'city', position: { x: 10, y: 10 }, size: 'large' },
      { id: 'hamlet', type: 'village', position: { x: 80, y: 80 }, size: 'small' },
    ]), FALLBACK);
    const classAt = (x: number, y: number, importance: number) => {
      const s = r(x, y);
      return bridgeClassFor({ era: 2, economy: ECONOMY[s.prosperity] ?? 1 }, importance);
    };
    expect(classAt(10, 10, 2)).toBe('dressed-stone');   // busy road, rich town
    expect(classAt(80, 80, 2)).toBe('timber');          // same class, poor hamlet
    expect(classAt(80, 80, 0)).toBe('log-plank');       // footpath out by the hamlet
  });
});
