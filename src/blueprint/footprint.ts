// src/blueprint/footprint.ts
//
// ONE footprint derivation — spatial-coordination C1 ("visual-claim closes the leak").
//
// A placed building has TWO spatial extents that must NOT be confused:
//
//   • SOLID  — `buildingSolidCells` (occupancy-grid.ts): the compiled `blocked` mask
//     minus passable door cells. "Inside the walls" — what blocks NPC movement and
//     what the spatial-invariant net calls a structure cell.
//   • VISUAL — `structureBox` / `buildingVisualCells` (here): the bounding box of the
//     resolved parts' tile claims. This is the geometry the renderer draws the sprite
//     over (`entity-draw-list.ts`), so it is also the extent under which NOTHING ELSE
//     may peek out — most importantly a croft/settlement barrier slab.
//
// The visual box is a SUPERSET of the solid cells (it also covers door thresholds and
// any cell a part draws over but doesn't claim solid — a column, a tapered tower). The
// fence-through-building leak was the barrier gate guard consulting SOLID cells while
// the renderer drew over the VISUAL box: a slab in `visual \ solid` rendered poking out
// from under the silhouette. Both the renderer and the gate guard now read THIS module,
// so "where it's drawn" and "where a fence must not run" can never drift again.
//
// Pure + world-free (blueprint geometry only): callable from the renderer and worldgen.

import type { ResolvedBlueprint } from '@/blueprint/types';

/** The drawn footprint box, structure-local. `dx,dy` = offset of the box from the
 *  entity origin; `w,h` = its tile span. */
export interface StructureBox { dx: number; dy: number; w: number; h: number; }

/**
 * The structure bounding box: the min/max over the resolved parts' tile rectangles
 * (`at .. at+size`). This is the exact box the renderer sizes the building sprite to.
 * A blueprint with no parts falls back to its declared footprint anchored at (0,0).
 */
export function structureBox(rb: ResolvedBlueprint): StructureBox {
  let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
  for (const p of rb.parts) {
    if (p.at.x < minX) minX = p.at.x;
    if (p.at.y < minY) minY = p.at.y;
    if (p.at.x + p.size.w > maxX) maxX = p.at.x + p.size.w;
    if (p.at.y + p.size.h > maxY) maxY = p.at.y + p.size.h;
  }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = rb.footprint.w; maxY = rb.footprint.h; }
  return { dx: minX, dy: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Every absolute `"x,y"` tile the building's drawn silhouette covers, for a placement
 * at origin `(ox,oy)`. This is the visual extent a barrier gate guard suppresses slabs
 * across, so no hedge/fence/wall slab is left poking out from under the building.
 * Superset of `buildingSolidCells` (it includes door thresholds and draw-only cells).
 */
export function buildingVisualCells(rb: ResolvedBlueprint, ox: number, oy: number): string[] {
  const box = structureBox(rb);
  const out: string[] = [];
  for (let dy = 0; dy < box.h; dy++) {
    for (let dx = 0; dx < box.w; dx++) {
      out.push(`${ox + box.dx + dx},${oy + box.dy + dy}`);
    }
  }
  return out;
}
