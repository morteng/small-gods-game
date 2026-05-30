import { describe, it, expect } from 'vitest';
import { createInteractionState } from '@/game/interaction-state';

describe('createInteractionState', () => {
  it('starts empty', () => {
    const s = createInteractionState();
    expect(s.overlayHitAreas).toEqual([]);
    expect(s.poiOverlay).toBeNull();
    expect(s.hoverTile).toBeNull();
    expect(s.hoverScreen).toBeNull();
  });
});
