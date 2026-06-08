// Single source of truth for world scale. Every entity class derives its native
// sprite size from world units through these constants — no hardcoded pixel
// sizes. See docs/superpowers/specs/2026-06-08-unified-art-scale-pipeline-vision.md.
import { ISO_TILE_W, ISO_TILE_H } from './iso/iso-constants';

/** Vertical pixels per one building height-unit (one storey). */
export const HEIGHT_UNIT_PX = ISO_TILE_H;             // 64

/** Reference human, in height-units and pixels (matches the LPC visible body). */
export const HUMAN_HEIGHT_UNITS = 0.72;
export const HUMAN_PX = Math.round(HUMAN_HEIGHT_UNITS * HEIGHT_UNIT_PX);   // 46

/** A human-scaled door: human + headroom, ~0.4 tile wide. */
export const DOOR_HEIGHT_UNITS = 0.85;
export const DOOR_WIDTH_TILES = 0.4;

export { ISO_TILE_W, ISO_TILE_H };
