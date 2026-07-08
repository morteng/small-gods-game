// src/blueprint/catalogue.ts
// The queryable asset catalogue — a faceted index over every Blueprint preset, for
// BOTH the studio object browser (humans) and agents (Fate / world-authoring) that
// retrieve assets by meaning rather than hard-coded preset name. v1 facets: class,
// category, era, tags. Later slices extend CatalogueEntry with descriptors[],
// eras[] and lifecycle stages[] (see
// docs/superpowers/specs/2026-06-14-asset-catalogue-variant-lifecycle-design.md).
import type { EntityClass, Era, Descriptors } from './types';
import { BUILDING_BLUEPRINTS } from './presets';
import { BRIDGE_RECIPES, bridgeBlueprint } from './presets/bridges';
import { WEALTH_LEVELS, QUALITY_LEVELS, CONDITION_LEVELS } from './descriptors';
import { allFloraSpecies } from '@/flora/flora-registry';
import { deriveGenParams, taxon } from '@/flora/flora-species';

export interface CatalogueEntry {
  type: string;                       // preset key (becomes entity.kind)
  class: EntityClass;
  category: string;
  era?: Era;
  footprint: { w: number; h: number };
  tags: string[];                     // searchable: materials + category + era + class
  /** Descriptor axes this type meaningfully supports (empty for plants/props that
   *  don't vary by wealth). Drives the studio variant pickers + agent queries. */
  descriptorAxes: { wealth?: readonly string[]; quality?: readonly string[]; condition?: readonly string[] };
  defaults?: Descriptors;             // the preset's baseline descriptors, if any
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
    // Buildings + props vary by wealth/quality/condition; plants (trees) do not.
    const supportsDescriptors = bp.class === 'building' || bp.class === 'prop';
    out.push({
      type, class: bp.class, category: bp.category ?? 'misc', era: bp.era,
      footprint: bp.footprint, tags,
      descriptorAxes: supportsDescriptors
        ? { wealth: WEALTH_LEVELS, quality: QUALITY_LEVELS, condition: CONDITION_LEVELS }
        : {},
      defaults: bp.descriptors,
    });
  }
  // Bridges — parametric props assembled from one recipe (see presets/bridges). Surface them
  // as `infrastructure` props so the studio picker + agents can select a specific bridge form.
  for (const [short, recipe] of Object.entries(BRIDGE_RECIPES)) {
    const type = `bridge-${short}`;
    const bp = bridgeBlueprint(recipe, type);
    const tags = [...new Set(['bridge', 'infrastructure', recipe.walls, ...Object.values(bp.materials ?? {})].filter(Boolean) as string[])];
    out.push({
      type, class: bp.class, category: bp.category ?? 'infrastructure',
      footprint: bp.footprint, tags, descriptorAxes: {},
    });
  }
  // Flora-DB species (english-oak, scots-pine, the cultivars…) are blueprints too,
  // via floraSpeciesBlueprint — surface them so the studio/agents can pick a
  // *particular* species or cultivar, searchable by family / genus / cultivar /
  // crown / biome (not just the hand-authored `*_branched` presets).
  for (const sp of allFloraSpecies()) {
    const g = deriveGenParams(sp);
    const t = taxon(sp.identity);
    const tags = [...new Set([
      'flora', g.kind, g.generator, g.crownShape, sp.botanical.habit, sp.botanical.leafType,
      sp.identity.family, t.genus, t.cultivar, ...sp.ecology.biome,
    ].filter(Boolean) as string[])];
    out.push({
      type: sp.id,
      class: g.kind === 'rock' ? 'terrain_feature' : 'plant',
      category: 'flora',
      footprint: { w: 1, h: 1 },
      tags,
      descriptorAxes: {},
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
