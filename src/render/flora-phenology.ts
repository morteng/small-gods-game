// src/render/flora-phenology.ts
// Render-side species phenology: which flora kinds drop their leaves, and the
// snow-driven variant selection built on it (alpine fidelity). The species facts
// live in the flora DB (src/flora/flora-species.ts leafPhenology); this module is
// the kind→phenology lookup the draw list reads per vegetation entity, memoised
// because the registry lookup runs for every flora instance on a static rebuild.

import { getFloraSpecies } from '@/flora/flora-registry';
import type { LeafPhenology } from '@/flora/flora-species';
import { FLORA_BARE_VARIANT, FLORA_VARIANTS, floraVariantBucket } from '@/render/flora-variant';

/** Snow amount (snowAmount01) above which a deciduous species swaps to its bare
 *  crown. No hysteresis needed — the mask is static per world. */
export const SNOW_BARE_THRESHOLD = 0.35;

const phenologyByKind = new Map<string, LeafPhenology | null>();

/** Leaf phenology for a flora kind, or null when the kind is not a flora-DB
 *  species (hand presets, rocks, landforms — none of which go bare). */
export function floraLeafPhenology(kind: string): LeafPhenology | null {
  let p = phenologyByKind.get(kind);
  if (p === undefined) {
    p = getFloraSpecies(kind)?.botanical.leafPhenology ?? null;
    phenologyByKind.set(kind, p);
  }
  return p;
}

/** True only for genuinely deciduous species — semi-evergreens and evergreens keep
 *  their crown in snow and rely on the per-instance whiten instead. */
export function isDeciduousFloraKind(kind: string): boolean {
  return floraLeafPhenology(kind) === 'deciduous';
}

/**
 * The variant the draw list should render for a flora instance: the bare-crown
 * slot when a deciduous species stands in snow, else its seeded silhouette bucket.
 * Snow here is the STATIC altitude/cold mask only — a future SEASONAL leaf drop
 * (calendar-driven) would multiply its own term into the amount compared against
 * the threshold, keeping this the single selection point.
 */
export function floraVariantForSnow(kind: string, entityId: string, snow01: number): number {
  if (snow01 >= SNOW_BARE_THRESHOLD && isDeciduousFloraKind(kind)) return FLORA_BARE_VARIANT;
  return floraVariantBucket(entityId, FLORA_VARIANTS);
}
