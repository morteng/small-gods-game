import { describe, it, expect } from 'vitest';
import {
  HEIGHT_UNIT_PX, HUMAN_PX, DOOR_WIDTH_TILES,
  mToPx, HUMAN_HEIGHT_M, DOOR_HEIGHT_M,
  ISO_TILE_W, ISO_TILE_H,
} from '@/render/scale-contract';

describe('scale-contract', () => {
  it('anchors the canonical world metrics', () => {
    expect(ISO_TILE_W).toBe(128);
    expect(ISO_TILE_H).toBe(64);
    expect(HEIGHT_UNIT_PX).toBe(ISO_TILE_H);
  });

  it('derives a human ~54px tall, with a door taller than a human', () => {
    expect(HUMAN_PX).toBe(Math.round(mToPx(HUMAN_HEIGHT_M)));
    expect(HUMAN_PX).toBeGreaterThanOrEqual(48);
    expect(HUMAN_PX).toBeLessThanOrEqual(60);
    // a door clears a human's head
    expect(DOOR_HEIGHT_M).toBeGreaterThan(HUMAN_HEIGHT_M);
    expect(DOOR_WIDTH_TILES).toBeGreaterThan(0);
    expect(DOOR_WIDTH_TILES).toBeLessThan(1);
  });
});
