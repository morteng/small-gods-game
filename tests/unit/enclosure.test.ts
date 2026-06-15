import { describe, it, expect, beforeAll } from 'vitest';
import {
  selectSettlementEnclosure, selectCroftEnclosure, barrierRunFromType,
  deriveCroftEnclosures, deriveSettlementRing, type EnclosureCtx,
} from '@/world/enclosure';
import { loadDefaultPacks } from '@/catalogue';
import type { Lot } from '@/world/settlement-plan';

const ctx: EnclosureCtx = { era: 'medieval' };
// Deterministic rng stub: cycles a fixed sequence.
function seqRng(vals: number[]) {
  let i = 0;
  return { next: () => vals[i++ % vals.length] };
}

beforeAll(() => loadDefaultPacks());

describe('barrier catalogue is registered + Wikipedia-grounded', () => {
  it('builds a hedge run with metric height and material from the fact', () => {
    const run = barrierRunFromType('hedge', [[0, 0], [3, 0]], []);
    expect(run).toBeTruthy();
    expect(run!.kind).toBe('hedge');
    expect(run!.material).toBe('hedge');
    expect(run!.height).toBeGreaterThan(0); // mToTiles(1.5)
  });

  it('town-wall is crenellated stone', () => {
    const run = barrierRunFromType('town-wall', [[0, 0], [4, 0]], []);
    expect(run!.material).toBe('stone');
    expect(run!.crenellated).toBe(true);
  });
});

describe('settlement enclosure rung selection scales with size', () => {
  it('hamlet (few buildings) gets no settlement ring', () => {
    expect(selectSettlementEnclosure(3, ctx)).toBeNull();
  });
  it('village gets a palisade', () => {
    expect(selectSettlementEnclosure(8, ctx)).toBe('timber-palisade');
  });
  it('town gets the town wall (the highest rung it reaches)', () => {
    expect(selectSettlementEnclosure(20, ctx)).toBe('town-wall');
  });
});

describe('croft enclosure selection', () => {
  it('default region biases to a hedge but only returns applicable types', () => {
    // rng.next < 0.6 → hedge
    expect(selectCroftEnclosure(seqRng([0.1]), ctx)).toBe('hedge');
    // drystone is region-gated (upland/north) → excluded in the default region
    const picks = new Set<string>();
    for (let i = 0; i < 20; i++) picks.add(selectCroftEnclosure(seqRng([0.9, i / 20]), ctx)!);
    expect(picks.has('drystone-wall')).toBe(false);
  });
});

describe('deriveCroftEnclosures rings built lots with a street gate', () => {
  const lot: Lot = {
    id: 'lot:1', edge: 0, side: [0, 1], // road to the north
    frontage: [{ x: 2, y: 1 }],
    depth: 3,
    tiles: [
      { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 },
      { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 },
      { x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 },
    ],
    buildingId: 'bld_1',
  };

  it('produces one gated ring per built lot', () => {
    const runs = deriveCroftEnclosures([lot], 'poi1', seqRng([0.1]), ctx);
    expect(runs).toHaveLength(1);
    const { run } = runs[0];
    expect(run.path.length).toBe(5);        // closed rectangle
    expect(run.gates).toHaveLength(1);
    // road north → gate on the top edge, t = dx/2 = (4-2)/2 = 1
    expect(run.gates[0].t).toBeCloseTo(1, 5);
  });

  it('skips unbuilt lots', () => {
    const empty = { ...lot, buildingId: undefined };
    expect(deriveCroftEnclosures([empty], 'poi1', seqRng([0.1]), ctx)).toHaveLength(0);
  });
});

describe('deriveSettlementRing encloses the built bbox with gates at crossings', () => {
  it('rings a town and opens a gate where a road crosses', () => {
    const ring = deriveSettlementRing({
      bbox: { minX: 5, minY: 5, maxX: 15, maxY: 15 },
      mapW: 64, mapH: 64,
      buildingCount: 20,
      poiId: 'town1',
      isWater: () => false,
      isRoad: (x, y) => x === 10 && y <= 3, // a road exits north near x=10
      ctx,
    });
    expect(ring).toBeTruthy();
    expect(ring!.run.kind).toBe('wall');     // town wall at 20 buildings
    // ring sits margin=2 outside the bbox
    expect(ring!.run.path[0]).toEqual([3, 3]);
    expect(ring!.run.gates.length).toBeGreaterThanOrEqual(1);
  });

  it('returns null for a hamlet', () => {
    const ring = deriveSettlementRing({
      bbox: { minX: 5, minY: 5, maxX: 9, maxY: 9 },
      mapW: 64, mapH: 64,
      buildingCount: 3,
      poiId: 'hamlet1',
      isWater: () => false, isRoad: () => false, ctx,
    });
    expect(ring).toBeNull();
  });
});
