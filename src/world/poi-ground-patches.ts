/**
 * Connectome-placed "mini biomes".
 *
 * A POI type can stamp a patch of distinctive ground around its position — a
 * temple's sacred grove, and whatever Fate / content packs register next — so
 * the place reads as its own little landscape rather than whatever biome noise
 * happened to land there. This is the small-scale sibling of `poi-influence`
 * (which nudges the elevation/moisture/temperature noise fields): patches don't
 * reshape the terrain, they re-skin the ground.
 *
 * Applied during worldgen AFTER biome classification but BEFORE settlements and
 * POI-zone brushes, so buildings sit on the patched ground and the zone brush
 * scatters its props over it (the temple brush already places altars/statues on
 * `sacred_grove`). Pure tile mutation, deterministic (seeded), Math.random-free.
 */

import type { POI, Tile } from '@/core/types';
import { noise } from '@/core/noise';

export interface GroundPatch {
  /** Ground tile stamped over the patch. */
  tile: string;
  /** Base radius in tiles (scaled by POI size). */
  radius: number;
}

/**
 * Open registry — the same agent seam as `POI_INFLUENCES` / `CIVIC_RULES`.
 * A patch must paint a tile that downstream placement understands (a buildable
 * ground type, if a settlement also sits on this POI).
 */
export const POI_GROUND_PATCHES: Record<string, GroundPatch> = {
  // A temple stands in a tended sacred grove (a lush, lighter green) — the
  // temple brush then dresses it with the altar, statues and flower patches.
  temple: { tile: 'sacred_grove', radius: 6 },
};

export function registerPoiGroundPatch(poiType: string, patch: GroundPatch): void {
  POI_GROUND_PATCHES[poiType] = patch;
}

/** Soft, natural ground a patch may overwrite — never water, sand, roads,
 *  farm field, or anything already special/built. */
const PATCHABLE = new Set(['grass', 'scrubland', 'dirt', 'hills', 'glen', 'meadow']);

const SIZE_SCALE: Record<string, number> = { small: 0.7, medium: 1, large: 1.4 };

/**
 * Stamp ground patches for every positioned POI. Seeded radial falloff with
 * per-tile dither keeps the edge organic (sparse, not a hard disc). Returns the
 * number of tiles changed.
 */
export function applyPoiGroundPatches(pois: POI[], tiles: Tile[][], seed: number): number {
  const h = tiles.length;
  const w = tiles[0]?.length ?? 0;
  let changed = 0;

  for (const poi of pois) {
    if (!poi.position) continue;
    const patch = POI_GROUND_PATCHES[poi.type];
    if (!patch) continue;

    const r = Math.max(1, Math.round(patch.radius * (SIZE_SCALE[poi.size ?? 'medium'] ?? 1)));
    const { x: px, y: py } = poi.position;

    for (let y = Math.max(0, py - r); y <= Math.min(h - 1, py + r); y++) {
      for (let x = Math.max(0, px - r); x <= Math.min(w - 1, px + r); x++) {
        const d = Math.hypot(x - px, y - py);
        if (d > r) continue;
        const t = tiles[y]?.[x];
        if (!t || !PATCHABLE.has(t.type)) continue;
        // Certain at the heart, sparse at the rim — dither against the radial
        // probability so the grove fades into its surroundings.
        const p = 1 - d / r;
        if (noise(x, y, seed + 877) > p) continue;
        t.type = patch.tile;
        t.walkable = true;
        changed++;
      }
    }
  }

  return changed;
}
