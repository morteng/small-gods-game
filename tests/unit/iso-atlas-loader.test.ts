import { describe, it, expect, vi } from 'vitest';
import { loadIsoTerrainAtlas, ISO_TERRAIN_TYPES, ATLAS_SHEET_PATH, type ImageLoader } from '@/render/iso/iso-atlas-loader';

function makeFakeImage(width = 768, height = 384): HTMLImageElement {
  const img = { width, height } as unknown as HTMLImageElement;
  return img;
}

describe('loadIsoTerrainAtlas', () => {
  it('returns a valid IsoAtlas with sprite slices for every terrain type when all sheets load', async () => {
    const loadImage = vi.fn(async (url: string): Promise<HTMLImageElement | null> => {
      if (typeof url !== 'string') return null;
      return makeFakeImage();
    });
    const atlas = await loadIsoTerrainAtlas({ loadImage });
    expect(loadImage).toHaveBeenCalledTimes(ISO_TERRAIN_TYPES.length);
    for (const type of ISO_TERRAIN_TYPES) {
      const sprite = atlas.getTerrain(type, 0);
      expect(sprite).not.toBeNull();
      expect(sprite!.sw).toBe(128);
      expect(sprite!.sh).toBe(64);
    }
    // Variant 6: col 0, row 1 → sx=0, sy=64
    const s = atlas.getTerrain('grass', 6);
    expect(s!.sx).toBe(0);
    expect(s!.sy).toBe(64);
  });
});
