// tests/unit/render-trees-slice2.test.ts — Slice 2: trees as class:'plant'
// blueprints that compose into standalone-prim sprites and render foot-anchored
// through the generative pipeline (not the flat billboard) when warm.
import { describe, it, expect, beforeAll } from 'vitest';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { synthesizeBlueprint, isPlantPreset, getBlueprintPreset, plantPresetNames } from '@/blueprint/presets';
import { blueprintEntity } from '@/blueprint/entity';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { plantSpriteItemFromPack } from '@/render/iso/iso-sprites';
import { ParametricPlantSource } from '@/render/parametric-plant-source';
import { FLORA_VARIANTS } from '@/render/flora-variant';
import type { SpritePack } from '@/render/iso/sprite-canvas';

beforeAll(() => ensureBuildingTypesRegistered());

// Surviving hand-authored branching presets (blob trees were retired). Worldgen
// prefers the botanically-derived flora-DB species; these mirror the same path.
const TREE_KINDS = ['oak_branched', 'pine_branched', 'willow_tree'];

describe('flora presets (class:plant)', () => {
  it('every flora kind resolves as a 1×1 plant preset', () => {
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

  it('compiles to a standalone flora prim (limbs + leaves) — no building prim', () => {
    for (const k of TREE_KINDS) {
      const g = toGeometry(synthesizeBlueprint(k)!);
      expect(g.parts.some(p => p.prim === 'building'), k).toBe(false);
      const flora = g.parts.filter(p => p.prim === 'flora') as Array<{ limbs?: unknown[]; leaves?: unknown[] }>;
      expect(flora.length, k).toBeGreaterThanOrEqual(1);     // branching skeleton
      expect(flora[0].limbs!.length, k).toBeGreaterThanOrEqual(1);
    }
    // A conifer (spacecol) and a broadleaf (proctree) both produce a flora prim.
    expect(toGeometry(synthesizeBlueprint('pine_branched')!).parts.some(p => p.prim === 'flora')).toBe(true);
  });

  it('a plant blueprint entity gets category vegetation (renderer + nature-height keep working)', () => {
    const e = blueprintEntity('t1', synthesizeBlueprint('oak_branched')!, 5, 6);
    expect(e.kind).toBe('oak_branched');
    expect(e.properties?.category).toBe('vegetation');
    expect(e.tags).toContain('vegetation');
  });
});

describe('ParametricPlantSource (species-keyed)', () => {
  const fakePack = (): SpritePack => ({ albedo: { width: 40, height: 90 } as unknown as HTMLCanvasElement });

  it('peek misses before warm, hits after; one compose per (species, variant)', async () => {
    let composes = 0;
    let resolve!: () => void;
    const gate = new Promise<void>(r => { resolve = r; });
    const src = new ParametricPlantSource({
      compose: async () => { composes++; await gate; return {} as never; },
      toSprite: () => fakePack(),
    });
    expect(src.peek('oak_branched')).toBeNull();
    src.warm('oak_branched');
    src.warm('oak_branched'); // de-duped per (kind, variant) while inflight
    resolve();
    await new Promise(r => setTimeout(r, 0));
    expect(src.peek('oak_branched')).not.toBeNull();         // variant 0
    expect(src.peek('oak_branched', FLORA_VARIANTS - 1)).not.toBeNull(); // last variant
    // warm() bakes every variant once — de-dup keeps a repeat warm from doubling it.
    expect(composes).toBe(FLORA_VARIANTS);
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

  it('prewarmAll resolves only once every species pack is cached (no placeholder flash)', async () => {
    const species = plantPresetNames();
    expect(species.length).toBeGreaterThan(0);
    let composes = 0;
    const src = new ParametricPlantSource({
      compose: async () => { composes++; await new Promise(r => setTimeout(r, 0)); return {} as never; },
      toSprite: () => fakePack(),
    });
    await src.prewarmAll();
    // Every species peeks hot the instant prewarm resolves — frame 1 never falls back.
    for (const k of species) expect(src.peek(k)).not.toBeNull();
    expect(composes).toBe(species.length);
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
