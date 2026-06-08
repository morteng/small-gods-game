/**
 * End-to-end worldgen placement guard for the default recipe.
 *
 * Verifies that the era-aware presets actually materialize as building entities
 * after a real generateWithNoise call on default.json.  A pure-roster test
 * (like tests/unit/default-world-era.test.ts) cannot catch a bug where the
 * coordinate-based placement logic silently skips a POI (e.g. because it lands
 * on water or outside the map bounds).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { generateWithNoise } from '@/map/map-generator';
import type { WorldSeed } from '@/core/types';
import { blueprintOf } from '@/blueprint/entity';

const seed = JSON.parse(
  readFileSync('public/data/worlds/default.json', 'utf-8'),
) as WorldSeed;

describe('default world generation — end-to-end placement', () => {
  it('places yurt, guard_post, and shrine entities from the era-aware POI recipes', async () => {
    const { world } = await generateWithNoise(
      seed.size.width,
      seed.size.height,
      12345,
      seed,
      { onProgress() {} },
    );

    // Collect every preset from every building entity in the world.
    const buildings = world.query({ tag: 'building' });
    const placedPresets = new Set(
      buildings
        .map(e => blueprintOf(e)?.rb.preset)
        .filter((p): p is string => p !== undefined),
    );

    // These three presets are ONLY produced by the new era-flagged POIs in the
    // default recipe:
    //   • 'yurt'       — hollow_camp (primordial village)
    //   • 'guard_post' — ironvein_mine (mine)
    //   • 'shrine'     — forest_ruins / swamp_shrine (ancient ruins)
    // Their presence proves the full pipeline ran for those POIs:
    // coordinate lookup → placeSettlement → era resolution → recipe → entity.
    expect(placedPresets, 'yurt must be placed (hollow_camp primordial village)').toContain('yurt');
    expect(placedPresets, 'guard_post must be placed (ironvein_mine)').toContain('guard_post');
    expect(placedPresets, 'shrine must be placed (ancient ruins POI)').toContain('shrine');
  }, 30_000);
});
