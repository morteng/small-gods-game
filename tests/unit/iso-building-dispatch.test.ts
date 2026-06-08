import { describe, it, expect } from 'vitest';
import type { BuildingRenderMode } from '@/core/types';

// Pure decision function extracted from the renderer so dispatch is unit-testable
// without a canvas. It returns which source to draw: 'asset' | 'parametric' | 'flat'.
import { pickBuildingSource } from '@/render/iso/iso-building';

describe('building render dispatch', () => {
  const has = () => ({} as unknown as CanvasImageSource);
  const none = () => null;

  it('auto: asset → else parametric → else flat', () => {
    expect(pickBuildingSource('auto', has, has)).toBe('asset');
    expect(pickBuildingSource('auto', none, has)).toBe('parametric');
    expect(pickBuildingSource('auto', none, none)).toBe('flat');
  });

  it('fallback: skips the asset, parametric → else flat', () => {
    expect(pickBuildingSource('fallback', has, has)).toBe('parametric');
    expect(pickBuildingSource('fallback', has, none)).toBe('flat');
  });
});
