/**
 * Tree sprite-sheet helpers shared by the top-down and iso renderers, so both
 * pick the same sheet variant and silhouette column for a given tree. The
 * sheets themselves (`public/sprites/trees/trees-<variant>.png`) are loaded by
 * AssetManager into `RenderContext.treeSheets`.
 */

/**
 * Map a tree entity kind to its sheet variant key (the `<variant>` in
 * `trees-<variant>.png`). Returns null for kinds without a dedicated tree sheet
 * (ground cover like fern/shrub, or unknown kinds) — callers fall back to a
 * drawn placeholder.
 */
export function treeSheetForKind(kind: string): string | null {
  switch (kind) {
    case 'oak_tree':    return 'green';
    case 'orange_tree': return 'orange';
    case 'pale_tree':   return 'pale';
    case 'brown_tree':  return 'brown';
    case 'dead_tree':   return 'dead';
    case 'pine_tree':   return 'pale';
    case 'birch_tree':  return 'pale';
    default: return null;
  }
}

/** Pixels per source sprite cell in a tree sheet (8 columns of 64×64). */
export const TREE_SPRITE_SRC = 64;

/**
 * Deterministic sprite column (0–7) for a tree at a tile, so one sheet shows a
 * variety of silhouettes across the map without any rotation.
 */
export function treeSpriteColumn(tileX: number, tileY: number): number {
  return Math.abs((tileX * 13) ^ (tileY * 7)) % 8;
}
