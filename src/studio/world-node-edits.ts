// src/studio/world-node-edits.ts
//
// The World studio's NODE-EDIT overlay: a small, pure, testable layer that lets the
// author move / retune / add / remove settlement (POI) nodes and fold those edits back
// into a WorldSeed for regeneration. Kept out of the studio's DOM code so the logic can
// be unit-tested and the studio wiring stays thin.
//
// Coordinate space: edits are stored in the FINAL (generated-map) tile space and applied
// to a *base* seed whose POIs are already in that space (the studio snapshots the
// post-`planWorldLayout` seed once). `generateWithNoise` reads `worldSeed.pois`
// directly and does NOT re-run the layout, so applying edits regenerates the world in
// place with no re-centring jump.

import type { POI, Connection, WorldSeed } from '@/core/types';
import type { Era } from '@/core/era';

/** A tuned subset of a POI's fields the inspector exposes for live editing. */
export interface PoiParamEdit {
  size?: POI['size'];
  era?: Era;
  importance?: POI['importance'];
  type?: string;
}

/** The live edit overlay on top of a base POI set. */
export interface PoiEdits {
  moved: Map<string, { x: number; y: number }>;
  params: Map<string, PoiParamEdit>;
  removed: Set<string>;
  added: POI[];
}

export function emptyEdits(): PoiEdits {
  return { moved: new Map(), params: new Map(), removed: new Set(), added: [] };
}

export function hasEdits(e: PoiEdits): boolean {
  return e.moved.size > 0 || e.params.size > 0 || e.removed.size > 0 || e.added.length > 0;
}

/** How many discrete edits are staged — for a "3 edits · Reset" affordance. */
export function countEdits(e: PoiEdits): number {
  return e.moved.size + e.params.size + e.removed.size + e.added.length;
}

/** Merge a param edit into a POI (only defined fields win). */
function mergeParams(p: POI, pr: PoiParamEdit): POI {
  const q: POI = { ...p };
  if (pr.size !== undefined) q.size = pr.size;
  if (pr.era !== undefined) q.era = pr.era;
  if (pr.importance !== undefined) q.importance = pr.importance;
  if (pr.type !== undefined) q.type = pr.type;
  return q;
}

/** Apply the edit overlay to a POI list: drop removed, move + retune, append added. */
export function applyPoiEdits(pois: POI[], e: PoiEdits): POI[] {
  const out: POI[] = [];
  for (const p of pois) {
    if (e.removed.has(p.id)) continue;
    let q: POI = p;
    const mv = e.moved.get(p.id);
    if (mv) q = { ...q, position: { x: Math.round(mv.x), y: Math.round(mv.y) } };
    const pr = e.params.get(p.id);
    if (pr) q = mergeParams(q, pr);
    out.push(q);
  }
  for (const a of e.added) if (!e.removed.has(a.id)) out.push(a);
  return out;
}

/** Drop connections that reference any removed POI id. */
export function cleanConnections(conns: Connection[] | undefined, removed: Set<string>): Connection[] {
  if (!conns) return [];
  return conns.filter((c) => !removed.has(c.from) && !removed.has(c.to));
}

/** Build a new settlement POI at a tile position (final coords). */
export function makeAddedPoi(
  id: string, type: string, x: number, y: number, size: POI['size'] = 'medium', name?: string,
): POI {
  return { id, type, name: name ?? id, position: { x: Math.round(x), y: Math.round(y) }, size };
}

/** A straight dirt road from an added POI to its nearest existing POI, so it's linked in. */
export function connectNearest(added: POI, existing: POI[]): Connection | null {
  if (!added.position) return null;
  let best: POI | null = null, bestD = Infinity;
  for (const p of existing) {
    if (!p.position || p.id === added.id) continue;
    const d = (p.position.x - added.position.x) ** 2 + (p.position.y - added.position.y) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  if (!best?.position) return null;
  return {
    from: added.id, to: best.id, type: 'road', style: 'dirt',
    waypoints: [{ x: added.position.x, y: added.position.y }, { x: best.position.x, y: best.position.y }],
  };
}

/** Fold the edit overlay into a WorldSeed ready for `generateWithNoise` (no re-layout). */
export function applyEditsToSeed(base: WorldSeed, e: PoiEdits): WorldSeed {
  const pois = applyPoiEdits(base.pois ?? [], e);
  const conns = cleanConnections(base.connections, e.removed);
  const addedConns: Connection[] = [];
  for (const a of e.added) {
    const c = connectNearest(a, pois.filter((p) => p.id !== a.id));
    if (c) addedConns.push(c);
  }
  return { ...base, pois, connections: [...conns, ...addedConns] };
}
