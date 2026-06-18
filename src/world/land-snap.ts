// src/world/land-snap.ts
//
// Spawn-time guard: NPCs must never be placed in the ocean / a river / a lake.
// POI positions (and the ±1 jitter around them) can land on water at the coast,
// so every NPC spawn site snaps its tile to the nearest LAND tile first. Pure
// geometry over `map.tiles` — no rng, no DOM — so it's deterministic + testable.

import type { GameMap } from '@/core/types';
import { WATER_TYPES } from '@/core/constants';

/** True when the tile at (x,y) is a water type (ocean/river/lake/shallow). */
export function isWaterTile(map: GameMap, x: number, y: number): boolean {
  const t = map.tiles[y]?.[x];
  return t ? WATER_TYPES.has(t.type) : false;
}

/**
 * Snap (x,y) to the nearest non-water, in-bounds tile via an expanding ring
 * search (Chebyshev rings, nearest first). Returns the clamped original when the
 * neighbourhood is all water within `maxR` (degenerate — keeps the old behaviour
 * rather than throwing). Deterministic.
 */
export function snapToLand(map: GameMap, x: number, y: number, maxR = 8): { x: number; y: number } {
  const cx = Math.max(0, Math.min(map.width - 1, Math.round(x)));
  const cy = Math.max(0, Math.min(map.height - 1, Math.round(y)));
  if (!isWaterTile(map, cx, cy)) return { x: cx, y: cy };
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring perimeter only
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
        if (!isWaterTile(map, nx, ny)) return { x: nx, y: ny };
      }
    }
  }
  return { x: cx, y: cy };
}
