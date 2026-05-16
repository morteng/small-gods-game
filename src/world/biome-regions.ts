import type { BiomeMap, Region } from '@/core/types';

export interface BiomeRegion extends Region {
  biome: string;
}

const SKIP_BIOMES = new Set(['deep_ocean', 'ocean']);

/**
 * Flood-fill the biome grid to find connected components (4-neighbour) and
 * return the axis-aligned bounding box of each. Order is deterministic:
 * top-to-bottom, left-to-right by component-seed cell. Ocean biomes are
 * skipped — they're handled by separate water rendering, not entity brushes.
 */
export function biomeRegions(map: BiomeMap): BiomeRegion[] {
  const { biomes, width, height } = map;
  const visited = new Uint8Array(width * height);
  const out: BiomeRegion[] = [];
  const stack: number[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const start = y * width + x;
      if (visited[start]) continue;
      const biome = biomes[start];
      if (SKIP_BIOMES.has(biome)) { visited[start] = 1; continue; }

      let minX = x, minY = y, maxX = x, maxY = y;
      stack.length = 0;
      stack.push(start);
      visited[start] = 1;

      while (stack.length) {
        const i = stack.pop()!;
        const cx = i % width;
        const cy = (i - cx) / width;
        if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;

        const neighbours = [
          cx > 0          ? i - 1     : -1,
          cx < width - 1  ? i + 1     : -1,
          cy > 0          ? i - width : -1,
          cy < height - 1 ? i + width : -1,
        ];
        for (const ni of neighbours) {
          if (ni < 0) continue;
          if (visited[ni]) continue;
          if (biomes[ni] !== biome) continue;
          visited[ni] = 1;
          stack.push(ni);
        }
      }
      out.push({ biome, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
    }
  }
  return out;
}
