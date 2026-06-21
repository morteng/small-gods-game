// src/flora/biome-flora.ts
//
// Canonical biome → flora-species pools. Worldgen brushes emit these SPECIES IDS
// (drawn from the flora fact DB, src/flora/flora-facts-data.ts) directly — the
// render layer resolves each to a parametric SpritePack via synthesizeBlueprint
// (see blueprint/presets `floraSpeciesBlueprint`), and entity-kinds derives a
// catalog face for each (see world/entity-kinds `floraKindDef`). This replaces
// the old hand-authored generic blob kinds (oak_tree/pine_tree/cactus/…), so a
// placed tree is a real species with botanically-derived geometry + ecology.
//
// Pools are weighted [speciesId, weight][]; undergrowth carries its own density.
// Only NW-European temperate biomes are covered today (the fact DB is a tight
// British set); desert/savanna/tropical/tundra await the species-expansion slice.

/** A biome's flora: a weighted canopy pool + lower-density undergrowth pool. */
export interface FloraPool {
  /** Primary layer: [speciesId, weight]. */
  canopy: ReadonlyArray<readonly [string, number]>;
  /** Undergrowth: [speciesId, weight, density] (placed only where canopy grew). */
  undergrowth: ReadonlyArray<readonly [string, number, number]>;
}

/** Tile-type / biome key → species pool. Keys match the brushes' `tileType`. */
export const BIOME_FLORA: Readonly<Record<string, FloraPool>> = {
  forest: {
    canopy: [
      ['english-oak', 0.35],
      ['european-beech', 0.25],
      ['european-ash', 0.2],
      ['small-leaved-lime', 0.12],
      ['silver-birch', 0.08],
    ],
    undergrowth: [
      ['common-hazel', 0.4, 0.05],
      ['bracken', 0.35, 0.05],
      ['bramble', 0.25, 0.04],
    ],
  },
  dense_forest: {
    canopy: [
      ['english-oak', 0.4],
      ['european-beech', 0.35],
      ['silver-birch', 0.25],
    ],
    undergrowth: [
      ['lady-fern', 0.4, 0.1],
      ['bramble', 0.3, 0.08],
      ['common-hazel', 0.3, 0.06],
    ],
  },
  pine_forest: {
    canopy: [
      ['scots-pine', 0.55],
      ['norway-spruce', 0.35],
      ['silver-birch', 0.1],
    ],
    undergrowth: [
      ['common-juniper', 0.5, 0.05],
      ['heather', 0.5, 0.04],
    ],
  },
  scrubland: {
    canopy: [
      ['common-hawthorn', 0.3],
      ['blackthorn', 0.25],
      ['gorse', 0.2],
      ['common-broom', 0.15],
      ['elder', 0.1],
    ],
    undergrowth: [
      ['heather', 0.5, 0.05],
      ['foxglove', 0.3, 0.03],
      ['common-poppy', 0.2, 0.03],
    ],
  },
  sacred_grove: {
    canopy: [
      ['english-oak', 0.36],
      ['european-yew', 0.26],
      ['silver-birch', 0.18],
      ['weeping-birch', 0.1],
      ['fastigiate-oak', 0.1],
      ['lombardy-poplar', 0.08],
    ],
    undergrowth: [
      ['foxglove', 0.6, 0.06],
      ['lady-fern', 0.4, 0.05],
    ],
  },
  /** Riparian/wetland margins (swamp tiles, water-adjacent coastal). */
  wetland: {
    canopy: [
      ['white-willow', 0.42],
      ['weeping-willow', 0.3],
      ['downy-birch', 0.13],
      ['black-poplar', 0.15],
      ['weeping-ash', 0.1],
    ],
    undergrowth: [
      ['heather', 1.0, 0.04],
    ],
  },
};

/** Mutable-tuple view of a pool's canopy, for APIs typed as `[string, number][]`. */
export function canopyOf(biome: string): [string, number][] {
  return (BIOME_FLORA[biome]?.canopy ?? []).map(([id, w]) => [id, w] as [string, number]);
}

/** Mutable-tuple view of a pool's undergrowth. */
export function undergrowthOf(biome: string): [string, number, number][] {
  return (BIOME_FLORA[biome]?.undergrowth ?? []).map(([id, w, d]) => [id, w, d] as [string, number, number]);
}
