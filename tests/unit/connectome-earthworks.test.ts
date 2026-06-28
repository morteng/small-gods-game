/**
 * DC-1a — earthworks + siting. Locks the two realism invariants:
 *   1. Siting is a weighted tradeoff (hill wins on cost; ford wins on strategy).
 *   2. Conservation of spoil (ditch cut balances motte + rampart fill).
 */
import { describe, it, expect } from 'vitest';
import {
  siteSelect,
  scoreSite,
  deriveEarthworks,
  frustumVolume,
  ringVolume,
  type SiteIntent,
  type SiteWeights,
  type EarthworkSpec,
} from '@/blueprint/connectome/earthworks';
import type { TerrainProbe } from '@/blueprint/connectome/types';

/** A terrain probe backed by a per-point affordance map. */
function probeOf(map: Record<string, Record<string, number>>): TerrainProbe {
  return { affordanceAt: (x, y) => map[`${x},${y}`] ?? {} };
}

const WEIGHTS_BALANCED: SiteWeights = { strat: 1, def: 1, cost: 1 };

describe('siteSelect — weighted tradeoff', () => {
  it('picks the natural hill over flat ground when strategy is neutral', () => {
    const hill = { x: 0, y: 0 };
    const flat = { x: 10, y: 0 };
    const probe = probeOf({
      '0,0': { height: 10, commanding: 0.9, steepFlanks: 0.6 }, // a knoll
      '10,0': { height: 0 }, // flat
    });
    const intent: SiteIntent = { desiredHeight: 10 }; // no target ⇒ strategy 0
    const best = siteSelect([flat, hill], intent, WEIGHTS_BALANCED, probe);
    expect(best?.site).toEqual(hill);
    // the hill gives the height for free → ~zero build cost
    expect(best?.buildCost).toBeCloseTo(0, 5);
  });

  it('picks flat ground by the target when strategy dominates (haul the earth)', () => {
    const hill = { x: 0, y: 0 }; // great hill, far from the ford
    const flatByFord = { x: 100, y: 0 }; // flat, but on the ford
    const probe = probeOf({
      '0,0': { height: 10, commanding: 1, steepFlanks: 1 },
      '100,0': { height: 0 },
    });
    const intent: SiteIntent = { desiredHeight: 10, target: { x: 100, y: 0 }, purpose: 'hold-ford' };
    const stratHeavy: SiteWeights = { strat: 20, def: 1, cost: 1 };
    const best = siteSelect([hill, flatByFord], intent, stratHeavy, probe);
    expect(best?.site).toEqual(flatByFord);
    // and it costs the full mound (flat ⇒ deficit = desiredHeight)
    expect(best?.buildCost).toBeCloseTo(1, 5);
  });

  it('is deterministic for the same seed and returns null for no candidates', () => {
    const probe = probeOf({ '0,0': { height: 5 }, '1,0': { height: 5 } });
    const intent: SiteIntent = { desiredHeight: 10 };
    const a = siteSelect([{ x: 0, y: 0 }, { x: 1, y: 0 }], intent, WEIGHTS_BALANCED, probe, 42);
    const b = siteSelect([{ x: 0, y: 0 }, { x: 1, y: 0 }], intent, WEIGHTS_BALANCED, probe, 42);
    expect(a?.site).toEqual(b?.site);
    expect(siteSelect([], intent, WEIGHTS_BALANCED, probe)).toBeNull();
  });

  it('reads missing affordance keys as zero', () => {
    const probe = probeOf({ '0,0': {} });
    const s = scoreSite({ x: 0, y: 0 }, { desiredHeight: 10 }, WEIGHTS_BALANCED, probe);
    expect(s.defensiveAffordance).toBe(0);
    expect(s.buildCost).toBeCloseTo(1, 5); // nothing given ⇒ full build
  });
});

describe('volume helpers', () => {
  it('frustum reduces to a cylinder when slope is 0', () => {
    // slope 0 ⇒ baseR == topR ⇒ V = π r² h
    expect(frustumVolume(3, 4, 0)).toBeCloseTo(Math.PI * 9 * 4, 6);
  });
  it('ring volume is circumference × cross-section', () => {
    expect(ringVolume(10, 2, 3)).toBeCloseTo(2 * Math.PI * 10 * 2 * 3, 6);
  });
});

describe('deriveEarthworks — conservation of spoil', () => {
  const spec: EarthworkSpec = {
    motteHeight: 8,
    motteTopRadius: 4,
    slope: 1.5,
    baileyRadius: 20,
    rampartHeight: 2,
    rampartWidth: 4,
    ditchWidth: 5,
  };

  it('on flat ground: builds motte + rampart + ditch, net volume ≈ 0', () => {
    const probe = probeOf({ '0,0': { height: 0 } });
    const { earthworks, netVolume } = deriveEarthworks({ x: 0, y: 0 }, spec, probe);
    const kinds = earthworks.map((e) => e.kind).sort();
    expect(kinds).toEqual(['ditch', 'motte', 'rampart']);
    expect(netVolume).toBeCloseTo(0, 5); // cut balances fill
    // ditch is a cut (negative), motte + rampart are fill (positive)
    expect(earthworks.find((e) => e.kind === 'ditch')!.volume).toBeLessThan(0);
    expect(earthworks.find((e) => e.kind === 'motte')!.volume).toBeGreaterThan(0);
  });

  it('on a hill the motte deficit shrinks — partial hill builds a smaller mound', () => {
    const flat = deriveEarthworks({ x: 0, y: 0 }, spec, probeOf({ '0,0': { height: 0 } }));
    const onHill = deriveEarthworks({ x: 0, y: 0 }, spec, probeOf({ '0,0': { height: 5 } }));
    const flatMotte = flat.earthworks.find((e) => e.kind === 'motte')!;
    const hillMotte = onHill.earthworks.find((e) => e.kind === 'motte')!;
    expect(hillMotte.height).toBeCloseTo(3, 5); // 8 wanted − 5 natural
    expect(hillMotte.volume).toBeLessThan(flatMotte.volume);
    expect(onHill.netVolume).toBeCloseTo(0, 5); // still conserved
  });

  it('a hill tall enough builds NO motte (the hill IS the motte)', () => {
    const probe = probeOf({ '0,0': { height: 12 } }); // taller than wanted
    const { earthworks } = deriveEarthworks({ x: 0, y: 0 }, spec, probe);
    expect(earthworks.find((e) => e.kind === 'motte')).toBeUndefined();
    // rampart + its balancing ditch still get built
    expect(earthworks.map((e) => e.kind).sort()).toEqual(['ditch', 'rampart']);
  });
});

// ── Building-validity S5: situational siting terms + consumer weight profiles ──────────
import {
  DEFENSIVE_SITE_WEIGHTS, OPULENT_SITE_WEIGHTS, SHRINE_SITE_WEIGHTS,
} from '@/blueprint/connectome/earthworks';

describe('siteSelect — situational terms (sun/prominence) and consumer profiles', () => {
  // Two candidates: a sunlit, far-seen eminence vs a shaded, defensible crag.
  const eminence = { x: 0, y: 0 };
  const crag = { x: 50, y: 0 };
  const probe = probeOf({
    '0,0': { height: 6, commanding: 0.7, steepFlanks: 0.2, sunny: 0.95, prominence: 0.9, shelter: 0.1 },
    '50,0': { height: 9, commanding: 0.8, steepFlanks: 0.9, water: 0.5, sunny: 0.1, prominence: 0.7, shelter: 0 },
  });
  const intent: SiteIntent = { desiredHeight: 8 };

  it('the optional terms default to 0 — defensive siting is unchanged (the crag wins)', () => {
    // No sun/prominence weights ⇒ pure defence ⇒ the protected crag.
    const best = siteSelect([eminence, crag], intent, { strat: 0, def: 1, cost: 0 }, probe);
    expect(best?.site).toEqual(crag);
  });

  it('opulence buys the sunlit, far-seen eminence over the defensible crag', () => {
    const best = siteSelect([eminence, crag], intent, OPULENT_SITE_WEIGHTS, probe);
    expect(best?.site).toEqual(eminence);
  });

  it('defence picks the protected crag', () => {
    const best = siteSelect([eminence, crag], intent, DEFENSIVE_SITE_WEIGHTS, probe);
    expect(best?.site).toEqual(crag);
  });

  it('a shrine takes the sacred eminence (prominence-led, sun-aligned)', () => {
    const best = siteSelect([eminence, crag], intent, SHRINE_SITE_WEIGHTS, probe);
    expect(best?.site).toEqual(eminence);
  });

  it('zeroing the situational weights scores identically to the legacy 3-term formula', () => {
    const legacy = scoreSite(eminence, intent, { strat: 1, def: 1, cost: 1 }, probe);
    const withDefaults = scoreSite(eminence, intent, { strat: 1, def: 1, cost: 1, sun: 0, prominence: 0 }, probe);
    expect(withDefaults.score).toBe(legacy.score);
  });
});
