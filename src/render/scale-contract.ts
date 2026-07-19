// Single source of truth for world scale. Every entity class derives its size from
// REAL METRES through one PX_PER_METRE. Author in metres; pixels & geometry cube-units
// are derived. Snap to integer pixels at the end (1:1 pixel-perfect rule).
// Master anchor: one ground tile = METRES_PER_TILE metres.
import { ISO_TILE_W, ISO_TILE_H } from './iso/iso-constants';

/** Vertical pixels per one tile-depth of world height (one cube-unit). */
export const HEIGHT_UNIT_PX = ISO_TILE_H;                  // 64

// ── Master anchors ──
export const METRES_PER_TILE = 2;                          // one ground tile = 2 m
export const PX_PER_METRE    = HEIGHT_UNIT_PX / METRES_PER_TILE;  // 64 / 2 = 32

// ── Conversions ──
export const mToPx    = (m: number): number => m * PX_PER_METRE;
export const mToTiles = (m: number): number => m / METRES_PER_TILE;
/** 1:1 rule: blit/derive only at whole pixels. */
export const snapPx   = (px: number): number => Math.round(px);

// ── Authored real-world dimensions (metres) ──
export const HUMAN_HEIGHT_M = 1.7;     // visible LPC body
export const DOOR_HEIGHT_M  = 2.0;
export const DOOR_WIDTH_M   = 0.9;
export const STOREY_M       = 2.7;     // interior storey height

/**
 * Real-world heights (metres) of natural entities, keyed by entity kind id.
 * The one place a human or LLM agent reads "how big is an oak". Every
 * `category: 'vegetation'` and `category: 'terrain-feature'` kind must appear
 * here (enforced by tests/unit/nature-height-coverage.test.ts in a later task).
 */
export const NATURE_HEIGHT_M: Record<string, number> = {
  // saplings / arid (real tree heights come from the flora-DB species)
  sapling: 2.5, cactus: 2.5,
  // shrubs / undergrowth
  shrub: 1.5, fern: 0.5, reeds: 1.8, vine: 1.5,
  // ground cover / misc
  flower_patch: 0.3, mushroom: 0.2, grass_tuft: 0.3, tundra_moss: 0.1,
  // coastal / forest debris
  driftwood: 0.4, shell: 0.15, stump: 0.6, log: 0.6,
  // rocks / geology (flora-DB rock species included: the size-keyed snow burial in
  // isSnowBuriedRockKind reads THIS table — a species absent here defaults to 1.0
  // and lands on the wrong side of the bury line)
  boulder: 1.2, rock_pile: 0.7, pebbles: 0.2, ore_vein: 0.8, rock_outcrop: 3.0,
  'granite-boulder': 1.8, 'field-stone': 0.6,
  // monuments
  standing_stone: 3.0, shrine_stone: 1.2,
  // natural landforms (mesh props; placement currently shelved in map-generator,
  // but the kinds exist so the contract covers them)
  sea_arch: 8.0, cliff_face: 10.0, cave_mouth: 6.0, hoodoo: 7.0,
};
/** Fallback for any nature kind missing from the table (logged once at use). */
export const DEFAULT_NATURE_HEIGHT_M = 1.0;

// ── Derived pixels / cube-units (kept for back-compat call sites) ──
export const HUMAN_PX          = snapPx(mToPx(HUMAN_HEIGHT_M));   // 54
export const DOOR_HEIGHT_TILES = mToTiles(DOOR_HEIGHT_M);         // 1.0
export const DOOR_WIDTH_TILES  = mToTiles(DOOR_WIDTH_M);          // 0.45
export const STOREY_TILES      = mToTiles(STOREY_M);              // 1.35

export { ISO_TILE_W, ISO_TILE_H };
