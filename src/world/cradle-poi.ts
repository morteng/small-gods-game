// src/world/cradle-poi.ts
//
// Deterministic seed-POI selection, shared by the cradle spawner and the
// origin-profile (the opening's place + first-mind variety both key off the
// cradle). Pure — reads only the POI list, no world access, no RNG.

import type { POI } from '@/core/types';

/** The founding flock belongs in a humble DWELLING, not whatever inhabited POI
 *  happens to sort first in array order — which once put a MINE (ironvein) ahead
 *  of the villages, founding the whole religion at a mineshaft near map-centre.
 *  Prefer a village, then other settlement types; a mine/quarry ranks last and is
 *  chosen only if nothing else is inhabited. Deterministic: ties break on authored-
 *  npc count (a busier town first), then id. */
const CRADLE_TYPE_RANK: Record<string, number> = {
  village: 0, hamlet: 1, town: 2, city: 3, port: 4, castle: 5, farm: 6, temple: 7,
};

/** Pick the seed POI: the first inhabited, positioned settlement by type rank.
 *  Returns `undefined` when no POI is inhabited or positioned (a terrain-only
 *  genome is pure ground — no cradle). */
export function pickCradlePoi(pois: POI[]): POI | undefined {
  const inhabited = pois.filter(p => p.npcs && p.npcs.length > 0 && p.position);
  if (inhabited.length === 0) return undefined;
  return inhabited.slice().sort((a, b) => {
    const ra = CRADLE_TYPE_RANK[a.type] ?? 90;
    const rb = CRADLE_TYPE_RANK[b.type] ?? 90;
    if (ra !== rb) return ra - rb;
    const na = a.npcs?.length ?? 0, nb = b.npcs?.length ?? 0;
    if (na !== nb) return nb - na;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  })[0];
}
