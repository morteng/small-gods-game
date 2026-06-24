import { describe, it, expect } from 'vitest';
import {
  METRES_PER_TILE, PX_PER_METRE, HEIGHT_UNIT_PX,
  mToPx, mToTiles, snapPx,
  HUMAN_HEIGHT_M, DOOR_HEIGHT_M, DOOR_WIDTH_M, STOREY_M,
  HUMAN_PX, DOOR_HEIGHT_TILES, DOOR_WIDTH_TILES, STOREY_TILES,
  NATURE_HEIGHT_M, DEFAULT_NATURE_HEIGHT_M,
} from '@/render/scale-contract';

describe('scale-contract: metric core', () => {
  it('master anchors', () => {
    expect(METRES_PER_TILE).toBe(2);
    expect(HEIGHT_UNIT_PX).toBe(64);
    expect(PX_PER_METRE).toBe(32);
  });
  it('conversions', () => {
    expect(mToPx(2)).toBe(64);
    expect(mToTiles(2)).toBe(1);
    expect(snapPx(31.6)).toBe(32);
  });
  it('authored metres', () => {
    expect(HUMAN_HEIGHT_M).toBe(1.7);
    expect(DOOR_HEIGHT_M).toBe(2.0);
    expect(DOOR_WIDTH_M).toBe(0.9);
    expect(STOREY_M).toBe(2.7);
  });
  it('derived pixels / cube-units', () => {
    expect(HUMAN_PX).toBe(54);
    expect(DOOR_HEIGHT_TILES).toBe(1);
    expect(DOOR_WIDTH_TILES).toBeCloseTo(0.45);
    expect(STOREY_TILES).toBeCloseTo(1.35);
  });
  it('nature table', () => {
    expect(NATURE_HEIGHT_M.sapling).toBe(2.5);
    expect(NATURE_HEIGHT_M.boulder).toBe(1.2);
    expect(DEFAULT_NATURE_HEIGHT_M).toBe(1.0);
  });
});
