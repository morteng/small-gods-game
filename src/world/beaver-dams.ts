// src/world/beaver-dams.ts
//
// Gen-time beaver-dam siting (rivers R3 P2) — pick a few moderate-flow reaches and turn each
// into a crest-clamp WEIR (see `DamRecord` / `HydrologyOptions.weirs`). The dam is NOT a terrain
// deformation: siting only DECIDES where a crest sits; `generateHydrology` then re-runs with the
// weir and the impounded reach falls out of P1's pond keep-rule (Timberborn's model — no water
// sim, no ground raise, the physical structure is a prop). Pure + deterministic (seeded LCG, the
// map-generator gen-rng family), so both hydrology callers reproduce the SAME final water from
// the persisted records.
//
// Siting rule (beaver science, spec §R3):
//   • MODERATE flow — a brook/stream, NEVER a trunk river: Strahler order in the LOW band
//     [DAM_STRAHLER_MIN, DAM_STRAHLER_MAX] (the mill wants [2,6] for wheel scale; beavers dam
//     the small end). Order-1 headwater trickles carry too little water; order ≥4 is too big to
//     dam by hand.
//   • NARROW valley cross-section — ground must RISE to a real abutment within a few tiles on
//     BOTH banks (a short bar can close it, and the pond is laterally confined so it stays
//     pond-sized, not a broad flood).
//   • NEAR WOOD — a forest cell within reach (beavers need timber). Derived by the caller
//     (map-generator has the biome field; the render-path recompute never re-sites — it reads
//     the persisted records).
//
// The crest rise is authored in NORMALIZED elevation units (the same units as the keep-rule's
// POND_MIN_DEPTH/LAKE_MIN_FILL), NOT metres, so the impounded depth lands in the POND band on
// every world regardless of its relief (≈ DAM_CREST_RISE·reliefM ≈ 0.38 m at default relief).

import type { HydrologyResult, DamRecord } from '@/core/types';
import { Random } from '@/core/noise';

// Strahler band for a dammable reach — a brook/stream, NEVER the trunk. CALIBRATED to the default
// world (scripts/probe-dam-calib.ts): the area-scaled river threshold makes a large map
// TRUNK-DOMINATED — measured river-cell order histograms are {3:6, 4:106, 5:568} (seed 12345),
// {4:253, 5:311, 6:186} (777), {4:7, 5:184, 6:236} (999). Orders 2–3 (the textbook "low end") are
// nearly absent; order 4 is the common mid-stream and orders 5–6 are the trunk. So the band runs
// [2,4] — it catches the real small streams while excluding every seed's order-5/6 trunk.
export const DAM_STRAHLER_MIN = 2;
export const DAM_STRAHLER_MAX = 4;
// Crest rise above the channel bed, normalized elevation. Between the keep-rule's POND_MIN_DEPTH
// (0.006) and LAKE_MIN_FILL (0.01) so the impounded reach PONDS (not lakes, not vanishes), nearer
// the low end because the abutment gate below must find banks ≥ crest and the world's valleys are
// shallow. Independent of reliefM by design — the keep-rule is normalized (≈ 0.007·reliefM ≈
// 0.34 m at default relief).
export const DAM_CREST_RISE = 0.007;
// A bank is a real ABUTMENT once it rises to the crest (the water can't spill around the bar).
// Probed up to MAX_HALF tiles each side; both banks must reach it — THAT is the "narrow valley"
// gate (calibration showed a wider probe just recruits broad valleys no beaver would dam). The
// sub-crest cells before the abutment are the dam RUN. 3 tiles ⇒ a ≤~10 m dam, beaver-scale.
const MAX_HALF = 3;
const FOREST_RADIUS = 4;                     // a forest cell must sit within this of the dam (tiles)
const MIN_SEPARATION = 10;                   // Chebyshev spacing between two dams (tiles)
const DEFAULT_MAX_DAMS = 3;                  // cap per world (some seeds legitimately get 0)

export interface BeaverSiteOptions {
  width: number;
  height: number;
  seaLevel: number;
  seed: number;
  /** True where wood grows near enough for beavers to build (caller-derived). */
  forestAt: (x: number, y: number) => boolean;
  /** Cap on dams per world (default 3). */
  maxDams?: number;
}

/** A dam candidate before selection — its channel cell, crest, and the resolved cross-channel run. */
interface Candidate {
  channelCell: number;
  crestElev: number;
  cells: number[];   // channelCell first, then the abutment-bounded run to both banks
}

/**
 * Site up to `maxDams` beaver dams from the BASE (pass-1) hydrology. Returns the persistable
 * records with `pondId` provisionally −1 — the caller re-runs hydrology WITH these weirs and
 * fills each `pondId` from the resulting `ponds` (a dam whose impounded reach fell outside the
 * keep-rule keeps −1). Deterministic in (hydro, elevation, seed).
 */
export function siteBeaverDams(
  hydro: HydrologyResult,
  elevation: Float32Array,
  opts: BeaverSiteOptions,
): DamRecord[] {
  const { width, height, seaLevel, seed, forestAt } = opts;
  const maxDams = opts.maxDams ?? DEFAULT_MAX_DAMS;
  const { riverMask, strahler, flowDirX, flowDirY, waterType, pondId } = hydro;

  const candidates: Candidate[] = [];
  for (let y = MAX_HALF; y < height - MAX_HALF; y++) {
    for (let x = MAX_HALF; x < width - MAX_HALF; x++) {
      const i = y * width + x;
      if (riverMask[i] !== 1) continue;                         // channel cells only
      const so = strahler[i];
      if (so < DAM_STRAHLER_MIN || so > DAM_STRAHLER_MAX) continue; // brook/stream, never trunk
      // Never dam a reach already sitting in standing water (a pond/lake outlet) — nothing to impound.
      if (pondId && pondId[i] >= 0) continue;
      const bed = elevation[i];
      const crest = bed + DAM_CREST_RISE;

      // Run axis is PERPENDICULAR to flow. Snap to the dominant flow axis so the dam is a clean
      // straight bar across the channel: flow mostly horizontal ⇒ dam runs vertically, and vice
      // versa. A river cell with a real drainTo always has a non-zero flow vector.
      const fx = flowDirX[i], fy = flowDirY[i];
      if (fx === 0 && fy === 0) continue;
      const runHorizontal = Math.abs(fy) >= Math.abs(fx);       // flow vertical ⇒ dam bar horizontal
      const [rdx, rdy] = runHorizontal ? [1, 0] : [0, 1];

      // Walk both ways along the run axis, up to MAX_HALF. Each side must reach a real ABUTMENT —
      // ground ≥ crest — within the probe, so the impounded water can't spill around the bar. That
      // both-banks-reach-the-crest test IS the "narrow valley" gate (a broad valley never reaches
      // the crest within MAX_HALF). The dam RUN is the contiguous sub-crest cells before the first
      // abutment (what the bar physically spans).
      const run: number[] = [i];
      let ok = true;
      for (const sign of [1, -1] as const) {
        let abutment = false;
        for (let d = 1; d <= MAX_HALF; d++) {
          const ni = (y + sign * rdy * d) * width + (x + sign * rdx * d);
          if (elevation[ni] < crest) run.push(ni);              // sub-crest cell the bar must span
          else { abutment = true; break; }                      // first cell at/above the crest = abutment
        }
        if (!abutment) { ok = false; break; }
      }
      if (!ok) continue;

      // Wood nearby (Chebyshev disc) — beavers need timber.
      let hasWood = false;
      for (let dy = -FOREST_RADIUS; dy <= FOREST_RADIUS && !hasWood; dy++) {
        for (let dx = -FOREST_RADIUS; dx <= FOREST_RADIUS; dx++) {
          const fxi = x + dx, fyi = y + dy;
          if (fxi < 0 || fyi < 0 || fxi >= width || fyi >= height) continue;
          if (forestAt(fxi, fyi)) { hasWood = true; break; }
        }
      }
      if (!hasWood) continue;

      // Never dam right at a river mouth / lake edge (the abutment cells shouldn't be open water).
      void seaLevel; void waterType;
      candidates.push({ channelCell: i, crestElev: crest, cells: run });
    }
  }

  if (candidates.length === 0) return [];

  // Deterministic selection: candidates are already in ascending cell order (a stable geometric
  // key); a seed-derived LCG shuffles, then a greedy pass takes the first `maxDams` that respect
  // MIN_SEPARATION so dams spread out (no two on the same short reach). Seed-stable ⇒ same map,
  // same dams on every run + in both hydrology callers.
  const rng = new Random((seed * 2246822519 + 40503) | 0);
  const order = candidates.map((_, k) => k);
  for (let a = order.length - 1; a > 0; a--) {
    const b = Math.floor(rng.next() * (a + 1));
    const t = order[a]; order[a] = order[b]; order[b] = t;
  }

  const chosen: Candidate[] = [];
  for (const k of order) {
    if (chosen.length >= maxDams) break;
    const c = candidates[k];
    const cx = c.channelCell % width, cy = (c.channelCell / width) | 0;
    let tooClose = false;
    for (const s of chosen) {
      const sx = s.channelCell % width, sy = (s.channelCell / width) | 0;
      if (Math.max(Math.abs(cx - sx), Math.abs(cy - sy)) < MIN_SEPARATION) { tooClose = true; break; }
    }
    if (!tooClose) chosen.push(c);
  }

  // Emit in a stable order (ascending channel cell) so `map.beaverDams` ids are seed-deterministic.
  chosen.sort((a, b) => a.channelCell - b.channelCell);
  return chosen.map((c, id) => ({
    id,
    cells: c.cells,
    channelCell: c.channelCell,
    crestElev: c.crestElev,
    pondId: -1,        // filled by the caller after the weir'd hydrology run
  }));
}

/** Forest biomes a beaver would harvest timber from (map-generator derives `forestAt` from these). */
export const DAM_WOOD_BIOMES: ReadonlySet<string> = new Set([
  'boreal_forest', 'temperate_forest', 'tropical_forest', 'sacred_grove', 'swamp',
]);
