import { BUILDING_TEMPLATES } from '@/map/building-templates';

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export class AssetManager {
  private tileAtlas: HTMLImageElement | null = null;
  private terrain = new Map<string, HTMLImageElement>();
  private buildings = new Map<string, HTMLImageElement>();
  private trees = new Map<string, HTMLImageElement>();

  async loadAll(): Promise<void> {
    if (!this.tileAtlas) this.tileAtlas = await loadImage('/sprites/tiles/kenney-town.png');
    await this.loadTerrain();
    await this.loadBuildings();
    if (this.trees.size === 0) await this.loadTrees();
  }

  getTileAtlas(): HTMLImageElement | null { return this.tileAtlas; }
  getTerrainSheets(): Map<string, HTMLImageElement> { return this.terrain; }
  getBuildingSprites(): Map<string, HTMLImageElement> { return this.buildings; }
  getTreeSheets(): Map<string, HTMLImageElement> { return this.trees; }

  private async loadTerrain(): Promise<void> {
    const groups = ['grass', 'water', 'dirt', 'sand', 'stone', 'rocky'];
    await Promise.all(groups.map(async (g) => {
      if (!this.terrain.has(g)) {
        const img = await loadImage(`/sprites/terrain/${g}.png`);
        if (img) this.terrain.set(g, img);
      }
    }));
  }

  private async loadBuildings(): Promise<void> {
    await Promise.all(BUILDING_TEMPLATES.map(async (tpl) => {
      if (!this.buildings.has(tpl.id)) {
        const img = await loadImage(`/sprites/buildings/${tpl.id}.png`);
        if (img) this.buildings.set(tpl.id, img);
      }
    }));
  }

  private async loadTrees(): Promise<void> {
    const variants = ['green', 'orange', 'dead', 'pale', 'brown'];
    await Promise.all(variants.map(async (v) => {
      const img = await loadImage(`/sprites/trees/trees-${v}.png`);
      if (img) this.trees.set(v, img);
    }));
  }
}
