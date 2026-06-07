import { describe, it, expect } from 'vitest';
import { drawIsoTerrain } from '@/render/iso/iso-terrain';
import type { GameMap, DevModeState } from '@/core/types';

/** A canvas ctx stub that records the fillStyle in effect at each fill() call. */
function recordingCtx() {
  const fills: string[] = [];
  const ctx = {
    _fs: '',
    set fillStyle(v: string) { this._fs = v; },
    get fillStyle() { return this._fs; },
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
    fill() { fills.push(this._fs); },
    imageSmoothingEnabled: true,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills };
}

/** 1×1 map whose single tile has the given type. */
function oneTileMap(type: string): GameMap {
  return {
    width: 1, height: 1,
    tiles: [[{ type, x: 0, y: 0, walkable: true, state: 'realized' }]],
    pois: [], buildings: [],
  } as unknown as GameMap;
}

const BOUNDS = { minTx: 0, minTy: 0, maxTx: 0, maxTy: 0 };

/**
 * Returns the TOP-diamond fill colour for a single tile (the last of the three
 * fills: left skirt, right skirt, then top). Per-tile value noise shades the
 * colour, but tile (0,0) gets the SAME noise factor across every call here, so
 * two types that resolve to the same base land on the same final colour — we
 * assert the layer-visibility MAPPING relationally rather than by raw palette.
 */
function topFill(type: string, devMode?: DevModeState): string {
  const { ctx, fills } = recordingCtx();
  drawIsoTerrain(ctx, { map: oneTileMap(type), bounds: BOUNDS, originX: 0, originY: 0, devMode });
  return fills[fills.length - 1];
}

describe('drawIsoTerrain — road/river sub-layer toggles', () => {
  it('a river tile differs from ground by default', () => {
    expect(topFill('river')).not.toBe(topFill('grass'));
  });

  it('hiding rivers resolves a river tile to the ground colour', () => {
    // Same tile coord → same noise factor → identical final colour when both
    // resolve to grass.
    expect(topFill('river', { showRivers: false } as DevModeState)).toBe(topFill('grass'));
  });

  it('a road tile differs from ground by default, resolves to ground when hidden', () => {
    expect(topFill('road')).not.toBe(topFill('grass'));
    expect(topFill('road', { showRoads: false } as DevModeState)).toBe(topFill('grass'));
  });

  it('does not cross-hide: hiding roads leaves a river tile painted as river', () => {
    expect(topFill('river', { showRoads: false } as DevModeState)).toBe(topFill('river'));
  });
});
