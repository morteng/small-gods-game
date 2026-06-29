// src/blueprint/orientation.ts
//
// Quarter-turn orientation for a placed blueprint. One ResolvedBlueprint is one CANONICAL
// (orientation 0) recipe; `orientation` ∈ 0..3 rotates the WHOLE asset by 90° per step about
// the footprint centre — geometry (via the composeStructure turntable yaw), the footprint
// dims, the collision cells and the door anchors all turn together. ONE source of truth, so
// the rendered sprite, the occupancy claim and the door's facing direction always agree.
//
// Rotation sense (held identical across all three helpers, so the 3D door face and its
// collision cell point the SAME world direction): ONE quarter-turn maps a tile cell
// (x,y) in a w×h footprint to (h-1-y, x) in the resulting h×w footprint, and a facing
// vector [fx,fy] to [-fy,fx]. That matches `makeYawRotor`'s rotation at yaw = +π/2
// (rx = dx·cos−dy·sin, ry = dx·sin+dy·cos), so geometry yaw = +o·π/2 stays in lockstep.

export type Orientation = 0 | 1 | 2 | 3;

export const ORIENTATIONS: readonly Orientation[] = [0, 1, 2, 3];

/** Geometry turntable yaw (radians) for an orientation — +π/2 per quarter-turn. */
export function yawForOrientation(o: Orientation): number {
  return o * (Math.PI / 2);
}

/** Footprint dims after `o` quarter-turns (w/h swap on odd turns). */
export function rotateFootprint(w: number, h: number, o: Orientation): { w: number; h: number } {
  return o % 2 === 0 ? { w, h } : { w: h, h: w };
}

/** Rotate an integer cell (x,y) within a w×h footprint by `o` quarter-turns. Returns the
 *  cell in the rotated footprint (dims become {@link rotateFootprint}). */
export function rotateCell(x: number, y: number, w: number, h: number, o: Orientation): [number, number] {
  let cx = x, cy = y, cw = w, ch = h;
  const turns = ((o % 4) + 4) % 4;
  for (let i = 0; i < turns; i++) {
    [cx, cy] = [ch - 1 - cy, cx]; // (x,y) in cw×ch → (ch-1-y, x) in ch×cw
    [cw, ch] = [ch, cw];
  }
  return [cx, cy];
}

/** Rotate a 2D facing/direction vector by `o` quarter-turns ([fx,fy] → [-fy,fx] per turn). */
export function rotateFacing(fx: number, fy: number, o: Orientation): [number, number] {
  let x = fx, y = fy;
  const turns = ((o % 4) + 4) % 4;
  for (let i = 0; i < turns; i++) [x, y] = [-y, x];
  return [x, y];
}

/**
 * The orientation that best rotates a building's CANONICAL door facing (`cfx,cfy`) to point
 * toward a desired world direction (`dfx,dfy`, e.g. the road the door should front). Picks
 * the quarter-turn maximising the dot product; ties resolve to the smaller turn. A zero
 * desired vector yields the canonical orientation 0 (nothing to prefer).
 */
export function orientationForFacing(cfx: number, cfy: number, dfx: number, dfy: number): Orientation {
  if (dfx === 0 && dfy === 0) return 0;
  let best: Orientation = 0;
  let bestDot = -Infinity;
  for (const o of ORIENTATIONS) {
    const [rx, ry] = rotateFacing(cfx, cfy, o);
    const dot = rx * dfx + ry * dfy;
    if (dot > bestDot + 1e-9) { bestDot = dot; best = o; }
  }
  return best;
}
