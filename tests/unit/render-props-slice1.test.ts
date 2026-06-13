// tests/unit/render-props-slice1.test.ts — render epic Slice 1: wells & graveyards
// become geometry-backed blueprint entities (class:'prop') that flow through the
// SAME generate→sprite pipeline as buildings, instead of invisible bare props.
import { describe, it, expect, beforeAll } from 'vitest';
import { World } from '@/world/world';
import { placeSettlement } from '@/world/building-placer';
import { recordBurial } from '@/world/civic';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { blueprintEntity, blueprintOf } from '@/blueprint/entity';
import { getZoneRule } from '@/map/poi-zones';
import { Random } from '@/core/noise';
import type { GameMap, Tile, POI, Entity } from '@/core/types';

beforeAll(() => ensureBuildingTypesRegistered());

const CENTER = { x: 24, y: 24 };
const POI_ID = 'v1';

function grassTiles(w = 48, h = 48): Tile[][] {
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) =>
      ({ x, y, type: 'grass', walkable: true, state: 'realized' }) as unknown as Tile));
}

function villageWorld(seed = 11) {
  const tiles = grassTiles();
  const poi: POI = { id: POI_ID, type: 'village', name: 'T', position: CENTER } as unknown as POI;
  const map: GameMap = {
    tiles, width: 48, height: 48, villages: [], seed: 1, success: true,
    worldSeed: { pois: [poi] } as unknown as GameMap['worldSeed'],
    stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as GameMap;
  const world = new World(map);
  const rule = { ...getZoneRule('village'), radius: { min: 10, max: 10 }, buildingCount: { min: 2, max: 2 } };
  const result = placeSettlement(
    poi, rule, tiles, world.registry, [{ dx: 1, dy: 0 }],
    new Random(seed), 'medieval', world, 42,
  );
  for (const e of result.entities) world.indexExisting(e);
  return { world, plan: result.plan, entities: result.entities };
}

const findKind = (es: Entity[], kind: string) => es.find(e => e.kind === kind);

describe('Slice 1 — civic prop blueprints', () => {
  it('well & graveyard presets resolve as class:prop', () => {
    const well = synthesizeBlueprint('well');
    const yard = synthesizeBlueprint('graveyard');
    expect(well?.class).toBe('prop');
    expect(yard?.class).toBe('prop');
    expect(well?.footprint).toEqual({ w: 1, h: 1 });
    expect(yard?.footprint).toEqual({ w: 2, h: 2 });
  });

  it('toGeometry produces standalone prims (no building prim) that compose', () => {
    const wellSpec = toGeometry(synthesizeBlueprint('well')!);
    const yardSpec = toGeometry(synthesizeBlueprint('graveyard')!);
    // like the yurt's round body: only standalone solids, no prim:'building'
    expect(wellSpec.parts.some(p => p.prim === 'building')).toBe(false);
    expect(wellSpec.parts.some(p => p.prim === 'cylinder')).toBe(true);
    expect(wellSpec.parts.length).toBeGreaterThanOrEqual(3);
    // graveyard: a scatter of headstone boxes (default 5 stones)
    expect(yardSpec.parts.every(p => p.prim === 'box')).toBe(true);
    expect(yardSpec.parts.length).toBe(5);
  });

  it('graveyard stone count honours the `stones` Fate param', () => {
    const three = toGeometry(synthesizeBlueprint('graveyard', [{ parts: { yard: { params: { stones: 3 } } } } as never])!);
    expect(three.parts.length).toBe(3);
  });
});

describe('Slice 1 — placer emits civic props as blueprint entities', () => {
  it('well & graveyard are blueprint-backed, kind preserved, category prop, not buildings', () => {
    const { entities } = villageWorld();
    const well = findKind(entities, 'well')!;
    const yard = findKind(entities, 'graveyard')!;
    expect(well).toBeDefined();
    expect(yard).toBeDefined();

    // geometry-backed → the draw-list building branch (blueprintOf) picks them up
    expect(blueprintOf(well)).toBeDefined();
    expect(blueprintOf(yard)).toBeDefined();

    // props, NOT buildings: keep them out of building counts / off the placement blocker
    expect(well.properties?.category).toBe('prop');
    expect(yard.properties?.category).toBe('prop');
    expect(well.tags).not.toContain('building');
    expect(yard.tags).not.toContain('building');
    expect(well.tags).toContain('civic');

    // poiId preserved (recordBurial depends on it)
    expect(well.properties?.poiId).toBe(POI_ID);
    expect(yard.properties?.poiId).toBe(POI_ID);
  });

  it('graveyard is sacred (religious category → sacred significance)', () => {
    const yard = findKind(villageWorld().entities, 'graveyard')!;
    expect(yard.properties?.religiousSignificance).toBe('sacred');
  });

  it('recordBurial still finds the graveyard by kind after it became a blueprint entity', () => {
    const { world } = villageWorld();
    recordBurial(world, POI_ID);
    recordBurial(world, POI_ID);
    const yard = [...world.query({ kind: 'graveyard' })].find(g => g.properties?.poiId === POI_ID)!;
    expect(yard.properties?.buried).toBe(2);
  });
});

describe('Slice 1 — mill regression (building branch unchanged)', () => {
  it('blueprintEntity keeps class:building entities as category building', () => {
    const cottage = blueprintEntity('c1', synthesizeBlueprint('cottage')!, 0, 0);
    expect(cottage.properties?.category).toBe('building');
    expect(cottage.tags).toContain('building');
    const mill = blueprintEntity('m1', synthesizeBlueprint('watermill')!, 0, 0);
    expect(mill.properties?.category).toBe('building');
  });
});
