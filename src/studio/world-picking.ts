// src/studio/world-picking.ts
//
// Hit-testing for the world-studio drill-down. The connectome is projected with
// terrain lift (non-affine), so rather than invert the projection we FORWARD-
// project every candidate node to screen space and pick the nearest within a
// pixel radius — robust and exactly parity with what the overlay draws.

import type { Camera, GameMap, POI, BuildingInstance } from '@/core/types';
import type { SettlementPlan } from '@/world/settlement-plan';
import { projectConnectome } from '@/render/connectome-overlay';

/** The connectome drill hierarchy: world → settlement → building. */
export type Focus =
  | { level: 'world' }
  | { level: 'settlement'; poiId: string; poi: POI | null; plan: SettlementPlan }
  | { level: 'building'; building: BuildingInstance; plan: SettlementPlan | null };

const sq = (n: number): number => n * n;

/** The settlement plan owned by a POI (matched on `poiId`), or null. */
export function planForPoi(map: GameMap, poiId: string | undefined): SettlementPlan | null {
  if (!poiId) return null;
  return (map.settlementPlans ?? []).find((p) => p.poiId === poiId) ?? null;
}

/** Every building owned by a settlement (matched on `poiId`). */
export function buildingsOf(map: GameMap, poiId: string | undefined): BuildingInstance[] {
  if (!poiId) return [];
  return (map.buildings ?? []).filter((b) => b.poiId === poiId);
}

/** Tile-space bounding box of a settlement plan (nodes + lot tiles + edges). */
export function planBounds(plan: SettlementPlan): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const eat = (x: number, y: number): void => {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  };
  for (const n of plan.nodes) eat(n.x, n.y);
  for (const l of plan.lots) for (const t of l.tiles) eat(t.x, t.y);
  for (const e of plan.edges) for (const t of e.tiles) eat(t.x, t.y);
  if (!Number.isFinite(minX)) { const c = plan.center; return { x: c.x - 4, y: c.y - 4, w: 8, h: 8 }; }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Nearest POI (with a position) to a screen point, within `radiusPx`. */
export function pickPoi(
  map: GameMap, cam: Camera, sx: number, sy: number, radiusPx = 16,
): POI | null {
  const pois = map.worldSeed?.pois ?? [];
  let best: POI | null = null, bestD = sq(radiusPx);
  for (const poi of pois) {
    if (!poi.position) continue;
    const p = projectConnectome(map, poi.position.x, poi.position.y, cam);
    const d = sq(p.x - sx) + sq(p.y - sy);
    if (d <= bestD) { bestD = d; best = poi; }
  }
  return best;
}

/** Nearest building (footprint origin) to a screen point, within `radiusPx`.
 *  Pass a building subset to scope the pick to one settlement. */
export function pickBuilding(
  buildings: BuildingInstance[], map: GameMap, cam: Camera,
  sx: number, sy: number, radiusPx = 14,
): BuildingInstance | null {
  let best: BuildingInstance | null = null, bestD = sq(radiusPx);
  for (const b of buildings) {
    const p = projectConnectome(map, b.tileX, b.tileY, cam);
    const d = sq(p.x - sx) + sq(p.y - sy);
    if (d <= bestD) { bestD = d; best = b; }
  }
  return best;
}
