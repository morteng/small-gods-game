// Interior I-2/I-3: a CUTAWAY view of a resolved blueprint — every body part gets
// `cutaway: true` (roof omitted + floor slab exposed), and (I-3) an `interior` plan
// derived from the latent connectome (partition walls + funnel floor). Pure +
// allocation-light: returns a structurally cloned blueprint with a DISTINCT JSON identity
// (so it earns its own art-cache key) when a body part exists, or the SAME object (a no-op)
// when there's nothing to open up or it is already cut away. The I-1 cutaway geometry
// (`buildingFacets`) reads these params.
import type { ResolvedBlueprint } from './types';
import { interiorPlan } from './interior';

export function cutawayOf(rb: ResolvedBlueprint): ResolvedBlueprint {
  // I-3: project the connectome rooms into partitions + a funnel floor (undefined when the
  // graph is absent — e.g. a save-rehydrated blueprint — so the cutaway stays an open shell).
  const interior = interiorPlan(rb);
  let changed = false;
  const parts = rb.parts.map((p) => {
    if (p.type !== 'body' || p.params.cutaway === true) return p;
    changed = true;
    return {
      ...p,
      params: { ...p.params, cutaway: true, ...(interior ? { interior } : {}) },
    };
  });
  if (!changed) return rb;
  const clone: ResolvedBlueprint = { ...rb, parts };
  // The connectome is attached NON-ENUMERABLY (out of the art-cache key), so the spread
  // above drops it — re-attach the same reference so downstream interior/agent reads survive.
  if (rb.connectome) {
    Object.defineProperty(clone, 'connectome', {
      value: rb.connectome, enumerable: false, writable: true, configurable: true,
    });
  }
  return clone;
}
