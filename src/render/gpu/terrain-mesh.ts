// src/render/gpu/terrain-mesh.ts
//
// R2d (mesh half) — build the terrain heightfield as GPU geometry: the ground
// stops being flat Canvas2D diamonds (z=0, colour-only height shading) and
// becomes a real lifted mesh in the WebGPU scene. THIS is where the sibling
// epics' deformations finally show up as pixels — a motte raises tiles, a ditch
// sinks them, a road pad levels them — because `heightAt` (R1 base ⊕ the
// deformation channel) drives each tile's z.
//
// Topology decision (parity-first): each tile is ONE flat diamond quad (2 tris)
// lifted to its own tile height — the crisp flat-diamond look + exact per-tile
// shading the Canvas2D path has today, now with geometric z so the ground
// physically steps and entities can later sit on it. Diamonds tessellate
// (a tile's bottom vertex == its front neighbour's left vertex) so a FLAT field
// has no cracks; at a height STEP the shared edge splits — skirts close that gap
// in a follow-up (R2d-skirts). Alternative (continuous per-corner mesh, smooth
// mounds, blended colours) is noted but deferred — it changes the look.
//
// Pure data: heightfield + colours + iso projection, no GPU/DOM. The device half
// (R2d-device) uploads these buffers; the integrate half swaps the Canvas2D
// terrain for this. Emitted in iso BACK-TO-FRONT order so the consumer can draw
// painter-ordered (terrain under entities) without a depth buffer.

import type { GameMap, DevModeState } from '@/core/types';
import type { TileBounds } from '@/render/iso/iso-projection';
import { TILE_COLORS } from '@/core/constants';
import { worldToScreen } from '@/render/iso/iso-projection';
import { ISO_TILE_W, ISO_TILE_H } from '@/render/iso/iso-constants';
import { effectiveTileType } from '@/render/layer-visibility';
import { getHeightfield, ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import { styledIslandSpec } from '@/terrain/island-mask';
import { worldStyleOf } from '@/core/world-style';
import { litTileColorRGB } from '@/render/iso/terrain-shading';

/**
 * Vertical z-scale: screen px per metre of terrain relief. DELIBERATELY far
 * below the XY scale (`PX_PER_METRE` = 32) — full relief (~48 m) at 32 px/m
 * would tower 1500 px; terrain z is compressed for readability, like most iso
 * games. Tunable in-browser at R2d-integrate; a peak (~+31 m) lifts ~47 px and
 * a trench (~−17 m) drops ~26 px at the default.
 */
export const TERRAIN_Z_PX_PER_M = 1.5;

export interface TerrainMeshOpts {
  /** Override the vertical z-scale (px per metre). */
  zPxPerM?: number;
  devMode?: DevModeState;
}

export interface TerrainMesh {
  /** Interleaved screen-space vertex positions [x0,y0, x1,y1, …] (world units,
   *  pre-camera — the consumer applies the same view transform as the entities). */
  positions: Float32Array;
  /** Interleaved per-vertex colour [r0,g0,b0, …], 0..1, flat per tile. */
  colors: Float32Array;
  /** Triangle indices into the vertex arrays, iso back-to-front order. */
  indices: Uint32Array;
  vertexCount: number;
  triCount: number;
}

/** Number of visible tiles in the bounds (each → 4 verts / 2 tris). */
function tileCount(map: GameMap, b: TileBounds): number {
  let n = 0;
  for (let ty = b.minTy; ty <= b.maxTy; ty++) {
    const row = map.tiles[ty];
    if (!row) continue;
    for (let tx = b.minTx; tx <= b.maxTx; tx++) if (row[tx]) n++;
  }
  return n;
}

/**
 * Build the terrain mesh for the visible tile bounds. Vertices are emitted in
 * iso diagonal order (back-to-front), four per tile (diamond top/right/bottom/
 * left), all lifted to the tile's height; two triangles per tile.
 */
export function buildTerrainMesh(
  map: GameMap, bounds: TileBounds, originX: number, originY: number, opts: TerrainMeshOpts = {},
): TerrainMesh {
  const zPxPerM = opts.zPxPerM ?? TERRAIN_Z_PX_PER_M;
  const relief = worldStyleOf(map.worldSeed).mountainRelief; // S1; defaults to TERRAIN_RELIEF_M
  const halfW = ISO_TILE_W / 2;
  const halfH = ISO_TILE_H / 2;
  const heightfield = getHeightfield(map.seed, map.width, map.height, styledIslandSpec(map.worldSeed), map.worldSeed?.pois ?? null);

  const n = tileCount(map, bounds);
  const positions = new Float32Array(n * 4 * 2);
  const colors = new Float32Array(n * 4 * 3);
  const indices = new Uint32Array(n * 6);
  let vi = 0; // vertex index (counts vertices, not floats)
  let ii = 0; // index cursor

  // Iso back-to-front: ascending diagonal i = tx+ty (same sweep as drawIsoTerrain).
  const iMin = bounds.minTx + bounds.minTy;
  const iMax = bounds.maxTx + bounds.maxTy;
  for (let i = iMin; i <= iMax; i++) {
    const txLo = Math.max(bounds.minTx, i - bounds.maxTy);
    const txHi = Math.min(bounds.maxTx, i - bounds.minTy);
    for (let tx = txLo; tx <= txHi; tx++) {
      const ty = i - tx;
      const tile = map.tiles[ty]?.[tx];
      if (!tile) continue;

      const elev = heightfield[ty * map.width + tx];
      const zPx = (elev - ELEVATION_SEA_LEVEL) * relief * zPxPerM;
      const { sx, sy } = worldToScreen(tx, ty, zPx, originX, originY);

      const base = TILE_COLORS[effectiveTileType(tile.type, opts.devMode)] ?? '#444';
      const [r, g, b] = litTileColorRGB(base, elev, tx, ty);

      // Diamond corners (lifted): top, right, bottom, left.
      const v0 = vi;
      const px = [sx, sy - halfH, sx + halfW, sy, sx, sy + halfH, sx - halfW, sy];
      for (let k = 0; k < 4; k++) {
        positions[vi * 2] = px[k * 2];
        positions[vi * 2 + 1] = px[k * 2 + 1];
        colors[vi * 3] = r;
        colors[vi * 3 + 1] = g;
        colors[vi * 3 + 2] = b;
        vi++;
      }
      // Two triangles: (top,right,bottom) + (top,bottom,left).
      indices[ii++] = v0; indices[ii++] = v0 + 1; indices[ii++] = v0 + 2;
      indices[ii++] = v0; indices[ii++] = v0 + 2; indices[ii++] = v0 + 3;
    }
  }

  return { positions, colors, indices, vertexCount: vi, triCount: ii / 3 };
}
