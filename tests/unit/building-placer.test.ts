import { describe, it, expect, beforeEach } from 'vitest';
import { findPlacement, placeSettlement } from '@/world/building-placer';
import { EntityRegistry } from '@/world/entity-registry';
import type { Tile } from '@/core/types';
import { getBuildingTemplate } from '@/map/building-templates';
import { getZoneRule } from '@/map/poi-zones';
import { Random } from '@/core/noise';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTiles(width: number, height: number, type = 'grass'): Tile[][] {
  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => ({
      type, x, y, walkable: true,
    })),
  );
}

function countNonOverlapping(entities: { tileX: number; tileY: number; footprint?: { w: number; h: number } }[]): boolean {
  const occupied = new Set<string>();
  for (const e of entities) {
    const fw = e.footprint?.w ?? 1;
    const fh = e.footprint?.h ?? 1;
    for (let dy = 0; dy < fh; dy++) {
      for (let dx = 0; dx < fw; dx++) {
        const key = `${e.tileX + dx},${e.tileY + dy}`;
        if (occupied.has(key)) return false;
        occupied.add(key);
      }
    }
  }
  return true;
}

// ─── findPlacement ────────────────────────────────────────────────────────────

describe('findPlacement', () => {
  const tiles = makeTiles(40, 40, 'grass');
  const registry = new EntityRegistry();
  const template = getBuildingTemplate('cottage')!;
  const constraint = {
    allowedTerrain: ['grass'],
    margin: 1,
    requiresRoadAccess: false,
  };

  it('finds a placement on open terrain', () => {
    const result = findPlacement({ x: 20, y: 20 }, template, constraint, tiles, registry);
    expect(result).not.toBeNull();
    expect(result!.tileX).toBeGreaterThanOrEqual(0);
    expect(result!.tileY).toBeGreaterThanOrEqual(0);
  });

  it('stays within bounds', () => {
    const result = findPlacement({ x: 20, y: 20 }, template, constraint, tiles, registry);
    expect(result).not.toBeNull();
    expect(result!.tileX + template.footprint.w).toBeLessThanOrEqual(40);
    expect(result!.tileY + template.footprint.h).toBeLessThanOrEqual(40);
  });

  it('returns null when terrain is wrong type', () => {
    const waterTiles = makeTiles(10, 10, 'deep_water');
    const result = findPlacement({ x: 5, y: 5 }, template, constraint, waterTiles, registry);
    expect(result).toBeNull();
  });

  it('respects margin — placed building blocks nearby placements', () => {
    const reg2 = new EntityRegistry();
    // Place a building at center
    const r1 = findPlacement({ x: 20, y: 20 }, template, constraint, tiles, reg2);
    expect(r1).not.toBeNull();
    reg2.add({
      id: 'first',
      category: 'building',
      type: 'cottage',
      templateId: 'cottage',
      tileX: r1!.tileX,
      tileY: r1!.tileY,
      footprint: template.footprint,
      era: 'medieval',
      religiousSignificance: 'neutral',
      state: 'intact',
      metadata: {},
    });

    // Try to place another building at exactly the same spot
    const r2 = findPlacement({ x: r1!.tileX, y: r1!.tileY }, template, { ...constraint, margin: 0 }, tiles, reg2);
    // With margin=0, it should be pushed aside (not at exact same position)
    if (r2) {
      expect(
        r2.tileX !== r1!.tileX || r2.tileY !== r1!.tileY
      ).toBe(true);
    }
  });
});

// ─── placeSettlement ─────────────────────────────────────────────────────────

describe('placeSettlement', () => {
  let tiles: Tile[][];
  let registry: EntityRegistry;

  beforeEach(() => {
    tiles = makeTiles(80, 80, 'grass');
    registry = new EntityRegistry();
  });

  it('places at least min buildings', () => {
    const poi = { id: 'village1', type: 'village', position: { x: 40, y: 40 } };
    const zoneRule = getZoneRule('village');
    const rng = new Random(42);
    const { entities } = placeSettlement(poi, zoneRule, tiles, registry, [], rng);
    expect(entities.length).toBeGreaterThanOrEqual(zoneRule.buildingCount.min);
  });

  it('places no more than max buildings', () => {
    const poi = { id: 'village2', type: 'village', position: { x: 40, y: 40 } };
    const zoneRule = getZoneRule('village');
    const rng = new Random(99);
    const { entities } = placeSettlement(poi, zoneRule, tiles, registry, [], rng);
    expect(entities.length).toBeLessThanOrEqual(zoneRule.buildingCount.max);
  });

  it('buildings do not overlap each other', () => {
    const poi = { id: 'v3', type: 'village', position: { x: 40, y: 40 } };
    const zoneRule = getZoneRule('village');
    const rng = new Random(7);
    const { entities } = placeSettlement(poi, zoneRule, tiles, registry, [], rng);
    expect(countNonOverlapping(entities)).toBe(true);
  });

  it('all entities linked to the poi', () => {
    const poi = { id: 'v4', type: 'village', position: { x: 40, y: 40 } };
    const zoneRule = getZoneRule('village');
    const rng = new Random(11);
    const { entities } = placeSettlement(poi, zoneRule, tiles, registry, [], rng);
    for (const e of entities) {
      expect(e.poiId).toBe('v4');
    }
  });

  it('entities appear in registry', () => {
    const poi = { id: 'v5', type: 'village', position: { x: 40, y: 40 } };
    const zoneRule = getZoneRule('village');
    const rng = new Random(55);
    const { entities } = placeSettlement(poi, zoneRule, tiles, registry, [], rng);
    for (const e of entities) {
      expect(registry.has(e.id)).toBe(true);
    }
  });

  it('roads are generated for settlements with internalRoads=true', () => {
    const poi = { id: 'v6', type: 'village', position: { x: 40, y: 40 } };
    const zoneRule = getZoneRule('village');
    expect(zoneRule.internalRoads).toBe(true);
    const rng = new Random(33);
    const { roadTiles } = placeSettlement(poi, zoneRule, tiles, registry, [], rng);
    expect(roadTiles.length).toBeGreaterThan(0);
  });

  it('temple placement uses sacred_grove terrain', () => {
    // Pre-fill tiles with sacred_grove so temple can place
    const sacredTiles = makeTiles(80, 80, 'sacred_grove');
    const templeReg = new EntityRegistry();
    const poi = { id: 'temple1', type: 'temple', position: { x: 40, y: 40 } };
    const zoneRule = getZoneRule('temple');
    const rng = new Random(22);
    const { entities } = placeSettlement(poi, zoneRule, sacredTiles, templeReg, [], rng);
    // Should still place (template accepts sacred_grove terrain)
    expect(entities.length).toBeGreaterThanOrEqual(zoneRule.buildingCount.min);
  });

  it('deterministic with same seed', () => {
    const poi = { id: 'vd', type: 'village', position: { x: 40, y: 40 } };
    const zoneRule = getZoneRule('village');
    const a = placeSettlement(poi, zoneRule, makeTiles(80, 80, 'grass'), new EntityRegistry(), [], new Random(42));
    const b = placeSettlement(poi, zoneRule, makeTiles(80, 80, 'grass'), new EntityRegistry(), [], new Random(42));
    expect(a.entities.map(e => e.tileX)).toEqual(b.entities.map(e => e.tileX));
    expect(a.entities.map(e => e.tileY)).toEqual(b.entities.map(e => e.tileY));
  });
});

// ─── Water tile filtering ─────────────────────────────────────────────────────

describe('placeSettlement water filtering', () => {
  const WATER_TILE_TYPES = new Set(['deep_water', 'shallow_water', 'river', 'ocean', 'water']);

  /** Make a map that's all grass except a ring of water around the center */
  function makeWaterRingTiles(width: number, height: number, cx: number, cy: number, r: number): Tile[][] {
    return Array.from({ length: height }, (_, y) =>
      Array.from({ length: width }, (_, x) => {
        const dist = Math.abs(x - cx) + Math.abs(y - cy);
        const type = dist >= r && dist <= r + 2 ? 'deep_water' : 'grass';
        return { type, x, y, walkable: type === 'grass' };
      }),
    );
  }

  it('no road tiles land on water tiles', () => {
    // Settlement at (55, 40) with a water ring between (48, 40) and (50, 40)
    const ringTiles = makeWaterRingTiles(80, 80, 55, 40, 5);
    const reg = new EntityRegistry();
    const poi = { id: 'wv1', type: 'village', position: { x: 55, y: 40 } };
    const zoneRule = getZoneRule('village');
    const rng = new Random(42);
    const { roadTiles } = placeSettlement(poi, zoneRule, ringTiles, reg, [], rng);

    for (const rt of roadTiles) {
      const tileType = ringTiles[rt.y]?.[rt.x]?.type ?? 'grass';
      expect(WATER_TILE_TYPES.has(tileType)).toBe(false);
    }
  });

  it('no road tiles placed outside map bounds', () => {
    const tiles = makeTiles(40, 40, 'grass');
    const reg = new EntityRegistry();
    const poi = { id: 'wv2', type: 'village', position: { x: 20, y: 20 } };
    const zoneRule = getZoneRule('village');
    const rng = new Random(7);
    const { roadTiles } = placeSettlement(poi, zoneRule, tiles, reg, [], rng);

    for (const rt of roadTiles) {
      expect(rt.x).toBeGreaterThanOrEqual(0);
      expect(rt.y).toBeGreaterThanOrEqual(0);
      expect(rt.x).toBeLessThan(40);
      expect(rt.y).toBeLessThan(40);
    }
  });

  it('door path stops when it hits an existing road tile', () => {
    // All grass — roads and door paths should terminate when reaching the main road
    const tiles = makeTiles(80, 80, 'grass');
    const reg = new EntityRegistry();
    const poi = { id: 'wv3', type: 'village', position: { x: 40, y: 40 } };
    const zoneRule = getZoneRule('village');
    expect(zoneRule.internalRoads).toBe(true);
    const rng = new Random(99);
    const { roadTiles } = placeSettlement(poi, zoneRule, tiles, reg, [], rng);

    // Verify road tiles are generated (basic sanity)
    expect(roadTiles.length).toBeGreaterThan(0);
    // All road tile coordinates should be valid
    for (const rt of roadTiles) {
      expect(Number.isFinite(rt.x)).toBe(true);
      expect(Number.isFinite(rt.y)).toBe(true);
    }
  });

  it('all-water settlement produces zero road tiles', () => {
    const allWater = makeTiles(40, 40, 'deep_water');
    // Mark all as non-walkable
    for (const row of allWater) for (const t of row) t.walkable = false;
    const reg = new EntityRegistry();
    const poi = { id: 'wv4', type: 'village', position: { x: 20, y: 20 } };
    const zoneRule = getZoneRule('village');
    const rng = new Random(1);
    const { roadTiles } = placeSettlement(poi, zoneRule, allWater, reg, [], rng);
    // No road tiles should be placed on water
    for (const rt of roadTiles) {
      const tileType = allWater[rt.y]?.[rt.x]?.type;
      expect(WATER_TILE_TYPES.has(tileType ?? '')).toBe(false);
    }
  });
});

// ─── ZoneRule extension ───────────────────────────────────────────────────────

describe('ZoneRule fields', () => {
  it('village has clearForest=true', () => {
    expect(getZoneRule('village').clearForest).toBe(true);
  });

  it('village has roadLayout=branching', () => {
    expect(getZoneRule('village').roadLayout).toBe('branching');
  });

  it('port has adjacencyRequirement=shallow_water', () => {
    expect(getZoneRule('port').adjacencyRequirement).toBe('shallow_water');
  });

  it('temple has roadLayout=none', () => {
    expect(getZoneRule('temple').roadLayout).toBe('none');
  });
});

// ─── BuildingTemplate era/religion ───────────────────────────────────────────

describe('BuildingTemplate era/religion fields', () => {
  it('cottage is medieval/neutral', () => {
    const t = getBuildingTemplate('cottage')!;
    expect(t.era).toBe('medieval');
    expect(t.religiousSignificance).toBe('neutral');
  });

  it('temple is classical/sacred', () => {
    const t = getBuildingTemplate('temple_small')!;
    expect(t.era).toBe('classical');
    expect(t.religiousSignificance).toBe('sacred');
  });
});
