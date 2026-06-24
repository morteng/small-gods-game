// src/world/riparian-scatter.ts
//
// The riparian band — dressing the river/lake margin so a watercourse reads as a
// PLACE (a rocky, willow-lined channel), not a bare blue line abutting plain grass.
//
// This is the placement half of the aquatic-biome ecology that `water-biome.ts`
// has carried as data all along (`rockSet`/`bankFlora`, commented "placed by S4b
// banks") but nothing ever rendered. It composes three existing systems with NO new
// art: the parametric flora kit (rocks via the `rock` prim, willows/poplars/birch
// via the L-system kit), the curated `wetland` riparian flora pool, and the entity
// scatter convention (`defaultEntity` + per-cell jitter, exactly like the forest
// brush). The depth-shaded water plane is drawn OVER the terrain + entities, so a
// rock sitting on the carved bed reads as partly submerged for free.
//
// Driven off the hydrology raster's `waterType` (River/Lake/Ocean cleanly split) so
// it dresses FRESH water only — the sea keeps its own coastal treatment. Pure +
// deterministic from (hydrology, seed): the same world re-scatters identically.

import { defaultEntity } from '@/world/brush-helpers';
import { canopyOf } from '@/flora/biome-flora';
import { WaterType } from '@/core/types';
import type { Entity, HydrologyResult } from '@/core/types';

const BRUSH = 'riparian';

/** Riparian canopy (willows/poplars/birch) — real species ids from the wetland pool.
 *  (The `water-biome.ts` `bankFlora` field carries descriptive labels — "willow",
 *  "reed" — not species ids, so we read the curated pool instead.) */
const BANK_FLORA: [string, number][] = canopyOf('wetland');
/** In-/at-water stones (→ `rock` prim). Cobble is the common river-margin stone; the
 *  boulder is the rarer feature reserved for cells carrying real discharge. */
const COBBLE = 'field-stone';
const BOULDER = 'granite-boulder';

// ── Tuning (densities are per-cell placement probabilities) ──────────────────
/** Boulders IN the shallow water margin. A boulder (1–3 m) is tall enough to breach
 *  the depth-shaded surface and read as a rock in the river; a low cobble would just
 *  sit submerged, so the in-water stone is the boulder. Bigger rivers get more — the
 *  density scales with flow accumulation up to a cap. */
const WATER_BOULDER_DENSITY = 0.07;
const WATER_BOULDER_FLOW_BONUS = 0.06;   // extra density at/above the flow cap
const BOULDER_FLOW_CAP = 400;
/** Bank trees on the immediate bank (land touching fresh water) and the set-back ring. */
const BANK_TREE_DENSITY_1 = 0.26;
const BANK_TREE_DENSITY_2 = 0.10;
/** Loose cobbles + the odd boulder on the dry shore (the exposed gravel bank). */
const BANK_COBBLE_DENSITY = 0.10;
const BANK_BOULDER_DENSITY = 0.03;
/** How far (tiles) the bank flora reaches back from the water. */
const BANK_RINGS = 2;

/** Decorrelated [0,1) hash — same mix the vegetation placer uses, so nearby seeds
 *  don't bias every roll to one side. */
function hash01(x: number, y: number, key: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(key | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Cell-fraction position: centre (0.5) jittered across the cell, clamped in-tile. */
function frac(rng: number): number {
  return 0.5 + (rng - 0.5) * 0.9; // ±0.45 → stays inside the cell
}

function pickWeighted(rng: number, kinds: [string, number][]): string {
  let total = 0;
  for (const [, w] of kinds) total += w;
  let acc = rng * total;
  for (const [k, w] of kinds) { acc -= w; if (acc <= 0) return k; }
  return kinds[kinds.length - 1][0];
}

function place(out: Entity[], kind: string, cx: number, cy: number, s: number, scaleLo: number, scaleHi: number): void {
  const fx = frac(hash01(cx, cy, s + 3));
  const fy = frac(hash01(cx, cy, s + 4));
  const scale = scaleLo + hash01(cx, cy, s + 5) * (scaleHi - scaleLo);
  out.push(defaultEntity(BRUSH, kind, cx + fx, cy + fy, { offsetX: fx, offsetY: fy, scale, rotation: 0 }));
}

/**
 * Build the riparian dressing entities (stones in the water margin + bank flora) for
 * a world. Pure: depends only on the hydrology raster + seed. The caller adds them to
 * the World after the biome brushes (so banks gather willows ON TOP of the base
 * vegetation) and before settlements (whose footprints clear nature entities).
 */
export function buildRiparianEntities(
  hydro: HydrologyResult, width: number, height: number, seed: number,
): Entity[] {
  const wt = hydro.waterType;
  const flow = hydro.flowField;
  const out: Entity[] = [];
  const idx = (x: number, y: number): number => y * width + x;
  const inB = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height;
  const isFresh = (i: number): boolean => wt[i] === WaterType.River || wt[i] === WaterType.Lake;

  // Distance (in tiles, capped) from each DRY cell to the nearest fresh-water cell —
  // a 2-ring dilation off the water. 0 = water, 1 = immediate bank, 2 = set-back bank.
  const dist = new Uint8Array(width * height).fill(255);
  let frontier: number[] = [];
  for (let i = 0; i < wt.length; i++) if (isFresh(i)) { dist[i] = 0; frontier.push(i); }
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let ring = 1; ring <= BANK_RINGS; ring++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % width, y = (i / width) | 0;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy;
        if (!inB(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (wt[ni] !== WaterType.Dry || dist[ni] <= ring) continue;
        dist[ni] = ring; next.push(ni);
      }
    }
    frontier = next;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = idx(x, y);
      const s = seed + i * 7;
      if (isFresh(i)) {
        // A water cell on the SHALLOW MARGIN (touching land or the map edge) gets the
        // stones; mid-channel cells stay clear so the open water still reads as water.
        let landNb = false;
        for (const [dx, dy] of N4) {
          const nx = x + dx, ny = y + dy;
          if (!inB(nx, ny) || wt[idx(nx, ny)] === WaterType.Dry) { landNb = true; break; }
        }
        if (!landNb) continue;
        // A boulder (1–3 m) breaches the depth-shaded water and reads as a rock in the
        // river; density scales with discharge so trunks are bouldery, brooks sparse.
        const flowF = Math.min(1, flow[i] / BOULDER_FLOW_CAP);
        const boulderD = WATER_BOULDER_DENSITY + WATER_BOULDER_FLOW_BONUS * flowF;
        if (hash01(x, y, s + 2) < boulderD) place(out, BOULDER, x, y, s + 50, 0.75, 1.2);
      } else if (wt[i] === WaterType.Dry && dist[i] >= 1 && dist[i] <= BANK_RINGS) {
        // The bank: willows/poplars on the immediate edge, sparser set back; loose
        // cobbles + the odd boulder on the exposed near shore.
        const treeDensity = dist[i] === 1 ? BANK_TREE_DENSITY_1 : BANK_TREE_DENSITY_2;
        if (hash01(x, y, s + 1) < treeDensity) {
          place(out, pickWeighted(hash01(x, y, s + 6), BANK_FLORA), x, y, s, 0.85, 1.15);
        } else if (dist[i] === 1 && hash01(x, y, s + 2) < BANK_COBBLE_DENSITY) {
          place(out, COBBLE, x, y, s + 70, 0.45, 0.8);
        } else if (dist[i] === 1 && hash01(x, y, s + 8) < BANK_BOULDER_DENSITY) {
          place(out, BOULDER, x, y, s + 90, 0.6, 1.0);
        }
      }
    }
  }
  return out;
}
