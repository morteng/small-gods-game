// src/world/road-deformation.ts
//
// Roads → terrain CARVE. Roads are not drawn as a ribbon; they ARE the terrain. Each
// road edge writes ONE corridor deformation into the shared channel
// (`terrain-deformation.ts`, the `heightAt = baseSeedHeight ⊕ deformations` contract),
// and water/ice/snow interaction then falls out of the unified terrain+water shader
// for free (a gutter pools water; a cold paved surface ices; a sunken path floods).
//
// The carve is a PROJECTION of a derived `RoadState` (road-state.ts), NOT a per-class
// table (design doc 2026-06-24 "Road as a connectome projection"):
//   * The cell path is first smoothed to a centripetal Catmull-Rom centerline
//     (road-centerline.ts) — carving a raw 4-connected staircase would dig a staircase
//     ditch.
//   * A per-VERTEX longitudinal grade is smoothed over a window driven by `construction`
//     (roadCrossSection.gradeWindowTiles): a footpath uses local ground height → FOLLOWS
//     the terrain; a prosperous highway averages a long grade → CUTS a flat shelf THROUGH
//     hills ("they spent more on workers modifying terrain"). One knob, emergent.
//   * One `level` deformation with a per-tile `targetAt` = grade(s) + cross-section
//     profile(d): crown camber, kerb gutter+curb, side drainage ditch, worn ruts, and
//     edge irregularity from wear/overgrowth — every dimension a function of RoadState.
//
// Determinism & save-safety: deformations are DERIVED from `map.roadGraph` (persisted)
// + the seed heightfield + worldSeed era; nothing here is persisted; re-derives
// identically on load. Memoised per (seed, dims) like getHeightfield.
import type { GameMap, POI } from '@/core/types';
import { WATER_TYPES } from '@/core/constants';
import {
  ROAD_TILE_TYPES,
  applyRoadMask,
  type RoadGraph, type RoadEdge, type RoadNode, type RoadMask,
} from '@/world/road-graph';
import {
  DeformationStore,
  heightAt,
  type Deformation,
} from '@/world/terrain-deformation';
import { getHeightfield, ELEVATION_SEA_LEVEL, heightMetresAt } from '@/world/heightfield';
import { styledIslandSpec } from '@/terrain/island-mask';
import { styledShapeSpec, shapeSignature } from '@/terrain/terrain-shape';
import { worldStyleOf } from '@/core/world-style';
import { buildRiverDeformations } from '@/world/river-deformation';
import { buildSettlementPadDeformations, settlementBuildCount } from '@/world/settlement-deformation';
import { buildBoulderPadDeformations } from '@/world/boulder-deformation';
import { buildRockPadDeformations } from '@/world/rock-deformation';
import { buildBarrierDeformations, barrierFoundationCount } from '@/world/barrier-deformation';
import { buildDitchDeformations, ditchWallCount } from '@/world/ditch-deformation';
import { buildEarthworkDeformations } from '@/world/earthwork-deformation';
import { getHydrologyResult } from '@/world/hydrology-store';
import { smoothCenterline, simplifyPath, type Pt } from '@/terrain/road-centerline';
import { filletApproach } from '@/world/anchor-fillet';
import { realGateProfiles, gateApproachPlan, type GateApproachProfile } from '@/world/connectome/gate-approach';
import { crossingOpeningsForEdge, deckCellKeys, type CrossingOpening } from '@/world/connectome/crossing-openings';
import { tileBlockedByBuilding } from '@/world/building-collision';
import type { World } from '@/world/world';
import type { Anchor } from '@/world/anchors';
import { resolveSettlementEra, isEra, type Era } from '@/core/era';
import {
  deriveRoadState,
  roadCrossSection,
  type RoadState,
  type RoadCrossSection,
  type RoadDynamics,
} from '@/world/road-state';
import { clamp01 } from '@/core/math';

/** Embankment batter (fill-side slope): horizontal run in TILES per metre of fill height.
 *  ~0.75 = a 1.5 m run per 1 m rise (≈34° angle of repose) at 2 m / tile. */
const BATTER_RUN_TILES_PER_M = 0.75;

/** Arc step (tiles) for sampling the ground under the grade line to find fill — fine enough
 *  to catch a valley between sparse centerline vertices, coarse enough to stay cheap. */
const FILL_SAMPLE_STEP_TILES = 1;

/**
 * The corridor's fill-side falloff width (tiles) at a point carrying `fillM` metres of
 * embankment fill, built by a road of the given `cutStrength`. On flat or cut ground
 * (`fillM ≤ 0`) it's just the thin shoulder feather, so a road that isn't filling keeps its
 * trail-width footprint (parity with the pre-embankment carve). Where the road rides up on
 * fill, the width grows with the fill actually carried (`cutStrength·fillM`) so the bank
 * descends at the soil's repose angle — a footpath barely banks, an engineered road throws a
 * real causeway. Pure + monotonic; the carve and a parity test both read it.
 */
export function embankmentBatterTiles(fillM: number, cutStrength: number, shoulderFeatherTiles: number): number {
  return Math.max(shoulderFeatherTiles, BATTER_RUN_TILES_PER_M * cutStrength * Math.max(0, fillM));
}

// ── Geometry helpers (pure) ──────────────────────────────────────────────────────

/** Project a point onto a polyline: nearest cross-distance `d` + arc-length `s`. */
function projectToPolyline(pts: Pt[], cumS: number[], px: number, py: number): { d: number; s: number } {
  let best = Infinity;
  let bestS = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i].x, ay = pts[i].y;
    const dx = pts[i + 1].x - ax, dy = pts[i + 1].y - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + t * dx, cy = ay + t * dy;
    const dist = Math.hypot(px - cx, py - cy);
    if (dist < best) {
      best = dist;
      bestS = cumS[i] + t * Math.sqrt(len2);
    }
  }
  return { d: best, s: bestS };
}

/** The centerline point at arc-length `s` (cumS sorted ascending) — mirror of interpAtArc. */
function pointAtArc(pts: Pt[], cumS: number[], s: number): Pt {
  if (s <= cumS[0]) return pts[0];
  const n = cumS.length;
  if (s >= cumS[n - 1]) return pts[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumS[mid] <= s) lo = mid; else hi = mid;
  }
  const span = cumS[hi] - cumS[lo] || 1;
  const w = (s - cumS[lo]) / span;
  return { x: pts[lo].x + (pts[hi].x - pts[lo].x) * w, y: pts[lo].y + (pts[hi].y - pts[lo].y) * w };
}

/** Interpolate a per-vertex value at arc-length `s` (cumS is sorted ascending). */
function interpAtArc(cumS: number[], vals: number[], s: number): number {
  if (s <= cumS[0]) return vals[0];
  const n = cumS.length;
  if (s >= cumS[n - 1]) return vals[n - 1];
  // binary search for the segment containing s
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumS[mid] <= s) lo = mid; else hi = mid;
  }
  const span = cumS[hi] - cumS[lo] || 1;
  const w = (s - cumS[lo]) / span;
  return vals[lo] + (vals[hi] - vals[lo]) * w;
}

/** Symmetric moving-average smoothing — the longitudinal grade window (cut-through). */
function boxSmooth(vals: number[], halfWindow: number): number[] {
  if (halfWindow < 1 || vals.length <= 2) return vals.slice();
  const n = vals.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let sum = 0, cnt = 0;
    for (let k = -halfWindow; k <= halfWindow; k++) {
      const j = i + k;
      if (j < 0 || j >= n) continue;
      sum += vals[j];
      cnt++;
    }
    out[i] = sum / cnt;
  }
  return out;
}

/** Deterministic [0,1) hash for edge/surface irregularity (no Math.random). */
function hash2(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * The signed cross-section displacement (metres) added to the longitudinal grade at
 * cross-distance |d| (tiles). Crown camber over the carriageway, a kerb gutter+lip,
 * a side drainage ditch, worn wheel ruts, and wear/overgrowth edge irregularity.
 */
function crossProfile(ad: number, x: RoadCrossSection, tx: number, ty: number): number {
  let p = 0;
  const half = x.carriageHalf;
  if (ad <= half) {
    const u = half > 0 ? ad / half : 0;
    p += x.crownM * (1 - u * u); // camber: high at centre, 0 at edge
    if (x.rutDepthM > 0) {
      // two symmetric ruts near the wheel paths (~0.55 of the half-width)
      const r = Math.exp(-Math.pow((ad - 0.55 * half) / (0.18 * half + 1e-3), 2));
      p -= x.rutDepthM * r;
    }
  } else if (x.hasCurb && ad <= half + x.curbWidthTiles) {
    const t = (ad - half) / x.curbWidthTiles; // 0..1 across the kerb zone
    if (t < 0.5) {
      // gutter dip (inner half) — collects the water the crown sheds
      p -= x.gutterDepthM * (1 - Math.abs(t - 0.25) / 0.25);
    } else {
      // raised kerb lip (outer half)
      p += x.curbHeightM * (1 - Math.abs(t - 0.75) / 0.25);
    }
  }
  if (x.ditchDepthM > 0) {
    const dd = Math.abs(ad - x.ditchOffsetTiles);
    if (dd < 0.5) p -= x.ditchDepthM * (1 - dd / 0.5);
  }
  if (x.edgeNoiseM > 0) {
    // irregularity concentrated near the shoulders, fading into the carriageway
    const falloff = clamp01((ad - half * 0.6) / (half + x.shoulderFeatherTiles));
    p += x.edgeNoiseM * (hash2(tx, ty) - 0.5) * 2 * falloff;
  }
  return p;
}

// ── RoadState derivation from the graph ──────────────────────────────────────────

function eraForEdge(edge: RoadEdge, fromPoi: POI | undefined, toPoi: POI | undefined, map: GameMap): Era {
  const ws = map.worldSeed;
  if (fromPoi) return resolveSettlementEra(fromPoi, ws);
  if (toPoi) return resolveSettlementEra(toPoi, ws);
  return isEra(ws?.era) ? (ws!.era as Era) : 'medieval';
}

/** Per-edge derived road profile — the shared seam the carve AND the surface field read. */
export interface EdgeRoadProfile {
  centerline: Pt[];
  state: RoadState;
  x: RoadCrossSection;
}

// ── Approach fillets: roads arrive SQUARE at gates AND building-anchor doors ─────────
// The gate waypoint threading (or the anchor-snap door↔road match) forces the route to a
// target point but nothing aligns the approach tangent to the target's own axis, so the
// centerline kinks at the waypoint node. Here (the shared seam BOTH the carve and the
// render ribbon read) any edge end that lands at a real gate OR a matched building anchor
// gets its tail re-shaped by the roads-article fillet so it arrives heading straight at
// the opening/door. `filletApproach` pins the endpoint exactly at the target, so smoothing
// can never detach the road from it. `reconcileFilletRaster` (below) then re-derives the
// tile mask so the raster NPCs walk matches this smoothed ribbon.

/** A road/street approach target: the point it must arrive at + the OUTWARD normal of the
 *  thing it arrives at (a gate's wall normal, or a building door/frontage facing). Gate
 *  profiles and building-anchor profiles share this shape. */
type ApproachProfile = Pick<GateApproachProfile, 'x' | 'y' | 'facing'>;

const gateProfileCache = new WeakMap<object, GateApproachProfile[]>();
function gateProfilesFor(map: GameMap): GateApproachProfile[] {
  const runs = map.barrierRuns;
  if (!runs || runs.length === 0) return [];
  let hit = gateProfileCache.get(runs);
  if (!hit) { hit = realGateProfiles(runs); gateProfileCache.set(runs, hit); }
  return hit;
}

/** A building-anchor arrival profile: a road EDGE's own endpoint matched (by the anchor-snap
 *  layer) to a building door/frontage. Scoped per-edge (`edgeId`) since the anchor-snap
 *  matcher can snap a door to ANY nearby road point, not only an edge's terminus — we only
 *  want to fillet a genuine arrival (the matched road point sits at this edge's own end). */
interface AnchorArrivalProfile extends ApproachProfile { edgeId: string }

const anchorProfileCache = new WeakMap<object, AnchorArrivalProfile[]>();
function allAnchorArrivalProfiles(map: GameMap): AnchorArrivalProfile[] {
  const links = map.anchorLinks;
  if (!links || links.length === 0) return [];
  let hit = anchorProfileCache.get(links);
  if (hit) return hit;
  const anchorById = new Map<string, Anchor>();
  for (const a of map.anchors ?? []) if (a.id) anchorById.set(a.id, a);
  const out: AnchorArrivalProfile[] = [];
  for (const link of links) {
    if (link.relation !== 'connects') continue;
    if (link.b.kind !== 'road' || !link.b.ownerId) continue;
    if (link.a.kind !== 'door' && link.a.kind !== 'frontage') continue;
    const src = link.a.id ? anchorById.get(link.a.id) : undefined;
    if (!src) continue;
    out.push({ x: link.b.x, y: link.b.y, facing: src.facing, edgeId: link.b.ownerId });
  }
  anchorProfileCache.set(links, out);
  return out;
}

/** Building-anchor arrival profiles for ONE edge (WP-Q #2). */
function buildingAnchorProfilesFor(map: GameMap, edgeId: string): AnchorArrivalProfile[] {
  const all = allAnchorArrivalProfiles(map);
  return all.length === 0 ? all : all.filter((p) => p.edgeId === edgeId);
}

/** A centerline end within this many tiles of a real gate point is a gate approach. */
const GATE_SNAP_TILES = 1.6;
/** A centerline end within this many tiles of a matched building anchor is that arrival —
 *  slightly looser than `DEFAULT_RULES`' door/frontage `maxGap` (1.6) to tolerate rounding
 *  between the anchor-snap match point and the edge's own endpoint. */
const ANCHOR_SNAP_TILES = 1.8;

/** Re-shape ONE end (the last point) of `line` to arrive square at approach target `p`. */
function filletEndOntoProfile(line: Pt[], p: ApproachProfile): Pt[] {
  // Which side does this edge approach from? Probe ~2 tiles back along the line: outside
  // (along +facing) arrives heading INTO the target (targetFacing = outward); an interior
  // street reaching the target from inside arrives heading OUT (targetFacing = inward).
  let acc = 0, probe = line[0];
  for (let i = line.length - 1; i > 0; i--) {
    acc += Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y);
    if (acc >= 2) { probe = line[i - 1]; break; }
  }
  const side = (probe.x - p.x) * p.facing[0] + (probe.y - p.y) * p.facing[1];
  const facing: [number, number] = side >= 0 ? p.facing : [-p.facing[0], -p.facing[1]];
  return filletApproach(line, { x: p.x, y: p.y }, facing);
}

/**
 * Pin a THROUGH-road onto each gate opening it crosses (WP: gate tile-exactness). The end
 * fillets above only re-shape a centerline whose ENDPOINT lands at a gate — an edge that
 * passes through an opening mid-polyline (a connection between two other POIs that A*
 * threaded through this town's wall) kept its fractional crossing, so the ribbon could shave
 * the curtain beside the opening. For each gate profile the line genuinely CROSSES (points
 * either side of the wall plane near the gate — a road merely running alongside the wall is
 * left alone), splice the exact opening cell into the polyline at the crossing, so the
 * centerline passes through the shared `gateOpeningCell` cell-exactly. Skips profiles already
 * owned by an end fillet (either endpoint within `snapTiles`). Deterministic; pure.
 */
function pinThroughOpenings(line: Pt[], profiles: GateApproachProfile[], snapTiles: number): Pt[] {
  if (profiles.length === 0 || line.length < 2) return line;
  let out = line;
  for (const g of profiles) {
    const endD = Math.min(
      Math.hypot(out[0].x - g.x, out[0].y - g.y),
      Math.hypot(out[out.length - 1].x - g.x, out[out.length - 1].y - g.y),
    );
    if (endD <= snapTiles) continue;                       // an end fillet owns this gate
    // The pin window spans the opening (half its width) plus the end-fillet slack.
    const window = Math.max(snapTiles, g.width / 2 + 0.5);
    // Nearest point on the polyline to the opening cell.
    let bestD = Infinity, bestI = -1, bestT = 0;
    for (let i = 0; i < out.length - 1; i++) {
      const ax = out[i].x, ay = out[i].y, dx = out[i + 1].x - ax, dy = out[i + 1].y - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((g.x - ax) * dx + (g.y - ay) * dy) / len2)) : 0;
      const d = Math.hypot(g.x - (ax + dx * t), g.y - (ay + dy * t));
      if (d < bestD) { bestD = d; bestI = i; bestT = t; }
    }
    if (bestI < 0 || bestD > window) continue;
    // CROSSING test: ~2 tiles up/down the line from the nearest point must sit on OPPOSITE
    // sides of the wall plane (the gate's outward normal). A road alongside the wall doesn't.
    const side = (p: Pt): number => (p.x - g.x) * g.facing[0] + (p.y - g.y) * g.facing[1];
    let before = out[bestI], acc = bestT > 0 ? Math.hypot(out[bestI + 1].x - out[bestI].x, out[bestI + 1].y - out[bestI].y) * bestT : 0;
    for (let i = bestI; i > 0 && acc < 2; i--) { acc += Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y); before = out[i - 1]; }
    let after = out[bestI + 1];
    acc = Math.hypot(out[bestI + 1].x - out[bestI].x, out[bestI + 1].y - out[bestI].y) * (1 - bestT);
    for (let i = bestI + 1; i < out.length - 1 && acc < 2; i++) { acc += Math.hypot(out[i + 1].x - out[i].x, out[i + 1].y - out[i].y); after = out[i + 1]; }
    if (side(before) * side(after) >= 0) continue;         // alongside, not through
    out = [...out.slice(0, bestI + 1), { x: g.x, y: g.y }, ...out.slice(bestI + 1)];
  }
  return out;
}

/** Index of the vertex of `line` nearest `p`. */
function nearestIndex(line: ReadonlyArray<Pt>, p: Pt): number {
  let best = Infinity, bi = 0;
  for (let i = 0; i < line.length; i++) {
    const d = (line[i].x - p.x) ** 2 + (line[i].y - p.y) ** 2;
    if (d < best) { best = d; bi = i; }
  }
  return bi;
}

/**
 * Pin the smoothed ribbon through each river crossing's SHARED OPENING (the bridge/road exactness
 * WP). The fillets above only reshape a centerline's ENDS — a gate approach, a building door — but
 * a river crossing is MID-SPAN, so nothing ever re-pinned the ribbon to the deck: at a bend the
 * Catmull-Rom corner-cut slid the drawn road a tile sideways off the bridge, and the road painted
 * cobble across the open channel the deck no longer covered.
 *
 * For each crossing on this edge the ribbon now: arrives square at the near bank cell ALONG THE
 * DECK AXIS, runs STRAIGHT across on the deck line (a bridge is a straight object, and so is the
 * road on it), and departs square from the far bank. Both approaches use the SAME line→arc fillet
 * a gate approach uses (`filletEndOntoProfile` → `filletApproach`, which pins its endpoint exactly
 * and leaves the graft on the incoming tangent), so the pin is C1 at the graft and arrives
 * collinear with the deck — no kink. The bank cells come from `getCrossingOpenings`, the same ONE
 * rounding the deck seats on, so ribbon and bridge cannot drift apart again.
 */
function pinBankOpenings(line: Pt[], openings: CrossingOpening[]): Pt[] {
  if (openings.length === 0 || line.length < 2) return line;
  let out = line;
  for (const op of openings) {
    if (out.length < 2) break;
    const A: Pt = { x: op.a[0], y: op.a[1] };
    const B: Pt = { x: op.b[0], y: op.b[1] };
    // Keep the ribbon's own order: whichever bank the line reaches first is the near one.
    const iA = nearestIndex(out, A), iB = nearestIndex(out, B);
    const [i0, p0, i1, p1] = iA <= iB ? [iA, A, iB, B] as const : [iB, B, iA, A] as const;
    if (i1 <= i0) continue;                                   // both banks collapse to one vertex
    const dx = p1.x - p0.x, dy = p1.y - p0.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) continue;
    const axis: [number, number] = [dx / len, dy / len];      // the deck's direction
    const head = out.slice(0, i0 + 1);
    const tail = out.slice(i1);
    // `filletEndOntoProfile` probes which side the road approaches from and orients the facing
    // itself, so passing the deck axis works for both ends (the tail is filleted reversed).
    const pinnedHead = head.length >= 2
      ? filletEndOntoProfile(head, { x: p0.x, y: p0.y, facing: axis })
      : [...head, p0];
    const pinnedTail = tail.length >= 2
      ? filletEndOntoProfile(tail.slice().reverse(), { x: p1.x, y: p1.y, facing: axis }).reverse()
      : [p1, ...tail];
    // The deck run: straight, resampled at ~1 tile so the carve/raster sample it densely enough.
    const deck: Pt[] = [];
    const steps = Math.max(1, Math.ceil(len));
    for (let k = 1; k < steps; k++) deck.push({ x: p0.x + dx * (k / steps), y: p0.y + dy * (k / steps) });
    out = dedupePts([...pinnedHead, ...deck, ...pinnedTail]);
  }
  return out;
}

/** Drop consecutive coincident points (the fillet joins can land on each other). */
function dedupePts(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 1e-6) out.push(p);
  }
  return out;
}

/** Fillet either end of `centerline` onto the nearest profile within `snapTiles`, if any. */
function filletOntoProfiles(centerline: Pt[], profiles: ApproachProfile[], snapTiles: number): Pt[] {
  if (profiles.length === 0 || centerline.length < 2) return centerline;
  const near = (p: Pt): ApproachProfile | undefined => {
    let best: ApproachProfile | undefined, bestD = snapTiles;
    for (const g of profiles) {
      const d = Math.hypot(g.x - p.x, g.y - p.y);
      if (d < bestD) { bestD = d; best = g; }
    }
    return best;
  };
  let line = centerline;
  const tail = near(line[line.length - 1]);
  if (tail) line = filletEndOntoProfile(line, tail);
  const head = near(line[0]);
  if (head) line = filletEndOntoProfile(line.slice().reverse(), head).reverse();
  return line;
}

/** Derive one road edge's smoothed centerline + RoadState + cross-section, or null. */
export function edgeRoadProfile(
  map: GameMap,
  edge: RoadEdge,
  nodeById: Map<string, RoadNode>,
  poiById: Map<string, POI>,
  dynamicFor?: (edge: RoadEdge) => RoadDynamics | undefined,
): EdgeRoadProfile | null {
  if (edge.feature !== 'road' || edge.polyline.length < 2) return null;
  // Bow-reconciliation pins (reconcileCenterlineBows) force the spline back through the
  // walked cells wherever plain smoothing bowed off the legal row — honoured EVERYWHERE
  // the centerline is derived (render ribbon, carve, raster reconcile), so all three agree.
  let centerline = smoothCenterline(
    edge.polyline,
    edge.pins?.length ? { keepIndices: new Set(edge.pins) } : {},
  );
  // A rejected fillet (reconciliation found its ribbon cells illegal) stays rejected: the
  // plain smoothed polyline tracks the router-approved raw path within the reconcile margin.
  // NOTE the crossing openings are derived from this SAME plain smoothed line, so a rejected
  // edge's ribbon still threads its deck — the pin below only has to survive the gate fillets.
  if (!edge.filletRejected) {
    const gateProfiles = gateProfilesFor(map);
    centerline = filletOntoProfiles(centerline, gateProfiles, GATE_SNAP_TILES);
    // A THROUGH-road (the gate mid-polyline, not at an end) is pinned onto the opening cell too.
    centerline = pinThroughOpenings(centerline, gateProfiles, GATE_SNAP_TILES);
    const anchorProfiles = buildingAnchorProfilesFor(map, edge.id);
    if (anchorProfiles.length) centerline = filletOntoProfiles(centerline, anchorProfiles, ANCHOR_SNAP_TILES);
    // MID-SPAN: pin the ribbon through each river crossing's shared bank opening, so the drawn
    // road threads the very cells the deck seats on (the gate fillet, applied to a crossing).
    centerline = pinBankOpenings(centerline, crossingOpeningsForEdge(map, edge.id));
  }
  if (centerline.length < 2) return null;
  const fromPoi = poiById.get(nodeById.get(edge.a)?.poiRef ?? '');
  const toPoi = poiById.get(nodeById.get(edge.b)?.poiRef ?? '');
  const era = eraForEdge(edge, fromPoi, toPoi, map);
  // An explicit dynamicFor (preview/scrub) overrides; otherwise the persisted per-edge
  // dynamics evolved by the road-evolution tick flow into BOTH the carve and the surface.
  const dynamic = dynamicFor?.(edge) ?? edge.dynamics;
  const state = deriveRoadState({ roadClass: edge.class, surface: edge.surface, era, dynamic });
  return { centerline, state, x: roadCrossSection(state) };
}

/** One road edge → its corridor deformation, or null if too short to carve. */
export function buildEdgeDeformation(
  map: GameMap,
  edge: RoadEdge,
  nodeById: Map<string, RoadNode>,
  poiById: Map<string, POI>,
  dynamicFor?: (edge: RoadEdge) => RoadDynamics | undefined,
): Deformation | null {
  const profile = edgeRoadProfile(map, edge, nodeById, poiById, dynamicFor);
  if (!profile) return null;
  const { centerline, x } = profile;

  // Per-vertex base grade + cumulative arc-length.
  const n = centerline.length;
  const grade = new Array<number>(n);
  const cumS = new Array<number>(n);
  const overSpan = new Array<boolean>(n);
  cumS[0] = 0;
  for (let i = 0; i < n; i++) {
    grade[i] = heightMetresAt(map, Math.round(centerline[i].x), Math.round(centerline[i].y));
    const tt = map.tiles?.[Math.round(centerline[i].y)]?.[Math.round(centerline[i].x)]?.type ?? '';
    overSpan[i] = tt === 'bridge' || WATER_TYPES.has(tt);
    if (i > 0) cumS[i] = cumS[i - 1] + Math.hypot(centerline[i].x - centerline[i - 1].x, centerline[i].y - centerline[i - 1].y);
  }
  // THE APPROACH-DIVE FIX: a vertex over a crossing samples the carved channel (low), and
  // the longitudinal smoothing dragged the flanking DRY approaches down toward the water —
  // the road visibly plunged beside the deck. The road's true profile over a span is the
  // DECK, which rides the higher bank: pin each wet run to max(bank, bank) before smoothing,
  // so the approaches ramp UP to the deck (embankment fill builds the ramp) instead of diving.
  for (let i = 0; i < n; i++) {
    if (!overSpan[i]) continue;
    let a = i; while (a > 0 && overSpan[a - 1]) a--;
    let b = i; while (b + 1 < n && overSpan[b + 1]) b++;
    const bankA = a > 0 ? grade[a - 1] : -Infinity;
    const bankB = b + 1 < n ? grade[b + 1] : -Infinity;
    const deckM = Math.max(bankA, bankB);
    if (Number.isFinite(deckM)) for (let k = a; k <= b; k++) grade[k] = deckM;
    i = b;
  }
  // Longitudinal smoothing window IS the cut-through lever (construction-driven).
  const halfWindow = Math.max(0, Math.round(x.gradeWindowTiles / 2));
  const smoothGrade = boxSmooth(grade, halfWindow);

  // G2 — embankment fill. Where the smoothed grade rides ABOVE the ground (a dip or valley
  // the road must carry itself across), the road builds UP a fill bank, not only carves down.
  // The `level` op already raises terrain toward grade (`height = lerp(ground, grade, mask)`);
  // the only thing missing for a believable embankment is the SHAPE of its side — a fixed
  // shoulder-feather drops the fill as a near-vertical wall. So on the fill side we widen the
  // falloff to a BATTER whose run scales with the fill height: the lerp then ramps the height
  // from grade down to ground over that run, a side-slope at the soil's repose angle (a
  // footpath barely banks; an engineered road throws a real causeway).
  //
  // The grade line is a smooth ramp between (possibly sparse) centerline vertices, so it can
  // float well above the terrain BETWEEN them — sampling fill only AT vertices misses all of
  // it (there `smoothGrade == grade` by construction). So sample the ground densely along arc.
  const total = cumS[n - 1] || 0;
  const fillArcs: number[] = [];
  const fillVals: number[] = [];
  let maxFill = 0;
  for (let s = 0; s <= total + 1e-6; s += FILL_SAMPLE_STEP_TILES) {
    const p = pointAtArc(centerline, cumS, s);
    const ground = heightMetresAt(map, Math.round(p.x), Math.round(p.y));
    const f = Math.max(0, interpAtArc(cumS, smoothGrade, s) - ground);
    fillArcs.push(s);
    fillVals.push(f);
    if (f > maxFill) maxFill = f;
  }
  const batterRun = (s: number): number =>
    embankmentBatterTiles(interpAtArc(fillArcs, fillVals, s), x.cutStrength, x.shoulderFeatherTiles);
  const maxBatter = embankmentBatterTiles(maxFill, x.cutStrength, x.shoulderFeatherTiles);

  // Footprint: carriageway + kerb + ditch + feather/batter.
  const core = x.carriageHalf + (x.hasCurb ? x.curbWidthTiles : 0);
  const ditchReach = x.ditchDepthM > 0 ? x.ditchOffsetTiles + 0.5 : 0;
  const featherStart = Math.max(core, ditchReach);
  const reach = featherStart + maxBatter; // worst-case footprint for the AABB bounds

  const xs = centerline.map((p) => p.x);
  const ys = centerline.map((p) => p.y);
  const bounds = {
    minX: Math.min(...xs) - reach,
    minY: Math.min(...ys) - reach,
    maxX: Math.max(...xs) + reach,
    maxY: Math.max(...ys) + reach,
  };

  return {
    id: `${edge.id}:corridor`,
    source: 'road:cut',
    op: 'level',
    priority: 30,
    amount: 0,
    bounds,
    mask(tx, ty) {
      const { d, s } = projectToPolyline(centerline, cumS, tx, ty);
      const batter = batterRun(s); // height-proportional on a fill bank; ≥ the thin shoulder feather
      const localReach = featherStart + batter;
      if (d >= localReach) return 0;
      if (d <= featherStart) return x.cutStrength;
      // Smoothstep (not linear) falloff: C1 at both featherStart and localReach — the
      // linear ramp's slope KINKS (0 → −cutStrength/batter) at featherStart produced a
      // shading rim that traced every road edge under banded lighting.
      const t = clamp01((d - featherStart) / batter);
      return x.cutStrength * (1 - t * t * (3 - 2 * t));
    },
    targetAt(tx, ty) {
      const { d, s } = projectToPolyline(centerline, cumS, tx, ty);
      return interpAtArc(cumS, smoothGrade, s) + crossProfile(d, x, tx, ty);
    },
  };
}

/**
 * Pure: a road graph → the corridor carve deformations its road edges imply (one per
 * edge). Rivers and walls are skipped (separate producers). `map` is read for base
 * heights + era only.
 */
export function buildRoadDeformations(map: GameMap, graph: RoadGraph): Deformation[] {
  const nodeById = new Map(graph.nodes.map((nd) => [nd.id, nd]));
  const poiById = new Map((map.worldSeed?.pois ?? []).map((p) => [p.id, p]));
  const out: Deformation[] = [];
  for (const edge of graph.edges) {
    const def = buildEdgeDeformation(map, edge, nodeById, poiById);
    if (def) out.push(def);
  }
  return out;
}

// ── Fillet → raster reconciliation (WP-Q) ─────────────────────────────────────────
//
// `edgeRoadProfile` smooths + fillets the RENDER centerline, but the integer cell polyline
// worldgen carved into `map.tiles` (what NPCs actually walk) stays the raw, kinked path — so
// the smooth approach the player sees is not the surface NPCs walk. This reconciles the two:
// for each road edge, re-sample the FILLETED centerline and compare it against the edge's own
// (unchanged) `polyline` — the ground truth from gen. Only the fillet-reshaped TAILS (gate
// approaches, building-anchor arrivals) diverge from the raw path; the vast majority of edges
// have no fillet applied at all and this is a no-op.
//
// Hard constraints (Galin 2010 — a pipeline that smooths after routing must RE-VALIDATE
// against the world): a candidate cell is never claimed if it's a curtain BLOCKING cell, open
// water without an existing bridge deck, a building footprint, or a protected green precinct.
// Where any cell in a divergent span fails, the WHOLE span falls back — the original (already
// road) tiles for that span are left untouched, never partially carved. This is PURELY
// ADDITIVE: `edge.polyline` (and `bridgeCells`) are never rewritten, so bridge bookkeeping and
// the graph's own "walked path" stay exactly as gen produced them; `map.tiles` simply gains the
// extra cells the smoothed ribbon needs. "Un-carving" stale cells is deliberately NOT attempted
// — the plan's own guidance ("when in doubt leave them — a slightly wide road is better than a
// broken one") makes a purely-additive reconciliation the conservative, defensible choice.

/** Arc-length step (tiles) for sampling the filleted centerline when reconciling tiles. */
const RECON_SAMPLE_STEP_TILES = 0.35;
/**
 * How far (tiles) a filleted sample may sit from the raw (carved) polyline before it counts
 * as "diverged" and needs new tiles. NOTE this is a tile-GRID tolerance, not a corridor-width
 * one: the carved tile MASK is a single-cell-wide path regardless of road class (only the
 * continuous height/paint carve scales with `carriageHalf`), so the right yardstick is "would
 * this land on a different integer cell than the raw path," not the carriageway's own width.
 * Plain Catmull-Rom smoothing (no fillet) measures ~0 deviation on the fixtures this reconciles
 * against; a gate/anchor fillet's reshaped arc measures well over a tile — comfortably above
 * this margin — so the threshold cleanly separates "ordinary smoothing" from "a real fillet."
 */
const RECON_MATCH_MARGIN_TILES = 0.65;

export interface FilletReconcileSpan {
  edgeId: string;
  /** Arc-length range along the edge's FILLETED centerline this span covers. A fillet built
   *  from a fully-collapsed (straight, RDP-simplified) raw polyline can bulge in the MIDDLE
   *  of the arc (a Hermite/arc curve pins both true endpoints exactly and departs from the
   *  raw path only in between) — so a span is wherever the samples diverge, not necessarily
   *  at either literal end. */
  arcRange: [number, number];
  /** True when new tiles were written; false when the span fell back (left the original
   *  raw-polyline tiles in place because a candidate cell failed a hard constraint). */
  written: boolean;
  cellsWritten: number;
}

/** One divergent span of an edge's filleted centerline, PLANNED but not applied: the candidate
 *  ribbon cells plus any that fail a hard constraint. `badCells.length > 0` ⇒ the span falls
 *  back (nothing written) — which is exactly what the `roads.ribbon-legal` lint contract reports:
 *  the smoothed ribbon the player sees would cross ground the router never approved. */
export interface FilletReconcilePlanSpan {
  edgeId: string;
  arcRange: [number, number];
  /** The 4-connected candidate cells the smoothed ribbon needs (rounded, deduped). */
  cells: { x: number; y: number }[];
  /** The subset of `cells` failing a hard constraint (curtain / water-sans-bridge / building /
   *  protected green). Empty ⇒ the span is applied by `reconcileFilletRaster`. */
  badCells: { x: number; y: number }[];
}

/** Sample a polyline at ~`step` arc-length spacing (endpoints included), paired with each
 *  sample's own arc-length position along `pts` (for reporting divergent spans). */
function denseSample(pts: ReadonlyArray<Pt>, step: number): { points: Pt[]; arcLens: number[] } {
  if (pts.length < 2) return { points: pts.slice(), arcLens: pts.map(() => 0) };
  const cumS = new Array<number>(pts.length);
  cumS[0] = 0;
  for (let i = 1; i < pts.length; i++) cumS[i] = cumS[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  const total = cumS[pts.length - 1];
  const points: Pt[] = [];
  const arcLens: number[] = [];
  for (let s = 0; s <= total; s += step) { points.push(pointAtArc(pts as Pt[], cumS, s)); arcLens.push(s); }
  const last = pts[pts.length - 1];
  if (points.length === 0 || Math.hypot(points[points.length - 1].x - last.x, points[points.length - 1].y - last.y) > 1e-6) {
    points.push(last);
    arcLens.push(total);
  }
  return { points, arcLens };
}

/** Round + dedupe consecutive identical cells. */
function roundCells(pts: ReadonlyArray<Pt>): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const p of pts) {
    const c = { x: Math.round(p.x), y: Math.round(p.y) };
    const last = out[out.length - 1];
    if (!last || last.x !== c.x || last.y !== c.y) out.push(c);
  }
  return out;
}

/** Insert an orthogonal corner between diagonally-adjacent cells so the reconciled span stays
 *  4-connected (NPC walkability + road-connectivity both step 4-neighbour) — same rule as
 *  `orthogonalize` in road-graph.ts, generalised to this reconciliation's own bad-cell test. */
function fourConnectCells(
  cells: ReadonlyArray<{ x: number; y: number }>,
  isBad: (x: number, y: number) => boolean,
): { x: number; y: number }[] {
  if (cells.length < 2) return cells.slice();
  const out: { x: number; y: number }[] = [cells[0]];
  for (let i = 1; i < cells.length; i++) {
    const p = cells[i - 1], c = cells[i];
    if (p.x !== c.x && p.y !== c.y) {
      const optA = { x: c.x, y: p.y };
      const optB = { x: p.x, y: c.y };
      out.push(!isBad(optA.x, optA.y) ? optA : !isBad(optB.x, optB.y) ? optB : optA);
    }
    out.push(c);
  }
  return out;
}

/** Every tile a settlement plan's `green` civic occupies — protected commons roads must
 *  thread AROUND (mirrors the `greenTiles` set `map-generator.ts` builds pre-carve; here
 *  re-derived from the persisted `settlementPlans` so this module never needs `world`). */
function collectGreenTiles(map: GameMap): Set<string> {
  const out = new Set<string>();
  for (const plan of map.settlementPlans ?? []) {
    for (const c of plan.civics) {
      if (c.type !== 'green') continue;
      for (let dy = 0; dy < c.h; dy++) for (let dx = 0; dx < c.w; dx++) out.add(`${c.x + dx},${c.y + dy}`);
    }
  }
  return out;
}

/** Hard constraints a reconciled cell must pass: never a curtain blocking cell, never open
 *  water without an existing bridge deck, never a protected green, never a building
 *  structure cell. The building check is TWO-layered: `tileBlockedByBuilding(world, …)` is
 *  the real authority (the registry tile index sees EVERY building, including entity-only
 *  ones — crossing tolls/shrines, stoops — that never stamp `tile.walkable`; this was the
 *  INV3 regression: a walkable-flag-only proxy missed them). The tile-walkable proxy is kept
 *  as a second layer for callers with no `world` (isolated tests / tooling). */
function blockedForReconcile(
  map: GameMap, x: number, y: number,
  wallObstacles: ReadonlySet<string>, greenTiles: ReadonlySet<string>, deckCells: ReadonlySet<string>,
  world?: World,
): boolean {
  const t = map.tiles[y]?.[x];
  if (!t) return true;
  const key = `${x},${y}`;
  if (wallObstacles.has(key)) return true;
  // A cell on a crossing's DECK LINE is legal water: the bridge carries the road over it (the
  // reconciliation stamps it `bridge` below). Without this the ribbon — now pinned through the
  // shared bank opening, i.e. deliberately routed onto the deck — would fail its own hard
  // constraint and reject the fillet, snapping the drawn road back off the bridge.
  if (WATER_TYPES.has(t.type) && t.type !== 'bridge' && !deckCells.has(key)) return true;
  if (greenTiles.has(key)) return true;
  if (t.walkable === false && !ROAD_TILE_TYPES.has(t.type) && !deckCells.has(key)) return true;
  if (world && tileBlockedByBuilding(world, x, y)) return true;
  return false;
}

/**
 * PLAN the reconciliation of ONE divergent span of an edge's filleted centerline. `sample` is
 * the dense-sampled sub-run covering just that span (padded 1 sample into the matching
 * neighbourhood on each side so the new cells stay 4-connected to the untouched raw tiles).
 * Pure read: returns the candidate cells + the subset failing a hard constraint; nothing is
 * written here. An empty `cells` list counts its own emptiness as illegal (nothing to stamp).
 */
function planSpan(
  map: GameMap, edge: RoadEdge, sample: Pt[], arcRange: [number, number],
  wallObstacles: ReadonlySet<string>, greenTiles: ReadonlySet<string>, deckCells: ReadonlySet<string>,
  world?: World,
): FilletReconcilePlanSpan {
  const isBad = (x: number, y: number): boolean => blockedForReconcile(map, x, y, wallObstacles, greenTiles, deckCells, world);
  const cells = fourConnectCells(roundCells(sample), isBad);
  const badCells = cells.filter((c) => isBad(c.x, c.y));
  return { edgeId: edge.id, arcRange, cells, badCells };
}

/**
 * Re-derive the road tile mask along every edge's FILLETED centerline so the raster NPCs walk
 * matches the rendered ribbon (WP-Q #1). Purely additive: edges with no fillet divergence (the
 * common case) are untouched; edges whose gate/anchor-arrival fillet moved the centerline off
 * its raw walked path get the new cells stamped, falling back per-span wherever a candidate
 * cell would violate a hard constraint. Safe to call more than once: divergence is measured
 * against `edge.polyline` (never rewritten), so a repeat call re-identifies the same span, but
 * `applyRoadMask` is itself idempotent (stamping an already-road tile is a no-op) — the TILE
 * GRID never changes on a second pass, even though the returned span list isn't empty.
 *
 * SEQUENCING (the INV3 lesson): this is an EXPLICIT worldgen pass, called once by
 * `map-generator.ts` after ALL building placement is final (settlements, crossing ancillary
 * structures, stoops, aqueducts, `reconcileBuildingsWithWater` nudges) and after the
 * anchor-snap layer is derived (`map.anchorLinks` feeds the building-anchor fillets) — the
 * same "final authority" pattern as `reconcileBuildingsWithWater`. It must NOT be triggered
 * lazily from a deformation-store/feature-geometry getter: a mid-generation read would stamp
 * road tiles BEFORE later structures validate their seats, and those structures (sited to
 * avoid roads-at-that-time) would then sit on roads they never saw. Pass `world` so the
 * blocked check consults the real building registry, not just tile flags.
 */
export function reconcileFilletRaster(map: GameMap, world?: World): FilletReconcileSpan[] {
  const plans = planFilletReconcile(map, world);
  const deckCells = deckCellKeys(map);   // ribbon cells ON a deck are stamped `bridge`, not road
  // GALIN'S VERDICT (re-validate after smoothing): an edge with ANY illegal span gets its
  // fillet REJECTED outright — never partially applied. `edgeRoadProfile` then re-derives the
  // plain smoothed centerline for that edge, so the render ribbon, the terrain carve and the
  // tile mask all follow the path the router approved (`roads.ribbon-legal` holds by
  // construction). Residual divergence on a rejected edge is pure Catmull-Rom corner-cutting
  // (sub-tile, fillet-free) — the lint contract reports it as a warn, not an error.
  const badEdges = new Set(plans.filter((s) => s.cells.length === 0 || s.badCells.length > 0).map((s) => s.edgeId));
  if (badEdges.size > 0 && map.roadGraph) {
    for (const e of map.roadGraph.edges) {
      if (!badEdges.has(e.id) || e.filletRejected) continue;
      e.filletRejected = true;
      console.warn(`[worldgen] fillet REJECTED for road ${e.id} — smoothed ribbon crossed illegal ground; edge keeps its plain centerline`);
    }
    // Deformation/surface caches key on the graph rev — the carve must re-derive fillet-free.
    map.roadGraph.rev = (map.roadGraph.rev ?? 0) + 1;
  }
  const results = plans.map((span) => {
    if (badEdges.has(span.edgeId)) {
      return { edgeId: span.edgeId, arcRange: span.arcRange, written: false, cellsWritten: 0 };
    }
    const mask: RoadMask = {
      width: map.width,
      height: map.height,
      // A cell the pinned ribbon crosses ON a deck line becomes a `bridge` tile — the raster then
      // says what the deck says (`bridge.tiles-vs-deck`), NPCs walk the span, and a plain-road
      // write over water (which `applyRoadMask` would silently drop) never happens at a crossing.
      writes: span.cells.map((c) => ({
        x: c.x, y: c.y,
        surface: surfaceOfEdge(map, span.edgeId),
        bridge: deckCells.has(`${c.x},${c.y}`),
      })),
    };
    applyRoadMask(map.tiles, mask);
    return { edgeId: span.edgeId, arcRange: span.arcRange, written: true, cellsWritten: span.cells.length };
  });
  // FINAL legality self-heal: any residual centerline graze onto an illegal cell (a rejected
  // edge's sub-margin corner-cut, a fillet residue) is pinned back onto the walked row, so
  // the `roads.ribbon-legal` whole-line invariant holds by construction after gen.
  const legalityPins = reconcileCenterlineLegality(map, world);
  if (legalityPins > 0) {
    console.warn(`[worldgen] centerline legality reconcile pinned ${legalityPins} point(s) — drawn line grazed illegal ground`);
  }
  return results;
}

/** The surface of a graph edge by id (planned spans carry only the id). */
function surfaceOfEdge(map: GameMap, edgeId: string): RoadEdge['surface'] {
  return map.roadGraph?.edges.find((e) => e.id === edgeId)?.surface ?? 'dirt';
}

// ── Road tile VISIBILITY reconcile ────────────────────────────────────────────────
//
// A road tile with `baseType` set is colour-painted as the ground UNDER the road
// (`packColorField`), on the assumption the analytic ribbon supplies the road albedo on
// top. That assumption only holds for tiles a graph edge's drawn centerline covers —
// stitch/orphan tiles carved by the repair passes (and any residual cell no centerline
// or settlement street owns) rendered as bare grass while staying walkable roads: the
// INVISIBLE-road class the road audit surfaced. This final pass clears `baseType` on any
// road tile that neither a road edge's FINAL centerline nor a settlement street run
// covers, so it falls back to honest tile-colour paint (the same blocky style settlement
// streets use) instead of vanishing. Runs once at gen, after `reconcileFilletRaster`
// (the centerlines it measures against are the final ones). Returns tiles made visible.

/** A road tile further than this (tiles) from every drawn centerline is ribbon-orphaned —
 *  matches the audit's own orphan threshold (ribbon half-width tops out ≈ 1.44 for a
 *  highway, but the orphan class sits well clear of ANY centerline, not just the wide ones). */
const RIBBON_COVER_TILES = 0.9;

export function reconcileRoadTileVisibility(map: GameMap): number {
  if (!map.tiles?.length) return 0;
  const graph = map.roadGraph;
  const nodeById = new Map((graph?.nodes ?? []).map((nd) => [nd.id, nd]));
  const poiById = new Map((map.worldSeed?.pois ?? []).map((p) => [p.id, p]));
  const lines: { pts: Pt[]; cumS: number[]; minX: number; minY: number; maxX: number; maxY: number }[] = [];
  for (const edge of graph?.edges ?? []) {
    if (edge.feature !== 'road' || edge.polyline.length < 2) continue;
    const prof = edgeRoadProfile(map, edge, nodeById, poiById);
    if (!prof || prof.centerline.length < 2) continue;
    const pts = prof.centerline;
    const cumS = new Array<number>(pts.length);
    cumS[0] = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) cumS[i] = cumS[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (pts[i].x < minX) minX = pts[i].x;
      if (pts[i].y < minY) minY = pts[i].y;
      if (pts[i].x > maxX) maxX = pts[i].x;
      if (pts[i].y > maxY) maxY = pts[i].y;
    }
    lines.push({ pts, cumS, minX, minY, maxX, maxY });
  }
  // Settlement street runs paint by tile colour already (the blocky street style) —
  // a road tile on one is owned, not orphaned.
  const streetCells = new Set<string>();
  for (const plan of map.settlementPlans ?? []) {
    for (const e of plan.edges ?? []) for (const t of e.tiles) streetCells.add(`${t.x},${t.y}`);
  }
  const R = RIBBON_COVER_TILES;
  let cleared = 0;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = map.tiles[y]?.[x];
      if (!t || t.baseType === undefined) continue;
      if (t.type !== 'dirt_road' && t.type !== 'stone_road') continue;   // bridges read as decks
      if (streetCells.has(`${x},${y}`)) continue;
      let covered = false;
      for (const l of lines) {
        if (x < l.minX - R || x > l.maxX + R || y < l.minY - R || y > l.maxY + R) continue;
        if (projectToPolyline(l.pts, l.cumS, x, y).d <= R) { covered = true; break; }
      }
      if (covered) continue;
      delete t.baseType;
      cleared++;
    }
  }
  return cleared;
}

/**
 * PURE planning half of the fillet↔raster reconciliation — every divergent span of every road
 * edge's filleted centerline, with its candidate ribbon cells and any hard-constraint violations.
 * Reads only committed map/world state (no tile writes), so it doubles as the evaluator for the
 * `roads.ribbon-legal` lint contract: a span with `badCells` means the smoothed ribbon the player
 * sees crosses ground the router never approved AND the reconciliation had to fall back — the
 * Galin "re-validate after smoothing" bug class, surfaced instead of silently shipped.
 */
export function planFilletReconcile(map: GameMap, world?: World): FilletReconcilePlanSpan[] {
  const graph = map.roadGraph;
  if (!graph || !map.tiles?.length) return [];
  const nodeById = new Map(graph.nodes.map((nd) => [nd.id, nd]));
  const poiById = new Map((map.worldSeed?.pois ?? []).map((p) => [p.id, p]));
  const wallObstacles = gateApproachPlan(map.barrierRuns ?? [], [], map.worldSeed?.pois ?? []).wallObstacles;
  const greenTiles = collectGreenTiles(map);
  const deckCells = deckCellKeys(map);   // the crossings' deck lines — legal water for the ribbon

  const results: FilletReconcilePlanSpan[] = [];
  for (const edge of graph.edges) {
    if (edge.feature !== 'road' || edge.polyline.length < 2) continue;
    const profile = edgeRoadProfile(map, edge, nodeById, poiById);
    if (!profile || profile.centerline.length < 2) continue;

    const raw = edge.polyline as Pt[];
    const rawCumS = new Array<number>(raw.length);
    rawCumS[0] = 0;
    for (let i = 1; i < raw.length; i++) rawCumS[i] = rawCumS[i - 1] + Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y);

    const { points: sampled, arcLens } = denseSample(profile.centerline, RECON_SAMPLE_STEP_TILES);
    const tol = RECON_MATCH_MARGIN_TILES;
    const dists = sampled.map((p) => projectToPolyline(raw, rawCumS, p.x, p.y).d);

    // Every contiguous run of divergent samples — a fillet reshapes a TAIL near a gate/anchor
    // in the common case, but a fully-collapsed (straight) raw polyline can pin BOTH literal
    // endpoints exactly and bulge only in the middle (a Hermite/arc property), so divergence
    // isn't guaranteed to touch either end. Pad one matching sample on each side so the
    // written cells stay 4-connected to the untouched raw tiles at the seam.
    let i = 0;
    while (i < dists.length) {
      if (dists[i] <= tol) { i++; continue; }
      let j = i;
      while (j + 1 < dists.length && dists[j + 1] > tol) j++;
      const from = Math.max(0, i - 1);
      const to = Math.min(dists.length - 1, j + 1);
      results.push(planSpan(
        map, edge, sampled.slice(from, to + 1), [arcLens[from], arcLens[to]], wallObstacles, greenTiles, deckCells, world,
      ));
      i = j + 1;
    }
  }
  return results;
}

// ── Bow reconciliation: plain smoothing must not leave the walked row ─────────────
//
// The fillet reconciliation above assumed plain (fillet-free) Catmull-Rom smoothing
// deviates ~0 from the walked polyline — empirically FALSE: at sharp RDP corners the
// spline bows up to ~1.6 tiles off the walked path. Stamping those bows doubled the
// road into a "lens" (raw tiles + bow tiles); rejecting them left the drawn ribbon
// sagging up to 2 tiles off ANY road tile for a whole arc. The honest fix is neither:
// where the PLAIN smoothed line diverges beyond the reconcile margin, the spline is
// PULLED BACK by pinning walked cells as mandatory control points (`edge.pins`,
// persisted), re-fitting the centerline through the row the router approved. Runs at
// gen before `reconcileFilletRaster`, so the fillet pass then only sees genuine
// fillet divergence (gate/anchor/deck reshaping — deliberate, stampable).

/** RDP tolerance (tiles) when choosing pin corners inside a bowed span — small enough that
 *  corner tolerance (0.45) + residual Catmull-Rom sag (≲0.2 through cells 1 apart) stays
 *  within `RECON_MATCH_MARGIN_TILES`. */
const PIN_EPSILON_TILES = 0.45;
/** Pin → re-measure rounds per edge. Round 1 pins RDP corners of each bowed span; later
 *  rounds pin EVERY walked cell of a still-bowed span; 3 rounds always converge (a spline
 *  through every cell of the span cannot bow further than the sag bound). */
const BOW_MAX_ROUNDS = 3;

export interface BowReconcileResult {
  edgeId: string;
  /** Polyline indices newly pinned for this edge. */
  pinned: number;
  /** Max plain-smoothing deviation (tiles) from the walked path AFTER pinning. */
  residualMax: number;
}

/**
 * Pull every road edge's PLAIN smoothed centerline back within the reconcile margin of its
 * walked polyline by pinning control points (`edge.pins`). Mutates the graph edges (pins are
 * persisted with the graph — load re-derives the identical centerline) and bumps `graph.rev`
 * when any pin lands so deformation/surface caches re-derive. Deterministic; idempotent
 * (a second call finds no divergent span and adds nothing).
 */
export function reconcileCenterlineBows(map: GameMap): BowReconcileResult[] {
  const graph = map.roadGraph;
  if (!graph) return [];
  const out: BowReconcileResult[] = [];
  let anyPinned = false;
  for (const edge of graph.edges) {
    if (edge.feature !== 'road' || edge.polyline.length < 2) continue;
    const raw = edge.polyline as Pt[];
    const rawCumS = new Array<number>(raw.length);
    rawCumS[0] = 0;
    for (let i = 1; i < raw.length; i++) rawCumS[i] = rawCumS[i - 1] + Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y);

    let pinnedCount = 0;
    let residualMax = 0;
    for (let round = 0; round < BOW_MAX_ROUNDS; round++) {
      const pins = new Set(edge.pins ?? []);
      const line = smoothCenterline(edge.polyline, pins.size ? { keepIndices: pins } : {});
      const { points: sampled } = denseSample(line, RECON_SAMPLE_STEP_TILES);
      // Divergent spans, expressed as arc ranges along the RAW polyline.
      const spanRanges: Array<[number, number]> = [];
      let cur: [number, number] | null = null;
      residualMax = 0;
      for (const p of sampled) {
        const { d, s } = projectToPolyline(raw, rawCumS, p.x, p.y);
        if (d > residualMax) residualMax = d;
        if (d > RECON_MATCH_MARGIN_TILES) {
          if (cur) { cur[0] = Math.min(cur[0], s); cur[1] = Math.max(cur[1], s); }
          else cur = [s, s];
        } else if (cur) {
          spanRanges.push(cur);
          cur = null;
        }
      }
      if (cur) spanRanges.push(cur);
      if (spanRanges.length === 0) break;

      let added = 0;
      for (const [s0, s1] of spanRanges) {
        // Raw index range covering the span's arc, padded one cell each side.
        let i0 = 0;
        while (i0 + 1 < raw.length && rawCumS[i0 + 1] < s0) i0++;
        let i1 = raw.length - 1;
        while (i1 > 0 && rawCumS[i1 - 1] > s1) i1--;
        i0 = Math.max(0, i0 - 1);
        i1 = Math.min(raw.length - 1, i1 + 1);
        if (i1 - i0 < 1) continue;
        const sub = raw.slice(i0, i1 + 1);
        // Round 1: pin the span's RDP corners (smooth but tight). Later rounds: pin all.
        const corners = round === 0 ? simplifyPath(sub, PIN_EPSILON_TILES) : sub;
        // simplifyPath returns references into `sub` — recover raw indices by identity.
        let k = 0;
        for (let j = 0; j < sub.length && k < corners.length; j++) {
          if (sub[j] !== corners[k]) continue;
          k++;
          const rawIdx = i0 + j;
          if (!pins.has(rawIdx)) { pins.add(rawIdx); added++; }
        }
      }
      if (added === 0) break; // fully pinned already — residual is the spline's own sag
      edge.pins = [...pins].sort((a, b) => a - b);
      pinnedCount += added;
      anyPinned = true;
    }
    if (pinnedCount > 0 || residualMax > RECON_MATCH_MARGIN_TILES) {
      out.push({ edgeId: edge.id, pinned: pinnedCount, residualMax });
    }
  }
  if (anyPinned) graph.rev = (graph.rev ?? 0) + 1;
  return out;
}

// ── Whole-centerline legality (roads.ribbon-legal, strengthened) ──────────────────

export interface RibbonLegalityViolation {
  edgeId: string;
  /** Rounded final-centerline cells failing a hard constraint (unwalkable rock, water
   *  without a deck, curtain, building, protected green). */
  badCells: { x: number; y: number }[];
}

/**
 * Gen-side self-heal for the whole-centerline legality invariant: wherever an edge's FINAL
 * drawn centerline rounds onto an illegal cell while the walked path alongside is legal
 * (a sub-margin corner-cut grazing rock/water the router avoided), pin the nearby walked
 * cells so the spline is pulled back onto the approved row. Ground-truth violations (the
 * RAW path itself crosses an illegal cell — e.g. a curtain later stamped over a live road
 * tile) are deliberately left for the lint contract to report: no pin can fix those.
 * Iterates ≤3 rounds; bumps `graph.rev` when pins land. Returns pins added.
 */
export function reconcileCenterlineLegality(map: GameMap, world?: World): number {
  const graph = map.roadGraph;
  if (!graph || !map.tiles?.length) return 0;
  const wallObstacles = gateApproachPlan(map.barrierRuns ?? [], [], map.worldSeed?.pois ?? []).wallObstacles;
  const greenTiles = collectGreenTiles(map);
  const deckCells = deckCellKeys(map);
  let pinnedTotal = 0;
  for (let round = 0; round < 3; round++) {
    const violations = planRibbonLegality(map, world);
    if (violations.length === 0) break;
    let added = 0;
    for (const v of violations) {
      const edge = graph.edges.find((e) => e.id === v.edgeId);
      if (!edge || edge.polyline.length < 2) continue;
      const raw = edge.polyline as Pt[];
      const rawCumS = new Array<number>(raw.length);
      rawCumS[0] = 0;
      for (let i = 1; i < raw.length; i++) rawCumS[i] = rawCumS[i - 1] + Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y);
      const pins = new Set(edge.pins ?? []);
      const before = pins.size;
      for (const c of v.badCells) {
        const { s } = projectToPolyline(raw, rawCumS, c.x, c.y);
        let i = 0;
        while (i + 1 < raw.length && rawCumS[i + 1] <= s) i++;
        for (let j = Math.max(0, i - 1); j <= Math.min(raw.length - 1, i + 2); j++) {
          const rc = raw[j];
          // Never pin an index whose own cell is illegal — that's a ground-truth violation
          // the contract must surface, not a bow a pin can heal.
          if (blockedForReconcile(map, Math.round(rc.x), Math.round(rc.y), wallObstacles, greenTiles, deckCells, world)) continue;
          if (!pins.has(j)) { pins.add(j); added++; }
        }
      }
      if (pins.size > before) edge.pins = [...pins].sort((a, b) => a - b);
    }
    if (added === 0) break;
    pinnedTotal += added;
    graph.rev = (graph.rev ?? 0) + 1;
  }
  return pinnedTotal;
}

/**
 * PURE check: the FINAL drawn centerline of every road edge (pins + fillets + deck pins
 * applied — exactly what the ribbon paints along) must never cross an illegal cell. This is
 * the whole-line strengthening of the span-based `planFilletReconcile` read: the span check
 * only sees where the line DIVERGES from the walked path; a bow within the margin can still
 * round onto a cell the router never approved. Evaluated by the `roads.ribbon-legal` lint
 * contract; a clean report means the ribbon the player sees rides ground NPCs can walk.
 */
export function planRibbonLegality(map: GameMap, world?: World): RibbonLegalityViolation[] {
  const graph = map.roadGraph;
  if (!graph || !map.tiles?.length) return [];
  const nodeById = new Map(graph.nodes.map((nd) => [nd.id, nd]));
  const poiById = new Map((map.worldSeed?.pois ?? []).map((p) => [p.id, p]));
  const wallObstacles = gateApproachPlan(map.barrierRuns ?? [], [], map.worldSeed?.pois ?? []).wallObstacles;
  const greenTiles = collectGreenTiles(map);
  const deckCells = deckCellKeys(map);
  const out: RibbonLegalityViolation[] = [];
  for (const edge of graph.edges) {
    if (edge.feature !== 'road' || edge.polyline.length < 2) continue;
    const profile = edgeRoadProfile(map, edge, nodeById, poiById);
    if (!profile || profile.centerline.length < 2) continue;
    const { points: sampled } = denseSample(profile.centerline, RECON_SAMPLE_STEP_TILES);
    const bad: { x: number; y: number }[] = [];
    const seen = new Set<string>();
    for (const c of roundCells(sampled)) {
      const key = `${c.x},${c.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (blockedForReconcile(map, c.x, c.y, wallObstacles, greenTiles, deckCells, world)) bad.push(c);
    }
    if (bad.length > 0) out.push({ edgeId: edge.id, badCells: bad });
  }
  return out;
}

// ── Riverside levee (#24): roads alongside open water ride up on an embankment ──

/** Full-height berm rise (metres) where a road runs alongside open water. ~1.5 m reads as a
 *  real causeway above the waterline without looking like a wall (cf. embankment fill G2). */
const LEVEE_HEIGHT_M = 1.5;
/** Half-width (tiles) of the levee's full-height crown about the road centerline. */
const LEVEE_HALF_TILES = 1.2;
/** Bank falloff (tiles) beyond the crown — the embankment slopes back down to grade. */
const LEVEE_FEATHER_TILES = 1.6;
/** A road vertex counts as "riverside" if open water lies within this radius (tiles). */
const RIVERSIDE_REACH_TILES = 2.5;

/**
 * Pure: the riverside-levee deformations a map's roads imply (#24 — "road-river
 * relationship"). A road that runs flush alongside a river reads as if it would flood;
 * a real road there sits on a raised embankment. For each road edge we find its
 * CONTIGUOUS riverside sub-runs (consecutive polyline vertices whose cell is near open
 * water) and raise each on an `add` berm that composes ABOVE the road's grade-cut and the
 * river incision (priority 80 > road 30 > river-carve 40). The mask returns 0 over water
 * tiles, so the river keeps its bed — only the road and its landward bank lift. Empty when
 * no road runs beside water (exact parity by construction).
 */
export function buildLeveeDeformations(map: GameMap): Deformation[] {
  if (!map.roadGraph || !map.tiles?.length) return [];
  const W = map.width, H = map.height;
  const isWater = (tx: number, ty: number): boolean => {
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return false;
    const t = map.tiles[ty]?.[tx];
    return !!t && WATER_TYPES.has(t.type);
  };
  const r = Math.ceil(RIVERSIDE_REACH_TILES);
  const reach2 = RIVERSIDE_REACH_TILES * RIVERSIDE_REACH_TILES;
  const nearWater = (p: Pt): boolean => {
    const cx = Math.round(p.x), cy = Math.round(p.y);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > reach2) continue;
        if (isWater(cx + dx, cy + dy)) return true;
      }
    }
    return false;
  };

  const out: Deformation[] = [];
  for (const edge of map.roadGraph.edges) {
    if (edge.feature !== 'road' || edge.polyline.length < 2) continue;
    // Split the edge into contiguous riverside sub-runs — a road may touch water in two
    // separate places, and one polyline across the gap would berm dry ground between them.
    const runs: Pt[][] = [];
    let cur: Pt[] = [];
    for (const p of edge.polyline) {
      if (nearWater(p)) cur.push(p);
      else { if (cur.length >= 2) runs.push(cur); cur = []; }
    }
    if (cur.length >= 2) runs.push(cur);

    runs.forEach((run, ri) => {
      const cumS = new Array<number>(run.length);
      cumS[0] = 0;
      for (let i = 1; i < run.length; i++) cumS[i] = cumS[i - 1] + Math.hypot(run[i].x - run[i - 1].x, run[i].y - run[i - 1].y);
      const reachT = LEVEE_HALF_TILES + LEVEE_FEATHER_TILES;
      const xs = run.map((p) => p.x), ys = run.map((p) => p.y);
      out.push({
        id: `${edge.id}:levee:${ri}`,
        source: 'road:levee',
        op: 'add',
        priority: 80,
        amount: LEVEE_HEIGHT_M,
        bounds: {
          minX: Math.min(...xs) - reachT,
          minY: Math.min(...ys) - reachT,
          maxX: Math.max(...xs) + reachT,
          maxY: Math.max(...ys) + reachT,
        },
        mask(tx, ty) {
          if (isWater(Math.round(tx), Math.round(ty))) return 0; // never raise the river bed
          const { d } = projectToPolyline(run, cumS, tx, ty);
          if (d >= reachT) return 0;
          if (d <= LEVEE_HALF_TILES) return 1;
          return clamp01(1 - (d - LEVEE_HALF_TILES) / LEVEE_FEATHER_TILES);
        },
      });
    });
  }
  return out;
}

// ── Memoised stores + composed fields, keyed by (seed, dims) like getHeightfield ──

const storeCache = new Map<string, DeformationStore>();
const fieldCache = new Map<string, Float32Array>();
const CACHE_CAP = 4;

/**
 * M4 S4 — signature of the OWNED (runtime-POI) physical stamps. The main key
 * folds in COUNTS (`e`/`w`/`d`), which collide when two different stamp sets
 * have equal counts — unreachable while worldgen was the only writer, but the
 * `found_castle` verb makes it real: scrub back (counts revert), re-issue the
 * verb, and siteSelect can land the SAME-count stamp set at a DIFFERENT site
 * (the timeline's scrub + re-roll flow; spike §8.3). Owned stamps therefore
 * hash their identity + placement into the key. Returns '' when no owned
 * stamps exist, so every pre-M4 world keys byte-identically to before.
 */
function ownedStampSignature(map: GameMap): string {
  let h = 0;
  let any = false;
  const mix = (n: number): void => { h = (Math.imul(h, 31) + (n | 0)) | 0; };
  const mixStr = (s: string): void => { for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i)); };
  for (const e of map.earthworks ?? []) {
    if (!e.ownerPoiId) continue;
    any = true;
    mixStr(e.ownerPoiId);
    mixStr(e.kind);
    mix(Math.round((e.centre?.x ?? e.ring?.cx ?? 0) * 8));
    mix(Math.round((e.centre?.y ?? e.ring?.cy ?? 0) * 8));
    mix(Math.round(e.height * 64));
  }
  for (const b of map.barrierRuns ?? []) {
    if (!b.ownerPoiId) continue;
    any = true;
    mixStr(b.ownerPoiId);
    const p0 = b.run.path[0];
    if (p0) { mix(Math.round(p0[0] * 8)); mix(Math.round(p0[1] * 8)); }
  }
  return any ? `:o${(h >>> 0).toString(36)}` : '';
}

function key(map: GameMap): string {
  // `rev` bumps when road-evolution mutates edge.dynamics; `b` is the built-lot count so
  // settlement foundation pads invalidate when live growth fills a lot. Both keep the
  // composed heightfield a pure, cache-correct function of the map's evolving state.
  // `p` distinguishes a map that declares its riparian scatter (boulder pads compose)
  // from a same-seed map that doesn't (gen-time stub, studio ground) — without it an
  // empty world's stub store could be served for the final map, dropping the pads.
  // `k` is the declared rock-pad count — the same reason `p` is here: a mid-generation
  // stub map (no pads yet) must not have its store served back for the final map.
  // The trailing owned-stamp signature disambiguates SAME-COUNT runtime castle
  // stamps at different sites (see ownedStampSignature).
  return `${map.seed}:${map.width}x${map.height}:r${map.roadGraph?.rev ?? 0}:b${settlementBuildCount(map)}:w${barrierFoundationCount(map)}:d${ditchWallCount(map)}:e${map.earthworks?.length ?? 0}:s${shapeSignature(styledShapeSpec(map.worldSeed))}:p${map.riparianSeed ?? 'n'}:k${map.rockPads?.length ?? 'n'}${ownedStampSignature(map)}`;
}

function evict(cache: Map<string, unknown>): void {
  if (cache.size > CACHE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/**
 * The road deformation store for a world — memoised. Empty (size 0) when the map
 * has no road graph, so consumers compose to exact base-terrain parity.
 */
export function getRoadDeformationStore(map: GameMap): DeformationStore {
  const k = key(map);
  let store = storeCache.get(k);
  if (store) return store;
  store = new DeformationStore();
  if (map.roadGraph) store.add(...buildRoadDeformations(map, map.roadGraph));
  storeCache.set(k, store);
  evict(storeCache);
  return store;
}

// ── Merged WORLD store: road grade-cuts ⊕ river incision (memoised) ──
const worldStoreCache = new Map<string, DeformationStore>();

/**
 * The full terrain-deformation store for a world — road corridors AND river incision,
 * composed into one store (priority/id order handles overlaps where a road bridges a
 * river). This is what the renderer and composed heightfield read; `getRoadDeformationStore`
 * stays road-only for callers that want just roads.
 */
export function getWorldDeformationStore(map: GameMap): DeformationStore {
  const k = key(map);
  let store = worldStoreCache.get(k);
  if (store) return store;
  store = new DeformationStore();
  if (map.roadGraph) store.add(...buildRoadDeformations(map, map.roadGraph));
  store.add(...buildRiverDeformations(map, getHydrologyResult(map)));
  store.add(...buildSettlementPadDeformations(map));
  store.add(...buildBoulderPadDeformations(map)); // R5: big bank boulders settle into grade
  store.add(...buildRockPadDeformations(map)); // scattered upland rocks settle into grade
  store.add(...buildBarrierDeformations(map)); // walls: stepped foundation footing under the curtain
  store.add(...buildDitchDeformations(map)); // WP-S: shallow dry ditch outside the town wall (causeways at gates)
  store.add(...buildEarthworkDeformations(map.earthworks ?? [])); // motte/ditch/rampart of a placed complex
  store.add(...buildLeveeDeformations(map)); // #24: riverside roads ride up on an embankment
  worldStoreCache.set(k, store);
  evict(worldStoreCache);
  return store;
}

/**
 * The world's NORMALISED `[0,1]` elevation field with road grade-cuts AND river
 * incision composed in — what the GPU terrain mesh lifts. Returns the SAME base
 * array instance (zero cost, byte-parity) when there are no deformations at all.
 * Memoised by (seed, dims, store version); callers must treat it read-only.
 */
export function getComposedHeightfield(map: GameMap): Float32Array {
  // Inspection ground (studio): a dead-flat plane just above sea level — no seed
  // noise, so the subject sits clean with no procedural peaks/snow/rock around it.
  // The same flat field feeds entity foot-z lift, so the building stays flush.
  if (map.flatHeight) return new Float32Array(map.width * map.height).fill(ELEVATION_SEA_LEVEL + 0.1);
  const base = getHeightfield(map.seed, map.width, map.height, styledIslandSpec(map.worldSeed), map.worldSeed?.pois ?? null, styledShapeSpec(map.worldSeed));
  const store = getWorldDeformationStore(map);
  if (store.size === 0) return base; // parity by construction

  const k = `${key(map)}:v${store.version}`;
  const cached = fieldCache.get(k);
  if (cached) return cached;

  const { width, height } = map;
  const relief = worldStyleOf(map.worldSeed).mountainRelief;
  const out = new Float32Array(width * height);
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const m = heightAt(map, store, tx, ty);
      out[ty * width + tx] = m / relief + ELEVATION_SEA_LEVEL;
    }
  }
  fieldCache.set(k, out);
  evict(fieldCache);
  return out;
}

/** Drop memoised stores + composed fields (tests; harmless in prod). */
export function clearRoadDeformationCache(): void {
  storeCache.clear();
  worldStoreCache.clear();
  fieldCache.clear();
}
