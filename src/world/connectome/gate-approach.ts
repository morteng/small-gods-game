// src/world/connectome/gate-approach.ts
//
// Make inter-POI roads LEAD TO GATES instead of piercing town walls at arbitrary points.
// Two pure mechanisms, combined for robustness (the impure tile carve stays in the caller):
//
//   1. WALLS BECOME OBSTACLES. A defensive ring's blocking cells (its curtain, minus the gate
//      openings) become obstacles for the approach walker, so A* physically cannot cross a
//      curtain except at an opening. (Croft hedges are NOT included — only rings that declare an
//      inside via `run.centroid`, so small lot fences never make a town unroutable.)
//   2. GATE WAYPOINT INJECTION. For each connection whose endpoint POI owns a ring, the ring's
//      real gate nearest the other endpoint is spliced into the route between the town centre and
//      the outside. `buildRoadGraph` already honours `conn.waypoints` and makes a graph node
//      there — so the gate becomes a real RoadGraph node for free, and the road threads it.
//
// Connections that touch NO ring are returned byte-identical (waypoints untouched) → a ringless
// world routes exactly as before. Deterministic: nearest-gate uses distance then gate.t.

import type { Connection, POI } from '@/core/types';
import { barrierFootprintTiles, gatePoint, type BarrierGate, type PlacedBarrier } from '@/world/barrier';

const cellKey = (x: number, y: number): string => `${x},${y}`;
const roundPt = (p: { x: number; y: number }) => ({ x: Math.round(p.x), y: Math.round(p.y) });

/** A ring is DEFENSIVE (worth walling as an obstacle) iff it declares an inside via centroid. */
function defensiveRings(barrierRuns: PlacedBarrier[]): PlacedBarrier[] {
  return barrierRuns.filter((b) => b.run.centroid && b.run.path.length >= 4);
}

/** The ring committed for a POI, by the `${poiId}_ring` id worldgen uses. */
function ringForPoi(barrierRuns: PlacedBarrier[], poiId: string): PlacedBarrier | undefined {
  return barrierRuns.find((b) => b.id === `${poiId}_ring` && b.run.centroid);
}

export interface GateApproachProfile {
  x: number; y: number;
  /** Unit ring normal at the gate, pointing OUTWARD (away from the ring centroid). */
  facing: [number, number];
}

/** Every real gate with its position + OUTWARD facing — the profile a road approach
 *  fillets onto so it arrives square through the opening instead of at a kinked angle. */
export function realGateProfiles(barrierRuns: PlacedBarrier[]): GateApproachProfile[] {
  const out: GateApproachProfile[] = [];
  for (const b of defensiveRings(barrierRuns)) {
    const c = b.run.centroid!;
    for (const g of b.run.gates) {
      if (g.kind === 'gap') continue;
      const [x, y] = gatePoint(b.run, g);
      // Ring tangent at the gate from two nearby path points; normal oriented outward.
      const [ax, ay] = gatePoint(b.run, { t: Math.max(0, g.t - 0.5), width: 0 });
      const [bx, by] = gatePoint(b.run, { t: g.t + 0.5, width: 0 });
      const dx = bx - ax, dy = by - ay, m = Math.hypot(dx, dy) || 1;
      let nx = -dy / m, ny = dx / m;
      if (nx * (x - c[0]) + ny * (y - c[1]) < 0) { nx = -nx; ny = -ny; }
      out.push({ x, y, facing: [nx, ny] });
    }
  }
  return out;
}

/** The real gate (kind !== 'gap') on a ring nearest a target point; deterministic tiebreak on t. */
function nearestRealGate(b: PlacedBarrier, target: { x: number; y: number }): BarrierGate | undefined {
  let best: BarrierGate | undefined;
  let bestD = Infinity;
  for (const g of b.run.gates) {
    if (g.kind === 'gap') continue;
    const [gx, gy] = gatePoint(b.run, g);
    const d = (gx - target.x) ** 2 + (gy - target.y) ** 2;
    if (d < bestD - 1e-9 || (Math.abs(d - bestD) < 1e-9 && (!best || g.t < best.t))) { bestD = d; best = g; }
  }
  return best;
}

export interface GateApproachPlan {
  /** Curtain cells (blocking, gate openings removed) — obstacles for the approach walker. */
  wallObstacles: Set<string>;
  /** Connections rewritten so each ring endpoint routes THROUGH its nearest real gate. */
  connections: Connection[];
}

/** Build the obstacle set + gate-threaded connections for the inter-POI road pass. */
export function gateApproachPlan(
  barrierRuns: PlacedBarrier[],
  connections: Connection[],
  pois: POI[],
): GateApproachPlan {
  const rings = defensiveRings(barrierRuns);
  const wallObstacles = new Set<string>();
  for (const b of rings) for (const [x, y] of barrierFootprintTiles(b.run).blocking) wallObstacles.add(cellKey(x, y));

  const posOf = (id: string) => pois.find((p) => p.id === id)?.position;

  const rewritten = connections.map((conn) => {
    const ringFrom = ringForPoi(barrierRuns, conn.from);
    const ringTo = ringForPoi(barrierRuns, conn.to);
    if (!ringFrom && !ringTo) return conn;                       // touches no ring → untouched (parity)

    const fromPos = posOf(conn.from), toPos = posOf(conn.to);
    // The base point sequence the graph would have walked (authored waypoints, else the centres).
    const base = conn.waypoints?.length
      ? conn.waypoints.slice()
      : (fromPos && toPos ? [fromPos, toPos] : undefined);
    if (!base || base.length < 2) return conn;                  // can't resolve → leave as-is

    const pts = [...base];
    // REPLACE each ring endpoint with the ring's real gate nearest the far end. The road then LEADS
    // TO the gate (the gate is sited next to an internal street, so the town core stays connected via
    // that street + the orphan-gate spur). Replacing — not inserting a centre→gate stub — keeps roads
    // that share a gate from doubling up into parallel corridors along the same interior run.
    if (ringFrom) {
      const g = nearestRealGate(ringFrom, base[base.length - 1]);
      if (g) { const [x, y] = gatePoint(ringFrom.run, g); pts[0] = { x, y }; }
    }
    if (ringTo) {
      const g = nearestRealGate(ringTo, base[0]);
      if (g) { const [x, y] = gatePoint(ringTo.run, g); pts[pts.length - 1] = { x, y }; }
    }
    return { ...conn, waypoints: pts.map(roundPt) };
  });

  return { wallObstacles, connections: rewritten };
}

/** Every real gate on every defensive ring, with its integer anchor — for the orphan-gate
 *  fallback (`wireGateToRoad`) when routing left a gate unreached. */
export function realGateAnchors(
  barrierRuns: PlacedBarrier[],
): { runId: string; poiId: string; x: number; y: number; t: number }[] {
  const out: { runId: string; poiId: string; x: number; y: number; t: number }[] = [];
  for (const b of defensiveRings(barrierRuns)) {
    const poiId = b.id.endsWith('_ring') ? b.id.slice(0, -'_ring'.length) : b.id;
    for (const g of b.run.gates) {
      if (g.kind === 'gap') continue;
      const [x, y] = gatePoint(b.run, g);
      out.push({ runId: b.id, poiId, x: Math.round(x), y: Math.round(y), t: g.t });
    }
  }
  return out;
}
