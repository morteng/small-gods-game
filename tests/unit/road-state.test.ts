import { describe, it, expect } from 'vitest';
import { deriveRoadState, roadCrossSection, eraTech } from '@/world/road-state';

describe('eraTech', () => {
  it('ranks primordial→current 0→1', () => {
    expect(eraTech('primordial')).toBe(0);
    expect(eraTech('current')).toBe(1);
    expect(eraTech('medieval')).toBeCloseTo(0.75, 5);
  });
});

describe('deriveRoadState — construction reflects spend', () => {
  it('a dirt footpath barely modifies terrain', () => {
    const s = deriveRoadState({ roadClass: 'path', surface: 'dirt', era: 'medieval' });
    expect(s.construction).toBeLessThan(0.3);
    expect(s.surfaceMaterial).toBe('dirt');
  });

  it('a stone highway cuts hard', () => {
    const s = deriveRoadState({ roadClass: 'highway', surface: 'stone', era: 'medieval' });
    expect(s.construction).toBeGreaterThan(0.85);
    expect(s.surfaceMaterial === 'cobble' || s.surfaceMaterial === 'paved').toBe(true);
  });

  it('construction is monotonic in endpoint significance', () => {
    const path = deriveRoadState({ roadClass: 'path', surface: 'dirt', era: 'medieval' });
    const road = deriveRoadState({ roadClass: 'road', surface: 'dirt', era: 'medieval' });
    const hw = deriveRoadState({ roadClass: 'highway', surface: 'dirt', era: 'medieval' });
    expect(road.construction).toBeGreaterThan(path.construction);
    expect(hw.construction).toBeGreaterThan(road.construction);
  });

  it('later eras engineer more', () => {
    const ancient = deriveRoadState({ roadClass: 'road', surface: 'stone', era: 'ancient' });
    const current = deriveRoadState({ roadClass: 'road', surface: 'stone', era: 'current' });
    expect(current.construction).toBeGreaterThan(ancient.construction);
  });

  it('a new road is unworn; dynamics inject age/decay', () => {
    const fresh = deriveRoadState({ roadClass: 'road', surface: 'stone', era: 'medieval' });
    expect(fresh.condition).toBe(1);
    expect(fresh.wear).toBe(0);
    const old = deriveRoadState({
      roadClass: 'road',
      surface: 'stone',
      era: 'medieval',
      dynamic: { ageYears: 80, condition: 0.2, overgrowth: 0.5 },
    });
    expect(old.ageYears).toBe(80);
    expect(old.condition).toBe(0.2);
    expect(old.wear).toBeGreaterThan(0);
    expect(old.overgrowth).toBe(0.5);
  });

  it('is deterministic', () => {
    const a = deriveRoadState({ roadClass: 'road', surface: 'dirt', era: 'classical' });
    const b = deriveRoadState({ roadClass: 'road', surface: 'dirt', era: 'classical' });
    expect(a).toEqual(b);
  });
});

describe('roadCrossSection — geometry follows state', () => {
  it('the grade-smoothing window grows with construction (cut-through)', () => {
    const path = roadCrossSection(deriveRoadState({ roadClass: 'path', surface: 'dirt', era: 'medieval' }));
    const hw = roadCrossSection(deriveRoadState({ roadClass: 'highway', surface: 'stone', era: 'medieval' }));
    expect(hw.gradeWindowTiles).toBeGreaterThan(path.gradeWindowTiles * 3);
    expect(hw.cutStrength).toBeGreaterThan(path.cutStrength);
  });

  it('only paved/cobble roads get curbs + gutters', () => {
    const dirt = roadCrossSection(deriveRoadState({ roadClass: 'track', surface: 'dirt', era: 'medieval' }));
    const paved = roadCrossSection(deriveRoadState({ roadClass: 'highway', surface: 'stone', era: 'current' }));
    expect(dirt.hasCurb).toBe(false);
    expect(dirt.curbHeightM).toBe(0);
    expect(paved.hasCurb).toBe(true);
    expect(paved.curbHeightM).toBeGreaterThan(0);
    expect(paved.gutterDepthM).toBeGreaterThan(0);
  });

  it('wear + overgrowth widen the shoulder feather and add ruts', () => {
    const fresh = roadCrossSection(deriveRoadState({ roadClass: 'road', surface: 'stone', era: 'medieval' }));
    const worn = roadCrossSection(
      deriveRoadState({ roadClass: 'road', surface: 'stone', era: 'medieval', dynamic: { condition: 0.1, ageYears: 60, overgrowth: 0.6 } }),
    );
    expect(worn.shoulderFeatherTiles).toBeGreaterThan(fresh.shoulderFeatherTiles);
    expect(worn.rutDepthM).toBeGreaterThan(fresh.rutDepthM);
    expect(worn.edgeNoiseM).toBeGreaterThan(fresh.edgeNoiseM);
  });
});
