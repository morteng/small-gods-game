import type { GameMap } from './types';

/**
 * Bump after any POST-GEN in-place tile mutation (`tile.type` / `irrigated`)
 * so renderer color memos rebuild (`packColorFieldMemo` keys on it). Without
 * the bump the GPU keeps painting the old ground for the rest of the session —
 * the map object identity is the only other invalidation signal, and it never
 * changes while a world is live. Known runtime mutators: trample promote/revert,
 * settlement-growth street/bridge stamping, perception tile realization, the
 * dev paint brush. Gen-time carves don't need it (no frame has rendered yet),
 * but bumping there is harmless.
 */
export function bumpTilesRev(map: GameMap): void {
  map.tilesRev = (map.tilesRev ?? 0) + 1;
}
