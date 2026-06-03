import { describe, it, expect } from 'vitest';
import {
  isLayerHidden, isEntityHidden, entityLayer, layerFlag, RENDER_LAYERS,
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
    expect(entityLayer(entity('oak_tree'))).toBe('vegetation');
    expect(entityLayer(entity('well'))).toBe('props');
    expect(entityLayer(entity('boulder'))).toBe('terrainFeatures');
  });

  it('routes unknown kinds to props', () => {
    expect(entityLayer(entity('mystery_thing'))).toBe('props');
  });
});

describe('isEntityHidden', () => {
  it('hides an entity when its layer flag is false', () => {
    const dm = { showBuildings: false } as DevModeState;
    expect(isEntityHidden(entity('cottage'), dm)).toBe(true);
    expect(isEntityHidden(entity('oak_tree'), dm)).toBe(false);
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
