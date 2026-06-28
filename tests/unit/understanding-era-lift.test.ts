// tests/unit/understanding-era-lift.test.ts — the dynamic half of the buildability envelope:
// aggregate believer UNDERSTANDING lifts a settlement's effective era at growth time, so a
// devout people grow grander architecture. Pins the era lift + the per-settlement aggregation,
// and that understanding 0 leaves the era (and thus growth) unchanged.
import { describe, it, expect } from 'vitest';
import { liftEraByUnderstanding, UNDERSTANDING_ERA_STEP, ERAS } from '@/core/era';
import { settlementUnderstanding, initNpcProps } from '@/world/npc-helpers';
import { World } from '@/world/world';
import type { Entity, GameMap, SpiritBelief } from '@/core/types';

function emptyWorld(): World {
  return new World({ tiles: [], width: 8, height: 8, seed: 1, success: true } as unknown as GameMap);
}

function addResident(world: World, id: string, poiId: string, understandings: number[]): Entity {
  const p = initNpcProps(id, 'farmer', id.charCodeAt(0));
  p.homePoiId = poiId;
  const beliefs: Record<string, SpiritBelief> = {};
  understandings.forEach((u, i) => {
    beliefs[`g${i}`] = { faith: 0.3, understanding: u, devotion: 0.2, assertiveness: 0.5 } as SpiritBelief;
  });
  p.beliefs = beliefs;
  const e: Entity = { id, kind: 'npc', x: 1, y: 1, properties: p as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}

describe('liftEraByUnderstanding', () => {
  it('leaves the era unchanged below the step (early game / shallow belief)', () => {
    expect(liftEraByUnderstanding('classical', 0)).toBe('classical');
    expect(liftEraByUnderstanding('classical', UNDERSTANDING_ERA_STEP - 0.01)).toBe('classical');
  });

  it('advances one era once understanding is deep enough', () => {
    expect(liftEraByUnderstanding('classical', UNDERSTANDING_ERA_STEP)).toBe('medieval');
    expect(liftEraByUnderstanding('ancient', 0.9)).toBe('classical');
  });

  it('never overflows past the latest era', () => {
    const last = ERAS[ERAS.length - 1];
    expect(liftEraByUnderstanding(last, 1)).toBe(last);
  });
});

describe('settlementUnderstanding', () => {
  it('is 0 for a settlement with no residents', () => {
    expect(settlementUnderstanding(emptyWorld(), 'town')).toBe(0);
  });

  it("averages each resident's STRONGEST understanding across their gods; excludes outsiders", () => {
    const world = emptyWorld();
    addResident(world, 'a', 'town', [0.8, 0.4]);     // strongest 0.8
    addResident(world, 'b', 'town', [0.2]);          // strongest 0.2
    addResident(world, 'c', 'elsewhere', [0.9]);     // different settlement → excluded
    expect(settlementUnderstanding(world, 'town')).toBeCloseTo(0.5, 6);  // mean(0.8, 0.2)
  });
});
