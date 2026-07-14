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
      ['common-hazel', 0.4, 0.09],   // raised 0.05→0.09 (~1.75x, density pass)
      ['bracken', 0.35, 0.09],       // raised 0.05→0.09 (~1.75x, density pass)
      ['bramble', 0.25, 0.07],       // raised 0.04→0.07 (~1.75x, density pass)
    ],
  },
  dense_forest: {
    canopy: [
      ['english-oak', 0.4],
      ['european-beech', 0.35],
      ['silver-birch', 0.25],
    ],
    undergrowth: [
      ['lady-fern', 0.4, 0.18],      // raised 0.1→0.18 (~1.75x, density pass)
      ['bramble', 0.3, 0.14],        // raised 0.08→0.14 (~1.75x, density pass)
      ['common-hazel', 0.3, 0.11],   // raised 0.06→0.11 (~1.75x, density pass)
    ],
  },
  pine_forest: {
    canopy: [
      ['scots-pine', 0.55],
      ['norway-spruce', 0.35],
      ['silver-birch', 0.1],
    ],
    undergrowth: [
      ['common-juniper', 0.5, 0.09],   // raised 0.05→0.09 (~1.75x, density pass)
      ['heather', 0.5, 0.07],          // raised 0.04→0.07 (~1.75x, density pass)
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
      ['heather', 0.5, 0.09],         // raised 0.05→0.09 (~1.75x, density pass)
      ['foxglove', 0.3, 0.05],        // raised 0.03→0.05 (~1.75x, density pass)
      ['common-poppy', 0.2, 0.05],    // raised 0.03→0.05 (~1.75x, density pass)
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
      ['foxglove', 0.6, 0.11],        // raised 0.06→0.11 (~1.75x, density pass)
      ['lady-fern', 0.4, 0.09],       // raised 0.05→0.09 (~1.75x, density pass)
    ],
  },
  /** Open grassland / meadow ground cover — 'grass'/'meadow'/'glen' TILES, which
   *  make up 50-70% of grassland biomes and historically had NO flora brush at all
   *  (the "why is there no grass or flowers" gap). Canopy here IS the ground cover:
   *  tussocks + wildflowers, with the odd free-standing shrub. */
  grassland: {
    canopy: [
      ['tussock-grass', 0.61],
      ['oxeye-daisy', 0.17],
      ['common-poppy', 0.10],
      ['foxglove', 0.04],
      ['common-hawthorn', 0.04],
      ['gorse', 0.04],
    ],
    undergrowth: [
      ['field-stone', 1.0, 0.012],
    ],
  },
  /** Riparian/wetland margins (swamp tiles, water-adjacent coastal). */
  wetland: {
    canopy: [
      ['white-willow', 0.36],
      ['weeping-willow', 0.26],
      ['common-alder', 0.16],   // the classic wet-woodland riverbank tree
      ['downy-birch', 0.11],
      ['black-poplar', 0.12],
      ['weeping-ash', 0.08],
    ],
    undergrowth: [
      ['common-reed', 0.4, 0.14],   // reedbeds fringe the wet margin
      ['carex-sedge', 0.3, 0.10],
      ['heather', 0.3, 0.05],
    ],
  },
  /** Alpine dwarf-shrub layer — the hardy heath/scrub that survives above the
   *  treeline on mountain/rocky/hills ground. The hills brush pairs this with its
   *  own rock + tussock vocabulary (rocks aren't flora-DB species). */
  alpine: {
    canopy: [
      ['heather', 0.5],
      ['common-juniper', 0.32],   // prostrate montane juniper
      ['gorse', 0.18],
    ],
    undergrowth: [
      ['heather', 0.6, 0.18],
      ['common-juniper', 0.4, 0.12],
    ],
  },
  /** Hot arid ground — mostly BARE (deserts read empty). Sparse salt-tolerant
   *  shrubs + esparto tussocks clumped around nothing in particular, the odd thistle. */
  desert: {
    canopy: [
      ['esparto-grass', 0.44],
      ['tamarisk', 0.2],
      ['white-wormwood', 0.18],
      ['common-juniper', 0.1],    // a lone juniper on rockier ground
      ['cotton-thistle', 0.08],
    ],
    undergrowth: [
      ['white-wormwood', 0.6, 0.05],
      ['cotton-thistle', 0.4, 0.03],
    ],
  },
  /** Wet lowland (swamp/fen) — alder + willow + downy-birch canopy over dense
   *  reed/bulrush/sedge near standing water. */
  swamp: {
    canopy: [
      ['common-alder', 0.34],
      ['white-willow', 0.22],
      ['weeping-willow', 0.2],
      ['downy-birch', 0.14],
      ['black-poplar', 0.1],
    ],
    undergrowth: [
      ['common-reed', 0.4, 0.28],
      ['bulrush', 0.3, 0.18],
      ['carex-sedge', 0.3, 0.16],
    ],
  },
  /** Tropical/temperate savanna — dry grass sea with very sparse thorn scrub
   *  (differentiates the warm grasslands from temperate hedgerow scrub). */
  savanna: {
    canopy: [
      ['tussock-grass', 0.62],
      ['esparto-grass', 0.2],
      ['common-hawthorn', 0.1],   // the lone thorn tree of the grass sea
      ['blackthorn', 0.08],
    ],
    undergrowth: [
      ['cotton-thistle', 0.5, 0.04],
      ['common-poppy', 0.5, 0.04],
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
