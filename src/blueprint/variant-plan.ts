// src/blueprint/variant-plan.ts
// The variant DB layer. A "variant" is one resolved point in the asset space —
// a type crossed with an era, a descriptor combo, and a lifecycle stage. Each
// resolves to a ResolvedBlueprint whose canonicalJson IS its identity, so its
// art-cache key (generatedArtKey) is the database primary key shared by the
// seeder (writes the sprite) and the runtime art source (reads it). This module
// is the single source of truth for enumerating + keying that space, so the
// seed script, worldgen, and Fate all agree on what a variant's key is.
//
// Pure + Node-safe (no DOM): used both at author-time (seeding) and at runtime.
import type { AssetRequest } from './presets';
import { resolveAsset } from './presets';
import { assetCatalogue, type CatalogueEntry } from './catalogue';
import { stagesFor } from './lifecycle';
import { WEALTH_LEVELS } from './descriptors';
import { canonicalJson, generatedArtKey } from '@/render/generated-art-cache';
import type { Descriptors, Era } from './types';

/** A fully-resolved variant: the request that produced it, its database key, a
 *  human label, and the axes that distinguish it (for querying the manifest). */
export interface PlannedVariant {
  request: AssetRequest;
  key: string;                 // generatedArtKey — the variant DB primary key
  label: string;               // e.g. "tavern · classical · rich · ruin"
  type: string;
  era?: Era;
  descriptors?: Descriptors;
  stage?: string;
  tags: string[];              // descriptor tags (queryable facets)
}

/** A request matrix for ONE type: the cartesian product of the axes given. An
 *  omitted axis contributes its single "base/default" value (one row). */
export interface VariantSpec {
  type: string;
  eras?: Era[];
  descriptors?: Descriptors[];
  stages?: string[];
}

/** The canonical database key for a request — the ONE place this is computed, so
 *  the seeder and any retrieval path can never disagree. Returns null for an
 *  unknown type. */
export function variantKey(req: AssetRequest, model: string): string | null {
  const rb = resolveAsset(req);
  if (!rb) return null;
  return generatedArtKey(canonicalJson(rb), model, rb.footprint);
}

/** Enumerate a spec into concrete planned variants (deduped by key — a base-era /
 *  default-stage combo collapses onto the bare key, so it's listed once). */
export function planVariants(specs: VariantSpec[], model: string): PlannedVariant[] {
  const out: PlannedVariant[] = [];
  const seen = new Set<string>();
  for (const spec of specs) {
    const eras: (Era | undefined)[] = spec.eras?.length ? spec.eras : [undefined];
    const descs: (Descriptors | undefined)[] = spec.descriptors?.length ? spec.descriptors : [undefined];
    const stages: (string | undefined)[] = spec.stages?.length ? spec.stages : [undefined];
    for (const era of eras) for (const descriptors of descs) for (const stage of stages) {
      const request: AssetRequest = { type: spec.type, era, descriptors, stage };
      const rb = resolveAsset(request);
      if (!rb) continue;
      const key = generatedArtKey(canonicalJson(rb), model, rb.footprint);
      if (seen.has(key)) continue;
      seen.add(key);
      const tags = rb.descriptors?.tags ?? [];
      const labelBits = [spec.type, rb.era, rb.descriptors?.wealth, rb.descriptors?.quality, rb.stage].filter(Boolean);
      out.push({
        request, key, label: labelBits.join(' · '), type: spec.type,
        era: rb.era, descriptors: rb.descriptors, stage: rb.stage, tags,
      });
    }
  }
  return out;
}

/** A sensible default matrix to seed: every catalogue type at its base, plus the
 *  variants most worth pre-baking — buildings gain a poor + a rich + a ruined
 *  cut; plants gain their whole stage timeline (cheap, high gameplay value). The
 *  base/default rows collapse onto the existing library keys (no waste). */
export function defaultVariantMatrix(entries: CatalogueEntry[] = assetCatalogue()): VariantSpec[] {
  const poor = WEALTH_LEVELS[1];   // 'poor'
  const rich = WEALTH_LEVELS[4];   // 'rich'
  return entries.map((e): VariantSpec => {
    if (e.class === 'plant') {
      return { type: e.type, stages: [...stagesFor(e.class)] };
    }
    if (e.class === 'building') {
      return {
        type: e.type,
        descriptors: [{}, { wealth: poor }, { wealth: rich }],
        stages: ['complete', 'ruin'],
      };
    }
    return { type: e.type };   // props/terrain: base only for now
  });
}

/** Query a list of planned variants (the in-memory variant DB) by free text +
 *  faceted axes. Text matches type/label/tags; axes are exact. */
export interface VariantQuery { text?: string; type?: string; era?: string; stage?: string; wealth?: string; tag?: string }
export function queryVariants(variants: PlannedVariant[], q: VariantQuery): PlannedVariant[] {
  const text = q.text?.trim().toLowerCase();
  return variants.filter(v => {
    if (q.type && v.type !== q.type) return false;
    if (q.era && v.era !== q.era) return false;
    if (q.stage && (v.stage ?? '') !== q.stage) return false;
    if (q.wealth && v.descriptors?.wealth !== q.wealth) return false;
    if (q.tag && !v.tags.includes(q.tag)) return false;
    if (text && !(`${v.type} ${v.label} ${v.tags.join(' ')}`.toLowerCase().includes(text))) return false;
    return true;
  });
}
