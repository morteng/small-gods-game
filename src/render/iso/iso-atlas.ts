export interface IsoTerrainSprite {
  img: HTMLImageElement;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface IsoSpriteSheet {
  img: HTMLImageElement;
  frameW: number;
  frameH: number;
}

export interface IsoAtlas {
  getTerrain(terrainType: string, blobVariant: number): IsoTerrainSprite | null;
  getBuilding(templateId: string): IsoTerrainSprite | null;
  getCharacter(characterClass: string): IsoSpriteSheet | null;
  getTree(variant: string): IsoTerrainSprite | null;
}

export function createNullAtlas(): IsoAtlas {
  return {
    getTerrain: () => null,
    getBuilding: () => null,
    getCharacter: () => null,
    getTree: () => null,
  };
}
