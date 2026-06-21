// @vitest-environment node
// World-studio drill-down hit-testing: projection determinism + nearest-candidate
// picking scoped to the focus level.
import { describe, it, expect } from 'vitest';
import type { Camera, GameMap } from '@/core/types';
import { projectConnectome } from '@/render/connectome-overlay';
import { pickPoi, pickBuilding, planForPoi, buildingsOf, planBounds } from '@/studio/world-picking';
import type { SettlementPlan } from '@/world/settlement-plan';

const plan: SettlementPlan = {
  poiId: 'p1', center: { x: 8, y: 8 },
  nodes: [{ id: 'n0', x: 8, y: 8, kind: 'founding' }],
  edges: [{ a: 'n0', b: 'n0', tiles: [{ x: 8, y: 8 }, { x: 9, y: 8 }], kind: 'through' }],
  slots: [],
  lots: [{ id: 'l0', edge: 0, side: [1, 0], frontage: [{ x: 8, y: 8 }], depth: 3, tiles: [{ x: 8, y: 8 }, { x: 9, y: 8 }, { x: 8, y: 9 }] }],
  wards: [], civics: [], market: [],
};

const map = {
  tiles: [], width: 48, height: 48, villages: [], seed: 1, success: true,
  worldSeed: {
    pois: [
      { id: 'p1', type: 'village', name: 'Riverford', position: { x: 8, y: 8 }, importance: 'high' },
      { id: 'p2', type: 'shrine', name: 'Old Shrine', position: { x: 30, y: 30 }, importance: 'low' },
    ],
  },
  stats: { iterations: 0, backtracks: 0 },
  buildings: [
    { id: 'b1', templateId: 'cottage', tileX: 9, tileY: 8, poiId: 'p1', state: 'intact' },
    { id: 'b2', templateId: 'tavern', tileX: 31, tileY: 30, poiId: 'p2', state: 'intact' },
  ],
  settlementPlans: [plan],
} as unknown as GameMap;

const cam: Camera = { x: 0, y: 0, zoom: 1, dragging: false, lastX: 0, lastY: 0 };

describe('projectConnectome', () => {
  it('is deterministic', () => {
    expect(projectConnectome(map, 8, 8, cam)).toEqual(projectConnectome(map, 8, 8, cam));
  });
  it('moves with the camera', () => {
    const a = projectConnectome(map, 8, 8, cam);
    const b = projectConnectome(map, 8, 8, { ...cam, x: 10 });
    expect(b.x).not.toBe(a.x);
  });
});

describe('plan helpers', () => {
  it('planForPoi matches on poiId', () => {
    expect(planForPoi(map, 'p1')).toBe(plan);
    expect(planForPoi(map, 'nope')).toBeNull();
  });
  it('buildingsOf scopes to a settlement', () => {
    expect(buildingsOf(map, 'p1').map((b) => b.id)).toEqual(['b1']);
    expect(buildingsOf(map, 'p2').map((b) => b.id)).toEqual(['b2']);
  });
  it('planBounds covers the plan tiles', () => {
    const b = planBounds(plan);
    expect(b.x).toBe(8); expect(b.y).toBe(8);
    expect(b.w).toBe(2); expect(b.h).toBe(2);   // x∈[8,9], y∈[8,9]
  });
});

describe('pickPoi', () => {
  it('returns the POI nearest the click within radius', () => {
    const p = projectConnectome(map, 8, 8, cam);   // p1's screen point
    expect(pickPoi(map, cam, p.x, p.y)?.id).toBe('p1');
  });
  it('returns null when the click is far from any POI', () => {
    expect(pickPoi(map, cam, 99999, 99999)).toBeNull();
  });
  it('discriminates between two POIs', () => {
    const p2 = projectConnectome(map, 30, 30, cam);
    expect(pickPoi(map, cam, p2.x, p2.y)?.id).toBe('p2');
  });
});

describe('pickBuilding', () => {
  it('picks the nearest building in the scoped set', () => {
    const p = projectConnectome(map, 9, 8, cam);   // b1's origin
    expect(pickBuilding(buildingsOf(map, 'p1'), map, cam, p.x, p.y)?.id).toBe('b1');
  });
  it('respects the scoped subset (a foreign settlement is not hit)', () => {
    const p = projectConnectome(map, 31, 30, cam); // b2's origin, but scope=p1
    expect(pickBuilding(buildingsOf(map, 'p1'), map, cam, p.x, p.y)).toBeNull();
  });
});
