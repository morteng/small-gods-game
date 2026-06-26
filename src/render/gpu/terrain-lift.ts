// src/render/gpu/terrain-lift.ts
//
// Entity foot-z parity for the GPU terrain. The buffer-driven heightfield
// (`terrain-field.ts` / `terrain-wgsl.ts`) LIFTS the ground surface in screen-y,
// but the entity draw list is authored flat (z=0, the same coords the Canvas2D
// path uses — Canvas2D has no 3D terrain). On the GPU that leaves buildings,
// trees and NPCs floating below hilltops / sunk into valleys.
//
// This pre-pass lifts each draw item by the terrain height at its GROUND-CONTACT
// tile, in the SAME world-screen space the items already live in (before the
// camera xform), so a single transform fixes sprites, fallback shapes AND their
// cast shadows together (shadows derive from the lifted foot, landing on the
// lifted ground). The lift exactly mirrors the terrain shader's `heightPx`:
//   hPx = (elev - seaLevel) * reliefM * zPxPerM
//
// Pure data — no GPU/DOM. Inverse-iso + sampling are unit-tested.

import type { DrawItem } from '@/render/iso/draw-list';
import type { TerrainGlobalsInput } from '@/render/gpu/instance-buffer';

/** The terrain inputs the lift needs (a subset of `TerrainField`). */
export interface TerrainLiftField {
  heights: Float32Array;
  globals: Pick<TerrainGlobalsInput, 'grid' | 'half' | 'zPxPerM' | 'seaLevel' | 'reliefM'>;
}

/**
 * THE screen-px lift of a normalised elevation — the single CPU mirror of the terrain
 * shader's `heightPx = (elev - seaLevel) * reliefM * zPxPerM`. Every CPU lift (entity
 * foot-z here, camera framing, the iso `IsoEnv.k` gain) bottoms out in this one formula,
 * so they can't drift from the GPU or each other. `reliefM * zPxPerM` IS the iso env's
 * `k` (mountainRelief × terrainVerticalExaggeration); see `iso-env.ts`.
 */
export function liftPxFromElev(elev: number, seaLevel: number, reliefM: number, zPxPerM: number): number {
  return (elev - seaLevel) * reliefM * zPxPerM;
}

/** Screen-px vertical lift of a flat-world point (sx,sy), matching the shader. */
export function liftAt(field: TerrainLiftField, sx: number, sy: number): number {
  const { grid, half, zPxPerM, seaLevel, reliefM } = field.globals;
  const [w, h] = grid;
  const [halfW, halfH] = half;
  if (w <= 0 || h <= 0 || halfW <= 0 || halfH <= 0) return 0;
  // Inverse iso (flat, height-free) → tile, matching iso-projection.screenToTile.
  const fx = sx / halfW;
  const fy = sy / halfH;
  let tx = Math.round((fx + fy) / 2);
  let ty = Math.round((fy - fx) / 2);
  if (tx < 0) tx = 0; else if (tx > w - 1) tx = w - 1;
  if (ty < 0) ty = 0; else if (ty > h - 1) ty = h - 1;
  const e = field.heights[ty * w + tx] ?? 0;
  return liftPxFromElev(e, seaLevel, reliefM, zPxPerM);
}

/**
 * Screen-px vertical lift at a tile centre, matching the shader's `heightPx`.
 * Camera framing uses this so focusing a hilltop centres the LIFTED surface
 * (the shader pushes high terrain up-screen by exactly this), not the flat
 * sea-level position. Clamps the tile into range and rounds to the nearest cell.
 */
export function tileLiftPx(field: TerrainLiftField, tileX: number, tileY: number): number {
  const { grid, seaLevel, reliefM, zPxPerM } = field.globals;
  const [w, h] = grid;
  if (w <= 0 || h <= 0 || field.heights.length === 0) return 0;
  let tx = Math.round(tileX), ty = Math.round(tileY);
  if (tx < 0) tx = 0; else if (tx > w - 1) tx = w - 1;
  if (ty < 0) ty = 0; else if (ty > h - 1) ty = h - 1;
  const e = field.heights[ty * w + tx] ?? 0;
  return liftPxFromElev(e, seaLevel, reliefM, zPxPerM);
}

/** Lift one draw item by the terrain height under its ground-contact point. */
function liftItem(it: DrawItem, field: TerrainLiftField): DrawItem {
  if (it.t === 'image') {
    // Above-ground deck (G4): ride the authored elevation, not the terrain below.
    if (it.liftElev !== undefined) {
      const { seaLevel, reliefM, zPxPerM } = field.globals;
      const dz = liftPxFromElev(it.liftElev, seaLevel, reliefM, zPxPerM);
      return dz === 0 ? it : { ...it, dy: it.dy - dz };
    }
    const footLift = it.shadow?.footLift ?? (it.maps ? it.dw / 4 : 0);
    const footX = it.dx + it.dw / 2;
    const footY = it.dy + it.dh - footLift;
    const dz = liftAt(field, footX, footY);
    return dz === 0 ? it : { ...it, dy: it.dy - dz };
  }
  if (it.t === 'poly') {
    // Ground contact = the lowest (max-y) vertex of the footprint.
    let footY = -Infinity, footX = 0;
    for (const p of it.points) if (p.y > footY) { footY = p.y; footX = p.x; }
    const dz = liftAt(field, footX, footY);
    return dz === 0 ? it : { ...it, points: it.points.map((p) => ({ x: p.x, y: p.y - dz })) };
  }
  // circle ⇒ ground contact at its bottom (cy + r).
  const dz = liftAt(field, it.cx, it.cy + it.r);
  return dz === 0 ? it : { ...it, cy: it.cy - dz };
}

/**
 * Lift an entire draw list onto the GPU terrain surface. Returns a NEW array
 * (items are cloned only when their lift is non-zero, so flat worlds incur no
 * allocation churn). Call BEFORE batching/shadow/shape construction so every
 * consumer sees the lifted coordinates.
 */
export function liftDrawList(items: readonly DrawItem[], field: TerrainLiftField | null | undefined): readonly DrawItem[] {
  if (!field || field.heights.length === 0) return items;
  return items.map((it) => liftItem(it, field));
}
