import { describe, it, expect } from 'vitest';

// Pure decision function extracted from the renderer so dispatch is unit-testable
// without a canvas. It returns which source to draw: 'asset' | 'generated' | 'parametric' | 'flat'.
import { pickBuildingSource } from '@/render/iso/iso-building';

describe('building render dispatch', () => {
  const has = () => ({} as unknown as CanvasImageSource);
  const none = () => null;

  it('auto: asset → generated → parametric → flat', () => {
    expect(pickBuildingSource('auto', has, none, none)).toBe('asset');
    expect(pickBuildingSource('auto', none, has, none)).toBe('generated');
    expect(pickBuildingSource('auto', none, none, has)).toBe('parametric');
    expect(pickBuildingSource('auto', none, none, none)).toBe('flat');
  });

  it('fallback: forces parametric — skips asset AND generated', () => {
    expect(pickBuildingSource('fallback', has, has, has)).toBe('parametric');
    expect(pickBuildingSource('fallback', has, has, none)).toBe('flat');
    expect(pickBuildingSource('fallback', has, none, has)).toBe('parametric');
    expect(pickBuildingSource('fallback', none, none, none)).toBe('flat');
  });
});
