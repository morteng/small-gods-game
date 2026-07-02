// tests/unit/volcano-identity.test.ts
// The volcano's field-classifiable identity (WCV76): scorching mountain-height
// ground classifies VOLCANIC (never alpine Peak/snow); the scorch mask keeps a
// crater dry through hydrology's pit-fill; `size` grows the summit via
// summitSizeBoost; settlement `cap` easing carves a livable pocket out of a
// noise mountain without touching low ground.
import { describe, it, expect } from 'vitest';
import { classifyBiome, Biome, MOUNTAIN_HEIGHT_M } from '@/terrain/biomes';
import { generateHydrology, buildVolcanoScorchMask } from '@/terrain/hydrology';
import { applyPoiInfluences, POI_INFLUENCES } from '@/terrain/poi-influence';
import type { TerrainField, TerrainConfig, POI } from '@/core/types';

const SEA = 0.35;
const RELIEF = 55;

describe('volcanic biome classification', () => {
  it('claims scorching mountain-height ground before the alpine branch', () => {
    const hM = MOUNTAIN_HEIGHT_M + 8; // above the peak line too (24 m)
    expect(classifyBiome(0.9, 0.1, 0.9, SEA, hM, 0)).toBe(Biome.Volcanic);
  });

  it('leaves cold high ground alpine and hot low ground desert', () => {
    expect(classifyBiome(0.9, 0.1, 0.2, SEA, 30, 0)).toBe(Biome.Peak);
    expect(classifyBiome(0.5, 0.1, 0.9, SEA, 10, 0)).toBe(Biome.Desert);
  });
});

describe('volcano scorch mask + hydrology dry-out', () => {
  const W = 64, H = 64;
  const volcano: POI = { id: 'v', type: 'volcano', position: { x: 32, y: 32 }, size: 'medium' };

  /** A cone with a closed summit crater bowl — guaranteed pit-fill pond bait. */
  function craterField(): TerrainField {
    const elevation = new Float32Array(W * H).fill(0.5);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = Math.hypot(x - 32, y - 32);
        if (d < 10) elevation[y * W + x] = 0.85 - Math.max(0, (3 - d)) * 0.05; // rim 0.85, bowl dips to 0.70
      }
    }
    return { elevation, moisture: new Float32Array(W * H), temperature: new Float32Array(W * H) };
  }

  it('masks the hot summit and dries the crater pond', () => {
    const fields = craterField();
    const mask = buildVolcanoScorchMask([volcano], W, H, fields.elevation, SEA, RELIEF);
    expect(mask).not.toBeNull();
    expect(mask![32 * W + 32]).toBe(1);       // crater floor scorched
    expect(mask![5 * W + 5]).toBe(0);         // far lowland untouched

    const cfg: TerrainConfig = { seed: 7, width: W, height: H, seaLevel: SEA };
    const wet = generateHydrology(fields, cfg);
    const dry = generateHydrology(fields, cfg, { scorchMask: mask });
    const lakeCells = (hy: { waterType: Uint8Array }): number => {
      let n = 0;
      for (let y = 25; y < 40; y++) for (let x = 25; x < 40; x++) if (hy.waterType[y * W + x] === 2) n++;
      return n;
    };
    expect(lakeCells(wet)).toBeGreaterThan(0); // without the mask the bowl ponds
    expect(lakeCells(dry)).toBe(0);            // with it the crater stays dry ash
  });

  it('returns null with no volcano (zero-cost for volcano-less worlds)', () => {
    expect(buildVolcanoScorchMask([], W, H, new Float32Array(W * H), SEA, RELIEF)).toBeNull();
  });
});

describe('summit size boost + settlement cap easing', () => {
  const W = 96, H = 96;

  function run(pois: POI[], base: number): Float32Array {
    const fields: TerrainField = {
      elevation: new Float32Array(W * H).fill(base),
      moisture: new Float32Array(W * H).fill(0.5),
      temperature: new Float32Array(W * H).fill(0.5),
    };
    applyPoiInfluences(fields, pois, { seed: 42, width: W, height: H, seaLevel: SEA, reliefM: RELIEF });
    return fields.elevation;
  }

  it('a huge volcano rises above a medium one (size grows the summit)', () => {
    const medium = run([{ id: 'v', type: 'volcano', position: { x: 48, y: 48 }, size: 'medium' }], 0.45);
    const huge = run([{ id: 'v', type: 'volcano', position: { x: 48, y: 48 }, size: 'huge' }], 0.45);
    const apex = (e: Float32Array): number => Math.max(...e);
    expect(POI_INFLUENCES.volcano.elevation!.summitSizeBoost).toBeGreaterThan(0);
    expect(apex(huge)).toBeGreaterThan(apex(medium) + 0.04);
  });

  it('summitM overrides the type height outright', () => {
    const short = run([{ id: 'v', type: 'volcano', position: { x: 48, y: 48 }, summitM: 10 }], 0.45);
    // apex ≈ sea + 10/relief minus the crater dip; well under the default 0.80
    expect(Math.max(...short)).toBeLessThan(0.60);
  });

  it('village cap flattens a mountain pocket but never touches low ground', () => {
    const village: POI = { id: 't', type: 'village', position: { x: 48, y: 48 } };
    const highBefore = 0.85;                    // a noise mountain under the town
    const capped = run([village], highBefore);
    const cap = POI_INFLUENCES.village.elevation!.cap!;
    expect(capped[48 * W + 48]).toBeLessThan(cap + 0.02);   // centre eased to livable
    expect(capped[5 * W + 5]).toBeCloseTo(highBefore, 5);   // far terrain untouched

    const low = run([village], 0.5);
    expect(low[48 * W + 48]).toBeCloseTo(0.5, 5);           // low ground byte-identical
  });
});
