import { describe, it, expect } from 'vitest';
import {
  isLayerHidden, isEntityHidden, entityLayer, layerFlag, RENDER_LAYERS,
  tileRenderLayer, effectiveTileType, HIDDEN_TILE_FALLBACK,
} from '@/render/layer-visibility';
import type { DevModeState, Entity } from '@/core/types';

function entity(kind: string): Entity {
  return { id: `${kind}-1`, kind, x: 1, y: 1 };
}

describe('isLayerHidden', () => {
  it('defaults to shown when devMode is undefined', () => {
    for (const layer of RENDER_LAYERS) {
      expect(isLayerHidden(layer, undefined)).toBe(false);
    }
  });

  it('defaults to shown when the flag is undefined', () => {
    const dm = {} as DevModeState;
    for (const layer of RENDER_LAYERS) {
      expect(isLayerHidden(layer, dm)).toBe(false);
    }
  });

  it('hides a layer only when its flag is explicitly false', () => {
    const dm = { showNpcs: false, showBuildings: true } as DevModeState;
    expect(isLayerHidden('npcs', dm)).toBe(true);
    expect(isLayerHidden('buildings', dm)).toBe(false);
    expect(isLayerHidden('terrain', dm)).toBe(false);
  });
});

describe('entityLayer', () => {
  it('maps each entity to its render layer', () => {
    expect(entityLayer(entity('npc'))).toBe('npcs');
    expect(entityLayer(entity('remains'))).toBe('remains');
    expect(entityLayer(entity('cottage'))).toBe('buildings');
    expect(entityLayer(entity('english-oak'))).toBe('vegetation');
    expect(entityLayer(entity('well'))).toBe('props');
    // Rocks are vegetation-category so the render graph draws them (WCV76 rock fix).
    expect(entityLayer(entity('boulder'))).toBe('vegetation');
    expect(entityLayer(entity('driftwood'))).toBe('terrainFeatures');
  });

  it('routes unknown kinds to props', () => {
    expect(entityLayer(entity('mystery_thing'))).toBe('props');
  });
});

describe('isEntityHidden', () => {
  it('hides an entity when its layer flag is false', () => {
    const dm = { showBuildings: false } as DevModeState;
    expect(isEntityHidden(entity('cottage'), dm)).toBe(true);
    expect(isEntityHidden(entity('english-oak'), dm)).toBe(false);
  });

  it('hides NPC entities (the fallback square) under the npcs toggle', () => {
    const dm = { showNpcs: false } as DevModeState;
    expect(isEntityHidden(entity('npc'), dm)).toBe(true);
  });
});

describe('layerFlag', () => {
  it('returns a distinct show* flag for every layer', () => {
    const flags = RENDER_LAYERS.map(layerFlag);
    expect(new Set(flags).size).toBe(RENDER_LAYERS.length);
    for (const f of flags) expect(f.startsWith('show')).toBe(true);
  });
});

describe('tileRenderLayer', () => {
  it('classifies road family tiles as roads', () => {
    for (const t of ['road', 'road_ns', 'dirt_road', 'dirt_road_ew', 'stone_road', 'bridge', 'bridge_ne']) {
      expect(tileRenderLayer(t)).toBe('roads');
    }
  });

  it('classifies river tiles as rivers', () => {
    expect(tileRenderLayer('river')).toBe('rivers');
    expect(tileRenderLayer('river_ns')).toBe('rivers');
  });

  it('treats lakes/ocean and plain ground as not-a-sublayer', () => {
    for (const t of ['water', 'shallow_water', 'deep_water', 'grass', 'sand', 'forest']) {
      expect(tileRenderLayer(t)).toBeNull();
    }
  });
});

describe('effectiveTileType', () => {
  it('returns the original type when nothing is hidden', () => {
    expect(effectiveTileType('road', undefined)).toBe('road');
    expect(effectiveTileType('river', {} as DevModeState)).toBe('river');
    expect(effectiveTileType('grass', { showRoads: false } as DevModeState)).toBe('grass');
  });

  it('falls back to ground when the tile sub-layer is hidden', () => {
    expect(effectiveTileType('road', { showRoads: false } as DevModeState)).toBe(HIDDEN_TILE_FALLBACK);
    expect(effectiveTileType('bridge', { showRoads: false } as DevModeState)).toBe(HIDDEN_TILE_FALLBACK);
    expect(effectiveTileType('river', { showRivers: false } as DevModeState)).toBe(HIDDEN_TILE_FALLBACK);
  });

  it('does not cross-hide: hiding roads leaves rivers, and vice-versa', () => {
    expect(effectiveTileType('river', { showRoads: false } as DevModeState)).toBe('river');
    expect(effectiveTileType('road', { showRivers: false } as DevModeState)).toBe('road');
  });
});
