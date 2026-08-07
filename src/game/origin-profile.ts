// src/game/origin-profile.ts
//
// Per-run origin variety for the New-Game opening (the "New Game" epic, origin-
// variety work). A PURE, deterministic function that derives an ORIGIN PROFILE
// from the ALREADY-GENERATED world: which place the player's god was born from,
// and which of the founding minds the opening names. Same world seed ⇒ same
// opening; different seeds ⇒ (usually) different openings — variety comes from
// the seeded substrate, never from Math.random.
//
// SIM-TRUTH GUARD: the sim's only real domains are `storm` and `flood` (gating
// smite / summon_storm), so the *only* origin that can honestly gesture at a
// held power is water/sky. Every other place flavor ("spirit of these stones",
// "of that place") is pure narrative label and never promises a power the sim
// cannot grant — the composer in first-run-tidings.ts honours that by keeping
// all non-water prose power-free.

import type { GameMap, WorldSeed } from '@/core/types';
import { createRng } from '@/core/rng';
import { pickCradlePoi } from '@/world/cradle-poi';

export type TerrainFlavor = 'water' | 'forest' | 'stone' | 'bog' | 'dry' | 'meadow';

/** The founding band (seed-world.ts) — one of them becomes the "first mind" the
 *  opening names. Rotated by seed so the foreground believer varies per run. */
export const FOUNDING_MIND_NAMES = ['Tola', 'Bram', 'Sefa', 'Doran', 'Mira', 'Garr'] as const;

export interface OriginProfile {
  flavor: TerrainFlavor;
  /** Locative phrase for the born-from place, e.g. 'beside the running water'. */
  place: string;
  /** The named first mind among the founding band. */
  firstMind: string;
  /** Prose-variant index (0..2); lets the SAME place read with different wording. */
  variant: number;
}

/** Deterministic fallback when there is no map/world (tests, or a terrain-only
 *  genome with no cradle). Never promises a power. */
export const DEFAULT_ORIGIN: OriginProfile = {
  flavor: 'meadow',
  place: 'across the open grass',
  firstMind: 'Tola',
  variant: 0,
};

// ── terrain classification ───────────────────────────────────────────────────
// The tile `type` vocabulary is the `BIOME_TILES` set in terrain/biomes.ts; we
// bucket the ones that read as a place flavor. Neutral grass/meadow → 'meadow'.

const WATER = new Set(['deep_water', 'shallow_water', 'river', 'major_river', 'ocean', 'water']);
const FOREST = new Set(['forest', 'dense_forest', 'pine_forest', 'glen', 'sacred_grove']);
const STONE = new Set(['mountain', 'rocky', 'hills', 'cliff', 'volcanic_rock', 'peak']);
const BOG = new Set(['swamp']);
const DRY = new Set(['scrubland', 'scrub', 'desert', 'sand', 'dirt', 'dead', 'ash']);
const MEADOW = new Set(['grass', 'meadow']);

function classify(type: string): TerrainFlavor | null {
  if (WATER.has(type)) return 'water';
  if (FOREST.has(type)) return 'forest';
  if (STONE.has(type)) return 'stone';
  if (BOG.has(type)) return 'bog';
  if (DRY.has(type)) return 'dry';
  if (MEADOW.has(type)) return 'meadow';
  return null;
}

/** A deterministic Chebyshev ring around the cradle centre; ties go to the more
 *  spiritually-loaded flavor (water wins, then forest, stone, bog, dry, meadow). */
const FLAVOR_PRIORITY: TerrainFlavor[] = ['water', 'forest', 'stone', 'bog', 'dry', 'meadow'];

function flavorOf(map: GameMap, cx: number, cy: number, ring = 2): TerrainFlavor {
  const counts: Record<TerrainFlavor, number> = { water: 0, forest: 0, stone: 0, bog: 0, dry: 0, meadow: 0 };
  for (let dy = -ring; dy <= ring; dy++) {
    for (let dx = -ring; dx <= ring; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
      const f = classify(map.tiles[y][x].type);
      if (f) counts[f]++;
    }
  }
  let best: TerrainFlavor = 'meadow';
  let bestN = 0;
  for (const f of FLAVOR_PRIORITY) {
    if (counts[f] > bestN) { best = f; bestN = counts[f]; }
  }
  return best;
}

// ── per-place locatives (prose-variant table) ─────────────────────────────────
// Pixel-font-safe ASCII (letters, spaces, commas — no straight apostrophes).
const LORES: Record<TerrainFlavor, string[]> = {
  water:  ['beside the running water', 'by the silver stream', 'along the rain fed river'],
  forest: ['beneath the tall trees', 'in the deep dark wood', 'among the crowding pines'],
  stone:  ['below the cold grey stone', 'under the high mountain', 'among the tumbled rock'],
  bog:    ['in the mists of the marsh', 'at the murky fen', 'on the sodden bog'],
  dry:    ['on the thirsty plain', 'across the parched dust', 'where the wind scours the land'],
  meadow: ['across the open grass', 'on the gentle meadow', 'among the sunlit hills'],
};

const VARIANT_COUNT = 3;

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** A dedicated seeded rng from the substrate seed + world identity — NEVER the
 *  live world rng stream (consuming that would re-roll every later system, the
 *  same trap seed-world.ts documents for seedAuthoredNobles). Same inputs ⇒ same
 *  opening, every replay. */
function varietySeed(mapSeed: number, worldSeed: WorldSeed, poiId: string): number {
  return Math.abs((mapSeed | 0) ^ hashStr(worldSeed.name) ^ hashStr(poiId));
}

/** Pure, deterministic per (map.seed, worldSeed). Returns DEFAULT_ORIGIN when the
 *  genome has no usable cradle. Does not touch the shared rng and never throws. */
export function originProfileFor(map: GameMap, worldSeed: WorldSeed): OriginProfile {
  const poi = pickCradlePoi(worldSeed.pois);
  const flavor = poi?.position ? flavorOf(map, poi.position.x, poi.position.y) : 'meadow';
  const rng = createRng(varietySeed(map.seed, worldSeed, poi?.id ?? 'cradle'));
  const firstMind = FOUNDING_MIND_NAMES[Math.floor(rng.next() * FOUNDING_MIND_NAMES.length)];
  const variant = Math.floor(rng.next() * VARIANT_COUNT);
  const place = LORES[flavor][variant % LORES[flavor].length];
  return { flavor, place, firstMind, variant };
}
