import type { IsoAtlas, IsoTerrainSprite } from './iso-atlas';

export const ISO_TERRAIN_TYPES = ['water', 'sand', 'dirt', 'grass', 'stone', 'rocky'] as const;
export type IsoTerrainType = typeof ISO_TERRAIN_TYPES[number];

export const ATLAS_SHEET_PATH = (type: IsoTerrainType): string =>
  `/sprites/iso/terrain/${type}-blob47.png`;

const CELL_W = 128;
const CELL_H = 64;

/** Injectable image loader. Browser default uses new Image(); tests stub this. */
export type ImageLoader = (url: string) => Promise<HTMLImageElement | null>;

const defaultImageLoader: ImageLoader = (url) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });

export interface LoadIsoTerrainAtlasOpts {
  loadImage?: ImageLoader;
  pathFor?: (type: IsoTerrainType) => string;
}

export async function loadIsoTerrainAtlas(
  opts: LoadIsoTerrainAtlasOpts = {},
): Promise<IsoAtlas> {
  const loadImage = opts.loadImage ?? defaultImageLoader;
  const pathFor = opts.pathFor ?? ATLAS_SHEET_PATH;

  const entries = await Promise.all(
    ISO_TERRAIN_TYPES.map(async (type) => {
      const img = await loadImage(pathFor(type));
      if (!img) {
        // eslint-disable-next-line no-console
        console.warn(`[iso-atlas] failed to load ${pathFor(type)}`);
      }
      return [type, img] as const;
    }),
  );

  const sheets = new Map<string, HTMLImageElement>();
  for (const [type, img] of entries) {
    if (img) sheets.set(type, img);
  }

  return {
    getTerrain(terrainType: string, blobVariant: number): IsoTerrainSprite | null {
      const img = sheets.get(terrainType);
      if (!img) return null;
      return {
        img,
        sx: (blobVariant % 6) * CELL_W,
        sy: Math.floor(blobVariant / 6) * CELL_H,
        sw: CELL_W,
        sh: CELL_H,
      };
    },
    getBuilding: () => null,
    getCharacter: () => null,
    getTree: () => null,
  };
}
