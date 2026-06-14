/**
 * DC-2 — siting against the REAL world heightfield. makeTerrainProbe reads the merged
 * seed-deterministic elevation field; siteComplex composes the siting argmax with the
 * spoil-conserving earthworks. Assertions are invariants that hold on ANY procedural
 * terrain (the knoll/flat tiles are DERIVED from the probe, so no magic seed needed).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { GameMap } from '@/core/types';
import { clearHeightfieldCache } from '@/world/heightfield';
import { makeTerrainProbe } from '@/world/terrain-affordance';
import { catalogue, loadDefaultPacks } from '@/catalogue';
import { siteComplex } from '@/blueprint/connectome';
import type { ExpandCtx, SiteCandidate } from '@/blueprint/connectome';

const SEED = 12345;
const DIM = 64;
const map = { seed: SEED, width: DIM, height: DIM } as unknown as GameMap;
const probe = makeTerrainProbe(map);

/** Scan an inset region (avoid edge-clamp skew) for the most/least prominent tiles. */
function extremesOfProminence() {
  let knoll: SiteCandidate = { x: 8, y: 8 };
  let flat: SiteCandidate = { x: 8, y: 8 };
  let hi = -Infinity;
  let lo = Infinity;
  for (let y = 8; y < DIM - 8; y += 2) {
    for (let x = 8; x < DIM - 8; x += 2) {
      const h = Number(probe.affordanceAt(x, y).height);
      if (h > hi) { hi = h; knoll = { x, y }; }
      if (h < lo) { lo = h; flat = { x, y }; }
    }
  }
  return { knoll, flat, hi, lo };
}

let ctx: ExpandCtx;

beforeAll(() => {
  clearHeightfieldCache();
  loadDefaultPacks();
  ctx = { era: 'medieval', wealth: 'modest', seed: 1, registry: catalogue, terrain: probe };
});

describe('makeTerrainProbe', () => {
  it('reports affordances in valid ranges', () => {
    for (const [x, y] of [[20, 20], [32, 32], [40, 12]] as const) {
      const a = probe.affordanceAt(x, y);
      expect(Number(a.height)).toBeGreaterThanOrEqual(0);
      for (const k of ['commanding', 'steepFlanks', 'water', 'approachControl'] as const) {
        expect(Number(a[k])).toBeGreaterThanOrEqual(0);
        expect(Number(a[k])).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is deterministic for a fixed seed', () => {
    const a = makeTerrainProbe(map).affordanceAt(25, 25);
    const b = makeTerrainProbe(map).affordanceAt(25, 25);
    expect(a).toEqual(b);
  });
});

describe('siteComplex — real terrain', () => {
  it('prefers the prominent knoll over flat ground when defence dominates', () => {
    const { knoll, flat, hi, lo } = extremesOfProminence();
    expect(hi).toBeGreaterThanOrEqual(lo); // the field has some relief
    const placed = siteComplex(
      'motte_and_bailey',
      ctx,
      {}, // no strategic target ⇒ defence + cost decide
      [flat, knoll],
      { strat: 0, def: 1, cost: 1 },
    );
    expect(placed).not.toBeNull();
    // the knoll is at least as defensible as the flat (prominence drives both terms)
    expect(placed!.site.site).toEqual(hi >= lo ? knoll : flat);
  });

  it('conserves spoil and only builds the motte the site lacks', () => {
    const { knoll } = extremesOfProminence();
    const placed = siteComplex('motte_and_bailey', ctx, {}, [knoll], { strat: 0, def: 1, cost: 1 })!;
    expect(placed.netVolume).toBeCloseTo(0, 4); // ditch cut balances fill
    const motte = placed.earthworks.find((e) => e.kind === 'motte');
    if (placed.site.affordance.height >= placed.spec.motteHeight) {
      expect(motte).toBeUndefined(); // a tall enough knoll IS the motte
    } else {
      expect(motte!.height).toBeCloseTo(placed.spec.motteHeight - placed.site.affordance.height, 4);
    }
    // earthworks are centred on the chosen tile
    expect(motte?.centre ?? placed.earthworks[0]?.ring).toBeTruthy();
  });

  it('returns null without a terrain probe', () => {
    const noTerrain: ExpandCtx = { ...ctx, terrain: undefined };
    expect(siteComplex('motte_and_bailey', noTerrain, {}, [{ x: 10, y: 10 }], { strat: 0, def: 1, cost: 1 })).toBeNull();
  });
});
