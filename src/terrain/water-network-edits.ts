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

import type { WaterNetwork, WaterReach, Pt } from './river-network';
import { smoothCenterline } from './river-network';

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
