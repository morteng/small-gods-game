import { describe, it, expect } from 'vitest';
import {
  HEIGHT_UNIT_PX, HUMAN_HEIGHT_UNITS, HUMAN_PX, DOOR_HEIGHT_UNITS, DOOR_WIDTH_TILES,
  ISO_TILE_W, ISO_TILE_H,
} from '@/render/scale-contract';

describe('scale-contract', () => {
  it('anchors the canonical world metrics', () => {
    expect(ISO_TILE_W).toBe(128);
    expect(ISO_TILE_H).toBe(64);
    expect(HEIGHT_UNIT_PX).toBe(ISO_TILE_H);
  });

  it('derives a human ~46px tall, with a door taller than a human', () => {
    expect(HUMAN_PX).toBe(Math.round(HUMAN_HEIGHT_UNITS * HEIGHT_UNIT_PX));
    expect(HUMAN_PX).toBeGreaterThanOrEqual(40);
    expect(HUMAN_PX).toBeLessThanOrEqual(52);
    // a door clears a human's head
    expect(DOOR_HEIGHT_UNITS).toBeGreaterThan(HUMAN_HEIGHT_UNITS);
    expect(DOOR_WIDTH_TILES).toBeGreaterThan(0);
    expect(DOOR_WIDTH_TILES).toBeLessThan(1);
  });
});
