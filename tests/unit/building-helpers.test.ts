import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { buildingEntity } from '@/world/building-descriptor';
import { synthesizeFromPreset } from '@/world/building-presets';
import { findBuildingAtTile, buildingInfoOf } from '@/world/building-helpers';
import type { BuildingDescriptor } from '@/world/building-descriptor';
import type { GameMap } from '@/core/types';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

function cottageDesc(): BuildingDescriptor {
  return synthesizeFromPreset('cottage')!;
}

describe('findBuildingAtTile', () => {
  it('finds a building covering any cell of its footprint, null elsewhere', () => {
    const world = new World(emptyMap());
    const d = cottageDesc(); // 3x3 footprint
    world.addEntity(buildingEntity('b1', d, 5, 5));

    // Every covered cell resolves to the building.
    expect(findBuildingAtTile(world, 5, 5)?.id).toBe('b1'); // top-left
    expect(findBuildingAtTile(world, 7, 7)?.id).toBe('b1'); // bottom-right corner (5+3-1)
    expect(findBuildingAtTile(world, 6, 6)?.id).toBe('b1'); // interior

    // Just outside the footprint → nothing.
    expect(findBuildingAtTile(world, 8, 5)).toBeNull();
    expect(findBuildingAtTile(world, 5, 8)).toBeNull();
    expect(findBuildingAtTile(world, 0, 0)).toBeNull();
  });
});

describe('buildingInfoOf', () => {
  it('derives a title, description and facts from a building entity', () => {
    const world = new World(emptyMap());
    const d = cottageDesc();
    world.addEntity(buildingEntity('b1', d, 5, 5));
    const info = buildingInfoOf(findBuildingAtTile(world, 5, 5)!)!;

    expect(info.title.toLowerCase()).toContain('cottage');
    expect(info.description.toLowerCase()).toContain('cottage');
    expect(info.footprint).toEqual(d.footprint);
    expect(['n', 'e', 's', 'w']).toContain(info.doorFace);
    // Facts surface the structured data the modal renders.
    expect(info.facts.some((f) => /size/i.test(f.label))).toBe(true);
  });

  it('is stable for a fixed entity id (seeded detail trait does not flap)', () => {
    const world = new World(emptyMap());
    const d = cottageDesc();
    world.addEntity(buildingEntity('b1', d, 5, 5));
    const e = findBuildingAtTile(world, 5, 5)!;
    expect(buildingInfoOf(e)).toEqual(buildingInfoOf(e));
  });

  it('returns null for a non-building entity', () => {
    expect(buildingInfoOf({ id: 'x', kind: 'npc', x: 0, y: 0, tags: [], properties: {} })).toBeNull();
  });
});
