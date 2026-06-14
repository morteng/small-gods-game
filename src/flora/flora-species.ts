// src/flora/flora-species.ts
// The FloraSpecies schema + the botanical→generation derivation.
//
// A FloraSpecies is a curated, Wikipedia-grounded record of one plant/rock. Its
// `botanical` block (habit/height/crown/leaf…) is the truth; the L-system
// generation parameters (`recipe`/`heightM`/`trunkR`, or rock `sizeM`/`jitter`)
// are DERIVED from it by `deriveGenParams`, so an agent (or the runtime lazy-fill
// path) can add a species by filling botanical facts and get a recognizable baked
// sprite for free. `ecology` drives worldgen placement; `narrative` (verbatim
// Wikipedia facts + sources) grounds the connectome. See the flora design doc.
import type { FloraRecipeName } from '@/assetgen/geometry/flora/recipes';

/** Growth form — the primary axis that picks an L-system recipe family. */
export type FloraHabit = 'tree' | 'shrub' | 'herb' | 'fern' | 'grass' | 'rock';
/** Crown silhouette — disambiguates tree recipes (weeping/conical/rounded). */
export type CrownShape =
  | 'rounded' | 'spreading' | 'conical' | 'columnar' | 'weeping' | 'irregular'
  | 'tufted' | 'none';
export type LeafPhenology = 'deciduous' | 'evergreen' | 'semi_evergreen' | 'none';
export type LeafType = 'broadleaf' | 'needle' | 'scale' | 'frond' | 'blade' | 'none';
export type Moisture = 'dry' | 'mesic' | 'wet';

/** A min/max range in the field's unit (metres, years). Use min==max for a point. */
export interface Range { min: number; max: number }

export interface Botanical {
  habit: FloraHabit;
  /** Mature height range, metres. */
  matureHeight_m: Range;
  crownShape: CrownShape;
  leafType: LeafType;
  leafPhenology: LeafPhenology;
  trunkHabit?: 'single' | 'multi' | 'none';
  /** Trunk/stem diameter at breast height, metres (optional — else heuristic). */
  trunkDiameter_m?: Range;
  lifespanYears?: Range;
  barkTexture?: string;
  /** Resprouts from a cut stump (willow/hazel/sweet-chestnut) — Slice-3 coppicing. */
  coppices?: boolean;
  /** 0 = rigid, 1 = whippy. Drives wind-sway amplitude (Slice 3). */
  flexibility?: number;
  /** Inclusive month range [start, end], 1=Jan..12=Dec (wraps if start>end). */
  floweringMonths?: [number, number];
  fruitingMonths?: [number, number];
}

export interface Ecology {
  biome: string[];
  climate?: string;
  soil?: string;
  moisture?: Moisture;
  nativeRange: string[];
}

export interface Narrative {
  /** Verbatim Wikipedia facts — connectome grounding, never paraphrased here. */
  keyFacts: string[];
  /** Wikipedia article titles (or URLs) the facts came from. */
  sources: string[];
}

/** The concrete parameters the blueprint flora/rock part consumes. */
export interface FloraGenParams {
  kind: 'plant' | 'rock';
  recipe?: FloraRecipeName;   // plants only
  heightM: number;
  trunkR?: number;            // plants only, metres (base limb radius)
  sizeM?: number;             // rocks only, diameter metres
  jitter?: number;            // rocks only, 0..0.7 surface noise
}

export interface FloraSpecies {
  /** kebab-case slug; doubles as the candidate entity-kind / sprite key. */
  id: string;
  identity: { commonName: string; scientificName: string; family: string; wikipediaTitle: string };
  botanical: Botanical;
  ecology: Ecology;
  narrative: Narrative;
  /** Explicit generation overrides; any field left out is derived from `botanical`. */
  generation?: Partial<FloraGenParams>;
}

const mid = (r: Range): number => (r.min + r.max) / 2;

/** Pick the L-system recipe family from growth form + crown + leaves. */
export function deriveRecipe(b: Botanical): FloraRecipeName {
  switch (b.habit) {
    case 'fern': return 'fern';
    case 'herb':
    case 'grass': return 'flower';
    case 'shrub': return 'shrub';
    case 'tree': {
      if (b.crownShape === 'weeping') return 'willow';
      // Conical/columnar evergreens read as conifers; everything else broadleaf.
      if (b.leafPhenology === 'evergreen' && (b.crownShape === 'conical' || b.crownShape === 'columnar')) return 'pine';
      if (b.leafType === 'needle' || b.leafType === 'scale') return 'pine';
      return 'oak';
    }
    // 'rock' has no recipe; callers route via kind.
    default: return 'shrub';
  }
}

/** Base limb radius (metres) for a plant. Uses measured trunk diameter when known,
 *  else a habit-scaled fraction of height; clamped to the part schema's [0.02,0.5]. */
export function deriveTrunkR(b: Botanical): number {
  const h = mid(b.matureHeight_m);
  let r: number;
  if (b.trunkDiameter_m) {
    r = mid(b.trunkDiameter_m) / 2;
  } else {
    // Slenderness by form: trees stoutest, herbs/ferns wispy.
    const k = b.habit === 'tree' ? 0.018 : b.habit === 'shrub' ? 0.03 : 0.02;
    r = Math.max(h * k, 0.02);
  }
  return Math.min(Math.max(r, 0.02), 0.5);
}

/** Derive concrete generation parameters from a species' botanical facts, layering
 *  any explicit `species.generation` overrides on top. Deterministic + pure. */
export function deriveGenParams(species: FloraSpecies): FloraGenParams {
  const b = species.botanical;
  const heightM = mid(b.matureHeight_m);
  if (b.habit === 'rock') {
    return {
      kind: 'rock',
      heightM,
      sizeM: heightM,
      jitter: 0.35,
      ...species.generation,
    };
  }
  return {
    kind: 'plant',
    recipe: deriveRecipe(b),
    heightM,
    trunkR: deriveTrunkR(b),
    ...species.generation,
  };
}
