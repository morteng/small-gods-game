import { describe, it, expect } from 'vitest';
import { drawIsoTerrain } from '@/render/iso/iso-terrain';
import { TILE_COLORS } from '@/core/constants';
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

function paint(type: string, devMode?: DevModeState): string {
  const { ctx, fills } = recordingCtx();
  drawIsoTerrain(ctx, { map: oneTileMap(type), bounds: BOUNDS, originX: 0, originY: 0, devMode });
  return fills[0];
}

describe('drawIsoTerrain — road/river sub-layer toggles', () => {
  it('paints a river tile with the river color by default', () => {
    expect(paint('river')).toBe(TILE_COLORS.river);
  });

  it('paints a river tile with the ground color when rivers are hidden', () => {
    expect(paint('river', { showRivers: false } as DevModeState)).toBe(TILE_COLORS.grass);
  });

  it('paints a road tile with the road color by default, ground when hidden', () => {
    expect(paint('road')).toBe(TILE_COLORS.road);
    expect(paint('road', { showRoads: false } as DevModeState)).toBe(TILE_COLORS.grass);
  });

  it('does not cross-hide: hiding roads leaves rivers painted', () => {
    expect(paint('river', { showRoads: false } as DevModeState)).toBe(TILE_COLORS.river);
  });
});
