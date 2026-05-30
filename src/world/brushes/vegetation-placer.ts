import { noise } from '@/core/noise';
import { defaultEntity } from '@/world/brush-helpers';
import type { Entity, Region, BrushContext } from '@/core/types';

export interface VegetationParams {
  /** Brush name for entity ID generation */
  brush: string;
  /** Tile type this brush applies to (e.g., 'forest', 'pine_forest') */
  tileType: string;
  /** Primary tree/vegetation kinds with weights [kind, weight] */
  kinds: [string, number][];
  /** Base density (0-1): probability a tile gets a vegetation entity */
  density: number;
  /** Scale variation range [min, max] (e.g., [0.8, 1.2]) */
  scaleRange: [number, number];
  /** Rotation variation in degrees [-max, +max] (e.g., 15 for ±15°) */
  rotationRange: number;
  /** Offset from tile center in tile units [maxX, maxY] (e.g., [0.3, 0.3]) */
  offsetRange: [number, number];
  /** Secondary undergrowth kinds (placed at lower density) */
  undergrowth?: [string, number, number][]; // [kind, weight, density]
}

/**
 * Place vegetation using shared noise-based parameters.
 * All parameters are deterministic from (x, y, seed).
 */
export function placeVegetation(
  region: Region,
  seed: number,
  ctx: BrushContext,
  params: VegetationParams,
): Entity[] {
  const out: Entity[] = [];
  const yEnd = region.y + region.h;
  const xEnd = region.x + region.w;
  
  for (let y = region.y; y < yEnd; y++) {
    for (let x = region.x; x < xEnd; x++) {
      const tile = ctx.tiles.tiles[y]?.[x];
      if (!tile || tile.type !== params.tileType) continue;

      // Use noise for density check
      const densityRng = noise(x, y, seed);
      if (densityRng >= params.density) continue;

      // Pick primary vegetation kind based on weighted random
      const kindRng = noise(x, y, seed + 1);
      const kind = pickWeighted(kindRng, params.kinds);

      // Calculate offset from tile center using noise
      const offRngX = noise(x, y, seed + 3);
      const offRngY = noise(x, y, seed + 4);
      const offsetX = (offRngX - 0.5) * 2 * params.offsetRange[0];
      const offsetY = (offRngY - 0.5) * 2 * params.offsetRange[1];

      // Calculate scale variation
      const scaleRng = noise(x, y, seed + 5);
      const scale = params.scaleRange[0] + scaleRng * (params.scaleRange[1] - params.scaleRange[0]);

      // Calculate rotation variation
      const rotRng = noise(x, y, seed + 6);
      const rotation = (rotRng - 0.5) * 2 * params.rotationRange;

      out.push(defaultEntity(params.brush, kind, x + offsetX, y + offsetY, {
        offsetX,
        offsetY,
        scale,
        rotation,
      }));

      // Place undergrowth at lower density
      if (params.undergrowth) {
        for (const [ugKind, ugWeight, ugDensity] of params.undergrowth) {
          const ugRng = noise(x, y, seed + 10 + ugKind.length);
          if (ugRng < ugDensity) {
            const ugKindPicked = pickWeighted(ugRng, [[ugKind, ugWeight]]);
            // Undergrowth has smaller offsets
            const ugOffX = (noise(x, y, seed + 20) - 0.5) * 0.15;
            const ugOffY = (noise(x, y, seed + 21) - 0.5) * 0.15;
            out.push(defaultEntity(params.brush, ugKindPicked, x + ugOffX, y + ugOffY, {
              offsetX: ugOffX,
              offsetY: ugOffY,
              scale: 0.6 + noise(x, y, seed + 22) * 0.4, // Smaller scale: 0.6-1.0
            }));
          }
        }
      }
    }
  }
  return out;
}

/**
 * Pick a weighted random item from a list of [item, weight] pairs.
 * rng should be in [0, 1).
 */
function pickWeighted(rng: number, items: [string, number][]): string {
  let cumulative = 0;
  for (const [item, weight] of items) {
    cumulative += weight;
    if (rng < cumulative) return item;
  }
  return items[items.length - 1][0]; // Fallback to last item
}

/**
 * Helper to create density noise check with perlin noise for smoother biome transitions.
 * Returns true if vegetation should be placed at (x, y).
 */
export function shouldPlaceAt(
  x: number,
  y: number,
  seed: number,
  baseDensity: number,
  noiseScale: number = 0.1,
): boolean {
  // Combine perlin noise with seeded random for natural-looking edges
  const n = noise(x * noiseScale, y * noiseScale, seed);
  return n < baseDensity;
}
