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
import { canopyOf, undergrowthOf } from '@/flora/biome-flora';
import { isEmergentSpecies } from '@/world/water-habitat';
import { WaterType } from '@/core/types';
import type { Entity, HydrologyResult } from '@/core/types';

const BRUSH = 'riparian';

/** Tag marking an entity as DELIBERATELY placed in/beside the water margin. The
 *  end-of-gen `clearObstructedVegetation` sweep clears nature entities out of the
 *  road/river corridor; without this exemption it deletes the very boulders the
 *  riparian pass just placed in the river (the rock IS the point). Tagged entities
 *  stay put in the corridor but remain clearable under a building footprint. */
export const WATER_PLACED_TAG = 'waterPlaced';

/** A bank's assemblage is a FUNCTION of the adjacent dry-land biome (threaded in as
 *  `biomes`): a temperate river gets willows/alder, a desert wash tamarisk/esparto, a
 *  swamp reed/bulrush/sedge, a mountain brook sparse downy-birch over more boulders.
 *  All species ids resolve to parametric flora sprites (`common-reed` etc. are real
 *  flora-DB species now — the old `reeds` placeholder that had no composed sprite is
 *  retired). `treeScale`/`boulderScale` modulate the immediate-bank tree + cobble/
 *  boulder densities so a dry wash reads stony and a fen reads leafy-and-reedy. */
interface BankAssemblage {
  flora: [string, number][];
  undergrowth: [string, number, number][];
  treeScale: number;
}
/** Default (temperate / forest / grassland) — the original willow recipe + alder. */
const BANK_TEMPERATE: BankAssemblage = {
  flora: canopyOf('wetland'), undergrowth: undergrowthOf('wetland'), treeScale: 1,
};
const BANK_DESERT: BankAssemblage = {
  flora: [['tamarisk', 0.6], ['esparto-grass', 0.4]],
  undergrowth: [['esparto-grass', 0.6, 0.18], ['white-wormwood', 0.4, 0.1]],
  treeScale: 0.6,   // a dry wash carries only a thin gallery of tamarisk
};
const BANK_SWAMP: BankAssemblage = {
  flora: [['common-alder', 0.5], ['white-willow', 0.3], ['downy-birch', 0.2]],
  undergrowth: undergrowthOf('swamp'),   // reed/bulrush/sedge heavy
  treeScale: 1.1,                        // fen carr: leafy and reedy
};
const BANK_MOUNTAIN: BankAssemblage = {
  flora: [['downy-birch', 1.0]],
  undergrowth: [['heather', 1.0, 0.1]],
  treeScale: 0.5,   // a mountain brook is sparse birch over stone (the stone is riffle-scored)
};

/** Resolve the bank assemblage from the adjacent dry-land biome name. */
function bankAssemblageFor(biome: string | undefined): BankAssemblage {
  switch (biome) {
    case 'desert':                              return BANK_DESERT;
    case 'swamp':                               return BANK_SWAMP;
    case 'mountain': case 'peak': case 'ice': case 'tundra': return BANK_MOUNTAIN;
    default:                                    return BANK_TEMPERATE;
  }
}
/** The assemblage's EMERGENT subset — the feet-wet species `water-habitat.ts` licenses
 *  to stand IN the shallow margin (reed/bulrush/sedge, derived from the flora DB, never
 *  an allowlist). Desert (esparto/wormwood) and mountain (heather) filter to EMPTY, so a
 *  dry wash and a stony brook grow no in-water fringe at all — for free. */
const EMERGENT_POOLS = new WeakMap<BankAssemblage, [string, number][]>();
function emergentPoolOf(asm: BankAssemblage): [string, number][] {
  let p = EMERGENT_POOLS.get(asm);
  if (!p) {
    p = asm.undergrowth.filter(([k]) => isEmergentSpecies(k)).map(([k, w]) => [k, w] as [string, number]);
    EMERGENT_POOLS.set(asm, p);
  }
  return p;
}

/** In-/at-water stones (→ `rock` prim). Cobble is the common river-margin stone; the
 *  boulder is the rarer feature reserved for cells carrying real discharge. */
const COBBLE = 'field-stone';
const BOULDER = 'granite-boulder';

// ── Tuning (densities are per-cell placement probabilities) ──────────────────
/** Boulders IN the shallow water margin, placed by a RIFFLE SCORE rather than a
 *  uniform density: real rivers cluster boulders on riffles, constrictions and
 *  cascade reaches (steep, energetic, shallow water) and keep pools (flat, deep,
 *  slow) clear. We score each margin cell by `slope × flowFactor` — the depth term
 *  of the physical `slope × flow ÷ depth` is folded into flow via hydraulic geometry
 *  (channel depth ∝ Q^0.4, so slope × flow ÷ depth ∝ slope × flow^~0.6, i.e. flow
 *  enters as a gentle, saturating multiplier, not linearly). Slope is the dominant
 *  signal; flow only modulates magnitude.
 *
 *  Slope reference: the water-surface slope on trunk rivers runs p50≈0, p90≈0.010,
 *  cascades up to ~0.044 (measured, 24-seed placement domain). REF maps a p90 reach
 *  to ~0.8 and clamps cascades to 1. */
const RIFFLE_REF_SLOPE = 0.012;
/** Flow saturates the multiplier; cap set near the p90 trunk discharge so a brook
 *  reads sparser than a river without the term pinning to 1 everywhere (the old cap
 *  of 400 sat below p10, so every cell maxed out → uniform scatter). */
const BOULDER_FLOW_CAP = 2000;
/** Flow never fully zeroes a steep reach — a bouldery mountain brook is bouldery even
 *  at low discharge; flow only scales between this floor and 1. */
const RIFFLE_FLOW_FLOOR = 0.45;
/** Ambient in-water boulder density on a calm reach (a lone rock even in slack water)
 *  + the riffle-scored addition at a full cascade. Modestly above the old 0.012 floor
 *  so most margin reaches carry at least the odd visible stone, not just cascades. */
const WATER_BOULDER_MIN = 0.02;
const WATER_BOULDER_RIFFLE = 0.26;
/** Emergent reeds/bulrush/sedge STANDING in the shallow-water margin — feet wet, bank
 *  next door (the `emergent` habitat `water-habitat.ts` licenses). Density rides calm²,
 *  the INVERSE of the riffle score: reeds root in slack water and are scoured off
 *  rapids, so bulrushes fringe the pools while boulders stud the riffles. */
const WATER_REED_DENSITY = 0.35;
/** Interior (mid-channel, no land neighbour) boulders: riffle must clear this before
 *  ANY interior scatter is considered — keeps flat, deep pools clear (the intent the
 *  landNb margin gate originally protected). */
const INTERIOR_RIFFLE_MIN = 0.45;
/** Interior eligibility is scaled by the hydrology's per-cell channel HALF-WIDTH
 *  (`hydro.width`, tiles — Leopold–Maddock W ∝ √flow, see `terrain/river-network.ts`),
 *  not a flat cell count: below this half-width a channel has no true interior at all
 *  (a brook's least width, `RIVER_HALF_MIN` in river-network.ts, is 0.32 — well under
 *  this), so a narrow brook never grows a mid-channel rock band regardless of riffle. */
const INTERIOR_WIDTH_MIN = 1.2;
/** Half-width (tiles) at/above which interior density scales to full strength — near
 *  the network's practical width ceiling (`RIVER_HALF_MAX` 3.2), so only the widest
 *  trunk reaches ever reach the full riffle-scored interior density. */
const INTERIOR_WIDTH_FULL = 3.0;
/** Bank trees on the immediate bank (land touching fresh water) and the set-back ring. */
const BANK_TREE_DENSITY_1 = 0.26;
const BANK_TREE_DENSITY_2 = 0.10;
/** Loose cobbles + the odd boulder on the dry shore (the exposed gravel bank). */
const BANK_COBBLE_DENSITY = 0.10;
const BANK_BOULDER_DENSITY = 0.03;
/** Ground-layer bank cover (see `BANK_UNDERGROWTH`) — dense on the immediate wet
 *  margin so the bank reads lush, sparser on the set-back ring. Rolled INDEPENDENTLY
 *  of the tree/cobble/boulder roll below (a cell can carry a willow AND heather),
 *  mirroring the forest brush's canopy+undergrowth convention. */
const BANK_GROUND_DENSITY_1 = 0.45;
const BANK_GROUND_DENSITY_2 = 0.18;
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

const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Local water-surface slope: steepest descent of `surfaceW` to any WET N8 neighbour
 *  (normalized-elev units per tile). This is the energy grade a riffle rides — a
 *  descending river reach reads high, a flat lake/pool reads ~0. Dry cells (surfaceW
 *  < 0) return 0. Deterministic, pure. */
function waterSurfaceSlope(surf: Float32Array, x: number, y: number, width: number, height: number): number {
  const z = surf[y * width + x];
  if (z < 0) return 0;
  let maxDrop = 0;
  for (const [dx, dy] of N8) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    const nz = surf[ny * width + nx];
    if (nz < 0) continue; // dry neighbour — no water-surface gradient
    const drop = (z - nz) / (dx && dy ? Math.SQRT2 : 1);
    if (drop > maxDrop) maxDrop = drop;
  }
  return maxDrop;
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
  out.push(defaultEntity(BRUSH, kind, cx + fx, cy + fy, { offsetX: fx, offsetY: fy, scale, rotation: 0 }, [WATER_PLACED_TAG]));
}

/**
 * Build the riparian dressing entities (stones in the water margin + bank flora) for
 * a world. Pure: depends only on the hydrology raster + seed. The caller adds them to
 * the World after the biome brushes (so banks gather willows ON TOP of the base
 * vegetation) and before settlements (whose footprints clear nature entities).
 */
export function buildRiparianEntities(
  hydro: HydrologyResult, width: number, height: number, seed: number,
  biomes: string[] | null = null,
): Entity[] {
  const wt = hydro.waterType;
  const flow = hydro.flowField;
  const surf = hydro.surfaceW;
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
        // full riffle-scored density; mid-channel (interior) cells are gated further
        // below so the open water still mostly reads as water.
        let landNb = false, bankNb = -1;
        for (const [dx, dy] of N4) {
          const nx = x + dx, ny = y + dy;
          if (!inB(nx, ny)) { landNb = true; continue; }   // map edge counts as land (no biome)
          const ni = idx(nx, ny);
          if (wt[ni] === WaterType.Dry) { landNb = true; if (bankNb < 0) bankNb = ni; }
        }
        // RIFFLE SCORE: steep, energetic reaches (riffles/cascades) cluster boulders;
        // flat deep pools stay clear. Slope dominates; flow (∝ discharge, a depth proxy
        // via hydraulic geometry) is a saturating multiplier that never zeroes a steep
        // brook.
        const slopeF = Math.min(1, waterSurfaceSlope(surf, x, y, width, height) / RIFFLE_REF_SLOPE);
        const flowF = Math.min(1, flow[i] / BOULDER_FLOW_CAP);
        const riffle = slopeF * (RIFFLE_FLOW_FLOOR + (1 - RIFFLE_FLOW_FLOOR) * flowF);

        // Interior (mid-channel) cells: only a strong riffle/cascade earns ANY interior
        // scatter (calm mid-channel pools stay clear, the margin gate's original
        // intent), and even then only as far as the LOCAL CHANNEL HALF-WIDTH reaches —
        // `hydro.width` is the same per-cell Leopold–Maddock estimate (W ∝ √flow) the
        // river geometry itself uses, so a narrow brook (half-width near the network
        // floor) never grows an interior band regardless of riffle, while a wide trunk
        // river's centreline scales up to full riffle-scored density.
        let interiorScale = 1;
        if (!landNb) {
          if (riffle < INTERIOR_RIFFLE_MIN) continue;
          const halfWidth = hydro.width[i] ?? 0;
          interiorScale = Math.min(1, Math.max(0,
            (halfWidth - INTERIOR_WIDTH_MIN) / (INTERIOR_WIDTH_FULL - INTERIOR_WIDTH_MIN)));
          if (interiorScale <= 0) continue;
        }

        // A boulder (1–3 m) breaches the depth-shaded water and reads as a rock in the
        // river. `interiorScale` scales the WHOLE density (ambient floor included) for a
        // mid-channel cell — a narrow reach must stay fully clear, not just lose its
        // riffle bonus, or the ambient floor alone paints a faint rock wall.
        const boulderD = (WATER_BOULDER_MIN + WATER_BOULDER_RIFFLE * riffle) * interiorScale;
        if (hash01(x, y, s + 2) < boulderD) {
          // Size ∝ discharge (the trunk-river width barely varies here, so flow is the
          // honest size signal): brooks get cobbly boulders, rivers get big ones.
          const lo = 0.65 + 0.4 * flowF;
          place(out, BOULDER, x, y, s + 50, lo, lo + 0.45);
        }

        // EMERGENT FRINGE — reeds/bulrush/sedge standing IN the shallow margin, feet
        // wet (margin cells only, never open water — the `emergent` habitat contract).
        // Species come from the ADJACENT bank's assemblage: a swamp reach reads
        // reed+bulrush-heavy, a temperate one reed+sedge, and a desert wash or mountain
        // brook grows nothing in-water (their pools filter to empty). NEW hash keys
        // only (s+20/21/130s) — the stone rolls above stay a pure function of
        // (hydrology, seed), untouched.
        if (landNb) {
          const pool = emergentPoolOf(bankAssemblageFor(bankNb >= 0 ? biomes?.[bankNb] : undefined));
          if (pool.length > 0) {
            const calm = 1 - riffle;
            if (hash01(x, y, s + 20) < WATER_REED_DENSITY * calm * calm) {
              place(out, pickWeighted(hash01(x, y, s + 21), pool), x, y, s + 130, 0.55, 0.85);
            }
          }
        }
      } else if (wt[i] === WaterType.Dry && dist[i] >= 1 && dist[i] <= BANK_RINGS) {
        // The bank assemblage is chosen from THIS cell's own (dry-land) biome: willows/
        // alder on a temperate river, tamarisk on a desert wash, reeds in a swamp, sparse
        // birch + boulders on a mountain brook. Trees on the immediate edge, sparser set
        // back; loose cobbles + the odd boulder on the exposed near shore.
        const asm = bankAssemblageFor(biomes?.[i]);
        const treeDensity = (dist[i] === 1 ? BANK_TREE_DENSITY_1 : BANK_TREE_DENSITY_2) * asm.treeScale;
        if (hash01(x, y, s + 1) < treeDensity) {
          place(out, pickWeighted(hash01(x, y, s + 6), asm.flora), x, y, s, 0.85, 1.15);
        }
        // INVARIANT — the STONE rolls stay a pure function of (hydrology, seed): they are
        // rolled INDEPENDENTLY of the biome-dependent tree roll above (never chained off
        // it) and carry no biome scale. `boulder-deformation.ts` re-derives this scatter
        // WITHOUT the biome map to settle each big bank boulder into its own level pad, so
        // the two derivations must agree on the boulder set exactly. (Bouldery mountain
        // reaches come from the in-water RIFFLE score, which is terrain-driven already.)
        if (dist[i] === 1 && hash01(x, y, s + 2) < BANK_COBBLE_DENSITY) {
          place(out, COBBLE, x, y, s + 70, 0.45, 0.8);
        }
        if (dist[i] === 1 && hash01(x, y, s + 8) < BANK_BOULDER_DENSITY) {
          place(out, BOULDER, x, y, s + 90, 0.6, 1.0);
        }
        // Ground-layer bank cover: rolled INDEPENDENTLY of the tree/cobble/boulder pick
        // above so a cell can carry both a willow AND a reed/heather clump — the immediate
        // margin reads dense and lush, the set-back ring sparser.
        if (asm.undergrowth.length > 0) {
          const groundDensity = dist[i] === 1 ? BANK_GROUND_DENSITY_1 : BANK_GROUND_DENSITY_2;
          const gRng = hash01(x, y, s + 12);
          if (gRng < groundDensity) {
            const kind = pickWeighted(hash01(x, y, s + 13), asm.undergrowth.map(([k, w]) => [k, w] as [string, number]));
            place(out, kind, x, y, s + 110, 0.55, 0.85);
          }
        }
      }
    }
  }
  return out;
}
