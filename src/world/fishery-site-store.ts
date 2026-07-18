// src/world/fishery-site-store.ts
//
// POND FISHERY SITES — a hydrology-derived affordance layer, mirroring `mill-site-store.ts`
// for still water. The water connectome already classifies still-water bodies by size
// (`LakeClass`, `terrain/river-network.ts`); this module TAGS the dry bank cells orthogonally
// adjacent to a `pond`-class body as good fisherman's-hut sites, scored by pond area (a bigger
// pond feeds more nets) and whether the pond is fed/drained by a channel (moving water reads
// as a healthier fishery than a stagnant puddle). Settlement siting then picks the nearest tag,
// same declare-affordance / resolve-to-real-terrain pattern the mill and the coastline
// anchoring both use — the hut lands flush against a pond that actually renders.
//
// SPEC-FAITHFUL SCOPE: pond klass only (design doc §7 names "pond node" specifically). A tarn
// (≤3 cells) is a plausible future loosening — big enough for one net, small enough that a hut
// beside it feels intimate — but the design didn't ask for it, so it stays out for now; widen
// the `klass` filter below if that's wanted later. Lake/mere shores are NEVER tagged (those are
// a different affordance's future problem — a proper harbour/quay, not a fisherman's hut).
//
// A pure VIEW of the water connectome (like `getMillSites`): re-derives identically on load,
// keyed only by (seed, dims), never travels in the save. Composes with a hydrology work
// package adding MORE ponds — this module only ever reads `getWaterNetwork(map).lakes`, never
// hand-rolls its own pond detection, so any new pond the parallel round adds is picked up for
// free.

import type { GameMap } from '@/core/types';
import { WaterType } from '@/core/types';
import type { WaterBody } from '@/terrain/river-network';
import { getWaterNetwork } from '@/world/water-network-store';
import { buildRenderWaterTypeMemo } from '@/render/gpu/render-water-mask';
import { scoreSite } from '@/world/site-fitness';
import type { CardinalFace } from '@/world/settlement-plan';

export interface FisherySite {
  /** The dry BANK cell (footprint anchor) orthogonally adjacent to the pond. */
  x: number;
  y: number;
  /** Cardinal from the bank toward the pond — the flank a jetty should run out over. */
  waterFace: CardinalFace;
  /** Id of the pond `WaterBody` this site fishes. */
  pondId: string;
  /** Pond area in cells — a bigger pond feeds more nets (the fishery equivalent of the
   *  mill's flow-strength proxy). */
  area: number;
  /** Composite 0..1 desirability (area + fed/drained bonus), strongest first. */
  strength: number;
}

const NEIGH: ReadonlyArray<readonly [number, number, CardinalFace]> = [
  [0, -1, 'north'], [0, 1, 'south'], [-1, 0, 'west'], [1, 0, 'east'],
];

const cache = new Map<string, FisherySite[]>();
const CACHE_CAP = 4;
const keyOf = (m: GameMap): string => `${m.seed}:${m.width}x${m.height}`;

/** Every good pond-fishery site on the map, strongest (biggest/best-fed pond) first.
 *  Memoised by (seed, dims), same discipline as `getMillSites`. */
export function getFisherySites(map: GameMap): FisherySite[] {
  const k = keyOf(map);
  const hit = cache.get(k);
  if (hit) { cache.delete(k); cache.set(k, hit); return hit; }   // LRU touch
  const sites = computeFisherySites(map);
  cache.set(k, sites);
  if (cache.size > CACHE_CAP) cache.delete(cache.keys().next().value as string);
  return sites;
}

function computeFisherySites(map: GameMap): FisherySite[] {
  const net = getWaterNetwork(map);
  // Tag against the RENDER water (the same source `buildRenderWaterType` stamps lake cells
  // from — `net.lakes` verbatim, see render-water-mask.ts), matching the mill's bank test:
  // the bank must be dry on the surface the player actually sees.
  return computeFisherySitesFromLakes(net.lakes, buildRenderWaterTypeMemo(map), map.width, map.height);
}

/**
 * The pure core of {@link getFisherySites} — bank-tags dry cells adjacent to any `pond`-klass
 * body in `lakes` (tarn/lake/mere shores are NEVER tagged, spec-faithful scope) over an
 * explicit render-water raster. Split out from `computeFisherySites` (which supplies both from
 * a real `GameMap`'s hydrology) so tests can drive it against a hand-built fixture WITHOUT full
 * noise-based worldgen — the hydrology store derives its heightfield purely from `map.seed`
 * (never from hand-authored tiles), so there's no way to fabricate a pond through a synthetic
 * `GameMap`; this seam is the testable surface instead.
 */
export function computeFisherySitesFromLakes(
  lakes: readonly WaterBody[], renderWT: Uint8Array, W: number, H: number,
): FisherySite[] {
  const ponds = lakes.filter((l) => l.klass === 'pond');
  if (ponds.length === 0) return [];
  const idx = (x: number, y: number): number => y * W + x;

  // Cell index → owning pond, for an O(1) shore-membership test.
  const cellPond = new Map<number, WaterBody>();
  for (const p of ponds) for (const c of p.cells) cellPond.set(c, p);

  // A pond with a real inlet/outlet channel reads as fed/drained (moving water) rather than a
  // stagnant puddle — a small fitness bonus, not a gate (a landlocked pond still fishes fine).
  const flowingPondIds = new Set<string>();
  for (const p of ponds) if (p.inletIds.length > 0 || p.outletIds.length > 0) flowingPondIds.add(p.id);
  const maxArea = Math.max(...ponds.map((p) => p.area));

  const out: FisherySite[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (renderWT[idx(x, y)] !== WaterType.Dry) continue;   // the bank must be dry (rendered) land
      // Prefer the LARGEST pond touching this bank cell when more than one borders it (a narrow
      // spit between two ponds) — deterministic (area, then face-scan order, both fixed).
      let bestPond: WaterBody | null = null, bestFace: CardinalFace | null = null;
      for (const [dx, dy, face] of NEIGH) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const pond = cellPond.get(idx(nx, ny));
        if (!pond) continue;
        if (!bestPond || pond.area > bestPond.area) { bestPond = pond; bestFace = face; }
      }
      if (bestPond && bestFace) {
        const strength = scoreSite([
          { id: 'area', weight: 0.7, score: bestPond.area / maxArea },
          { id: 'flow', weight: 0.3, score: flowingPondIds.has(bestPond.id) ? 1 : 0 },
        ]);
        out.push({ x, y, waterFace: bestFace, pondId: bestPond.id, area: bestPond.area, strength });
      }
    }
  }
  // Strongest first; index tiebreak (row-major). Ties are the COMMON case here (every bank
  // cell around the same pond shares that pond's area/flow score, unlike the mill's per-cell
  // flow value) — the explicit tiebreak, not sort stability, is what keeps ordering
  // deterministic across every shore cell of a tied pond.
  out.sort((a, b) => b.strength - a.strength || (a.y * W + a.x) - (b.y * W + b.x));
  return out;
}

/** The good fishery sites within `maxDist` tiles of (cx,cy), NEAREST first (strength breaks
 *  ties, since the input is strength-sorted). The caller tries them in order until a clean
 *  footprint seats. Mirrors `millSitesNear` exactly. */
export function fisherySitesNear(sites: FisherySite[], cx: number, cy: number, maxDist: number): FisherySite[] {
  return sites
    .filter((s) => Math.abs(s.x - cx) + Math.abs(s.y - cy) <= maxDist)
    .sort((a, b) => (Math.abs(a.x - cx) + Math.abs(a.y - cy)) - (Math.abs(b.x - cx) + Math.abs(b.y - cy)));
}
