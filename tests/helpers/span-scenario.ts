// Synthetic span-structure scenario harness.
//
// The live world is too cluttered (a whole riverside town of overlapping crossings) and too
// slow (~40 s worldgen) to interrogate bridge/stair siting reliably. This harness lets a test
// hand-author a CONTROLLED situation — a terrain slope, a raster river, the WIDER render-water
// ribbon the player actually sees, and a road crossing it — run it through the REAL siting
// pipeline (`detectCrossings` → `buildCrossingStructureEntities`, `buildStairStructureEntities`),
// then interrogate the result against RENDER-water invariants: does the deck actually cover the
// visible channel? do its ends land on dry ground? do stairs foot on the road, climb, and not
// pile up? A scenario where render-water ≠ raster-water reproduces the shipped regression
// deterministically, so the fix can be driven test-first.
//
// The crucial modelling choice: the pipeline SITES on whatever water predicate it's handed
// (today: raster tiles), but "correct" means "reads right to the player" = matches RENDER
// water. So `runScenario` lets a test pick the siting predicate (raster = current behaviour,
// render = the fix) while `checkScenario` always judges against render water.

import type { RoadClass, RoadEdge, RoadGraph } from '@/world/road-graph';
import type { Entity } from '@/core/types';
import { buildCrossingStructureEntities } from '@/world/connectome/crossing-structures';
import { buildStairStructureEntities } from '@/world/connectome/stair-structures';
import { detectCrossings } from '@/world/connectome/detect-crossings';
import type { CrossingSpec } from '@/world/connectome/crossing-builder';

export interface Pt { x: number; y: number; }

export interface ScenarioRoad {
  id?: string;
  class: RoadClass;
  /** Cell path (need not be pre-densified; the harness fills gaps to unit steps). */
  polyline: Pt[];
}

export interface SpanScenario {
  width: number;
  height: number;
  /** Metres of relief per normalised elevation unit. */
  reliefM: number;
  /** Normalised [0,1] terrain elevation. */
  elevAt: (x: number, y: number) => number;
  /** The raster 'river' tile the siter reads today (thin flow line). */
  rasterWater: (x: number, y: number) => boolean;
  /** The render-water ribbon the player SEES (W∝√Q disc-stamped, wider, may meander off the
   *  raster line). This is the ground truth `checkScenario` judges against. */
  renderWater: (x: number, y: number) => boolean;
  roads: ScenarioRoad[];
}

/** Densify a polyline to unit (8-connected) steps — real road edges are dense cell paths. */
function densify(poly: Pt[]): Pt[] {
  if (poly.length === 0) return [];
  const out: Pt[] = [{ x: Math.round(poly[0].x), y: Math.round(poly[0].y) }];
  for (let k = 1; k < poly.length; k++) {
    let { x, y } = out[out.length - 1];
    const bx = Math.round(poly[k].x), by = Math.round(poly[k].y);
    while (x !== bx || y !== by) { x += Math.sign(bx - x); y += Math.sign(by - y); out.push({ x, y }); }
  }
  return out;
}

/** Build a RoadGraph from the scenario's roads, computing each edge's `bridgeCells` as the road
 *  cells that land on the RASTER water — this mirrors how the road walker records the cells it
 *  bridges (it walks the raster). Detection uses these to find WHERE a crossing is; the SEATING
 *  (bank snap, deck span) then reads whatever water `runScenario` sites on. Modelling bridgeCells
 *  on the thin raster is the conservative worst case: if bank-snapping on render water covers the
 *  visible channel from a thin raster crossing, it covers it from a wider one too. */
export function roadGraphFromScenario(sc: SpanScenario): RoadGraph {
  const W = sc.width;
  const edges: RoadEdge[] = sc.roads.map((r, i) => {
    const poly = densify(r.polyline);
    const bridgeCells = poly.filter((p) => sc.rasterWater(p.x, p.y)).map((p) => p.y * W + p.x);
    const id = r.id ?? `re${i}`;
    return { id, a: `${id}-a`, b: `${id}-b`, polyline: poly, feature: 'road', class: r.class, surface: 'dirt', bridgeCells };
  });
  return { nodes: [], edges };
}

export interface ScenarioResult {
  graph: RoadGraph;
  specs: CrossingSpec[];
  crossingEntities: Entity[];
  stairEntities: Entity[];
  /** Which water predicate the pipeline sited against (for reporting). */
  sitedOn: 'raster' | 'render';
}

export interface RunOptions {
  /** Which water the SITING pipeline reads. 'raster' = current shipped behaviour (reproduces the
   *  bug against a wider/offset render ribbon); 'render' = the fix. Default 'raster'. */
  siteWater?: 'raster' | 'render';
}

export function runScenario(sc: SpanScenario, opts: RunOptions = {}): ScenarioResult {
  const which = opts.siteWater ?? 'raster';
  const site = which === 'render' ? sc.renderWater : sc.rasterWater;
  const graph = roadGraphFromScenario(sc);
  const defaults = { era: 'late-medieval', prosperity: 'modest' as const };
  const isBlocked = (x: number, y: number) => site(x, y);
  const crossingEntities = buildCrossingStructureEntities(graph, sc.width, {
    isWater: site,
    // The fix locates the crossing on the render channel too (not just snaps banks); modelled only
    // in the 'render' siting mode so the raster-sited baseline still reproduces the bug.
    bridgeAt: which === 'render' ? sc.renderWater : undefined,
    deckElevAt: sc.elevAt,
    elevAt: sc.elevAt,
    reliefM: sc.reliefM,
    cellBlocked: isBlocked,
    defaults,
  });
  const stairEntities = buildStairStructureEntities(graph, {
    elevAt: sc.elevAt,
    reliefM: sc.reliefM,
    liftElevAt: sc.elevAt,
    cellBlocked: (x, y) => sc.renderWater(x, y),
  });
  const specs = detectCrossings(graph, sc.width, {
    isWater: site, defaults, bridgeAt: which === 'render' ? sc.renderWater : undefined,
  });
  return { graph, specs, crossingEntities, stairEntities, sitedOn: which };
}

// ── The structured checker ──────────────────────────────────────────────────────────────────

export interface Violation {
  code: string;
  detail: string;
}

/** Cells of the deck slab footprint for a spec: within half the span+overhang along the bank
 *  axis, within half the deck width across it. The deck entity is built length `spanLen+1`
 *  (a +1 abutment overhang) centred on the bank midpoint, oriented bank→bank. */
function deckCoverage(spec: CrossingSpec): { covers: (x: number, y: number) => boolean; ends: [Pt, Pt]; mid: Pt } {
  const [b0, b1] = spec.banks ?? [{ x: 0, y: 0 }, { x: 0, y: 0 }];
  const mid = { x: (b0.x + b1.x) / 2, y: (b0.y + b1.y) / 2 };
  const dx = b1.x - b0.x, dy = b1.y - b0.y;
  const len = Math.hypot(dx, dy) || 1;
  const ax = { x: dx / len, y: dy / len };
  const perp = { x: -ax.y, y: ax.x };
  const halfLen = len / 2 + 0.5;                 // spanLen+1 slab ⇒ half + 0.5 overhang
  const deckWidthTiles = 1;                       // path/road decks are ~1 tile wide
  const halfW = deckWidthTiles / 2 + 0.5;
  const covers = (x: number, y: number): boolean => {
    const rx = x - mid.x, ry = y - mid.y;
    const along = Math.abs(rx * ax.x + ry * ax.y);
    const across = Math.abs(rx * perp.x + ry * perp.y);
    return along <= halfLen && across <= halfW;
  };
  const ends: [Pt, Pt] = [
    { x: mid.x - ax.x * halfLen, y: mid.y - ax.y * halfLen },
    { x: mid.x + ax.x * halfLen, y: mid.y + ax.y * halfLen },
  ];
  return { covers, ends, mid };
}

export interface CheckOptions {
  /** Min Chebyshev spacing between two stair feet before it reads as a pile-up. Default 3. */
  stairSpacing?: number;
}

/**
 * Interrogate a scenario result against render-water invariants and return every violation.
 * Empty array = the crossings & stairs read correctly to the player.
 */
export function checkScenario(sc: SpanScenario, res: ScenarioResult, opts: CheckOptions = {}): Violation[] {
  const v: Violation[] = [];
  const wet = sc.renderWater;

  // Per road: the render-wet cells the traveller must be carried over.
  for (const edge of res.graph.edges) {
    const poly = edge.polyline;
    const wetRoad = poly.filter((p) => wet(p.x, p.y));
    if (wetRoad.length === 0) continue; // road never touches visible water — no crossing needed
    // Find the crossing(s) belonging to this edge.
    const mine = res.specs.filter((s) => s.id.startsWith(`crossing@${edge.id}#`));
    if (mine.length === 0) {
      v.push({ code: 'B-missing', detail: `road ${edge.id} crosses ${wetRoad.length} render-wet cell(s) but no crossing was generated` });
      continue;
    }
    // Every render-wet road cell must be covered by SOME deck of this edge.
    const covs = mine.map(deckCoverage);
    for (const c of wetRoad) {
      if (!covs.some((d) => d.covers(c.x, c.y))) {
        v.push({ code: 'B-uncovered', detail: `road ${edge.id}: visible water at (${c.x},${c.y}) is not under any deck` });
      }
    }
    // Each deck's two ends (abutments) must land on render-DRY ground.
    for (const d of covs) {
      for (const e of d.ends) {
        const ex = Math.round(e.x), ey = Math.round(e.y);
        if (wet(ex, ey)) v.push({ code: 'B-end-in-water', detail: `deck end (${ex},${ey}) sits in visible water` });
      }
    }
  }

  // Piers should stand in or beside the visible water — a pier on a dry APPROACH cell under the
  // deck is fine (an abutment support), but one marooned >1 tile from any water reads wrong.
  const wetWithin1 = (x: number, y: number): boolean => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (wet(x + dx, y + dy)) return true;
    return false;
  };
  for (const p of res.crossingEntities) {
    if (p.kind !== 'bridge_pier') continue;
    if (!wetWithin1(Math.round(p.x), Math.round(p.y))) {
      v.push({ code: 'P-dry-pier', detail: `pier at (${p.x},${p.y}) stands >1 tile from any channel` });
    }
  }

  // Stairs: foot on the road, off the water, and not piled up. A stair id is `${edgeId}:stair:i`
  // (stoops are `${bld}:stoop`) — the edge prefix lets us tell a legit STACKED climb on one road
  // (contiguous flights, fine) from a PILE-UP of parallel roads' stairs crammed together (bad).
  const roadCells = new Set<string>();
  for (const e of res.graph.edges) for (const p of e.polyline) roadCells.add(`${p.x},${p.y}`);
  const feet = res.stairEntities.map((e) => ({
    x: Math.round(e.x), y: Math.round(e.y), edge: String(e.id).split(':stair:')[0],
  }));
  for (const f of feet) {
    if (!roadCells.has(`${f.x},${f.y}`)) v.push({ code: 'S-off-road', detail: `stair foot (${f.x},${f.y}) is not on a road cell` });
    if (wet(f.x, f.y)) v.push({ code: 'S-on-water', detail: `stair foot (${f.x},${f.y}) sits in visible water` });
  }
  const spacing = opts.stairSpacing ?? 3;
  for (let i = 0; i < feet.length; i++) {
    for (let j = i + 1; j < feet.length; j++) {
      if (feet[i].edge === feet[j].edge) continue;   // stacked flights on one road are a staircase, not a pile-up
      const cheb = Math.max(Math.abs(feet[i].x - feet[j].x), Math.abs(feet[i].y - feet[j].y));
      if (cheb < spacing) {
        v.push({ code: 'S-pileup', detail: `stair feet (${feet[i].x},${feet[i].y})[${feet[i].edge}] & (${feet[j].x},${feet[j].y})[${feet[j].edge}] are ${cheb}t apart (< ${spacing})` });
      }
    }
  }
  return v;
}

// ── Scenario builders (ergonomic constructors) ───────────────────────────────────────────────

export interface RiverOptions {
  /** Row (for a horizontal river) the raster flow line sits on. */
  axisRow: number;
  /** Raster half-width (thin — the flow line). Default 0 (single cell row). */
  rasterHalf?: number;
  /** Render half-width (the visible ribbon, W∝√Q — wider). Default 1. */
  renderHalf?: number;
  /** Shift the render ribbon this many rows off the raster line (meander offset). Default 0. */
  renderOffset?: number;
}

/** A world with a gentle valley: land high on both sides, dropping to the river row. A horizontal
 *  river (raster thin line + wider/offset render ribbon) runs across it; the caller adds roads. */
export function valleyWithRiver(width: number, height: number, opts: RiverOptions): SpanScenario {
  const { axisRow, rasterHalf = 0, renderHalf = 1, renderOffset = 0 } = opts;
  const renderRow = axisRow + renderOffset;
  return {
    width, height, reliefM: 40,
    // Elevation: a V-valley in y — flat sea-level trench at the river, rising away from it. Kept
    // shallow so a plain crossing needs no stairs unless the caller makes the banks steep.
    elevAt: (_x, y) => Math.min(1, Math.abs(y - axisRow) * 0.01),
    rasterWater: (_x, y) => Math.abs(y - axisRow) <= rasterHalf,
    renderWater: (_x, y) => Math.abs(y - renderRow) <= renderHalf,
    roads: [],
  };
}
