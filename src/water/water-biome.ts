// src/water/water-biome.ts
//
// Water S4 — aquatic biomes as an AXIS SPACE (like the flora fact-DB), not an
// enumerated list. A biome is picked by (salinity × flowRegime × climate) and a
// depth ZONE within it is the `depth` the shader already computes (littoral →
// profundal). Each biome carries the appearance the water shader reads — a
// shallow→deep palette + a single `clarity` scalar that sets blend depth, caustic
// reach (S5) and submerged-flora visibility — plus the ecology S4b/S6 will place
// (bed substrate, rocks, submerged/emergent/bank flora, fauna).
//
// Grounded in limnology (lotic = flowing / lentic = still; littoral/profundal
// zones; riparian banks). Curated for the temperate-medieval default world, with
// boreal/arid/highland variants so climate visibly changes the water.

import { WaterType } from '@/core/types';

export type Salinity = 'fresh' | 'brackish' | 'marine';
export type FlowRegime = 'lotic' | 'lentic' | 'tidal';
export type Climate = 'temperate' | 'boreal' | 'arid' | 'highland';
/** Depth zone within a body — selected by the shader's per-cell depth, not stored. */
export type DepthZone = 'littoral' | 'sublittoral' | 'profundal';

/** Linear-RGB triple, 0..1 (matches the shader's colour space). */
export type Rgb = [number, number, number];

export interface AquaticBiome {
  id: string;
  /** Selection axes. */
  salinity: Salinity;
  flowRegime: FlowRegime;
  climate: Climate;
  /** Appearance the water shader consumes. */
  shallowColor: Rgb;
  deepColor: Rgb;
  /** 0 = opaque/silty (no see-through), 1 = gin-clear. Sets blend depth + caustic reach. */
  clarity: number;
  /** Ecology (placed by S4b banks / S6 fauna — carried here as the single source). */
  bedSubstrate: string;
  rockSet: string[];
  submergedFlora: string[];
  emergentFlora: string[];
  bankFlora: string[];
  fauna: string[];
  /** Verbatim Wikipedia facts + source article titles (connectome grounding). */
  keyFacts: string[];
  sources: string[];
}

// ── The curated catalogue ───────────────────────────────────────────────────
export const WATER_BIOMES: AquaticBiome[] = [
  {
    id: 'temperate-ocean', salinity: 'marine', flowRegime: 'tidal', climate: 'temperate',
    shallowColor: [0.30, 0.62, 0.74], deepColor: [0.06, 0.27, 0.42], clarity: 0.5,
    bedSubstrate: 'sand', rockSet: ['boulder', 'shingle'],
    submergedFlora: ['kelp', 'eelgrass'], emergentFlora: ['glasswort'],
    bankFlora: ['marram-grass', 'sea-buckthorn'], fauna: ['herring-shoal', 'gull', 'crab'],
    keyFacts: [
      'An ocean is a body of salt water that composes much of a planet’s hydrosphere.',
      'The littoral zone is the part of a sea, lake, or river that is close to the shore.',
    ],
    sources: ['Ocean', 'Littoral zone'],
  },
  {
    id: 'temperate-lake', salinity: 'fresh', flowRegime: 'lentic', climate: 'temperate',
    shallowColor: [0.27, 0.58, 0.70], deepColor: [0.10, 0.34, 0.47], clarity: 0.5,
    bedSubstrate: 'mud', rockSet: ['cobble'],
    submergedFlora: ['pondweed', 'water-milfoil'], emergentFlora: ['common-reed', 'water-lily'],
    bankFlora: ['willow', 'alder', 'sedge'], fauna: ['carp', 'mallard', 'heron'],
    keyFacts: [
      'A lake is an area filled with water, localized in a basin, surrounded by land.',
      'Lentic ecosystems refer to standing or still fresh waters such as lakes and ponds.',
    ],
    sources: ['Lake', 'Lake ecosystem'],
  },
  {
    id: 'temperate-river', salinity: 'fresh', flowRegime: 'lotic', climate: 'temperate',
    shallowColor: [0.36, 0.66, 0.78], deepColor: [0.16, 0.42, 0.55], clarity: 0.45,
    bedSubstrate: 'gravel', rockSet: ['cobble', 'boulder'],
    submergedFlora: ['water-crowfoot'], emergentFlora: ['bur-reed', 'yellow-iris'],
    bankFlora: ['willow', 'alder', 'reed'], fauna: ['trout', 'kingfisher', 'otter'],
    keyFacts: [
      'A river is a natural flowing watercourse, usually freshwater, flowing towards an ocean, sea, lake or another river.',
      'Lotic waters range from springs only a few centimetres wide to major rivers; they are flowing-water ecosystems.',
    ],
    sources: ['River', 'River ecosystem'],
  },
  {
    id: 'boreal-lake', salinity: 'fresh', flowRegime: 'lentic', climate: 'boreal',
    shallowColor: [0.20, 0.44, 0.52], deepColor: [0.05, 0.18, 0.28], clarity: 0.7,
    bedSubstrate: 'peat', rockSet: ['granite-boulder'],
    submergedFlora: ['quillwort'], emergentFlora: ['cottongrass'],
    bankFlora: ['spruce', 'birch', 'bilberry'], fauna: ['pike', 'loon'],
    keyFacts: [
      'Boreal lakes are often dark-stained by dissolved organic carbon (humic) from surrounding peatlands and conifer forest.',
    ],
    sources: ['Lake'],
  },
  {
    id: 'arid-lake', salinity: 'brackish', flowRegime: 'lentic', climate: 'arid',
    shallowColor: [0.40, 0.74, 0.78], deepColor: [0.14, 0.46, 0.52], clarity: 0.75,
    bedSubstrate: 'silt', rockSet: ['limestone'],
    submergedFlora: ['stonewort'], emergentFlora: ['bulrush', 'tamarisk'],
    bankFlora: ['date-palm', 'tamarisk'], fauna: ['tilapia', 'flamingo'],
    keyFacts: [
      'Endorheic lakes in arid basins have no outflow and tend toward brackish or saline water as evaporation concentrates dissolved salts.',
    ],
    sources: ['Endorheic basin'],
  },
  {
    id: 'highland-river', salinity: 'fresh', flowRegime: 'lotic', climate: 'highland',
    shallowColor: [0.42, 0.72, 0.82], deepColor: [0.18, 0.46, 0.60], clarity: 0.85,
    bedSubstrate: 'boulder', rockSet: ['granite-boulder', 'scree'],
    submergedFlora: ['moss'], emergentFlora: ['rush'],
    bankFlora: ['rowan', 'juniper'], fauna: ['trout', 'dipper'],
    keyFacts: [
      'Headwater mountain streams are cold, fast and well-oxygenated, with clear water over a coarse boulder-and-cobble bed.',
    ],
    sources: ['Stream'],
  },
];

const BY_ID = new Map(WATER_BIOMES.map((b) => [b.id, b]));

/** Coarse climate band from a world/biome label (temperate default). */
export function climateOf(biome: string | null | undefined): Climate {
  const b = (biome ?? '').toLowerCase();
  if (/boreal|taiga|tundra|subarctic|cold/.test(b)) return 'boreal';
  if (/desert|arid|savanna|steppe|dry/.test(b)) return 'arid';
  if (/highland|alpine|mountain|montane/.test(b)) return 'highland';
  return 'temperate';
}

/** Water-body kind from the cell's WaterType. */
function bodyKind(wt: WaterType): 'ocean' | 'lake' | 'river' | null {
  switch (wt) {
    case WaterType.Ocean: return 'ocean';
    case WaterType.Lake: return 'lake';
    case WaterType.River: return 'river';
    default: return null;
  }
}

/**
 * Pick the aquatic biome for a cell: `${climate}-${bodyKind}`, falling back to the
 * temperate variant of that body, then to the temperate lake. Rivers/oceans have
 * no climate variant in the catalogue beyond temperate/highland — the fallback
 * keeps selection total.
 */
export function classifyWaterCell(wt: WaterType, climate: Climate): AquaticBiome | null {
  const kind = bodyKind(wt);
  if (!kind) return null;
  return (
    BY_ID.get(`${climate}-${kind}`) ??
    BY_ID.get(`temperate-${kind}`) ??
    BY_ID.get('temperate-lake')!
  );
}

export function getWaterBiome(id: string): AquaticBiome | undefined {
  return BY_ID.get(id);
}
