/**
 * Terrain Atlas — maps (terrainGroup, blobIndex) to pixel coords in LPC terrain spritesheet
 *
 * LPC terrain atlas layout (bluecarrot16 [LPC] Terrains):
 *   Each terrain occupies a 6-column × 8-row region (192×256 px for 32×32 tiles)
 *   blobIndex 0-46 → col = blobIndex % 6, row = Math.floor(blobIndex / 6)
 *
 * Atlas file: public/sprites/terrain/lpc-terrain.png
 *   Terrain regions stacked vertically in this order:
 *     0: grass       (row offset 0)
 *     1: dirt        (row offset 8)
 *     2: sand        (row offset 16)
 *     3: water       (row offset 24)
 *     4: stone       (row offset 32)
 *     5: rocky       (row offset 40)
 *
 * NOTE: Until the LPC terrain atlas is downloaded and placed at
 *   public/sprites/terrain/lpc-terrain.png
 * the renderer falls back to TILE_COLORS. The atlas path and terrain
 * region offsets defined here are correct for the standard LPC terrain pack.
 */

/** Terrain group → row offset in the LPC atlas (in 8-row blocks of 32px tiles) */
const TERRAIN_ROW_OFFSETS: Record<string, number> = {
  grass:  0,
  dirt:   8,
  sand:   16,
  water:  24,
  stone:  32,
  rocky:  40,
};

/** Tile size in the LPC terrain atlas (32×32 px) */
export const LPC_TILE_SIZE = 32;

/**
 * Get pixel coordinates for a (terrainGroup, blobIndex) pair in the LPC terrain atlas.
 * Returns null if the terrain group has no atlas mapping (use TILE_COLORS fallback).
 */
export function getTerrainAtlasCoords(
  terrainGroup: string,
  blobIndex: number,
): { sx: number; sy: number; sw: number; sh: number } | null {
  const rowOffset = TERRAIN_ROW_OFFSETS[terrainGroup];
  if (rowOffset === undefined) return null;

  const col = blobIndex % 6;
  const row = Math.floor(blobIndex / 6);

  return {
    sx: col * LPC_TILE_SIZE,
    sy: (rowOffset + row) * LPC_TILE_SIZE,
    sw: LPC_TILE_SIZE,
    sh: LPC_TILE_SIZE,
  };
}
