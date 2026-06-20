// src/world/connectome/detect-crossings.ts
//
// Crossing DETECTION — the "where" half of the river-crossing producer. The road graph
// already records, per edge, the cells its walker chose to bridge over water
// (`edge.bridgeCells`); a maximal contiguous run of those along a road's polyline IS a
// crossing. This turns each run into a `CrossingSpec` for `buildCrossing`, pulling the
// site parameters (era / prosperity / style / biome) from a caller-supplied resolver so
// this stays decoupled from how the world models settlements & climate.
//
// Pure: reads the (immutable) road graph + a resolver callback. Changes NO rendering — the
// crossings it finds are a parallel connectome layer; flipping the road ribbon to stop at
// the banks (and realizing the spans) are later, separate steps. Until then R3b's plank
// deck stays the interim visual.

import type { RoadGraph, RoadClass } from '@/world/road-graph';
import type { CrossingSpec } from './crossing-builder';

/** Site parameters at a tile — supplied by the caller (nearest settlement, world climate). */
export interface CrossingSiteParams {
  era: string;
  prosperity: string;
  style?: string;
  biome?: string;
}

export interface DetectOptions {
  /** Resolve site params at a tile (defaults applied when absent). */
  siteParamsAt?: (x: number, y: number) => CrossingSiteParams;
  /** Fallback site params when no resolver is given. */
  defaults?: CrossingSiteParams;
}

const DEFAULT_SITE: CrossingSiteParams = { era: 'early-medieval', prosperity: 'modest' };

/**
 * Detect every road×water crossing in the graph as a `CrossingSpec`. One spec per maximal
 * contiguous run of bridge cells along a road edge's polyline; `spanTiles` is the run
 * length, `roadClass` the edge's class, `banks` the approach points flanking the run, and
 * the site params come from the resolver evaluated at the run's midpoint.
 */
export function detectCrossings(graph: RoadGraph | undefined, width: number, opts: DetectOptions = {}): CrossingSpec[] {
  if (!graph?.edges.length) return [];
  const resolve = opts.siteParamsAt ?? (() => opts.defaults ?? DEFAULT_SITE);
  const out: CrossingSpec[] = [];

  for (const edge of graph.edges) {
    if (edge.feature !== 'road' || !edge.bridgeCells.length || edge.polyline.length < 2) continue;
    const bridge = new Set(edge.bridgeCells);
    const pts = edge.polyline;
    const cellOf = (p: { x: number; y: number }) => Math.floor(p.y) * width + Math.floor(p.x);
    const onBridge = pts.map((p) => bridge.has(cellOf(p)));

    let i = 0, run = 0;
    while (i < pts.length) {
      if (!onBridge[i]) { i++; continue; }
      const s = i;
      while (i < pts.length && onBridge[i]) i++;
      const e = i - 1;                                   // run = polyline points [s..e]
      const mid = pts[(s + e) >> 1];
      const site = resolve(Math.floor(mid.x), Math.floor(mid.y));
      const near = pts[Math.max(0, s - 1)];
      const far = pts[Math.min(pts.length - 1, e + 1)];
      out.push({
        id: `crossing@${edge.id}#${run}`,
        waterRef: `water@${cellOf(mid)}`,
        spanTiles: e - s + 1,
        roadClass: (edge.class ?? 'road') as RoadClass,
        era: site.era,
        prosperity: site.prosperity,
        style: site.style,
        biome: site.biome,
        banks: [{ x: near.x, y: near.y }, { x: far.x, y: far.y }],
      });
      run++;
    }
  }
  return out;
}
