// src/blueprint/wheel-orientation.ts
//
// Orient a watermill so its WATERWHEEL dips into the real stream. The mill blueprint is
// authored canonical (the wheel on a hand-picked flank, e.g. west); where a mill actually
// lands — a village stream bank, a river crossing — is a PLACEMENT fact the preset can't know.
// This turns the WHOLE asset (via `orientation`, the same quarter-turn the door→road pattern
// uses) so the wheel's authored face points at the nearest water, leaving the door landward.
// Reads the wheel part's face from the blueprint itself, so the preset stays the single source
// of truth — change the authored flank and this still finds it.

import type { ResolvedBlueprint, WallFace } from './types';
import { orientationForFacing, type Orientation } from './orientation';

/** Outward normal (tile-space) of each wall face. Matches `waterwheelPartType.toPrims`. */
const FACE_VEC: Record<WallFace, [number, number]> = {
  north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0],
};

/**
 * The orientation that turns a placed watermill's wheel toward the nearest water within
 * `range` tiles of its footprint at (ox,oy). Returns null when the blueprint carries no
 * waterwheel, when no water is in range, or when the wheel already faces the water at
 * orientation 0 — so a canonically-correct mill keeps its byte-identical art-cache key.
 */
export function wheelWaterOrientation(
  rb: ResolvedBlueprint,
  ox: number,
  oy: number,
  isWater: (x: number, y: number) => boolean,
  range = 4,
): Orientation | null {
  const wheel = rb.parts.find(p => p.type === 'waterwheel');
  if (!wheel) return null;
  const canon = FACE_VEC[(wheel.params.face as WallFace) ?? 'west'] ?? FACE_VEC.west;

  const { w, h } = rb.footprint;
  const ccx = ox + w / 2, ccy = oy + h / 2;
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (let ty = oy - range; ty < oy + h + range; ty++) {
    for (let tx = ox - range; tx < ox + w + range; tx++) {
      if (!isWater(tx, ty)) continue;
      const dx = tx + 0.5 - ccx, dy = ty + 0.5 - ccy;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        // Snap to the cardinal that dominates the offset — the wheel juts one face.
        best = Math.abs(dx) >= Math.abs(dy) ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dy) || 1];
      }
    }
  }
  if (!best) return null;
  const o = orientationForFacing(canon[0], canon[1], best[0], best[1]);
  return o === 0 ? null : o;   // present ONLY when non-zero (keeps the art-cache key stable)
}

/**
 * The orientation that turns the wheel to a KNOWN water flank (`face`). Use when placement has
 * already resolved which side the stream is on (a tagged mill site) — deterministic, no scan, so
 * the wheel dips into exactly the bank the footprint was seated against. Null when there's no
 * waterwheel or the wheel already faces `face` at orientation 0.
 */
export function wheelOrientationForFace(rb: ResolvedBlueprint, face: WallFace): Orientation | null {
  const wheel = rb.parts.find(p => p.type === 'waterwheel');
  if (!wheel) return null;
  const canon = FACE_VEC[(wheel.params.face as WallFace) ?? 'west'] ?? FACE_VEC.west;
  const t = FACE_VEC[face];
  const o = orientationForFacing(canon[0], canon[1], t[0], t[1]);
  return o === 0 ? null : o;
}
