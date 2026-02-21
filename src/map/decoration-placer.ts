import { noise } from '@/core/noise';
import type { GameMap, DecorationInstance } from '@/core/types';

/** Forest tile types and their decoration density (0–1 probability of placing a tree) */
const FOREST_DENSITIES: Record<string, number> = {
  forest:        0.35,
  dense_forest:  0.70,
  pine_forest:   0.50,
  dead_forest:   0.40,
};

/** Variant selection per tile type */
type Variant = 'green' | 'orange' | 'dead' | 'pale' | 'brown';

function pickVariant(tileType: string, rng: number): Variant {
  if (tileType === 'dead_forest') return 'dead';
  if (tileType === 'dense_forest') return rng < 0.6 ? 'green' : 'brown';
  if (tileType === 'pine_forest') return rng < 0.5 ? 'green' : 'pale';
  // forest
  if (rng < 0.5) return 'green';
  if (rng < 0.75) return 'orange';
  return 'pale';
}

/**
 * Place tree decorations on forest tiles deterministically from seed.
 * Pure function — same map+seed always produces identical output.
 */
export function placeDecorations(map: GameMap, seed: number): DecorationInstance[] {
  const decorations: DecorationInstance[] = [];
  const { tiles, width, height } = map;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tile = tiles[y]?.[x];
      if (!tile) continue;

      const density = FOREST_DENSITIES[tile.type];
      if (density === undefined) continue;

      // Probability gate — use noise for stable hashing
      const chance = noise(x, y, seed);
      if (chance > density) continue;

      // Secondary noise values for variant, sprite, and jitter
      const rngVariant = noise(x, y, seed + 1);
      const rngSprite  = noise(x, y, seed + 2);
      const rngOffX    = noise(x, y, seed + 3);
      const rngOffY    = noise(x, y, seed + 4);

      const variant = pickVariant(tile.type, rngVariant);

      // 8 trees per row in the LPC sheet (cols 0–7 of row 0 have full trees)
      const spriteCol = Math.floor(rngSprite * 8);
      const spriteRow = 0;

      // Sub-tile jitter in tile units: [-0.15, 0.15]
      const offsetX = (rngOffX - 0.5) * 0.3;
      const offsetY = (rngOffY - 0.5) * 0.3;

      const id = `deco-tree-${x}-${y}`;
      decorations.push({ id, category: 'tree', variant, tileX: x, tileY: y, offsetX, offsetY, spriteCol, spriteRow });
    }
  }

  return decorations;
}
