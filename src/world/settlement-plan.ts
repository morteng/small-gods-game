/**
 * Settlement plan — the road graph + frontage slots a settlement is built
 * around (growth slice S1).
 *
 * `planSettlement` turns a zone rule into an explicit, deterministic plan:
 * road edges as tile runs between typed nodes, and frontage slots (road tile
 * + perpendicular side) that buildings claim so their DOORS FACE THE ROAD.
 * The executor lives in `building-placer.ts`; this module is pure data over
 * tiles + seeded rng, so future slices (live growth, constraint catalogue)
 * can extend the same plan during play.
 */

import type { Tile } from '@/core/types';
import type { ZoneRule } from '@/map/poi-zones';
import { Random, noise } from '@/core/noise';
import { WATER_TYPES } from '@/core/constants';

/** Water tile types — roads and footprints must avoid these. Single source in
 *  core/constants; re-exported here for the settlement modules that already import it. */
export { WATER_TYPES };

/** Ground a building footprint may occupy (shared: worldgen executor + live growth). */
export const BUILDABLE_TERRAIN = new Set(['grass', 'dirt', 'sand', 'scrubland', 'farm_field',
  'sacred_grove', 'hills', 'glen', 'dirt_road', 'stone_road']);

export interface RoadNode {
  id: string;
  x: number;
  y: number;
  kind: 'founding' | 'junction' | 'end';
}

export interface RoadEdge {
  a: string;                       // node ids
  b: string;
  tiles: { x: number; y: number }[];
  kind: 'through' | 'lane';
}

/** A buildable candidate beside one road tile. The building goes on `side`;
 *  its door must face back (−side) onto the road. */
export interface FrontageSlot {
  roadX: number;
  roadY: number;
  side: [number, number];          // unit vector road → building side
  edge: number;                    // index into plan.edges
  dist: number;                    // Manhattan distance from the founding node
}

/**
 * A burgage lot: 3–4 tiles of street frontage × 3–5 tiles deep, perpendicular
 * to its road edge (3 wide is the minimum that holds a cottage/yurt; 4 holds
 * a longhouse). The lot is the persistent unit — it exists before and
 * outlives its building; one building per lot gives regular street spacing
 * and back yards by construction. Dimensions are keyed on the FIRST frontage
 * road tile's coordinates (not iteration order), so lots reached lazily by
 * future growth slices subdivide identically.
 */
export interface Lot {
  id: string;                      // `lot:${x},${y}:${sx},${sy}` — first frontage tile + side
  edge: number;                    // index into plan.edges
  side: [number, number];
  frontage: { x: number; y: number }[];
  depth: number;
  tiles: { x: number; y: number }[];
  buildingId?: string;
}

/** A named district — the compact promptable shape LLM prompts want. */
export interface Ward {
  id: string;
  name: string;                    // "North Market", "Fisher Quarter"
  type: 'market' | 'harbour' | 'temple' | 'gate' | 'residential' | 'craft';
  seed: { x: number; y: number };
  tiles: { x: number; y: number }[];
}

/**
 * A reserved civic precinct (S4): well / graveyard / mill — placed by the
 * constraint catalogue, kept clear of burgage lots so future slices (and
 * Fate) can build the actual structure or fill the ground over deep time
 * (the churchyard gathering `remains`). Plan data only in this slice — no
 * entity is emitted at worldgen; the reserve is the open hook.
 */
export interface CivicSite {
  type: string;                    // 'well' | 'graveyard' | 'mill' | agent-added
  x: number; y: number;            // footprint origin
  w: number; h: number;
}

export interface SettlementPlan {
  /** Owning POI — set by `placeSettlement`, ties the plan to its settlement
   *  for live growth (S3). */
  poiId?: string;
  center: { x: number; y: number };
  nodes: RoadNode[];
  edges: RoadEdge[];
  slots: FrontageSlot[];
  lots: Lot[];
  wards: Ward[];
  /** Reserved civic precincts (well/graveyard/mill — S4 constraint catalogue). */
  civics: CivicSite[];
  /** Widened-main-street market tiles around the founding node. */
  market: { x: number; y: number }[];
  /** The water-partitioned developable area (home bank + adjacent banks +
   *  candidate crossings). Set at placement by `computeSettlementParcels`; the
   *  shared spatial model placement, the wall, and (Slice 3) growth all read.
   *  Undefined for dry inland sites with no reachable water. */
  parcels?: import('@/world/settlement-parcels').SettlementParcels;
}

/** Per-preset siting preferences (grows into the S4 constraint catalogue). */
export interface SiteRule {
  /** Hard requirement: water within this many tiles of the footprint. */
  nearWater?: number;
  /** Soft preference for frontage near the founding node or the edge of town. */
  affinity?: 'center' | 'edge';
  /** S3 (nucleated grammar): a FOCUS building — the parish church / manor hall the
   *  village nucleates around. Focus buildings are placed FIRST, so they claim the
   *  most central frontage and become the layout's root anchor; dwellings then fill
   *  in around them (HEAG210: church + manor are the village's defining foci). */
  focus?: boolean;
  /** A focus only appears once the settlement reaches this many buildings (HEAG210:
   *  the smallest hamlets are dwellings only; a church arrives as a village forms, a
   *  manor later still). Below the threshold the focus is omitted so a tiny hamlet
   *  isn't all church-and-manor with nowhere to live. Same rung idea as the
   *  enclosure ring's `minBuildings`. */
  focusMin?: number;
}

export const SITE_RULES: Record<string, SiteRule> = {
  dock:           { nearWater: 2 },
  tavern:         { affinity: 'center' },
  temple_small:   { affinity: 'center' },
  shrine:         { affinity: 'center' },
  market_stall:   { affinity: 'center' },
  farm_barn:      { affinity: 'edge' },
  longhouse:      { affinity: 'edge' },
  'parish-church': { affinity: 'center', focus: true, focusMin: 4 },
  manor:           { affinity: 'center', focus: true, focusMin: 6 },
};

/**
 * Register/override a siting rule at runtime — the same open-registry pattern
 * as blueprint part/feature types. This is the seam agents (Fate, the Create
 * panel, era content packs) use to direct placement for new or existing
 * building types without touching this table.
 */
export function registerSiteRule(preset: string, rule: SiteRule): void {
  SITE_RULES[preset] = rule;
}

/** Walk `len` tiles from (x0,y0) along dir, keeping in-bounds non-water tiles. */
function walkTiles(
  x0: number, y0: number, dir: { dx: number; dy: number }, len: number, tiles: Tile[][],
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i <= len; i++) {
    const x = x0 + dir.dx * i, y = y0 + dir.dy * i;
    const t = tiles[y]?.[x];
    if (!t || WATER_TYPES.has(t.type)) continue;
    out.push({ x, y });
  }
  return out;
}

/**
 * Build the road graph + frontage slots for a settlement.
 *
 * The main street snaps to the dominant axis of the first connected-POI
 * direction (inter-POI connector roads stay organic — they're carved
 * separately). Layouts: `linear` = one through street; `branching` = through
 * street + two short perpendicular lanes at the founding node; `grid` =
 * through street + a parallel lane each side + two cross connectors.
 */
export function planSettlement(
  center: { x: number; y: number },
  rule: ZoneRule,
  tiles: Tile[][],
  connectedDirections: { dx: number; dy: number }[],
  rng: Random,
): SettlementPlan {
  const nodes: RoadNode[] = [{ id: 'n0', x: center.x, y: center.y, kind: 'founding' }];
  const edges: RoadEdge[] = [];
  const plan: SettlementPlan = { center, nodes, edges, slots: [], lots: [], wards: [], civics: [], market: [] };
  if (!rule.internalRoads || rule.roadLayout === 'none' || rule.roadLayout === undefined) {
    return plan;
  }

  const main = connectedDirections[0] ?? { dx: 1, dy: 0 };
  const axis = Math.abs(main.dx) >= Math.abs(main.dy)
    ? { dx: Math.sign(main.dx) || 1, dy: 0 }
    : { dx: 0, dy: Math.sign(main.dy) || 1 };
  const perp = { dx: -axis.dy, dy: axis.dx };
  const radius = rng.int(rule.radius.min, rule.radius.max);

  let nid = 1;
  const addNode = (x: number, y: number, kind: RoadNode['kind']): string => {
    const id = `n${nid++}`;
    nodes.push({ id, x, y, kind });
    return id;
  };
  const addEdge = (
    a: string, b: string, x0: number, y0: number,
    dir: { dx: number; dy: number }, len: number, kind: RoadEdge['kind'],
  ): void => {
    const run = walkTiles(x0, y0, dir, len, tiles);
    if (run.length > 0) edges.push({ a, b, tiles: run, kind });
  };

  // Through street: founding node at the centre, an end node either way.
  const w = addNode(center.x - axis.dx * radius, center.y - axis.dy * radius, 'end');
  const e = addNode(center.x + axis.dx * radius, center.y + axis.dy * radius, 'end');
  addEdge(w, 'n0', center.x - axis.dx * radius, center.y - axis.dy * radius, axis, radius, 'through');
  addEdge('n0', e, center.x, center.y, axis, radius, 'through');

  if (rule.roadLayout === 'branching') {
    const blen = Math.min(3, radius);
    for (const s of [1, -1]) {
      const end = addNode(center.x + perp.dx * blen * s, center.y + perp.dy * blen * s, 'end');
      addEdge('n0', end, center.x + perp.dx * s, center.y + perp.dy * s,
        { dx: perp.dx * s, dy: perp.dy * s }, blen - 1, 'lane');
    }
  } else if (rule.roadLayout === 'grid') {
    const off = 3;
    const lanes: string[] = [];
    for (const s of [1, -1]) {
      const ox = center.x + perp.dx * off * s, oy = center.y + perp.dy * off * s;
      const a = addNode(ox - axis.dx * (radius - 1), oy - axis.dy * (radius - 1), 'end');
      const b = addNode(ox + axis.dx * (radius - 1), oy + axis.dy * (radius - 1), 'end');
      addEdge(a, b, ox - axis.dx * (radius - 1), oy - axis.dy * (radius - 1), axis, (radius - 1) * 2, 'lane');
      lanes.push(a, b);
    }
    // Two cross connectors joining the three parallel streets.
    const half = Math.max(1, Math.floor(radius / 2));
    for (const s of [1, -1]) {
      const cx = center.x + axis.dx * half * s, cy = center.y + axis.dy * half * s;
      const j = addNode(cx, cy, 'junction');
      addEdge(j, lanes[0], cx - perp.dx * off, cy - perp.dy * off, perp, off * 2, 'lane');
    }
  }

  // Frontage slots: each road tile offers its two perpendicular neighbours.
  // Cross streets front along the MAIN axis; everything is centre-out sorted
  // by the executor, so order here just needs to be deterministic.
  edges.forEach((edge, ei) => {
    const dir = edge.tiles.length > 1
      ? {
          dx: Math.sign(edge.tiles[1].x - edge.tiles[0].x),
          dy: Math.sign(edge.tiles[1].y - edge.tiles[0].y),
        }
      : axis;
    const sides: [number, number][] = [[-dir.dy, dir.dx], [dir.dy, -dir.dx]];
    for (const t of edge.tiles) {
      for (const side of sides) {
        plan.slots.push({
          roadX: t.x, roadY: t.y, side, edge: ei,
          dist: Math.abs(t.x - center.x) + Math.abs(t.y - center.y),
        });
      }
    }
  });

  return plan;
}

// ─── Lots ─────────────────────────────────────────────────────────────────────

/** Buildable lot ground: in-bounds, non-water, not a planned road tile. */
function lotTileOk(x: number, y: number, tiles: Tile[][], roadSet: Set<string>): boolean {
  const t = tiles[y]?.[x];
  return !!t && !WATER_TYPES.has(t.type) && !roadSet.has(`${x},${y}`);
}

/**
 * Subdivide every road edge's frontage into burgage lots. Width (3–4: wide
 * enough for every dwelling footprint — cottage/yurt 3, longhouse 4) and
 * depth (3–5) come from `noise()` keyed on the lot's FIRST road tile — pure
 * coordinate hash, so subdivision is independent of walk order and stable
 * under future incremental growth. Tiles already claimed by an earlier lot
 * (junction overlap) are dropped from the later one.
 */
export function subdivideLots(plan: SettlementPlan, tiles: Tile[][], seed: number): Lot[] {
  const roadSet = new Set(plan.edges.flatMap(e => e.tiles.map(t => `${t.x},${t.y}`)));
  for (const m of plan.market) roadSet.add(`${m.x},${m.y}`);
  // Reserved civic precincts are not buildable lot ground — exclude them so
  // re-subdivision (ribbon/back-lane growth) never lots over a well or graveyard.
  for (const c of plan.civics) {
    for (let dy = 0; dy < c.h; dy++) for (let dx = 0; dx < c.w; dx++) roadSet.add(`${c.x + dx},${c.y + dy}`);
  }
  const claimed = new Set<string>();
  const lots: Lot[] = [];

  plan.edges.forEach((edge, ei) => {
    const dir = edge.tiles.length > 1
      ? {
          dx: Math.sign(edge.tiles[1].x - edge.tiles[0].x),
          dy: Math.sign(edge.tiles[1].y - edge.tiles[0].y),
        }
      : { dx: 1, dy: 0 };
    const sides: [number, number][] = [[-dir.dy, dir.dx], [dir.dy, -dir.dx]];

    for (const side of sides) {
      let i = 0;
      while (i < edge.tiles.length) {
        const first = edge.tiles[i];
        const width = 3 + Math.floor(noise(first.x, first.y, seed + 101) * 2);       // 3–4
        const depth = 3 + Math.floor(noise(first.x, first.y, seed + 211) * 3);       // 3–5
        const frontage = edge.tiles.slice(i, i + width);
        const lotTiles: { x: number; y: number }[] = [];
        for (const f of frontage) {
          for (let d = 1; d <= depth; d++) {
            const x = f.x + side[0] * d, y = f.y + side[1] * d;
            const key = `${x},${y}`;
            if (!lotTileOk(x, y, tiles, roadSet) || claimed.has(key)) continue;
            lotTiles.push({ x, y });
          }
        }
        if (lotTiles.length >= 2) {
          for (const t of lotTiles) claimed.add(`${t.x},${t.y}`);
          lots.push({
            id: `lot:${first.x},${first.y}:${side[0]},${side[1]}`,
            edge: ei, side, frontage, depth, tiles: lotTiles,
          });
        }
        i += width;
      }
    }
  });

  plan.lots = lots;
  return lots;
}

/** Soft cap on ribbon extensions: stop adding street once the graph is this big. */
const MAX_PLAN_NODES = 24;
/** Tiles added per ribbon extension. */
const EXTEND_LEN = 4;

/**
 * Ribbon growth (S3): when the frontage saturates, extend a through street
 * past one of its end nodes and re-subdivide lots. Lot dimensions are
 * coordinate-keyed, so re-subdivision reproduces every existing lot
 * identically — claims are carried over by id. Returns the NEW road tiles
 * (the caller carves them into the live grid), or null when nothing can
 * extend (map edge, water, node cap).
 */
export function extendThroughStreet(
  plan: SettlementPlan,
  tiles: Tile[][],
  seed: number,
): { x: number; y: number }[] | null {
  if (plan.nodes.length >= MAX_PLAN_NODES) return null;
  const { x: cx, y: cy } = plan.center;

  for (const edge of plan.edges) {
    if (edge.kind !== 'through') continue;
    for (const endId of [edge.a, edge.b]) {
      const node = plan.nodes.find(n => n.id === endId);
      if (!node || node.kind !== 'end') continue;
      const axis = {
        dx: Math.sign(node.x - cx),
        dy: Math.sign(node.y - cy),
      };
      if (axis.dx === 0 && axis.dy === 0) continue;
      const run = walkTiles(node.x + axis.dx, node.y + axis.dy, axis, EXTEND_LEN - 1, tiles);
      if (run.length < 2) continue;

      const newId = `n${plan.nodes.length}x`;
      node.kind = 'junction';
      const last = run[run.length - 1];
      plan.nodes.push({ id: newId, x: last.x, y: last.y, kind: 'end' });
      plan.edges.push({ a: node.id, b: newId, tiles: run, kind: 'through' });

      // Re-derive slots + lots for the grown graph; carry claims over by id
      // (coordinate-keyed subdivision reproduces existing lots exactly).
      const claims = new Map(plan.lots.filter(l => l.buildingId).map(l => [l.id, l.buildingId!]));
      plan.slots = [];
      const axisMain = { dx: Math.abs(axis.dx), dy: Math.abs(axis.dy) };
      plan.edges.forEach((e, ei) => {
        const dir = e.tiles.length > 1
          ? {
              dx: Math.sign(e.tiles[1].x - e.tiles[0].x),
              dy: Math.sign(e.tiles[1].y - e.tiles[0].y),
            }
          : axisMain;
        const sides: [number, number][] = [[-dir.dy, dir.dx], [dir.dy, -dir.dx]];
        for (const t of e.tiles) {
          for (const side of sides) {
            plan.slots.push({ roadX: t.x, roadY: t.y, side, edge: ei,
              dist: Math.abs(t.x - cx) + Math.abs(t.y - cy) });
          }
        }
      });
      subdivideLots(plan, tiles, seed);
      for (const lot of plan.lots) {
        const claim = claims.get(lot.id);
        if (claim) lot.buildingId = claim;
      }
      return run;
    }
  }
  return null;
}

/**
 * Back-lane growth (S4): once ribbon extension is exhausted, branch a NEW lane
 * perpendicular to the main street from an existing founding/junction node and
 * re-subdivide. This is the medieval back-lane stage — the town deepens away
 * from the high street rather than stretching it further. Lot dimensions are
 * coordinate-keyed, so existing lots reproduce identically and keep their
 * claims. Returns the new road tiles (caller carves them live), or null when
 * nothing can branch (node cap, every side blocked by water/road/map edge).
 */
export function extendBackLane(
  plan: SettlementPlan,
  tiles: Tile[][],
  seed: number,
): { x: number; y: number }[] | null {
  if (plan.nodes.length >= MAX_PLAN_NODES) return null;
  const through = plan.edges.find(e => e.kind === 'through' && e.tiles.length > 1);
  if (!through) return null;
  const axis = {
    dx: Math.sign(through.tiles[1].x - through.tiles[0].x),
    dy: Math.sign(through.tiles[1].y - through.tiles[0].y),
  };
  const perp = { dx: -axis.dy, dy: axis.dx };
  const roadSet = new Set(plan.edges.flatMap(e => e.tiles.map(t => `${t.x},${t.y}`)));
  for (const m of plan.market) roadSet.add(`${m.x},${m.y}`);
  const { x: cx, y: cy } = plan.center;

  // Branch off founding/junction nodes (deterministic node order), each
  // perpendicular side. Skip a side already carrying a lane or blocked.
  for (const node of plan.nodes) {
    if (node.kind === 'end') continue;
    for (const s of [1, -1]) {
      const dir = { dx: perp.dx * s, dy: perp.dy * s };
      const first = { x: node.x + dir.dx, y: node.y + dir.dy };
      if (roadSet.has(`${first.x},${first.y}`)) continue;
      const run = walkTiles(first.x, first.y, dir, EXTEND_LEN - 1, tiles);
      if (run.length < 2 || run.some(t => roadSet.has(`${t.x},${t.y}`))) continue;

      const newId = `n${plan.nodes.length}b`;
      const last = run[run.length - 1];
      plan.nodes.push({ id: newId, x: last.x, y: last.y, kind: 'end' });
      plan.edges.push({ a: node.id, b: newId, tiles: run, kind: 'lane' });

      // Re-derive slots + lots for the grown graph; carry claims by id
      // (coordinate-keyed subdivision reproduces existing lots exactly).
      const claims = new Map(plan.lots.filter(l => l.buildingId).map(l => [l.id, l.buildingId!]));
      plan.slots = [];
      plan.edges.forEach((e, ei) => {
        const d = e.tiles.length > 1
          ? { dx: Math.sign(e.tiles[1].x - e.tiles[0].x), dy: Math.sign(e.tiles[1].y - e.tiles[0].y) }
          : { dx: 1, dy: 0 };
        const sides: [number, number][] = [[-d.dy, d.dx], [d.dy, -d.dx]];
        for (const t of e.tiles) {
          for (const side of sides) {
            plan.slots.push({ roadX: t.x, roadY: t.y, side, edge: ei,
              dist: Math.abs(t.x - cx) + Math.abs(t.y - cy) });
          }
        }
      });
      subdivideLots(plan, tiles, seed);
      for (const lot of plan.lots) {
        const claim = claims.get(lot.id);
        if (claim) lot.buildingId = claim;
      }
      return run;
    }
  }
  return null;
}

// ─── Frontage value ─────────────────────────────────────────────────────────

/**
 * Prime-ness of a lot's frontage in (0, 1] — 1 at the founding node / market,
 * decaying with distance (the medieval frontage-value gradient: market and
 * crossroads frontage is prime, cottages further out). Drives growth order:
 * prime lots fill and densify first. Agents can read it to weight commercial
 * placement; it stays a pure function of plan geometry so it's replay-stable.
 */
export function frontageValue(plan: SettlementPlan, lot: Lot): number {
  const f = lot.frontage[0] ?? lot.tiles[0];
  if (!f) return 0;
  const d = Math.abs(f.x - plan.center.x) + Math.abs(f.y - plan.center.y);
  return 1 / (1 + d);
}

// ─── Civic catalogue ──────────────────────────────────────────────────────────

/** Where a civic precinct sites itself. */
export interface CivicRule {
  size: { w: number; h: number };
  /** 'green' = beside the founding node; 'edge' = settlement rim;
   *  'water' = nearest buildable ground to water (skipped if none in range). */
  site: 'green' | 'edge' | 'water';
  /** Hard requirement for `water` sites: a water tile within this many tiles. */
  nearWater?: number;
}

/**
 * Open civic registry — the same agent seam as SITE_RULES / DWELLING_CAPACITY.
 * Fate / era content packs register new civic precincts (smithy, gallows,
 * shrine-stone) via `registerCivicRule` without touching this table.
 */
export const CIVIC_RULES: Record<string, CivicRule> = {
  well:      { size: { w: 1, h: 1 }, site: 'green' },
  graveyard: { size: { w: 2, h: 2 }, site: 'edge' },
  mill:      { size: { w: 2, h: 2 }, site: 'water', nearWater: 3 },
};

export function registerCivicRule(type: string, rule: CivicRule): void {
  CIVIC_RULES[type] = rule;
}

function waterWithin(x: number, y: number, w: number, h: number, tiles: Tile[][], range: number): boolean {
  for (let dy = -range; dy < h + range; dy++) {
    for (let dx = -range; dx < w + range; dx++) {
      const t = tiles[y + dy]?.[x + dx];
      if (t && WATER_TYPES.has(t.type)) return true;
    }
  }
  return false;
}

/**
 * Reserve civic precincts over the planned settlement (S4 constraint
 * catalogue). Pure, deterministic (coordinate scans, no rng): a well on the
 * green beside the founding node, a graveyard on the settlement rim, a mill
 * only where water is in range. Each footprint must sit on buildable ground,
 * off existing roads/market/lots/other civics. Writes `plan.civics`.
 */
export function planCivics(plan: SettlementPlan, tiles: Tile[][], seed: number, greenSize = 0): CivicSite[] {
  void seed; // reserved for future dithered siting
  const { x: cx, y: cy } = plan.center;

  const extent = plan.nodes.reduce(
    (m, n) => Math.max(m, Math.abs(n.x - cx) + Math.abs(n.y - cy)), 1) + 2;

  const buildable = (x: number, y: number, w: number, h: number, blocked: Set<string>): boolean => {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const t = tiles[y + dy]?.[x + dx];
        if (!t || !BUILDABLE_TERRAIN.has(t.type)) return false;
        if (blocked.has(`${x + dx},${y + dy}`)) return false;
      }
    }
    return true;
  };

  const civics: CivicSite[] = [];

  // S3b — Village green: the central open common. A nucleated village (gated by
  // greenSize > 0, set when the settlement is large enough to carry foci) keeps
  // a square of tended ground beside the founding node open — the well stands at
  // its heart and the church/manor/dwellings front it. It's the HEART of the
  // village, so it claims central ground with priority over burgage lots: the
  // search only avoids roads/market/water (not lots), then any lot it overlaps
  // is dropped so dwellings ring the green instead of building on it. greenSize
  // 0 ⇒ no green (a hamlet stays dense).
  let green: CivicSite | null = null;
  if (greenSize > 0) {
    const roadMarket = new Set<string>();
    for (const e of plan.edges) for (const t of e.tiles) roadMarket.add(`${t.x},${t.y}`);
    for (const m of plan.market) roadMarket.add(`${m.x},${m.y}`);
    const g = greenSize;
    const off = g >> 1; // centre the square on the candidate tile
    for (let r = 0; r <= extent && !green; r++) {
      for (let dy = -r; dy <= r && !green; dy++) {
        for (let dx = -r; dx <= r && !green; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = cx + dx - off, y = cy + dy - off;
          if (buildable(x, y, g, g, roadMarket)) green = { type: 'green', x, y, w: g, h: g };
        }
      }
    }
    if (green) {
      civics.push(green);
      // Lots ring the green, never sit on it — drop any the green overlaps.
      const gx1 = green.x + green.w, gy1 = green.y + green.h;
      plan.lots = plan.lots.filter(l =>
        !l.tiles.some(t => t.x >= green!.x && t.x < gx1 && t.y >= green!.y && t.y < gy1));
    }
  }

  // Everything else (well/graveyard/mill) deconflicts against roads, market,
  // the remaining lots, and the green.
  const reserved = new Set<string>();
  for (const e of plan.edges) for (const t of e.tiles) reserved.add(`${t.x},${t.y}`);
  for (const m of plan.market) reserved.add(`${m.x},${m.y}`);
  for (const l of plan.lots) for (const t of l.tiles) reserved.add(`${t.x},${t.y}`);
  if (green) for (let dy = 0; dy < green.h; dy++) for (let dx = 0; dx < green.w; dx++) reserved.add(`${green.x + dx},${green.y + dy}`);

  const fits = (x: number, y: number, w: number, h: number): boolean => buildable(x, y, w, h, reserved);
  const reserve = (s: CivicSite): void => {
    for (let dy = 0; dy < s.h; dy++) for (let dx = 0; dx < s.w; dx++) reserved.add(`${s.x + dx},${s.y + dy}`);
  };

  // Stable iteration over the catalogue (insertion order).
  for (const [type, rule] of Object.entries(CIVIC_RULES)) {
    const { w, h } = rule.size;
    let best: CivicSite | null = null;
    if (type === 'well' && green) {
      // The well stands at the heart of the green (civic-on-civic, intentional).
      best = { type, x: green.x + (green.w >> 1), y: green.y + (green.h >> 1), w, h };
    } else if (rule.site === 'green') {
      // Nearest buildable footprint to the founding node, ring by ring out.
      for (let r = 1; r <= extent && !best; r++) {
        for (let dy = -r; dy <= r && !best; dy++) {
          for (let dx = -r; dx <= r && !best; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const x = cx + dx, y = cy + dy;
            if (fits(x, y, w, h)) best = { type, x, y, w, h };
          }
        }
      }
    } else if (rule.site === 'edge') {
      // Farthest buildable footprint within the settlement extent (the rim).
      for (let r = extent; r >= 1 && !best; r--) {
        for (let dy = -r; dy <= r && !best; dy++) {
          for (let dx = -r; dx <= r && !best; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const x = cx + dx, y = cy + dy;
            if (fits(x, y, w, h)) best = { type, x, y, w, h };
          }
        }
      }
    } else {
      // 'water': closest buildable footprint to the centre that still touches
      // water within range — no water in range ⇒ no mill (mills need a stream).
      let bestD = Infinity;
      for (let y = cy - extent; y <= cy + extent; y++) {
        for (let x = cx - extent; x <= cx + extent; x++) {
          if (!fits(x, y, w, h)) continue;
          if (!waterWithin(x, y, w, h, tiles, rule.nearWater ?? 2)) continue;
          const d = Math.abs(x - cx) + Math.abs(y - cy);
          if (d < bestD) { bestD = d; best = { type, x, y, w, h }; }
        }
      }
    }
    if (best) { civics.push(best); reserve(best); }
  }

  plan.civics = civics;
  return civics;
}

// ─── Market ───────────────────────────────────────────────────────────────────

/**
 * Widen the main street around the founding node — the medieval market is a
 * WIDENED through street, not a detached plaza. The ±1-perpendicular
 * neighbours of through-road tiles within `extent` of the founding node
 * become market ground (carved as road by the executor).
 */
export function widenMarket(plan: SettlementPlan, tiles: Tile[][], extent = 2): { x: number; y: number }[] {
  const market: { x: number; y: number }[] = [];
  const roadSet = new Set(plan.edges.flatMap(e => e.tiles.map(t => `${t.x},${t.y}`)));
  const { x: cx, y: cy } = plan.center;

  for (const edge of plan.edges) {
    if (edge.kind !== 'through') continue;
    const dir = edge.tiles.length > 1
      ? {
          dx: Math.sign(edge.tiles[1].x - edge.tiles[0].x),
          dy: Math.sign(edge.tiles[1].y - edge.tiles[0].y),
        }
      : { dx: 1, dy: 0 };
    const perp = { dx: -dir.dy, dy: dir.dx };
    for (const t of edge.tiles) {
      if (Math.abs(t.x - cx) + Math.abs(t.y - cy) > extent) continue;
      for (const s of [1, -1]) {
        const x = t.x + perp.dx * s, y = t.y + perp.dy * s;
        const key = `${x},${y}`;
        if (roadSet.has(key)) continue;
        const tile = tiles[y]?.[x];
        if (!tile || WATER_TYPES.has(tile.type)) continue;
        roadSet.add(key);
        market.push({ x, y });
      }
    }
  }

  plan.market = market;
  return market;
}

// ─── Wards ────────────────────────────────────────────────────────────────────

const GOLDEN_ANGLE = 2.39996;

function bearingName(dx: number, dy: number): string {
  // Screen-space tile coords: +y is south.
  const ns = dy < 0 ? 'North' : 'South';
  const ew = dx < 0 ? 'West' : 'East';
  if (Math.abs(dx) > Math.abs(dy) * 2) return ew;
  if (Math.abs(dy) > Math.abs(dx) * 2) return ns;
  return `${ns}${ew.toLowerCase()}`;
}

const WARD_NOUNS: Record<Ward['type'], string> = {
  market: 'Market',
  harbour: 'Fisher Quarter',
  temple: 'Temple Hill',
  gate: 'Gate Row',
  residential: 'Rows',
  craft: 'Crafts',
};

/**
 * Assign wards over the settlement disc: golden-spiral seed points (dense
 * centre → small central wards, the classic medieval read), per-tile
 * nearest-seed assignment, type from a location rating, name from compass
 * bearing + type noun.
 */
export function assignWards(
  plan: SettlementPlan,
  radius: number,
  tiles: Tile[][],
  seed: number,
): Ward[] {
  // No streets, no wards — a road-less POI (ruin, mine, lone tavern) has no
  // districts to name. Growth (S3) assigns wards when the first street forms.
  if (plan.edges.length === 0) {
    plan.wards = [];
    return plan.wards;
  }
  const { x: cx, y: cy } = plan.center;
  const n = Math.max(3, Math.floor(radius * 0.8));
  const rot = noise(cx, cy, seed + 307) * Math.PI * 2;
  const seeds: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const r = radius * Math.sqrt((i + 0.5) / n);
    const a = rot + i * GOLDEN_ANGLE;
    seeds.push({ x: cx + Math.round(Math.cos(a) * r), y: cy + Math.round(Math.sin(a) * r) });
  }

  const wardTiles: { x: number; y: number }[][] = seeds.map(() => []);
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > radius * radius) continue;
      const t = tiles[y]?.[x];
      if (!t || WATER_TYPES.has(t.type)) continue;
      let best = 0, bestD = Infinity;
      for (let i = 0; i < seeds.length; i++) {
        const d = (x - seeds[i].x) ** 2 + (y - seeds[i].y) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
      wardTiles[best].push({ x, y });
    }
  }

  // Location rating → type.
  const endNodes = plan.nodes.filter(nd => nd.kind === 'end');
  const hasWaterNear = (txy: { x: number; y: number }[]): boolean =>
    txy.some(({ x, y }) => {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const t = tiles[y + dy]?.[x + dx];
          if (t && WATER_TYPES.has(t.type)) return true;
        }
      }
      return false;
    });

  // The ward whose seed is nearest the founding node is the market.
  let marketIdx = 0, marketD = Infinity;
  seeds.forEach((s, i) => {
    const d = (s.x - cx) ** 2 + (s.y - cy) ** 2;
    if (d < marketD) { marketD = d; marketIdx = i; }
  });

  const wards: Ward[] = [];
  const usedNames = new Set<string>();
  seeds.forEach((s, i) => {
    const tset = wardTiles[i];
    if (tset.length === 0) return;
    let type: Ward['type'];
    if (i === marketIdx) type = 'market';
    else if (hasWaterNear(tset)) type = 'harbour';
    else if (endNodes.some(nd => tset.some(t => t.x === nd.x && t.y === nd.y))) type = 'gate';
    else type = noise(s.x, s.y, seed + 401) < 0.5 ? 'residential' : 'craft';

    const noun = WARD_NOUNS[type];
    let name = i === marketIdx ? `The ${noun}` : `${bearingName(s.x - cx, s.y - cy)} ${noun}`;
    let ordinal = 2;
    while (usedNames.has(name)) name = `${name.replace(/ \d+$/, '')} ${ordinal++}`;
    usedNames.add(name);

    wards.push({ id: `ward:${s.x},${s.y}`, name, type, seed: s, tiles: tset });
  });

  plan.wards = wards;
  return wards;
}

/**
 * How many tiles of distance-affinity a perfect terrain fitness (1.0) is worth when
 * ordering slots. Small on purpose: terrain re-ranks slots that are *near-equal* on
 * the existing distance/affinity + jitter, so a building drifts to the best-sited of
 * the lots its layout already offers (the church onto the sunnier rise) WITHOUT
 * abandoning the gross centre/edge structure for a far-off knoll.
 */
export const SITE_FITNESS_PULL = 3;

/**
 * Deterministic candidate ordering for one preset: slots whose side opposes
 * the door facing, sorted by site affinity (centre-affine in, edge-affine
 * out) with a small seeded jitter for variety.
 *
 * `fitnessAt` (optional) is a terrain site-fitness in `0..1` sampled at a slot's
 * road anchor; when supplied it pulls better-sited slots earlier by up to
 * {@link SITE_FITNESS_PULL} tile-equivalents. Omitted (or a flat world ⇒ constant
 * fitness) leaves the ordering byte-identical to the pure distance/affinity sort —
 * the rng draw order is unchanged either way, so determinism holds.
 */
export function orderedSlotsFor(
  plan: SettlementPlan,
  doorFacing: [number, number] | null,
  rule: SiteRule | undefined,
  rng: Random,
  fitnessAt?: (tx: number, ty: number) => number,
): FrontageSlot[] {
  // `doorFacing === null` ⇒ ALL frontage sides (the building rotates to face whichever road
  // its slot fronts, via blueprint orientation). A concrete facing keeps the legacy filter
  // (slots whose side opposes a FIXED door — used by orientation-less callers / focus logic).
  const want: [number, number] | null = doorFacing ? [-doorFacing[0], -doorFacing[1]] : null;
  const sign = rule?.affinity === 'edge' ? -1 : 1;
  return plan.slots
    .filter(s => !want || (s.side[0] === want[0] && s.side[1] === want[1]))
    .map(s => {
      const fit = fitnessAt ? fitnessAt(s.roadX, s.roadY) : 0;
      return { s, k: sign * s.dist + rng.next() * 1.5 - SITE_FITNESS_PULL * fit };
    })
    .sort((a, b) => a.k - b.k)
    .map(({ s }) => s);
}
