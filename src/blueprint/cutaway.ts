// Interior I-2: a CUTAWAY view of a resolved blueprint — every body part gets
// `cutaway: true` (roof omitted + floor slab exposed), the geometry the focus reveal
// swaps in when a building is selected. Pure + allocation-light: returns a structurally
// cloned blueprint with a DISTINCT JSON identity (so it earns its own art-cache key)
// when a body part exists, or the SAME object (a no-op) when there's nothing to open up
// or it is already cut away. The I-1 cutaway geometry (`buildingFacets`) reads this flag.
import type { ResolvedBlueprint } from './types';

export function cutawayOf(rb: ResolvedBlueprint): ResolvedBlueprint {
  let changed = false;
  const parts = rb.parts.map((p) => {
    if (p.type !== 'body' || p.params.cutaway === true) return p;
    changed = true;
    return { ...p, params: { ...p.params, cutaway: true } };
  });
  return changed ? { ...rb, parts } : rb;
}
