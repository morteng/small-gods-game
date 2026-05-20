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

describe('loadIsoTerrainAtlas — fallback', () => {
  function makeFakeImage(): HTMLImageElement {
    return { width: 768, height: 384 } as unknown as HTMLImageElement;
  }

  it('returns null sprites for terrains whose PNG failed to load, others still work', async () => {
    const warnings: string[] = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((msg: string) => {
      warnings.push(msg);
    });
    try {
      const loadImage: ImageLoader = async (url) =>
        url.includes('grass') ? null : makeFakeImage();
      const atlas = await loadIsoTerrainAtlas({ loadImage });
      expect(atlas.getTerrain('grass', 0)).toBeNull();
      expect(atlas.getTerrain('dirt', 0)).not.toBeNull();
      expect(warnings.some((w) => w.includes('grass'))).toBe(true);
      expect(warnings.some((w) => w.includes('dirt'))).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('all 6 PNGs fail to load → atlas where every getTerrain returns null (still valid)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const loadImage: ImageLoader = async () => null;
      const atlas = await loadIsoTerrainAtlas({ loadImage });
      for (const type of ISO_TERRAIN_TYPES) {
        expect(atlas.getTerrain(type, 0)).toBeNull();
      }
      expect(atlas.getBuilding('any')).toBeNull();
      expect(atlas.getCharacter('any')).toBeNull();
      expect(atlas.getTree('any')).toBeNull();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('no warning emitted for successful loads', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const loadImage: ImageLoader = async () => ({ width: 768, height: 384 }) as unknown as HTMLImageElement;
      await loadIsoTerrainAtlas({ loadImage });
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('variant index math: blob 11 → col 5 row 1 → sx=640, sy=64', async () => {
    const loadImage: ImageLoader = async () => ({ width: 768, height: 384 }) as unknown as HTMLImageElement;
    const atlas = await loadIsoTerrainAtlas({ loadImage });
    const s = atlas.getTerrain('water', 11)!;
    expect(s.sx).toBe(640);
    expect(s.sy).toBe(64);
  });
});
