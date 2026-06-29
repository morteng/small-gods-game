/**
 * Settlement plan/tile reconciliation after a snapshot restore (S3).
 *
 * `restoreSnapshot` rebuilds entities from the snapshot but shares the map's
 * tiles BY REFERENCE, so runtime tile mutations made after the snapshot
 * (a grown dwelling's footprint, its claimed lot) would otherwise survive a
 * scrub-back as ghost obstacles. Reconciliation re-derives both from the
 * restored entities — nothing extra to serialize in the Snapshot:
 *
 *   1. Every lot tile resets to walkable (lot tiles are buildable ground by
 *      construction) and every `lot.buildingId` clears.
 *   2. Every restored building entity re-stamps its footprint (non-walkable
 *      except door cells) and re-claims the lot its footprint intersects.
 *
 * Ground-type divergence (grass where a scrubbed-away building stood) is
 * accepted as cosmetic; the vegetation entities themselves are restored by
 * the snapshot. Idempotent; also safe on autosave resume.
 */

import type { GameMap } from '@/core/types';
import type { World } from '@/world/world';
import { blueprintOf } from '@/blueprint/entity';
import { isBuilding } from '@/world/building-collision';

export function reconcileSettlementTiles(map: GameMap, world: World): void {
  const plans = map.settlementPlans;
  if (!plans?.length) return;

  // Lot tile → lot lookup while resetting.
  const lotAt = new Map<string, { buildingId?: string }>();
  for (const plan of plans) {
    for (const lot of plan.lots) {
      lot.buildingId = undefined;
      for (const t of lot.tiles) {
        const tile = map.tiles[t.y]?.[t.x];
        if (tile) tile.walkable = true;
        lotAt.set(`${t.x},${t.y}`, lot);
      }
    }
  }

  for (const e of world.query({})) {
    const bp = blueprintOf(e);
    if (!bp) continue;
    // Only true buildings re-stamp their footprint non-walkable. Infrastructure
    // props (bridge decks, stairs) and barriers carry blueprints too, but their
    // tiles are deliberately traversable (road/bridge cells carved walkable by
    // the road graph) — re-stamping them here severed every crossing on restore.
    if (!isBuilding(e)) continue;
    const doorCells = new Set(bp.collision.doorCells);
    for (let dy = 0; dy < bp.collision.footprint.h; dy++) {
      for (let dx = 0; dx < bp.collision.footprint.w; dx++) {
        const tx = e.x + dx, ty = e.y + dy;
        const tile = map.tiles[ty]?.[tx];
        if (tile) tile.walkable = doorCells.has(`${dx},${dy}`);
        const lot = lotAt.get(`${tx},${ty}`);
        if (lot && !lot.buildingId) lot.buildingId = e.id;
      }
    }
  }
}
