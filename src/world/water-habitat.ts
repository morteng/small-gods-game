// src/world/water-habitat.ts
//
// "Can this thing stand in the water the player SEES?" — the habitat half of the
// ground-holds-it contract (`slope-habitat` is the other half: can the ground hold it
// at THIS steepness).
//
// THE BUG THIS EXISTS TO KILL: every scatter pass gates on `tile.type`, but the tile
// grid is NOT the drawn water (`world/render-water.ts` documents the two lies; a THIRD
// showed up here — hydrology LAKES were never stamped into the raster, so a lake bed
// kept its `mountain`/`grass`/`forest` tile until WCV 103 stamped them `water` at gen).
// A brush therefore happily seeded tussock, heather, marram and oak onto ground the
// shader paints as a lake, and the player saw trees standing on open water. Measured on
// the WCV-97 world: 1097 (seed 12345) / 1945 (seed 777) nature entities standing on
// render-water — EVERY ONE of them on a tile whose type said dry land. The stamp fixes
// the raster; this habitat sweep stays as the enforcement against the DRAWN water,
// which still diverges from tiles wherever roads carve bridge/dirt over the channel.
//
// The rule is NOT a blanket water ban. Three populations, three habitats:
//
//   LAND      — never on render-water. (tussock, heather, marram, oak, willow, …)
//   EMERGENT  — reeds/bulrush/sedge: they grow WITH their feet wet, but at the MARGIN.
//               Allowed on render-water only where a render-dry cell is 4-adjacent
//               (the fringe) and never in deep/open water. This is derived from the
//               flora DB (`ecology.moisture: 'wet'` + a wetland-margin habitat + a
//               non-woody habit) — a species property, not a hardcoded allowlist.
//   IN-WATER  — the riparian riffle BOULDERS. Deliberate (`riparian-scatter.ts` places
//               them on the incised bed; `boulder-deformation.ts` documents the intent).
//               They stay.
//
// A riparian BANK TREE is LAND: it carries the water-placed tag (so the road/river
// corridor sweep leaves it alone) but a willow belongs on the bank, not in the channel.

import type { GameMap } from '@/core/types';
import { getFloraSpecies } from '@/flora/flora-registry';
import { isRockKind } from '@/world/entity-kinds';
import type { WaterDistance, WaterPredicate } from '@/world/render-water';

/** Habitats the world can offer a nature entity, relative to the DRAWN water. */
export type WaterHabitat = 'land' | 'emergent' | 'in-water';

/** Wetland-margin habitats in the flora DB's `ecology.biome` vocabulary. A species that
 *  lists one of these AND is wet-loving AND non-woody stands in the shallows for real. */
const MARGIN_BIOMES = ['reedbed', 'marsh', 'pond margin', 'fen', 'wetland', 'swamp'];

/** Tile types that are OPEN water — an emergent never stands here even at a margin
 *  (a reed bed is a shallow fringe, not a raft in the middle of a lake). */
const DEEP_TILES = new Set(['deep_water', 'ocean']);

/** The riparian pass's tag for an entity it DELIBERATELY placed in/beside the water
 *  (`WATER_PLACED_TAG`, riparian-scatter.ts). It marks INTENT, and intent is what
 *  separates a riffle boulder from an accident — see `waterHabitatOf`. */
const WATER_PLACED_TAG = 'waterPlaced';

/**
 * EMERGENT = grows with its feet in shallow water at the bank (reed, bulrush, sedge).
 * Derived from the flora DB, never a kind allowlist: a wet-moisture, herbaceous
 * (grass/herb/fern — never a tree or shrub, which are BANK species) species whose
 * ecology names a wetland-margin habitat.
 */
export function isEmergentSpecies(kind: string): boolean {
  const sp = getFloraSpecies(kind);
  if (!sp) return false;
  const { habit } = sp.botanical;
  if (habit !== 'grass' && habit !== 'herb' && habit !== 'fern') return false;
  if (sp.ecology.moisture !== 'wet') return false;
  return sp.ecology.biome.some((b) => MARGIN_BIOMES.includes(b.toLowerCase()));
}

/**
 * The habitat an ENTITY occupies — a property of the placement, not of the kind alone.
 *
 * A rock is IN-WATER capable only if the pass that placed it MEANT it to be there: the
 * riparian scatter reads the hydrology raster and seeds riffle boulders onto the incised
 * bed on purpose (and tags them). The hills brush reads `tile.type` and has no idea the
 * shader is painting a mountain tarn over the cell — a boulder it drops there is exactly
 * the same accident as a tussock, and gets no special pass just for being stone.
 */
export function waterHabitatOf(kind: string, tags: readonly string[] = []): WaterHabitat {
  if (isRockKind(kind) && tags.includes(WATER_PLACED_TAG)) return 'in-water';
  return isEmergentSpecies(kind) ? 'emergent' : 'land';
}

/** How far (tiles) past the drawn water's edge an EMERGENT species may wade. The old
 *  1-tile rule ("a render-dry cell is 4-adjacent") let a TALL reed sprite root a full
 *  tile into the channel — and iso draw order (land veg drawn OVER the water plane) then
 *  smeared its 2-tile-tall body clear across the water, so a fringe reed read as a clump
 *  standing MID-STREAM (user: "reeds in middle of water"). Tightened to a hug-the-edge
 *  band: a reed's FEET stay within a third of a tile of the waterline, where a real reed
 *  bed sits, so the tall sprite leans out FROM the bank instead of out OF the water. */
export const EMERGENT_BAND_TILES = 0.3;

/**
 * May this thing stand at (tx,ty)? `isWater` is the RENDER-water predicate (the drawn
 * channel + lakes + ocean), NOT the tile raster. Pure; safe to call per placement roll.
 *
 * CELL-granular view — right for per-cell work. Anything with a continuous position
 * (an entity's actual foot) must use {@link canStandAtPoint}: streams are narrower than
 * a cell, so this predicate cannot see a foot standing in the drawn channel of a
 * dry-CENTRED cell.
 */
export function canStandAt(
  map: GameMap, kind: string, tags: readonly string[], tx: number, ty: number, isWater: WaterPredicate,
): boolean {
  if (!isWater(tx, ty)) return true;             // dry ground holds anything
  const habitat = waterHabitatOf(kind, tags);
  if (habitat === 'in-water') return true;       // riffle boulders: deliberate
  if (habitat === 'land') return false;
  // EMERGENT: shallow fringe only — never open water, and only where the bank is
  // literally next door (a reed bed rings a lake, it does not raft across it).
  if (DEEP_TILES.has(map.tiles[ty]?.[tx]?.type ?? '')) return false;
  return !isWater(tx - 1, ty) || !isWater(tx + 1, ty) ||
         !isWater(tx, ty - 1) || !isWater(tx, ty + 1);
}

/**
 * May this thing stand at CONTINUOUS point (x,y)? The sub-tile habitat check —
 * `waterDist` is the signed render-water distance ({@link getRenderWaterDist}), the
 * same drawn-water truth as the mask at the resolution entity feet actually have.
 */
export function canStandAtPoint(
  map: GameMap, kind: string, tags: readonly string[], x: number, y: number, waterDist: WaterDistance,
): boolean {
  const d = waterDist(x, y);
  if (d >= 0) return true;                       // dry ground holds anything
  const habitat = waterHabitatOf(kind, tags);
  if (habitat === 'in-water') return true;       // riffle boulders: deliberate
  if (habitat === 'land') return false;
  // EMERGENT: the shallow fringe — feet wet, bank within reach, never open water.
  if (DEEP_TILES.has(map.tiles[Math.floor(y)]?.[Math.floor(x)]?.type ?? '')) return false;
  return d > -EMERGENT_BAND_TILES;
}
