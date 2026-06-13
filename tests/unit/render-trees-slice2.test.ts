// tests/unit/render-trees-slice2.test.ts — Slice 2: trees as class:'plant'
// blueprints that compose into standalone-prim sprites and render foot-anchored
// through the generative pipeline (not the flat billboard) when warm.
import { describe, it, expect, beforeAll } from 'vitest';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { synthesizeBlueprint, isPlantPreset, getBlueprintPreset } from '@/blueprint/presets';
import { blueprintEntity } from '@/blueprint/entity';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { plantSpriteItemFromPack } from '@/render/iso/iso-sprites';
import { ParametricPlantSource } from '@/render/parametric-plant-source';
import type { SpritePack } from '@/render/iso/sprite-canvas';

beforeAll(() => ensureBuildingTypesRegistered());

const TREE_KINDS = ['oak_tree', 'pine_tree', 'birch_tree', 'dead_tree', 'orange_tree', 'pale_tree', 'brown_tree'];

describe('tree presets (class:plant)', () => {
  it('every tree kind resolves as a 1×1 plant preset', () => {
    for (const k of TREE_KINDS) {
      expect(isPlantPreset(k), k).toBe(true);
      const b = getBlueprintPreset(k)!;
      expect(b.class).toBe('plant');
      expect(b.footprint).toEqual({ w: 1, h: 1 });
      const rb = synthesizeBlueprint(k);
      expect(rb, k).toBeDefined();
      expect(rb!.class).toBe('plant');
    }
  });

  it('a building/prop kind is NOT a plant preset', () => {
    expect(isPlantPreset('cottage')).toBe(false);
    expect(isPlantPreset('well')).toBe(false);
    expect(isPlantPreset('nope')).toBe(false);
  });

  it('compiles to standalone prims — no building prim; foliage crown + bark trunk', () => {
    const matOf = (p: unknown): string | undefined => (p as { material?: string }).material;
    const oak = toGeometry(synthesizeBlueprint('oak_tree')!);
    expect(oak.parts.some(p => p.prim === 'building')).toBe(false);
    const oakCyl = oak.parts.filter(p => p.prim === 'cylinder');
    const oakFol = oak.parts.filter(p => p.prim === 'ellipsoid');
    expect(oakCyl.length).toBeGreaterThanOrEqual(1);            // bark trunk
    expect(oakFol.length).toBeGreaterThanOrEqual(3);            // rounded crown lobes
    expect(oakFol.every(p => matOf(p) === 'foliage')).toBe(true);
    expect(matOf(oakCyl[0])).toBe('bark');

    // conifer = cones, slender = one ellipsoid, bare = no foliage
    const pine = toGeometry(synthesizeBlueprint('pine_tree')!);
    expect(pine.parts.some(p => p.prim === 'cone')).toBe(true);
    const birch = toGeometry(synthesizeBlueprint('birch_tree')!);
    expect(birch.parts.filter(p => p.prim === 'ellipsoid').length).toBe(1);
    const dead = toGeometry(synthesizeBlueprint('dead_tree')!);
    expect(dead.parts.every(p => matOf(p) !== 'foliage')).toBe(true);
    expect(dead.parts.some(p => p.prim === 'ellipsoid' || p.prim === 'cone')).toBe(false);
  });

  it('a plant blueprint entity gets category vegetation (renderer + nature-height keep working)', () => {
    const e = blueprintEntity('t1', synthesizeBlueprint('oak_tree')!, 5, 6);
    expect(e.kind).toBe('oak_tree');
    expect(e.properties?.category).toBe('vegetation');
    expect(e.tags).toContain('vegetation');
  });
});

describe('ParametricPlantSource (species-keyed)', () => {
  const fakePack = (): SpritePack => ({ albedo: { width: 40, height: 90 } as unknown as HTMLCanvasElement });

  it('peek misses before warm, hits after; one compose per species', async () => {
    let composes = 0;
    let resolve!: () => void;
    const gate = new Promise<void>(r => { resolve = r; });
    const src = new ParametricPlantSource({
      compose: async () => { composes++; await gate; return {} as never; },
      toSprite: () => fakePack(),
    });
    expect(src.peek('oak_tree')).toBeNull();
    src.warm('oak_tree');
    src.warm('oak_tree'); // de-duped while inflight
    resolve();
    await new Promise(r => setTimeout(r, 0));
    expect(src.peek('oak_tree')).not.toBeNull();
    expect(composes).toBe(1);
  });

  it('a non-plant kind caches null and never composes', async () => {
    let composes = 0;
    const src = new ParametricPlantSource({
      compose: async () => { composes++; return {} as never; },
      toSprite: () => fakePack(),
    });
    src.warm('cottage');
    await new Promise(r => setTimeout(r, 0));
    expect(src.peek('cottage')).toBeNull();
    expect(composes).toBe(0);
  });
});

describe('plantSpriteItemFromPack', () => {
  it('anchors bottom-centre at the tile and carries maps when present', () => {
    const pack: SpritePack = {
      albedo: { width: 40, height: 90 } as unknown as HTMLCanvasElement,
      normal: { width: 40, height: 90 } as unknown as HTMLCanvasElement,
      material: { width: 40, height: 90 } as unknown as HTMLCanvasElement,
    };
    const item = plantSpriteItemFromPack({ originX: 0, originY: 0 }, pack, 3, 3);
    expect(item.t).toBe('image');
    if (item.t === 'image') {
      expect(item.dw).toBe(40);
      expect(item.dh).toBe(90);
      expect(item.maps?.normal).toBe(pack.normal);
      expect(item.maps?.material).toBe(pack.material);
    }
  });

  it('omits maps for an albedo-only pack', () => {
    const pack: SpritePack = { albedo: { width: 20, height: 30 } as unknown as HTMLCanvasElement };
    const item = plantSpriteItemFromPack({ originX: 0, originY: 0 }, pack, 0, 0);
    if (item.t === 'image') expect(item.maps).toBeUndefined();
  });
});
