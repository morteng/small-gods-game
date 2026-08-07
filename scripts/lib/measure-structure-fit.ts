// scripts/lib/measure-structure-fit.ts
// PURE, world-free terrain-fit measurement core (Phase B3 of the LLM-authorable modeling
// epic). Given a placement origin, a footprint, and an INJECTED `terrain` height sampler
// (metres), it reports how the ground meets the structure's base over every footprint cell:
//   - per-cell `terrainM` (metres, whatever datum the injected sampler uses — the script
//     injects the world's `heightAt`/`heightMetresAt`, which are sea-relative) and
//     `clearanceM = terrainM - referenceM`, where `referenceM` is the terrain at the
//     placement ANCHOR cell (origin.x, origin.y).
//   - min/max/mean clearance and `maxSlopeMvTile` (metres per tile) over adjacent cells.
//
// SIGN CONVENTION: `clearanceM > 0` means the cell's ground sits ABOVE the structure's
// nominal grade at its anchor (the base presses against rising ground); `clearanceM < 0`
// means the cell's ground drops BELOW that grade (the structure would float / need fill);
// `0` on a flat field of ANY absolute height (only the RELATIVE relief matters, so a flat
// field never reports a spurious float). `maxSlopeMvTile` is the max absolute height
// difference between horizontally/vertically adjacent footprint cells (tile spacing = 1),
// the classic "how steep is the ground I'm putting this on".
//
// Deterministic and Math.random-free: cells are emitted in fixed row-major order and every
// number is a pure function of the injected sampler, so the SAME sampler ⇒ an
// object-equal report on every call. This module imports NOTHING from the game world — the
// unit test drives it with synthetic heightfields (no world, no manifold, no renderer).

export interface FitCell {
  /** Absolute tile coordinates of the cell (origin + footprint offset). */
  x: number;
  y: number;
  /** Terrain height in metres at this cell (in the injected sampler's datum). */
  terrainM: number;
  /** `terrainM - referenceM` — metres above/below the structure's anchor grade. */
  clearanceM: number;
}

export interface StructureFitReport {
  /** The footprint's top-left integer tile (where measurement actually sampled). */
  origin: { x: number; y: number };
  /** The terrain height (metres) at the anchor cell — the structure's nominal grade. */
  referenceM: number;
  /** Footprint extent in tiles actually sampled (floored, ≥1). */
  footprint: { w: number; h: number };
  /** All footprint cells, row-major from origin. */
  cells: FitCell[];
  minClearanceM: number;
  maxClearanceM: number;
  meanClearanceM: number;
  /** Max |Δheight| over adjacent cells, metres per tile. 0 for a 1×1 footprint. */
  maxSlopeMvTile: number;
}

export function measureStructureFit(
  place: { x: number; y: number },
  footprint: { w: number; h: number },
  terrain: (x: number, y: number) => number,
): StructureFitReport {
  const ox = Math.floor(place.x);
  const oy = Math.floor(place.y);
  const w = Math.max(1, Math.floor(footprint.w));
  const h = Math.max(1, Math.floor(footprint.h));
  const referenceM = terrain(ox, oy);

  const cells: FitCell[] = [];
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      const tx = ox + cx;
      const ty = oy + cy;
      const tM = terrain(tx, ty);
      cells.push({ x: tx, y: ty, terrainM: tM, clearanceM: tM - referenceM });
    }
  }

  let minClearance = Infinity;
  let maxClearance = -Infinity;
  let sum = 0;
  for (const c of cells) {
    if (c.clearanceM < minClearance) minClearance = c.clearanceM;
    if (c.clearanceM > maxClearance) maxClearance = c.clearanceM;
    sum += c.clearanceM;
  }

  // Max absolute |Δ| over adjacent cells (horizontal + vertical neighbours). Tile spacing
  // is exactly 1, so this is the slope in metres per tile.
  let maxSlope = 0;
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      const idx = cy * w + cx;
      const c = cells[idx];
      if (c == null) continue;
      const right = cells[idx + 1];
      if (cx + 1 < w && right) {
        const d = Math.abs(right.terrainM - c.terrainM);
        if (d > maxSlope) maxSlope = d;
      }
      const down = cells[idx + w];
      if (cy + 1 < h && down) {
        const d = Math.abs(down.terrainM - c.terrainM);
        if (d > maxSlope) maxSlope = d;
      }
    }
  }

  const hasCells = cells.length > 0;
  return {
    origin: { x: ox, y: oy },
    referenceM,
    footprint: { w, h },
    cells,
    minClearanceM: hasCells ? minClearance : 0,
    maxClearanceM: hasCells ? maxClearance : 0,
    meanClearanceM: hasCells ? sum / cells.length : 0,
    maxSlopeMvTile: maxSlope,
  };
}
