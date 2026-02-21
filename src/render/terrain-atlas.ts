/**
 * Terrain Atlas — maps blobIndex to (col, row) within a per-group terrain sheet.
 *
 * Each terrain group has its own PNG at public/sprites/terrain/{group}.png.
 * Sheet format (LPC blob autotile standard):
 *   6 columns × 8 rows of 32×32 tiles = 192×256 px
 *   blobIndex 0–46 → col = idx % 6, row = floor(idx / 6)
 *
 * Adding a new terrain type:
 *   1. Drop public/sprites/terrain/{group}.png (192×256, 6×8 tiles)
 *   2. Add the group name to TERRAIN_GROUPS in src/map/blob-autotiler.ts
 *   No renderer changes needed.
 */

/** Tile size in the LPC terrain sheets (32×32 px) */
export const LPC_TILE_SIZE = 32;

/**
 * Returns the (col, row) position of a blob variant within a terrain group sheet.
 * The sheet must be 6 columns wide; rows continue until all 47 variants fit.
 */
export function getTerrainSpriteCoords(blobIndex: number): { col: number; row: number } {
  return {
    col: blobIndex % 6,
    row: Math.floor(blobIndex / 6),
  };
}
