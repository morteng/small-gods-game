// src/world/road-corridors.ts
//
// Connectome loosening (Roads Slice 3). Worldgen places settlements + buildings first, then
// inter-POI roads thread AROUND them. When a settlement sprawls across the direct line between
// two connected POIs, the road is forced into a bad detour. This module reserves a keep-clear
// CORRIDOR band along each planned connection so building placement leaves the trunk route open
// — "loosen connectome placement to make room for good road placement."
//
// The corridor is a straight funnel between endpoints (the road may still curve within/around
// it for terrain); it deliberately EXCLUDES a disc around each POI centre so settlements still
// form at their hubs. Pure + deterministic — a set of "x,y" keys derived from POIs + connections.

import type { POI, Connection } from '@/core/types';

export interface CorridorOptions {
  /** Half-width of the reserved band, in tiles (each side of the centre line). Default 1. */
  margin?: number;
  /** Keep-clear is suppressed within this many tiles of a POI centre (so hubs still build). Default 3. */
  hubRadius?: number;
}

const key = (x: number, y: number) => `${x},${y}`;

/**
 * The set of cells reserved as trunk corridor between connected POIs. Building placement should
 * treat these as obstacles so the direct route stays open. Excludes a `hubRadius` disc around
 * each POI centre. Deterministic; bounds are not enforced here (callers clip to the grid).
 */
export function corridorCells(
  pois: POI[],
  connections: Connection[] | undefined,
  opts: CorridorOptions = {},
): Set<string> {
  const margin = opts.margin ?? 1;
  const hubRadius = opts.hubRadius ?? 3;
  const out = new Set<string>();
  if (!connections?.length) return out;

  const posById = new Map<string, { x: number; y: number }>();
  for (const p of pois) if (p.position) posById.set(p.id, p.position);

  const hubs = [...posById.values()];
  const nearHub = (x: number, y: number): boolean =>
    hubs.some((h) => Math.abs(h.x - x) <= hubRadius && Math.abs(h.y - y) <= hubRadius);

  for (const conn of connections) {
    if (conn.type === 'river' || conn.type === 'wall') continue; // only road-like connections
    const a = posById.get(conn.from);
    const b = posById.get(conn.to);
    if (!a || !b) continue;
    for (const c of thickLine(a, b, margin)) {
      if (!nearHub(c.x, c.y)) out.add(key(c.x, c.y));
    }
  }
  return out;
}

/** A point set covering a `margin`-dilated straight line from a to b (integer cells). */
function thickLine(a: { x: number; y: number }, b: { x: number; y: number }, margin: number): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  const dx = b.x - a.x, dy = b.y - a.y;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  if (steps === 0) return cells;
  for (let i = 0; i <= steps; i++) {
    const cx = Math.round(a.x + (dx * i) / steps);
    const cy = Math.round(a.y + (dy * i) / steps);
    for (let oy = -margin; oy <= margin; oy++) {
      for (let ox = -margin; ox <= margin; ox++) {
        cells.push({ x: cx + ox, y: cy + oy });
      }
    }
  }
  return cells;
}
