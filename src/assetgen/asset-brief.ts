/**
 * AssetBrief — the single canonical, pipeline-agnostic description of one asset.
 *
 * Every generated asset is described once here. From this one source we derive
 * three aligned artifacts that cannot drift:
 *   1. a human-facing description (`describeForHuman`),
 *   2. a provider generation request (`PromptCompiler.compile`),
 *   3. the image (the request's faithful output).
 *
 * Producers (game data → brief) live in `producers/`; compilers (brief →
 * provider request) live in `compilers/`. The brief itself knows about neither.
 */
import type { AssetKind, Era } from '@/core/types';

export type { AssetKind, Era };

/** Camera/projection the asset is authored for. */
export type AssetView = 'iso-3q' | 'front-portrait' | 'topdown' | 'side';

/** Which face of a footprint a functional door shows on. */
export type DoorFace = 'n' | 'e' | 's' | 'w';

export interface BriefMaterial {
  /** e.g. "walls", "roof", "ground". */
  part: string;
  /** e.g. "wattle", "thatch". */
  material: string;
  /** Hex colour for this part (feeds paletteAnchors + massing guidance). */
  color: string;
}

/** Functional door cell (footprint-relative) plus the face it presents. */
export interface BriefDoor {
  x: number;
  y: number;
  face: DoorFace;
}

export interface BriefGuidance {
  source: 'massing' | 'scaffold' | 'lpc-base' | 'none';
  /** PixelLab init_image_strength band (1–999). Low (~200) = loose placement
   *  guidance from a sparse scaffold; high (~500) = copy a detailed init. */
  strength: number;
}

export interface AssetBrief {
  kind: AssetKind;
  /** Humanized subject, e.g. "tavern". */
  subject: string;
  /** Descriptive adjective phrases, e.g. ["two storeys", "moss-streaked roof"]. */
  traits: string[];
  /** Per-part material + colour; feeds both traits (language) and paletteAnchors. */
  materials: BriefMaterial[];
  view: AssetView;
  era: Era;
  /** Footprint in tiles, for view-projected assets (buildings). */
  footprint?: { w: number; h: number };
  /**
   * Vertical extent in tile-height units (body + roof rise), precomputed by the
   * producer so the view/size registry can derive native pixel size purely from
   * the brief without re-deriving massing.
   */
  heightUnits?: number;
  door?: BriefDoor;
  /** Hexes that MUST appear in the output (derived from materials). */
  paletteAnchors: string[];
  guidance?: BriefGuidance;
  negatives: string[];
  /** Stable per-instance seed so re-generating the same brief is identical. */
  seed: number;
}
