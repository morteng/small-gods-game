// src/terrain/river-network.ts
//
// The WATER CONNECTOME — rivers promoted from a per-cell raster to a graph.
//
// `generateHydrology` gives us a per-cell drainage RASTER (`waterType`, `drainTo`,
// `flowField`, `strahler`). That is the right substrate for *where the water is*,
// but it has no notion of identity: there is no "this brook", no "the river that
// leaves Mirror Pond", no "two tributaries from different springs that meet here".
// Every feature the design calls for — sub-cell pixel-perfect carving, ponds on a
// stream, lake-fed rivers, multi-source confluences, draggable/reorderable features
// — needs the SAME thing: the channel as a GRAPH.
//
// This module walks the drainage forest in `drainTo` and lifts it into:
//   • NODES — the articulation points where the network's meaning changes:
//       spring (a headwater source), confluence (≥2 channels merge), lake_outlet
//       (a channel born at a lake's spill), lake_inlet (a channel enters a lake),
//       mouth (a channel reaches the ocean / map edge — an estuary).
//   • REACHES — a maximal run of channel cells between two nodes, carrying its
//       Strahler order, flow, a spectrum CLASS (brook → stream → river → major), a
//       lake-fed flag, and a SMOOTHED SUB-CELL centerline (Catmull-Rom resample of
//       the cell centres) — the line the carve and the renderer follow for a
//       contour-hugging channel instead of a blocky per-cell staircase.
//
// Pure + deterministic (cells visited in index order, ids derived from cell index);
// no randomness, no I/O. The raster stays the source of truth for occupancy; this is
// a derived, queryable, editable VIEW of it.

import type { HydrologyResult } from '@/core/types';
import { WaterType } from '@/core/types';

/** Articulation points of the channel graph — where the network's meaning changes. */
export type WaterNodeKind =
  | 'spring'       // headwater source: a channel begins (no upstream channel, no lake feed)
  | 'lake_outlet'  // a channel is born at a lake's spill point (lake-fed river)
  | 'confluence'   // two or more channels merge
  | 'lake_inlet'   // a channel flows into a lake
  | 'mouth';       // a channel reaches the ocean or the map edge (estuary)

/** The river spectrum, derived from Strahler order — a brook is not a trunk river. */
export type ReachClass = 'brook' | 'stream' | 'river' | 'major_river';

/** Still-water size spectrum — a mountain tarn is not a great mere. By cell area. */
export type LakeClass = 'tarn' | 'pond' | 'lake' | 'mere';

/** A connected still-water body (a lake/pond), classified by area, with the channel
 *  junctions on its shore (the springs of its outflow, the mouths of its inflow). */
export interface WaterBody {
  id: string;
  klass: LakeClass;
  cells: number[];       // grid indices of the lake body
  area: number;          // cell count
  x: number;             // centroid (tile coords)
  y: number;
  outletIds: string[];   // lake_outlet junction node ids fed BY this lake
  inletIds: string[];    // lake_inlet junction node ids draining INTO this lake
}

/** Area (cells) → size class. A tarn is a handful of cells; a mere is a major basin. */
export function classifyLake(area: number): LakeClass {
  return area <= 3 ? 'tarn' : area <= 12 ? 'pond' : area <= 60 ? 'lake' : 'mere';
}

export interface WaterNode {
  id: string;
  kind: WaterNodeKind;
  cell: number;          // grid index (y*W + x)
  x: number;             // tile coords (cell column / row)
  y: number;
}

export interface Pt { x: number; y: number; }

export interface WaterReach {
  id: string;
  from: string;          // upstream node id
  to: string;            // downstream node id
  cells: number[];       // ordered channel cells, upstream→downstream (endpoints included)
  order: number;         // Strahler order (max along the reach)
  flow: number;          // accumulated flow at the downstream end
  klass: ReachClass;     // spectrum classification
  lakeFed: boolean;      // true when the upstream node is a lake outlet
  /** Smoothed sub-cell centreline (tile coords), Catmull-Rom resample of cell centres. */
  centerline: Pt[];
}

export interface WaterNetwork {
  nodes: WaterNode[];
  reaches: WaterReach[];
  lakes: WaterBody[];
  byId: Map<string, WaterNode>;
  /** node id at a given channel cell, when that cell IS a node (else undefined). */
  nodeAtCell: Map<number, string>;
  /** Grid dimensions — so an editor can re-route a reach (cells → centreline) on a move. */
  width: number;
  height: number;
}

/**
 * Connected-component lake bodies over the still-water raster, each classified by area
 * and linked to the channel junctions on its shore. 4-connected flood fill in index
 * order (deterministic). `nodeAtCell` maps a shore river cell to its junction id so we
 * can record which outlets a lake feeds and which inlets drain into it.
 */
export function detectLakeBodies(
  hydro: HydrologyResult, W: number, H: number, nodeAtCell: Map<number, string>,
): WaterBody[] {
  const { waterType } = hydro;
  const total = W * H;
  const seen = new Uint8Array(total);
  const bodies: WaterBody[] = [];
  const isLakeCell = (i: number): boolean => i >= 0 && i < total && waterType[i] === WaterType.Lake;
  for (let s = 0; s < total; s++) {
    if (!isLakeCell(s) || seen[s]) continue;
    const cells: number[] = [];
    const stack = [s];
    seen[s] = 1;
    let sx = 0, sy = 0;
    const outletIds = new Set<string>();
    const inletIds = new Set<string>();
    while (stack.length) {
      const c = stack.pop()!;
      const cx = c % W, cy = (c / W) | 0;
      cells.push(c); sx += cx; sy += cy;
      const visit = (n: number): void => {
        if (isLakeCell(n) && !seen[n]) { seen[n] = 1; stack.push(n); }
        else if (waterType[n] === WaterType.River) {
          // A river junction on this lake's shore: lake_outlet (fed by lake) or lake_inlet.
          const id = nodeAtCell.get(n);
          if (!id) return;
          if (hydro.drainTo[n] === c) inletIds.add(id);        // river drains INTO this lake cell
          else if (hydro.drainTo[c] === n) outletIds.add(id);  // lake spills INTO this river cell
        }
      };
      if (cy > 0) visit(c - W);
      if (cy < H - 1) visit(c + W);
      if (cx > 0) visit(c - 1);
      if (cx < W - 1) visit(c + 1);
    }
    const area = cells.length;
    bodies.push({
      id: `wl:${s}`,
      klass: classifyLake(area),
      cells,
      area,
      x: sx / area,
      y: sy / area,
      outletIds: [...outletIds],
      inletIds: [...inletIds],
    });
  }
  return bodies;
}

const CLASS_RANK: Record<ReachClass, number> = { brook: 0, stream: 1, river: 2, major_river: 3 };

/**
 * Spectrum class from DISCHARGE (flow = upstream drainage area, a discharge proxy)
 * blended with a structural Strahler floor. Discharge is what physically separates a
 * brook from a river — a high-volume trunk reads as a river even if no tributary ever
 * merged into it (Strahler 1). The order floor keeps a post-confluence trunk from
 * dropping below a stream. `threshold` is the flow at which a cell became a channel,
 * so the buckets are relative to "the smallest channel this world has".
 */
export function classifyReach(order: number, flow: number, threshold: number): ReachClass {
  const f = flow / Math.max(1, threshold);
  const byFlow: ReachClass = f < 1.5 ? 'brook' : f < 4 ? 'stream' : f < 10 ? 'river' : 'major_river';
  const byOrder: ReachClass = order <= 1 ? 'brook' : order === 2 ? 'stream' : order === 3 ? 'river' : 'major_river';
  return CLASS_RANK[byFlow] >= CLASS_RANK[byOrder] ? byFlow : byOrder;
}

/** Centreline resample spacing (tiles). ~0.5 tile gives sub-cell pixel-perfect carve
 *  resolution without exploding vertex counts on a long trunk. */
const CENTERLINE_SPACING = 0.5;

/**
 * Catmull-Rom resample of a control polyline at a fixed arc-ish spacing. Endpoints are
 * duplicated for the tangent at the ends, so the curve passes through every control
 * point and stays inside the channel corridor (no overshoot blowups). Pure.
 */
export function smoothCenterline(control: Pt[], spacing = CENTERLINE_SPACING): Pt[] {
  if (control.length <= 2) return control.slice();
  const p = control;
  const n = p.length;
  const at = (i: number): Pt => p[i < 0 ? 0 : i >= n ? n - 1 : i];
  const out: Pt[] = [{ x: p[0].x, y: p[0].y }];
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
    const steps = Math.max(1, Math.round(segLen / spacing));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const t2 = t * t, t3 = t2 * t;
      // Catmull-Rom basis (uniform, tension 0.5).
      const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      out.push({ x, y });
    }
  }
  return out;
}

/**
 * Lift the hydrology raster into the water connectome (nodes + reaches).
 * `hydro` is the per-cell drainage model; `W`/`H` are the grid dimensions; `threshold`
 * is the flow at which a cell became a channel (so reach classes scale to this world).
 */
export function buildWaterNetwork(hydro: HydrologyResult, W: number, H: number, threshold = 500): WaterNetwork {
  const { waterType, drainTo, flowField } = hydro;
  const total = W * H;
  const isRiver = (i: number): boolean => i >= 0 && i < total && waterType[i] === WaterType.River;
  const isLake = (i: number): boolean => i >= 0 && i < total && waterType[i] === WaterType.Lake;
  const isOcean = (i: number): boolean => i >= 0 && i < total && waterType[i] === WaterType.Ocean;

  // ── Upstream channel in-degree, and whether a lake feeds each river cell. ──
  // A river cell's downstream is the single `drainTo`; its UPSTREAM donors are every
  // neighbour whose drainTo points back at it. We count river donors (for confluence
  // detection) and note any lake donor (a lake spilling into this cell = lake-fed).
  const riverInDeg = new Uint8Array(total);
  const lakeFeeds = new Uint8Array(total);
  for (let j = 0; j < total; j++) {
    const t = drainTo[j];
    if (t < 0) continue;
    if (!isRiver(t)) continue;
    if (isRiver(j)) { if (riverInDeg[t] < 255) riverInDeg[t]++; }
    else if (isLake(j)) lakeFeeds[t] = 1;
  }

  // ── CHANNEL Strahler — order over the river subgraph only. ──
  // `hydro.strahler` is the FULL-drainage-tree order (every hillslope land cell is a
  // node), so even a headwater channel reads order 3-4 because a big slope drains into
  // it. For the river SPECTRUM we want the channel order: a source channel = 1, rising
  // only where two CHANNELS meet. Process river cells in ascending flow (donors, which
  // carry less flow, finalize before the cell they feed) and apply the Strahler rule.
  const chOrder = new Uint16Array(total);
  const riverCells: number[] = [];
  for (let i = 0; i < total; i++) if (isRiver(i)) riverCells.push(i);
  riverCells.sort((a, b) => flowField[a] - flowField[b]);
  for (const i of riverCells) {
    const x = i % W, y = (i / W) | 0;
    let maxOrd = 0, cntMax = 0;
    const consider = (n: number): void => {
      if (drainTo[n] === i && isRiver(n)) {
        const o = chOrder[n];
        if (o > maxOrd) { maxOrd = o; cntMax = 1; }
        else if (o === maxOrd) cntMax++;
      }
    };
    if (y > 0) consider(i - W);
    if (y < H - 1) consider(i + W);
    if (x > 0) consider(i - 1);
    if (x < W - 1) consider(i + 1);
    chOrder[i] = maxOrd === 0 ? 1 : (cntMax >= 2 ? maxOrd + 1 : maxOrd);
  }

  // ── Classify each river cell as a node (or interior body cell). ──
  // Downstream terminal kinds (mouth / inlet) are read from what `drainTo` points at;
  // upstream kinds (spring / lake_outlet / confluence) from the donor counts above.
  const nodes: WaterNode[] = [];
  const nodeAtCell = new Map<number, string>();
  const byId = new Map<string, WaterNode>();
  const addNode = (cell: number, kind: WaterNodeKind): string => {
    const id = `wn:${cell}`;
    if (nodeAtCell.has(cell)) return nodeAtCell.get(cell)!;   // one node per cell; first kind wins
    const x = cell % W, y = (cell / W) | 0;
    const node: WaterNode = { id, kind, cell, x, y };
    nodes.push(node);
    nodeAtCell.set(cell, id);
    byId.set(id, node);
    return id;
  };

  // Downstream-terminal nodes (mouth / lake_inlet) — precedence over interior.
  const terminalKind = (i: number): WaterNodeKind | null => {
    const t = drainTo[i];
    if (t < 0) return 'mouth';                 // drains off the map edge → estuary/mouth
    if (isOcean(t)) return 'mouth';
    if (isLake(t)) return 'lake_inlet';
    return null;                               // drains into another river cell → interior
  };

  for (let i = 0; i < total; i++) {
    if (!isRiver(i)) continue;
    // Upstream identity first (a cell can be BOTH a source and a terminal in a 1-cell reach).
    if (lakeFeeds[i] && riverInDeg[i] === 0) addNode(i, 'lake_outlet');
    else if (riverInDeg[i] === 0) addNode(i, 'spring');
    else if (riverInDeg[i] >= 2) addNode(i, 'confluence');
    // Downstream terminal (mouth / inlet) — added even if the cell already became an
    // upstream node, but addNode keeps the first kind; terminal-only cells get it here.
    const tk = terminalKind(i);
    if (tk && !nodeAtCell.has(i)) addNode(i, tk);
  }

  // ── Walk reaches: from every NON-terminal node, follow drainTo to the next node. ──
  // A reach is the maximal chain of channel cells between two nodes. Springs / outlets /
  // confluences all START a downstream reach; mouths / inlets only END one.
  const reaches: WaterReach[] = [];
  const startsReach = (id: string): boolean => {
    const k = byId.get(id)!.kind;
    return k === 'spring' || k === 'lake_outlet' || k === 'confluence';
  };
  for (const node of nodes) {
    if (!startsReach(node.id)) continue;
    const cells: number[] = [node.cell];
    let cur = node.cell;
    let guard = 0;
    let toId: string | null = null;
    while (guard++ < total) {
      const next = drainTo[cur];
      if (next < 0 || !isRiver(next)) {            // ran off the channel without hitting a node
        toId = nodeAtCell.get(cur) ?? null;        // (cur should already be a terminal node)
        break;
      }
      cells.push(next);
      if (nodeAtCell.has(next)) { toId = nodeAtCell.get(next)!; break; }
      cur = next;
    }
    if (!toId) {
      // The chain ended at a non-node cell — make the last cell a mouth so the reach closes.
      toId = addNode(cells[cells.length - 1], 'mouth');
    }
    // Reach order = its UPSTREAM end's CHANNEL Strahler. Channel order is constant along
    // a reach and only jumps AT a confluence (the reach's downstream `to` node), so the
    // from-node cell carries the reach's own order (a confluence start already holds the
    // merged value, correct for the trunk leaving it). Flow at the downstream end gives
    // the channel's volume for width.
    const order = chOrder[node.cell];
    const flow = flowField[cells[cells.length - 1]] ?? 0;
    const control: Pt[] = cells.map((c) => ({ x: (c % W) + 0.5, y: ((c / W) | 0) + 0.5 }));
    reaches.push({
      id: `wr:${node.cell}-${cells[cells.length - 1]}`,
      from: node.id,
      to: toId,
      cells,
      order,
      flow,
      klass: classifyReach(order, flow, threshold),
      lakeFed: node.kind === 'lake_outlet',
      centerline: smoothCenterline(control),
    });
  }

  const lakes = detectLakeBodies(hydro, W, H, nodeAtCell);
  return { nodes, reaches, lakes, byId, nodeAtCell, width: W, height: H };
}

/** Quick tally for studio / debug — counts by node kind and reach class. Pure. */
export function summarizeNetwork(net: WaterNetwork): {
  nodes: Record<WaterNodeKind, number>;
  reaches: Record<ReachClass, number>;
  lakes: Record<LakeClass, number>;
  lakeFedReaches: number;
  totalReaches: number;
  totalNodes: number;
  totalLakes: number;
} {
  const nodes: Record<WaterNodeKind, number> = {
    spring: 0, lake_outlet: 0, confluence: 0, lake_inlet: 0, mouth: 0,
  };
  const reaches: Record<ReachClass, number> = { brook: 0, stream: 0, river: 0, major_river: 0 };
  const lakes: Record<LakeClass, number> = { tarn: 0, pond: 0, lake: 0, mere: 0 };
  for (const n of net.nodes) nodes[n.kind]++;
  let lakeFed = 0;
  for (const r of net.reaches) { reaches[r.klass]++; if (r.lakeFed) lakeFed++; }
  for (const l of net.lakes) lakes[l.klass]++;
  return {
    nodes, reaches, lakes,
    lakeFedReaches: lakeFed,
    totalReaches: net.reaches.length,
    totalNodes: net.nodes.length,
    totalLakes: net.lakes.length,
  };
}
