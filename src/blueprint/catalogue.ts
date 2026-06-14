// src/blueprint/catalogue.ts
// The queryable asset catalogue — a faceted index over every Blueprint preset, for
// BOTH the studio object browser (humans) and agents (Fate / world-authoring) that
// retrieve assets by meaning rather than hard-coded preset name. v1 facets: class,
// category, era, tags. Later slices extend CatalogueEntry with descriptors[],
// eras[] and lifecycle stages[] (see
// docs/superpowers/specs/2026-06-14-asset-catalogue-variant-lifecycle-design.md).
import type { EntityClass, Era } from './types';
import { BUILDING_BLUEPRINTS } from './presets';

export interface CatalogueEntry {
  type: string;                       // preset key (becomes entity.kind)
  class: EntityClass;
  category: string;
  era?: Era;
  footprint: { w: number; h: number };
  tags: string[];                     // searchable: materials + category + era + class
}

export interface CatalogueQuery {
  text?: string;                      // substring over type / category / tags
  class?: string;
  category?: string;
  era?: string;
}

/** Build the catalogue from the preset map. Pure derivation — no geometry resolve,
 *  so it is cheap to call on mount and re-call as presets grow. */
export function assetCatalogue(): CatalogueEntry[] {
  const out: CatalogueEntry[] = [];
  for (const [type, bp] of Object.entries(BUILDING_BLUEPRINTS)) {
    const mats = bp.materials ? Object.values(bp.materials) : [];
    const tags = [...new Set([bp.category, bp.era, bp.class, ...mats].filter(Boolean) as string[])];
    out.push({
      type, class: bp.class, category: bp.category ?? 'misc', era: bp.era,
      footprint: bp.footprint, tags,
    });
  }
  return out.sort((a, b) =>
    (a.class).localeCompare(b.class) || a.category.localeCompare(b.category) || a.type.localeCompare(b.type));
}

/** Filter a catalogue by facets + a free-text substring (matches type/category/tags). */
export function queryCatalogue(entries: CatalogueEntry[], q: CatalogueQuery): CatalogueEntry[] {
  const text = q.text?.trim().toLowerCase() ?? '';
  return entries.filter((e) => {
    if (q.class && e.class !== q.class) return false;
    if (q.category && e.category !== q.category) return false;
    if (q.era && e.era !== q.era) return false;
    if (text) {
      const hay = `${e.type} ${e.category} ${e.tags.join(' ')}`.toLowerCase();
      if (!hay.includes(text)) return false;
    }
    return true;
  });
}
