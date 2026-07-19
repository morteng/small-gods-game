// src/world/desire-line-corridors.ts
// Road-wear economy S4 — desire-line ADOPTION corridor tracing (the PURE detection half).
// Spec: docs/superpowers/specs/2026-07-17-road-wear-economy-spec.md §5, §7 (S4 row), §9 dec. 3–4.
//
// The bottom rung of the road-formation ladder. A promoted trample corridor (an emergent NPC
// desire-line; `src/sim/trample.ts`) that has sustained qualifying wear between two ANCHORS —
// an existing graph node, a landing mid-way along an existing road, or a POI the graph never
// reached (an off-road mill) — has earned the right to become a real `RoadEdge`. This module
// finds those corridors and hands the driver a clean, deterministic geometry to adopt.
//
// This is the PURE TRACING half. It scans the trample grid's promoted set for the connected
// chains that span between two reachable anchors and returns deterministic `AdoptionCandidate`s
// (the traced 4-connected path + its mean wear + any log crossings it rides). The ledger/commit
// half — `adoptDesireLine` in `src/world/desire-line-adoption.ts`, written in parallel — consumes
// these candidates: it owns the streak discipline (`N_ADOPT` consecutive qualifying year-passes,
// the `ADOPT_WEAR_MIN` gate), the RoadEdge build, the mid-edge junction split (`splitEdgeAtIndex`),
// the trample `release()`, and the scrub-replay ledger. Nothing here mutates the grid, the graph,
// entities, or persistence.
//
// Deterministic + RNG-free by construction (the `no-random-in-sim` guard philosophy applies — this
// is consumed from sim-adjacent year-pass code): row-major seed order from `promotedCellList()`,
// fixed neighbour order `[+x,-x,+y,-y]` with log-jumps last, output sorted by `key`. Runs at most
// ~1×/fiction-year over the (usually small) promoted set, so the flood/BFS work is well within budget.
//
// Design notes carried from the spec:
//  • Water is IMPASSABLE except across a standing corridor log (a §9.4 tier-0 crossing on the humble
//    trail). Adoption never CREATES a crossing (§7 non-goal) — it only rides logs that S3 already
//    placed, passed in as `logSites`. Both banks of a log must be promoted for the jump to be legal.
//  • A trail that shadows an existing road between the same two anchors IS a legal candidate — a
//    genuine shortcut. The redundancy question belongs to the emergent-edge lint EXEMPTION (§5), not
//    to this detector; it reports the geometry and lets the driver + contracts rule.
//  • This module reports `meanWear` raw and does NOT apply `ADOPT_WEAR_MIN` — the driver owns the
//    streak/threshold discipline. The gate lives here only as an exported constant for the driver.

import type { GameMap, POI } from '@/core/types';
import type { RoadGraph, RoadNode } from '@/world/road-graph';
import type { TrampleGrid } from '@/sim/trample';
import { WATER_TYPES } from '@/core/constants';

/** Mean trample wear a corridor must sustain to qualify for adoption. Reported, not enforced here —
 *  the driver (`adoptDesireLine`) gates on it across `N_ADOPT` consecutive year-passes. */
export const ADOPT_WEAR_MIN = 100;
/** Chebyshev tiles a corridor END may sit from an anchor for that anchor to bind the corridor. */
export const ADOPT_ANCHOR_REACH_T = 3;
/** Minimum promoted-cell count of a corridor component — below this it's a stub, never adopted. */
export const ADOPT_MIN_PATH_CELLS = 6;
/** Consecutive qualifying year-passes an adoption streak must hold. Exported here; the DRIVER owns
 *  the streak book-keeping — this module is stateless and re-detects from scratch each pass. */
export const N_ADOPT = 4;

/** How a corridor end binds to the road network / world. Identity for streak+dedupe keying:
 *  node→`nodeId`, edge→`edgeId` (NOT the index — the trail wobbles), poi→`poiId`. */
export type AdoptionAnchor =
  | { kind: 'node'; nodeId: string; cell: { x: number; y: number }; poiId?: string }   // existing graph node (poiId when node.kind==='poi' → node.poiRef)
  | { kind: 'edge'; edgeId: string; index: number; cell: { x: number; y: number } }     // mid-edge landing: STRICTLY interior polyline index (1..len-2); the commit splits here
  | { kind: 'poi'; poiId: string; cell: { x: number; y: number } };                      // a POI with no graph node on its cell (e.g. an off-road mill)

export interface AdoptionCandidate {
  /** Stable streak identity: 'adopt:' + the two anchor identity strings sorted + joined '~'. */
  key: string;
  anchors: [AdoptionAnchor, AdoptionAnchor];
  /** 4-connected cell path, path[0] === anchors[0].cell and path[last] === anchors[1].cell.
   *  Interior = promoted trail cells + short land connectors at each end + log-jump water cells. */
  path: { x: number; y: number }[];
  /** Indices into `path` that are water cells crossed via a standing corridor log. */
  bridgeIndices: number[];
  /** corridorIds of the standing log sites the path crosses (the S4 ledger re-key input). */
  logCorridorIds: string[];
  /** Mean trample wear over the PROMOTED cells of the path (connectors/water excluded). */
  meanWear: number;
}

/** The geometry subset of an S3 `CrossingTierEntry` this detector needs — a standing corridor log. */
export interface CorridorLogSite {
  corridorId: string;
  banks: [{ x: number; y: number }, { x: number; y: number }];
  water: Array<{ x: number; y: number }>;    // ordered bank[0] → bank[1]
}

interface AnchorResolution {
  anchor: AdoptionAnchor;
  /** Identity string used for the dedupe/streak key (node→nodeId, edge→edgeId, poi→poiId). */
  identity: string;
}

/** A jump edge across a standing log: the far promoted bank + the water it inserts, oriented. */
interface Jump {
  to: number;                                  // flat index of the far bank
  water: Array<{ x: number; y: number }>;      // oriented near-bank → far-bank
  corridorId: string;
}

export function traceAdoptionCorridors(
  trample: TrampleGrid,
  map: GameMap,
  graph: RoadGraph,
  opts: {
    pois?: POI[];
    logSites?: CorridorLogSite[];
    isWater?: (x: number, y: number) => boolean;
  } = {},
): AdoptionCandidate[] {
  const W = map.width;
  const H = map.height;
  const pois = opts.pois ?? [];
  const isWater = opts.isWater ?? ((x: number, y: number) => WATER_TYPES.has(map.tiles[y]?.[x]?.type ?? ''));

  const inBounds = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;
  const flatOf = (x: number, y: number): number => y * W + x;
  const cellOf = (i: number): { x: number; y: number } => ({ x: i % W, y: (i - (i % W)) / W });

  // ── 1. Promoted-cell set + the log-jump adjacency ──────────────────────────────────────────
  // A promoted cell is a node; 4-connected between promoted cells is an edge; a "log jump" is an
  // edge between the two banks of a `logSites` entry WHEN BOTH banks are promoted (the only legal
  // way to cross water). The jump carries the site's water cells (for bridgeIndices/logCorridorIds).
  const promotedCells = trample.promotedCellList();               // row-major sorted (deterministic seed order)
  const promoted = new Set<number>(promotedCells.map((c) => flatOf(c.x, c.y)));

  const jumps = new Map<number, Jump[]>();
  const addJump = (from: number, jump: Jump): void => {
    const arr = jumps.get(from);
    if (arr) arr.push(jump);
    else jumps.set(from, [jump]);
  };
  for (const site of opts.logSites ?? []) {
    const b0 = flatOf(site.banks[0].x, site.banks[0].y);
    const b1 = flatOf(site.banks[1].x, site.banks[1].y);
    if (!promoted.has(b0) || !promoted.has(b1)) continue;         // a log only joins a chain when BOTH banks are trodden
    const water = site.water.map((w) => ({ x: w.x, y: w.y }));
    addJump(b0, { to: b1, water, corridorId: site.corridorId });
    addJump(b1, { to: b0, water: water.slice().reverse(), corridorId: site.corridorId });
  }

  /** Neighbours of a promoted cell: 4-connected (fixed order +x,-x,+y,-y) first, log-jumps last. */
  const neighbours = (i: number): Array<{ to: number; jump?: Jump }> => {
    const { x, y } = cellOf(i);
    const out: Array<{ to: number; jump?: Jump }> = [];
    for (const [dx, dy] of NEIGHBOUR_DELTAS) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const ni = flatOf(nx, ny);
      if (promoted.has(ni)) out.push({ to: ni });
    }
    for (const j of jumps.get(i) ?? []) out.push({ to: j.to, jump: j });
    return out;
  };

  // ── Anchor lookup structures ───────────────────────────────────────────────────────────────
  const nodeById = new Map<string, RoadNode>();
  for (const n of graph.nodes) nodeById.set(n.id, n);
  const nodeCells = new Set<number>();                            // cells that carry a graph node (poi anchor (c) excludes these)
  for (const n of graph.nodes) if (inBounds(n.x, n.y)) nodeCells.add(flatOf(n.x, n.y));
  const roadEdges = graph.edges.filter((e) => e.feature === 'road');

  // ── 2. Connected components (flood in row-major seed order; jumps included, jumps last) ──────
  const visited = new Set<number>();
  const components: number[][] = [];
  for (const c of promotedCells) {
    const seed = flatOf(c.x, c.y);
    if (visited.has(seed)) continue;
    const comp: number[] = [];
    const stack = [seed];
    visited.add(seed);
    while (stack.length) {
      const cur = stack.pop()!;
      comp.push(cur);
      for (const nb of neighbours(cur)) {
        if (!visited.has(nb.to)) {
          visited.add(nb.to);
          stack.push(nb.to);
        }
      }
    }
    components.push(comp);
  }

  // ── 3–7. Per component: diameter endpoints → anchors → path → candidate ──────────────────────
  const byKey = new Map<string, AdoptionCandidate>();
  for (const comp of components) {
    if (comp.length < ADOPT_MIN_PATH_CELLS) continue;             // a stub is not a road

    // Double-BFS diameter: from the row-major-smallest cell to E1, then E1 to E2 (hop count,
    // tie-break smallest flat index). `comp[0]` is the seed = the component's row-major-smallest.
    const e1 = bfsFarthest(comp[0], neighbours);
    const e2 = bfsFarthest(e1, neighbours);
    if (e1 === e2) continue;                                       // degenerate (single-cell diameter)

    const a1 = resolveAnchor(cellOf(e1));
    const a2 = resolveAnchor(cellOf(e2));
    if (!a1 || !a2) continue;                                      // an end with no anchor in reach → no road
    if (a1.identity === a2.identity) continue;                    // §5: a trail looping back to its own anchor is not a road

    // 6. Build the full path: land connector anchor0→E1, then the through-component path E1→E2
    //    (jumps allowed), then land connector E2→anchor1. Connectors never touch water.
    const conn0 = landConnector(a1.anchor.cell, e1);
    if (!conn0) continue;
    const mid = middlePath(e1, e2, neighbours, cellOf);
    if (!mid) continue;                                           // unreachable (should not happen within one component)
    const conn1 = landConnector(cellOf(e2), flatOf(a2.anchor.cell.x, a2.anchor.cell.y));
    if (!conn1) continue;

    // Stitch with a bridge-corridor tag per cell, then dedupe consecutive duplicates (the connectors
    // share their terminal cell with the middle segment). Compute bridgeIndices AFTER the dedupe.
    const tagged: Array<{ cell: { x: number; y: number }; corridor: string | null }> = [];
    for (const cell of conn0) tagged.push({ cell, corridor: null });
    for (const step of mid.steps) tagged.push(step);
    for (const cell of conn1) tagged.push({ cell, corridor: null });

    const path: { x: number; y: number }[] = [];
    const bridgeIndices: number[] = [];
    const logCorridorIds: string[] = [];
    for (const t of tagged) {
      const last = path[path.length - 1];
      if (last && last.x === t.cell.x && last.y === t.cell.y) continue;   // drop consecutive duplicate
      path.push({ x: t.cell.x, y: t.cell.y });
      if (t.corridor !== null) {
        bridgeIndices.push(path.length - 1);
        if (!logCorridorIds.includes(t.corridor)) logCorridorIds.push(t.corridor);
      }
    }
    if (!is4Connected(path)) continue;                            // invariant guard (defensive — stitching keeps it 4-connected)

    // 7. meanWear over the PROMOTED cells actually on the path (connectors/water excluded).
    let sum = 0, n = 0;
    for (const p of path) {
      if (promoted.has(flatOf(p.x, p.y))) { sum += trample.wearAt(p.x, p.y); n++; }
    }
    const meanWear = n > 0 ? sum / n : 0;

    const key = `adopt:${[a1.identity, a2.identity].sort().join('~')}`;
    if (byKey.has(key)) continue;                                 // 8. at most one per key; first (row-major component order) wins
    byKey.set(key, {
      key,
      anchors: [a1.anchor, a2.anchor],
      path,
      bridgeIndices,
      logCorridorIds,
      meanWear,
    });
  }

  // 8. Final list sorted by key (deterministic).
  return [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  // ── local helpers (close over W/H/map/promoted/…) ────────────────────────────────────────────

  /** Resolve an anchor for a corridor end. Preference (a) graph node > (b) mid-edge landing >
   *  (c) off-graph POI, each within `ADOPT_ANCHOR_REACH_T` Chebyshev. Returns null if none in reach. */
  function resolveAnchor(end: { x: number; y: number }): AnchorResolution | null {
    // (a) nearest existing graph node (any kind), tie-break smallest node id.
    let bestNode: { node: RoadNode; d: number } | null = null;
    for (const node of graph.nodes) {
      const d = cheby(end.x, end.y, node.x, node.y);
      if (d > ADOPT_ANCHOR_REACH_T) continue;
      if (!bestNode || d < bestNode.d || (d === bestNode.d && node.id < bestNode.node.id)) {
        bestNode = { node, d };
      }
    }
    if (bestNode) {
      const n = bestNode.node;
      const anchor: AdoptionAnchor = { kind: 'node', nodeId: n.id, cell: { x: n.x, y: n.y } };
      if (n.kind === 'poi' && n.poiRef) anchor.poiId = n.poiRef;
      return { anchor, identity: n.id };
    }

    // (b) nearest polyline cell of any road-feature edge, tie-break (dist, edgeId, index).
    let bestEdge: { edgeId: string; index: number; cell: { x: number; y: number }; len: number; d: number } | null = null;
    for (const e of roadEdges) {
      for (let idx = 0; idx < e.polyline.length; idx++) {
        const c = e.polyline[idx];
        const d = cheby(end.x, end.y, c.x, c.y);
        if (d > ADOPT_ANCHOR_REACH_T) continue;
        if (!bestEdge
          || d < bestEdge.d
          || (d === bestEdge.d && e.id < bestEdge.edgeId)
          || (d === bestEdge.d && e.id === bestEdge.edgeId && idx < bestEdge.index)) {
          bestEdge = { edgeId: e.id, index: idx, cell: { x: c.x, y: c.y }, len: e.polyline.length, d };
        }
      }
    }
    if (bestEdge) {
      // Nearest cell is an ENDPOINT (index 0 / len-1) → resolve to that endpoint's NODE, not a split.
      if (bestEdge.index === 0 || bestEdge.index === bestEdge.len - 1) {
        const edge = roadEdges.find((e) => e.id === bestEdge!.edgeId)!;
        const nodeId = bestEdge.index === 0 ? edge.a : edge.b;
        const node = nodeById.get(nodeId);
        const cell = node ? { x: node.x, y: node.y } : bestEdge.cell;
        const anchor: AdoptionAnchor = { kind: 'node', nodeId, cell };
        if (node?.kind === 'poi' && node.poiRef) anchor.poiId = node.poiRef;
        return { anchor, identity: nodeId };
      }
      // Strictly interior — a genuine mid-edge landing; the commit splits the host edge here.
      return {
        anchor: { kind: 'edge', edgeId: bestEdge.edgeId, index: bestEdge.index, cell: bestEdge.cell },
        identity: bestEdge.edgeId,
      };
    }

    // (c) nearest POI with no graph node on its cell, tie-break smallest poi id.
    let bestPoi: { poi: POI; d: number } | null = null;
    for (const poi of pois) {
      if (!poi.position) continue;
      if (nodeCells.has(flatOf(poi.position.x, poi.position.y))) continue;    // on a graph node → (a) already owns it
      const d = cheby(end.x, end.y, poi.position.x, poi.position.y);
      if (d > ADOPT_ANCHOR_REACH_T) continue;
      if (!bestPoi || d < bestPoi.d || (d === bestPoi.d && poi.id < bestPoi.poi.id)) {
        bestPoi = { poi, d };
      }
    }
    if (bestPoi) {
      const p = bestPoi.poi;
      return {
        anchor: { kind: 'poi', poiId: p.id, cell: { x: p.position!.x, y: p.position!.y } },
        identity: p.id,
      };
    }
    return null;
  }

  /** 4-connected land BFS from `start` cell to the cell at flat index `goal`, ≤ ADOPT_ANCHOR_REACH_T+1
   *  steps over walkable land (never water, never `tile.walkable===false`; road tiles ARE allowed —
   *  connectors often meet the road). Returns the inclusive cell path, or null if unreachable. */
  function landConnector(start: { x: number; y: number }, goal: number): { x: number; y: number }[] | null {
    const g = cellOf(goal);
    if (start.x === g.x && start.y === g.y) return [{ x: g.x, y: g.y }];
    const maxSteps = ADOPT_ANCHOR_REACH_T + 1;
    const startK = flatOf(start.x, start.y);
    const prev = new Map<number, number>();
    const depth = new Map<number, number>();
    prev.set(startK, -1);
    depth.set(startK, 0);
    const q = [startK];
    for (let qi = 0; qi < q.length; qi++) {
      const k = q[qi];
      const d = depth.get(k)!;
      if (d >= maxSteps) continue;
      const { x, y } = cellOf(k);
      for (const [dx, dy] of NEIGHBOUR_DELTAS) {
        const nx = x + dx, ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        const nk = flatOf(nx, ny);
        if (prev.has(nk)) continue;
        if (!isWalkableLand(nx, ny)) continue;
        prev.set(nk, k);
        depth.set(nk, d + 1);
        if (nk === goal) return reconstruct(prev, goal, cellOf);
        q.push(nk);
      }
    }
    return null;
  }

  /** True when a cell is dry, in-bounds land a walker can stand on (road tiles included). */
  function isWalkableLand(x: number, y: number): boolean {
    if (!inBounds(x, y) || isWater(x, y)) return false;
    return map.tiles[y]?.[x]?.walkable !== false;
  }
}

// ── module-level pure helpers ──────────────────────────────────────────────────────────────────

/** Fixed 4-neighbour order used everywhere in this module (+x, -x, +y, -y) — determinism. */
const NEIGHBOUR_DELTAS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function cheby(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/** BFS over the promoted-cell adjacency; return the farthest cell (max hop count, tie-break smallest
 *  flat index). Used twice for the classic double-BFS graph-diameter endpoints. */
function bfsFarthest(source: number, neighbours: (i: number) => Array<{ to: number; jump?: Jump }>): number {
  const depth = new Map<number, number>();
  depth.set(source, 0);
  const q = [source];
  let best = source, bestD = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const k = q[qi];
    const d = depth.get(k)!;
    if (d > bestD || (d === bestD && k < best)) { best = k; bestD = d; }
    for (const nb of neighbours(k)) {
      if (depth.has(nb.to)) continue;
      depth.set(nb.to, d + 1);
      q.push(nb.to);
    }
  }
  return best;
}

/** Shortest path E1→E2 through the component (BFS, fixed neighbour order, log-jumps allowed). Returns
 *  the tagged cell steps (E1..E2 inclusive), each tagged with the log corridorId when it is a water
 *  cell inserted by a jump, else null. Null if E2 is unreachable (never happens within one component). */
function middlePath(
  e1: number,
  e2: number,
  neighbours: (i: number) => Array<{ to: number; jump?: Jump }>,
  cellOf: (i: number) => { x: number; y: number },
): { steps: Array<{ cell: { x: number; y: number }; corridor: string | null }> } | null {
  // BFS recording the incoming edge (its jump, if any) per node.
  const prev = new Map<number, { from: number; jump?: Jump }>();
  prev.set(e1, { from: -1 });
  const q = [e1];
  let found = false;
  for (let qi = 0; qi < q.length && !found; qi++) {
    const k = q[qi];
    for (const nb of neighbours(k)) {
      if (prev.has(nb.to)) continue;
      prev.set(nb.to, { from: k, jump: nb.jump });
      if (nb.to === e2) { found = true; break; }
      q.push(nb.to);
    }
  }
  if (!found && e1 !== e2) return null;

  // Walk back E2→E1 collecting the node chain + the jump used to ENTER each node, then reverse.
  const chain: Array<{ flat: number; jump?: Jump }> = [];
  let cur = e2;
  while (cur !== e1) {
    const p = prev.get(cur)!;
    chain.push({ flat: cur, jump: p.jump });
    cur = p.from;
  }
  chain.push({ flat: e1 });
  chain.reverse();                                        // now E1..E2; entry k's jump is the edge chain[k-1]→chain[k]

  const steps: Array<{ cell: { x: number; y: number }; corridor: string | null }> = [];
  for (let k = 0; k < chain.length; k++) {
    const node = chain[k];
    if (k > 0 && node.jump) {
      // The jump's water is oriented prev→this (chain[k-1]→chain[k]); insert it between the banks.
      for (const w of node.jump.water) steps.push({ cell: { x: w.x, y: w.y }, corridor: node.jump.corridorId });
    }
    const c = cellOf(node.flat);
    steps.push({ cell: { x: c.x, y: c.y }, corridor: null });
  }
  return { steps };
}

/** Reconstruct a flat-index BFS path (prev map, terminal `goal`) into an inclusive cell list. */
function reconstruct(prev: Map<number, number>, goal: number, cellOf: (i: number) => { x: number; y: number }): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  let k: number | undefined = goal;
  while (k !== undefined && k !== -1) {
    out.push(cellOf(k));
    k = prev.get(k);
  }
  return out.reverse();
}

/** True when every consecutive pair in the path is 4-adjacent (Manhattan distance 1). */
function is4Connected(path: { x: number; y: number }[]): boolean {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) return false;
  }
  return true;
}
