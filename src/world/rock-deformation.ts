// src/world/rock-deformation.ts
//
// SCATTERED rocks settle into grade — the alpine/upland half of the R5 ground-blend that
// `boulder-deformation.ts` does for the riverbank. The hills brush scatters ~2.5–3.6 k
// rocks through the uplands and every one of them sat ON the surface: tangent to the
// ground, lit like a free-floating object, reading as dropped rather than lodged. A rock
// dishes the ground it rests in.
//
// WHY A DECLARATION, NOT A RE-DERIVATION — the crux of this pass.
// A pad must be a PURE function of `map`: the composed heightfield re-derives on load
// while the rocks are entities. `boulder-deformation.ts` gets there by RE-DERIVING the
// riparian scatter, which is legitimately a pure function of (hydrology, seed) — the map
// declares the seed (`map.riparianSeed`) and the builder replays the generator.
//
// The BRUSH scatter cannot be replayed that way. Two independent reasons:
//   1. the hills brush only visits cells inside the BOUNDING BOX of a connected
//      mountain/peak/ice/tundra biome component (`biomeRegions`) — and the biome map is
//      not on the map, nor cheaply/faithfully re-derivable from it; and
//   2. the brush ran on the tile grid as it stood BEFORE rivers were widened, roads
//      carved, settlements stamped and farmland tilled — so `map.tiles` at load time is
//      NOT the grid the brush read.
// Measured: replaying `placeVegetation` over the final map yields 4157 rocks where the
// world holds 2500 (seed 12345) — 1665 of them phantom, 40 %. Pads under 1665 rocks that
// do not exist is 1665 dimples in the open ground.
//
// So the map DECLARES the derived-entity identity one step further than `riparianSeed`
// does: it declares the PADS THEMSELVES (`map.rockPads`, stamped by the generator from
// the rocks that actually SURVIVED every clearing pass). This builder is then a pure read
// of that declaration — exact by construction, and it cannot drift.

import type { GameMap, Entity } from '@/core/types';
import { discDeformation, type Deformation } from '@/world/terrain-deformation';
import { heightMetresAt } from '@/world/heightfield';
import { isRockKind, natureSizeM } from '@/world/entity-kinds';

/** Smallest rock that dishes the ground, in metres. Below this (rock_pile ≤0.84 m,
 *  pebbles ≤0.24 m) the PR1 bury crop alone reads right and the heightfield stays quiet
 *  — a cobble does not settle, it just lies there. A `boulder` (1.2 m nominal) clears it
 *  from scale 0.84 up; a `standing_stone` (3 m) always does. */
export const ROCK_PAD_MIN_SIZE_M = 1.0;

/** Pad radius in TILES per metre of rock height: a rock's base is roughly half as wide
 *  as it is tall, and one tile is 2 m → radius ≈ sizeM/2 metres = sizeM/4 tiles. The pad
 *  hugs the base, not the silhouette. */
const PAD_RADIUS_PER_M = 0.25;
/** Taper back to untouched terrain — TIGHT (cf. settlement pads' 2.5): a rock lodges in a
 *  dimple, it does not command a ramped forecourt. Matches the riparian pad. */
const PAD_FEATHER_TILES = 0.75;
/** How deep the rock seats below grade, in metres — SIZE-SCALED (the whole point: a
 *  boulder pushes into the ground, a cobble barely marks it). A 1 m rock takes the
 *  riparian pad's 0.08 m seat line; a 3 m menhir sinks 0.16 m. */
const SETTLE_DEPTH_PER_M = 0.06;
const SETTLE_DEPTH_MIN_M = 0.06;
const SETTLE_DEPTH_MAX_M = 0.16;
/** Below EVERYTHING engineered (discs 20, footprint-levels 22, settlement pads 25, roads
 *  30, rivers 40) — wherever built ground overlaps a rock, the engineering rules. Same
 *  rung as the riparian pad: two pads that overlap are two level brushes at one depth. */
const PAD_PRIORITY = 8;

/** Floats per declared pad in `map.rockPads` (x, y, sizeM). */
export const ROCK_PAD_STRIDE = 3;

export function rockPadRadiusTiles(sizeM: number): number {
  return PAD_RADIUS_PER_M * sizeM;
}

export function rockPadDepthM(sizeM: number): number {
  return Math.min(SETTLE_DEPTH_MAX_M, Math.max(SETTLE_DEPTH_MIN_M, SETTLE_DEPTH_PER_M * sizeM));
}

/** Does this entity earn a settle pad? Rock family, big enough to push into the ground. */
export function padWorthyRock(e: Entity): boolean {
  if (!isRockKind(e.kind)) return false;
  const scale = (e.properties as { scale?: number } | undefined)?.scale ?? 1;
  return natureSizeM(e.kind, scale) >= ROCK_PAD_MIN_SIZE_M;
}

/**
 * The generator's declaration: flat (x, y, sizeM) triples for every rock in the world
 * that earns a pad. Call this with the FINAL entity set (after every clearing pass) —
 * an early harvest leaves orphan dimples where a settlement later cleared the rock, the
 * same trap the boulder contact-dirt ring documents.
 */
export function collectRockPads(entities: Iterable<Entity>): number[] {
  const out: number[] = [];
  for (const e of entities) {
    if (!padWorthyRock(e)) continue;
    const scale = (e.properties as { scale?: number } | undefined)?.scale ?? 1;
    out.push(e.x, e.y, natureSizeM(e.kind, scale));
  }
  return out;
}

/**
 * Pure: a world → the settle pads its declared rocks imply. A map with no `rockPads`
 * (test stub, studio ground, a pre-WCV-98 save) gets none, by construction.
 * `groundHeightM` reads the BASE terrain (not the composed field) so each pad is a
 * one-shot level with no self-reference — the same rule settlement pads follow.
 */
export function buildRockPadDeformations(map: GameMap): Deformation[] {
  const pads = map.rockPads;
  if (!pads || pads.length < ROCK_PAD_STRIDE || map.flatHeight) return [];
  const out: Deformation[] = [];
  for (let i = 0; i + ROCK_PAD_STRIDE <= pads.length; i += ROCK_PAD_STRIDE) {
    const x = pads[i], y = pads[i + 1], sizeM = pads[i + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(sizeM)) continue;
    const tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
    out.push(discDeformation({
      id: `pad:rock:${i / ROCK_PAD_STRIDE}`,
      source: 'rock:pad',
      cx: x,
      cy: y,
      radius: rockPadRadiusTiles(sizeM),
      target: heightMetresAt(map, tx, ty) - rockPadDepthM(sizeM),
      feather: PAD_FEATHER_TILES,
      priority: PAD_PRIORITY,
    }));
  }
  return out;
}
