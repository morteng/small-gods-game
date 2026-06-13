// src/world/civic.ts
// Civic-entity helpers shared by worldgen and the sim. S6: graveyard-filling.
import type { World } from '@/world/world';

/**
 * Tally one burial against a settlement's graveyard (S6). A 2×2 churchyard can't
 * physically hold centuries of dead, so the graveyard accrues a `buried` COUNT
 * rather than relocating remains — the dead NPC still lives on as a persistent
 * `remains` entity (the persistence principle is untouched); the graveyard just
 * records that the ground received it.
 *
 * No-op when the settlement has no graveyard (a camp, a road-less POI, a lake).
 * Pure + deterministic — no rng — so it reproduces identically under live
 * mortality and the closed-form time-skip (both route deaths through killNpc).
 */
export function recordBurial(world: World, poiId: string | undefined): void {
  if (!poiId) return;
  for (const g of world.query({ kind: 'graveyard' })) {
    if (g.properties?.poiId !== poiId) continue;
    const prev = typeof g.properties.buried === 'number' ? g.properties.buried : 0;
    g.properties.buried = prev + 1;
    return;
  }
}
