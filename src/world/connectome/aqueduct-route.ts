// src/world/connectome/aqueduct-route.ts
//
// G6 slice 2 — the grade-constrained aqueduct ROUTER. Given a high water source and a lower sink
// (a settlement), find the horizontal tile line the channel should follow. Where a road router
// minimises travel cost over terrain, an aqueduct router minimises STRUCTURAL cost — the trenching
// (cut) and arching (elevated deck) the channel will need once `planAqueductProfile` lays its
// gravity water-line down the chosen line. So the route prefers to follow a gently-descending
// CONTOUR from source to sink (hugging the ground ⇒ cheap surface channel), detouring around a rise
// it would otherwise have to trench and around a void it would otherwise have to bridge.
//
// The structural cost of a tile depends on the channel's water-line there, which depends on the
// whole path taken to reach it — a history dependence A* can't represent exactly. So the router uses
// a CHEAP ADMISSIBLE PROXY for the cost (the water-line a straight gentle descent would hold at this
// tile's progress between source and sink), then validates the chosen line through the real
// `planAqueductProfile`. The proxy only steers the search; the returned profile is the ground truth
// (true monotone water-line, true cut/surface/elevated, true feasibility). Pure + deterministic.

import { planAqueductProfile, type AqueductProfile, type AqueductProfileOptions } from './aqueduct-profile';
import type { SpanPoint } from './road-span';

export interface AqueductRouteOptions {
  /** Normalised [0,1] ground elevation at a tile. Required. */
  elevAt: (x: number, y: number) => number;
  /** Metres of relief per normalised elevation unit. Required. */
  reliefM: number;
  /** Grid extent — the search stays in `[0,width) × [0,height)`. Required. */
  width: number;
  height: number;
  /** A tile the channel may NOT route through (open water, a lake, a building, off-limits). In-
   *  bounds tiles are passable by default. The source and sink are always treated as passable. */
  blocked?: (x: number, y: number) => boolean;
  /** Channel grade band + structural thresholds, forwarded to the profile planner (and used to size
   *  the routing proxy). See {@link AqueductProfileOptions}. */
  maxGrade?: number;
  minGrade?: number;
  channelDepthM?: number;
  cutDepthMaxM?: number;
  sinkUndershootM?: number;
  /** Cost weights (per tile). `length` is the base step cost (keeps routes short); `cut`/`elevated`
   *  price each metre of proxied trench / deck the route would incur, so raising `elevated` makes
   *  the router work harder to avoid arching, etc. Defaults: length 1, cut 1.5, elevated 2. */
  weights?: { length?: number; cut?: number; elevated?: number };
  /** Safety cap on explored nodes (a blocked map can't strand the search). Default 200k. */
  maxExpansions?: number;
}

export interface AqueductRoute {
  /** The chosen tile line, source first → sink last (unit-stepped, 4-connected). */
  path: SpanPoint[];
  /** The real channel profile along {@link path} (the ground-truth geometry + feasibility). */
  profile: AqueductProfile;
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], [0, 1], [-1, 0], [1, 0],
];

interface Node {
  x: number;
  y: number;
  g: number;
  f: number;
  parent: Node | null;
}

const keyOf = (x: number, y: number) => `${x},${y}`;

/**
 * Route an aqueduct from `source` to `sink`, returning the chosen line plus its real profile, or
 * `null` if no in-bounds unblocked path exists. The returned `profile.feasible` tells the caller
 * whether that line can actually carry water (source above sink, no cut beyond the cap, head
 * delivered) — a path can be found yet be hydraulically infeasible, which the placer/caller decides
 * how to handle (reject, or try a different source).
 */
export function routeAqueduct(
  source: SpanPoint,
  sink: SpanPoint,
  opts: AqueductRouteOptions,
): AqueductRoute | null {
  const { width, height, reliefM } = opts;
  const wLen = opts.weights?.length ?? 1;
  const wCut = opts.weights?.cut ?? 1.5;
  const wElev = opts.weights?.elevated ?? 2;
  const channelDepthM = opts.channelDepthM ?? 0.6;
  const maxExpansions = opts.maxExpansions ?? 200_000;

  const sx = Math.round(source.x), sy = Math.round(source.y);
  const tx = Math.round(sink.x), ty = Math.round(sink.y);
  const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
  if (!inBounds(sx, sy) || !inBounds(tx, ty)) return null;

  const isBlocked = (x: number, y: number) => {
    if (x === sx && y === sy) return false;       // endpoints always passable
    if (x === tx && y === ty) return false;
    return opts.blocked?.(x, y) ?? false;
  };

  const srcElevM = opts.elevAt(sx, sy) * reliefM;
  const sinkElevM = opts.elevAt(tx, ty) * reliefM;
  // Straight-line progress proxy: the water-line a uniform gentle descent would hold at a tile,
  // by its projected fraction along source→sink. Used only to PRICE the search, not to classify.
  const dxL = tx - sx, dyL = ty - sy;
  const lineLen2 = dxL * dxL + dyL * dyL || 1;
  const targetWaterAt = (x: number, y: number): number => {
    const frac = Math.max(0, Math.min(1, ((x - sx) * dxL + (y - sy) * dyL) / lineLen2));
    return srcElevM + (sinkElevM - srcElevM) * frac;
  };
  // Per-tile structural penalty proxy: a rise above the target line costs cut, a drop below it costs
  // elevated, the channel-depth band around it is free (surface).
  const tilePenalty = (x: number, y: number): number => {
    const ground = opts.elevAt(x, y) * reliefM;
    const target = targetWaterAt(x, y);
    const above = ground - (target + channelDepthM);   // ground over the line ⇒ cut
    if (above > 0) return wCut * above;
    const below = (target - channelDepthM) - ground;   // ground under the line ⇒ deck
    if (below > 0) return wElev * below;
    return 0;
  };
  // Admissible heuristic: remaining Manhattan distance priced at the (cheapest) length weight only;
  // penalties are ≥ 0, so this never over-estimates.
  const heuristic = (x: number, y: number) => (Math.abs(x - tx) + Math.abs(y - ty)) * wLen;

  const open = new Map<string, Node>();
  const closed = new Set<string>();
  const start: Node = { x: sx, y: sy, g: 0, f: 0, parent: null };
  start.f = heuristic(sx, sy);
  open.set(keyOf(sx, sy), start);

  let expansions = 0;
  while (open.size > 0) {
    if (++expansions > maxExpansions) return null;
    // Lowest-f node (linear scan — matches the codebase's A*; a heap can replace it if it matters).
    let cur: Node | null = null;
    for (const n of open.values()) {
      if (!cur || n.f < cur.f || (n.f === cur.f && (Math.abs(n.x - tx) + Math.abs(n.y - ty)) < (Math.abs(cur.x - tx) + Math.abs(cur.y - ty)))) cur = n;
    }
    if (!cur) break;
    const ck = keyOf(cur.x, cur.y);

    if (cur.x === tx && cur.y === ty) {
      const path: SpanPoint[] = [];
      for (let n: Node | null = cur; n; n = n.parent) path.unshift({ x: n.x, y: n.y });
      const profile = planAqueductProfile(path, profileOpts(opts))!;
      return { path, profile };
    }

    open.delete(ck);
    closed.add(ck);

    for (const [dx, dy] of DIRS) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (!inBounds(nx, ny) || isBlocked(nx, ny)) continue;
      const nk = keyOf(nx, ny);
      if (closed.has(nk)) continue;
      const g = cur.g + wLen + tilePenalty(nx, ny);
      const existing = open.get(nk);
      if (existing && g >= existing.g) continue;
      open.set(nk, { x: nx, y: ny, g, f: g + heuristic(nx, ny), parent: cur });
    }
  }
  return null;
}

function profileOpts(opts: AqueductRouteOptions): AqueductProfileOptions {
  return {
    elevAt: opts.elevAt,
    reliefM: opts.reliefM,
    maxGrade: opts.maxGrade,
    minGrade: opts.minGrade,
    channelDepthM: opts.channelDepthM,
    cutDepthMaxM: opts.cutDepthMaxM,
    sinkUndershootM: opts.sinkUndershootM,
  };
}
