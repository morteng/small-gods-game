// src/render/ribbon/river-ribbon-field.ts
//
// Rivers as terrain-following RIBBONS (roads-epic R2) — the de-gridding of the
// per-cell hydrology river. The hydrology model gives each river cell a downstream
// neighbour (`drainTo`, always DOWNHILL), a Strahler `order` and a channel `width`;
// here we trace those `drainTo` chains from every headwater to its mouth into one
// smooth polyline per stream, then sweep them with `ribbon-geometry` (same RDP +
// Catmull-Rom that liberated roads from the grid). The GPU ribbon pass lifts +
// iso-projects them and the river fragment program (tag.y = 1) advects flow ALONG
// the centerline — so a river snakes and flows downstream, never up.
//
// Width tapers with channel width (trunk wider than headwater); flow speed scales
// with the local surface slope (steeper = faster + whitewater). Pure + memoised
// per map (hydrology is deterministic per map).

import type { GameMap, HydrologyResult } from '@/core/types';
import { WaterType } from '@/core/types';
import { getHydrologyResult } from '@/world/hydrology-store';
import { buildRibbonMesh, type RibbonSpec, type RibbonMesh, type Pt } from './ribbon-geometry';

const EMPTY: RibbonMesh = { data: new Float32Array(0), vertexCount: 0 };

/** Hermite smoothstep, clamped — 0 below `e0`, 1 above `e1`. */
function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0 || 1)));
  return t * t * (3 - 2 * t);
}

/** A traced stream: a downstream-ordered cell-centre polyline + its Strahler order.
 *  `endsAtMouth` is true only when the reach spills into STILL water (a lake/ocean
 *  cell) — those get the river-mouth splash; confluences and edge outlets don't. */
export interface RiverPath {
  points: Pt[];
  order: number;
  endsAtMouth: boolean;
}

/**
 * Trace the hydrology river graph into maximal downstream polylines. From each
 * headwater (a river cell with no river draining into it) we walk `drainTo` until
 * the outlet, the river ends, or we meet a cell another walk already claimed (a
 * confluence) — which we still append so tributaries visually join the trunk. The
 * first walk to reach a confluence owns the trunk below it; later tributaries stop
 * there, so each reach is swept once.
 */
export function traceRiverPolylines(map: GameMap, hydro: HydrologyResult): RiverPath[] {
  const W = map.width, H = map.height, N = W * H;
  const { waterType, drainTo, strahler } = hydro;

  // Upstream river contributors per cell → headwaters have none.
  const upstream = new Uint16Array(N);
  for (let i = 0; i < N; i++) {
    if (waterType[i] !== WaterType.River) continue;
    const t = drainTo[i];
    if (t >= 0 && waterType[t] === WaterType.River) upstream[t]++;
  }

  const center = (i: number): Pt => ({ x: (i % W) + 0.5, y: ((i / W) | 0) + 0.5 });
  const visited = new Uint8Array(N);
  const paths: RiverPath[] = [];

  for (let i = 0; i < N; i++) {
    if (waterType[i] !== WaterType.River || upstream[i] !== 0) continue;
    const pts: Pt[] = [];
    let c = i;
    let order = 1;
    let endsAtMouth = false;
    // Guard against pathological cycles with a hard step cap.
    for (let step = 0; step < N; step++) {
      pts.push(center(c));
      order = Math.max(order, strahler[c] || 1);
      if (visited[c] && c !== i) break;           // joined an already-traced reach
      visited[c] = 1;
      const t = drainTo[c];
      if (t < 0) break;                            // outlet
      if (waterType[t] !== WaterType.River) { pts.push(center(t)); endsAtMouth = true; break; } // mouth → lake/ocean
      c = t;
    }
    if (pts.length >= 2) paths.push({ points: pts, order, endsAtMouth });
  }
  return paths;
}

/** Pure: hydrology → swept river ribbon mesh (tile space; lifted on the GPU). The
 *  per-vertex tag is [strahler order, 1] — tag.y=1 selects the river shader. */
export function buildRiverRibbonMesh(map: GameMap, hydro?: HydrologyResult): RibbonMesh {
  const h = hydro ?? getHydrologyResult(map);
  const paths = traceRiverPolylines(map, h);
  if (!paths.length) return EMPTY;

  const W = map.width, H = map.height;
  const idx = (x: number, y: number) =>
    Math.min(H - 1, Math.max(0, Math.floor(y))) * W + Math.min(W - 1, Math.max(0, Math.floor(x)));

  // Channel half-width in tiles (trunk wider than headwater); never knife-thin.
  const halfWidth = (x: number, y: number) => Math.max(0.4, (h.width[idx(x, y)] || 1) * 0.5);
  // Flow speed from the water-surface slope to the downstream cell (steeper=faster).
  const speed = (x: number, y: number) => {
    const i = idx(x, y);
    const t = h.drainTo[i];
    if (t < 0) return 0.35;
    const drop = Math.max(0, h.surfaceW[i] - h.surfaceW[t]);
    return Math.min(2.2, 0.35 + drop * 45);
  };

  // tag.x carries the MOUTH-SPLASH ramp (0 upstream → 1 at the lip) for reaches that
  // spill into still water; the river shader ignores Strahler order, so this channel
  // is free. Non-mouth reaches keep 0. tag.y = 1 selects the river fragment program.
  const specs: RibbonSpec[] = paths.map((p) => ({
    points: p.points,
    halfWidth,
    speed,
    tag: p.endsAtMouth
      ? ((_x: number, _y: number, a01: number): [number, number] => [smoothstep(0.78, 1.0, a01), 1])
      : ([0, 1] as [number, number]),
    simplifyTol: 1.2,
  }));
  return buildRibbonMesh(specs);
}

// Memoise by map identity — hydrology is built once per world.
let memo: { map: GameMap; mesh: RibbonMesh } | null = null;
export function buildRiverRibbonMeshMemo(map: GameMap): RibbonMesh {
  if (memo && memo.map === map) return memo.mesh;
  const mesh = buildRiverRibbonMesh(map);
  memo = { map, mesh };
  return mesh;
}
