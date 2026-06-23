// src/terrain/water-network-edits.ts
//
// The water connectome is EDITABLE — "everything movable / reorderable in real time".
// An author (human in the studio, or an agent over the bus) moves a node; the reaches
// incident to it re-route to follow. This is a pure, derived OVERLAY: the hydrology
// raster and the base network stay untouched, and `applyNodeMoves` returns a NEW network
// with the moved nodes + re-smoothed reaches. Nothing is persisted; the carve re-derives
// from the edited network on drop (and the base re-derives identically from the seed).
//
// Re-routing keeps a reach's interior cell chain (the channel the water actually cut) and
// only relocates the moved ENDPOINT, re-smoothing through the new head/foot — so dragging
// a spring relocates the source while the river's body stays on its bed. Pure.

import type { WaterNetwork, WaterReach, WaterBody, WaterNodeKind, Pt } from './river-network';
import { smoothCenterline, classifyLake } from './river-network';

/** nodeId → new position in node coord space (the same space as `WaterNode.x/.y`). */
export type NodeMoves = ReadonlyMap<string, Pt>;

/** Cell-centre of a grid index (the centreline coordinate space). */
function cellCentre(cell: number, W: number): Pt {
  return { x: (cell % W) + 0.5, y: ((cell / W) | 0) + 0.5 };
}

/** Re-route one reach given the (possibly moved) endpoint positions. Interior cells keep
 *  their bed; the moved end is relocated to the node's new centre and the line re-smoothed. */
function rerouteReach(r: WaterReach, W: number, fromPos: Pt | null, toPos: Pt | null): WaterReach {
  if (!fromPos && !toPos) return r;
  const control: Pt[] = r.cells.map((c) => cellCentre(c, W));
  if (fromPos) control[0] = { x: fromPos.x + 0.5, y: fromPos.y + 0.5 };
  if (toPos) control[control.length - 1] = { x: toPos.x + 0.5, y: toPos.y + 0.5 };
  return { ...r, centerline: smoothCenterline(control) };
}

/**
 * Apply node moves to a water network, returning a NEW network with moved node anchors and
 * re-routed reaches. Pure — the input network is untouched. An empty move set returns the
 * input unchanged (identity), so callers can apply unconditionally.
 */
export function applyNodeMoves(net: WaterNetwork, moves: NodeMoves): WaterNetwork {
  if (moves.size === 0) return net;
  const nodes = net.nodes.map((n) => {
    const m = moves.get(n.id);
    return m ? { ...n, x: m.x, y: m.y } : n;
  });
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const reaches = net.reaches.map((r) =>
    rerouteReach(r, net.width, moves.get(r.from) ?? null, moves.get(r.to) ?? null));
  return { ...net, nodes, reaches, byId };
}

// ── MERGING — the other resolution to pressure: join two features, don't push apart ──
// Sometimes a pinch point should be resolved topologically. A generated headwater spring
// sitting on a placed lake isn't "too close" — it IS the lake's outflow; joining them
// (the lake becomes the source) is the right move, not separation. Three merges, by the
// kinds involved; all pure (return a new network).

function lakeById(net: WaterNetwork, id: string): WaterBody | undefined {
  return net.lakes.find((l) => l.id === id);
}

/** Join a channel junction to a lake: the lake becomes the channel's source. The junction
 *  is reclassified `lake_outlet`, the reach(es) leaving it become lake-fed, and the lake
 *  records the junction as one of its outlets. (If the junction only *enters* the lake it
 *  is recorded as an inlet instead.) Positions are unchanged. */
function joinJunctionToLake(net: WaterNetwork, juncId: string, lakeId: string): WaterNetwork {
  const junc = net.byId.get(juncId);
  const lake = lakeById(net, lakeId);
  if (!junc || !lake) return net;
  const issues = net.reaches.some((r) => r.from === juncId);   // does a channel leave here?
  const newKind: WaterNodeKind = issues ? 'lake_outlet' : 'lake_inlet';
  const nodes = net.nodes.map((n) => (n.id === juncId ? { ...n, kind: newKind } : n));
  const reaches = net.reaches.map((r) => (r.from === juncId ? { ...r, lakeFed: true } : r));
  const lakes = net.lakes.map((l) => {
    if (l.id !== lakeId) return l;
    const key = issues ? 'outletIds' : 'inletIds';
    return l[key].includes(juncId) ? l : { ...l, [key]: [...l[key], juncId] };
  });
  return { ...net, nodes, reaches, lakes, byId: new Map(nodes.map((n) => [n.id, n] as const)) };
}

/** Absorb one junction into another: every reach touching `dropId` is repointed to
 *  `keepId` (and re-routed to its position); the dropped node and any self-loop reach
 *  it created are removed. The natural merge of two coincident headwaters into one. */
function absorbJunction(net: WaterNetwork, keepId: string, dropId: string): WaterNetwork {
  const keep = net.byId.get(keepId);
  if (!keep || !net.byId.get(dropId)) return net;
  const keepCentre: Pt = { x: keep.x + 0.5, y: keep.y + 0.5 };
  const nodes = net.nodes.filter((n) => n.id !== dropId);
  const reaches = net.reaches
    .map((r) => {
      const from = r.from === dropId ? keepId : r.from;
      const to = r.to === dropId ? keepId : r.to;
      if (from === r.from && to === r.to) return r;
      const control = r.cells.map((c) => cellCentre(c, net.width));
      if (from !== r.from) control[0] = keepCentre;
      if (to !== r.to) control[control.length - 1] = keepCentre;
      return { ...r, from, to, centerline: smoothCenterline(control) };
    })
    .filter((r) => r.from !== r.to);   // drop a reach that collapsed onto a single node
  return { ...net, nodes, reaches, byId: new Map(nodes.map((n) => [n.id, n] as const)) };
}

/** Merge two lake bodies into one: union the cells/shore-links, recompute centroid + class. */
function mergeLakeBodies(net: WaterNetwork, keepId: string, dropId: string): WaterNetwork {
  const a = lakeById(net, keepId), b = lakeById(net, dropId);
  if (!a || !b) return net;
  const cells = [...a.cells, ...b.cells];
  const area = cells.length;
  let sx = 0, sy = 0;
  for (const c of cells) { sx += c % net.width; sy += (c / net.width) | 0; }
  const uniq = (xs: string[]): string[] => [...new Set(xs)];
  const merged: WaterBody = {
    ...a, cells, area, x: sx / area, y: sy / area, klass: classifyLake(area),
    outletIds: uniq([...a.outletIds, ...b.outletIds]),
    inletIds: uniq([...a.inletIds, ...b.inletIds]),
  };
  const lakes = net.lakes.filter((l) => l.id !== dropId).map((l) => (l.id === keepId ? merged : l));
  return { ...net, lakes };
}

/**
 * Merge two water features (junctions or lakes), dispatching by kind: lake+lake unite,
 * junction+junction absorb, lake+junction join (the lake feeds the channel). Pure —
 * returns a new network; unknown ids return the input unchanged.
 */
export function mergeWaterFeatures(net: WaterNetwork, keepId: string, dropId: string): WaterNetwork {
  if (keepId === dropId) return net;
  const keepIsLake = !!lakeById(net, keepId), dropIsLake = !!lakeById(net, dropId);
  if (keepIsLake && dropIsLake) return mergeLakeBodies(net, keepId, dropId);
  if (!keepIsLake && !dropIsLake) return absorbJunction(net, keepId, dropId);
  // one lake, one junction → join the junction to the lake (lake is the surviving body).
  const lakeId = keepIsLake ? keepId : dropId;
  const juncId = keepIsLake ? dropId : keepId;
  return joinJunctionToLake(net, juncId, lakeId);
}
