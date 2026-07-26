// src/sim/garrison.ts
// MANNING THE WALLS (W1) — the pure half of the garrison: the roster shape, the ring geometry a
// garrison is derived against, and the phase machine that walks a soldier from his door to a post
// between the merlons and back down again. W3 adds the ORDERS store (`GarrisonOrders`) — the
// command-reachable half — and the shared ring/roster lookups the command verbs and
// `GarrisonSystem` both need to agree on (never two independent derivations of "does this
// settlement have a garrisonable wall").
//
// THREE pieces of state, deliberately split:
//   • `GarrisonOrders` — a `GameState` field (`state.garrisonOrders`), NOT a system-private
//     field: a command verb receives `ctx.state`/`ctx.world`, never a live `GarrisonSystem`
//     instance, so the two bits a command can actually raise/release (a STANDING muster order)
//     or that are pure hysteresis (which garrisons are currently UP) live here — mirroring
//     `ContentionLedger` (`@/sim/rival-contention`) exactly, down to the serialize/hydrate/
//     `fromSnapshot` shape. `GarrisonSystem` reads and writes it through an injected getter,
//     exactly as `RivalContentionSystem` reads `state.contention`.
//   • the ROSTER (`GarrisonRoster`) — ONE settlement-keyed object owned by `GarrisonSystem`:
//     which ring, which men, mustered or not. Membership is DERIVED fresh every tick and never
//     persisted (a member can die, be rehomed, or fold back into the statistical tier between
//     ticks). This is a proto-`Group`: phase 2 of the tactical-behaviour track
//     (`docs/superpowers/specs/2026-07-26-tactical-npc-behaviour-spec.md`) introduces a
//     first-class `Group` object (garrison/patrol/warband/procession) and retrofits it onto
//     exactly this shape, so nothing downstream has to be rewritten to speak groups.
//   • the per-NPC `p.garrison` (`NpcGarrisonState`, `@/core/types`) — ONLY the transient
//     phase-machine scratch of one man in transit. Nothing about membership or orders.
//
// Geometry comes from `@/world/tactical-positions` (W0), the leaf both the sim and the renderer
// read, so the flight a soldier climbs and the flight that is drawn are the same flight by
// construction. WALL TILES ARE NOT WALKABLE and must stay that way: everything above grade moves
// PARAMETRICALLY along the run polyline, never through tile pathfinding.
import type { Entity, GameMap, NpcProperties, NpcId, POI } from '@/core/types';
import type { World } from '@/world/world';
import { pathLength, type BarrierRun, type PlacedBarrier } from '@/world/barrier';
import {
  arcLengthPoint, stairClimbOf, wallStations, type WallStationPosition,
} from '@/world/tactical-positions';
import { animateStationary, animateWalking, directionFromDelta } from '@/sim/npc-pose';
import { queryNpcs, npcProps } from '@/world/npc-helpers';

type Pt = [number, number];

// ── Ordered walks (shared: rosters, orders, and the command verbs all sort this way) ───────────

/** Lowest-id-first — the stable walk every roster/assignment/serialize decision is made in. */
export function byId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ── Roster (the proto-Group) ────────────────────────────────────────────────────────────────

/** How many men one ring can hold at a time (first cut). The wall usually offers far more
 *  stations than a village has soldiers; this caps the other direction, so a garrison never
 *  swallows a settlement's whole watch. */
export const GARRISON_RING_CAP = 8;

/**
 * A settlement's garrison, as ONE object. Rebuilt from live NPCs every system tick (a member can
 * die, be rehomed by `found_castle`, or fold back into the statistical tier between ticks), so
 * `members` is DERIVED truth and never persisted; `mustered` and any standing order are the two
 * bits that genuinely cannot be rederived, and they ride the system-state snapshot seam.
 */
export interface GarrisonRoster {
  /** The settlement POI this garrison belongs to. */
  poiId: string;
  /** `PlacedBarrier.id` of the ring being manned. */
  barrierId: string;
  /** Resident soldiers currently posted (or posting), lowest entity id first — a stable order, so
   *  the same world always assigns the same men to the same stations. */
  members: NpcId[];
  /** True while the walls are being held: contention at `schism` or above, or a standing order. */
  mustered: boolean;
  /** True when a standing muster order (W3's `muster_garrison`) holds this garrison up regardless
   *  of the contention ladder. */
  standingOrder: boolean;
  /** Number of posts the ring offers — the other half of the assignment cap. */
  stationCount: number;
}

// ── Ring geometry (memoised per run) ────────────────────────────────────────────────────────

/** Everything the phase machine needs about one ring, derived purely from its (immutable) run. */
export interface RingGarrisonGeometry {
  stations: WallStationPosition[];
  /** The mural stair's parametric climb, or `null` when the ring has no way up (⇒ no garrison). */
  climb: { bottom: Pt; top: Pt; walkZ: number; topT: number } | null;
  /** Length of the flight in 3-space (tiles) — the climb's own track length. */
  flightLen: number;
  /** Total path length of the run (the on-wall track's arc coordinate range). */
  total: number;
  /** True when the polyline closes on itself: the allure is a loop and a soldier takes the SHORTER
   *  way round to his post instead of trudging back past the gate. */
  closed: boolean;
}

// Keyed on the run OBJECT: `BarrierRun` is immutable plain data once worldgen (or `foundCastle`)
// commits it, so this memo is a pure function of its key and can never go stale. Weak so a
// discarded map's rings are collected with it.
const RING_GEOMETRY = new WeakMap<BarrierRun, RingGarrisonGeometry>();

/** Stations + stair climb for a ring, memoised. Deterministic and allocation-free after the
 *  first call, which matters: the phase machine runs at 60 Hz. */
export function ringGarrisonGeometry(run: BarrierRun): RingGarrisonGeometry {
  const hit = RING_GEOMETRY.get(run);
  if (hit) return hit;
  const stations = wallStations(run);
  const climb = stairClimbOf(run);
  const flightLen = climb
    ? Math.hypot(climb.top[0] - climb.bottom[0], climb.top[1] - climb.bottom[1], climb.walkZ)
    : 0;
  const path = run.path ?? [];
  const first = path[0], last = path[path.length - 1];
  const geo: RingGarrisonGeometry = {
    stations,
    climb,
    flightLen: Math.max(flightLen, 1e-3),
    total: path.length >= 2 ? pathLength(path) : 0,
    closed: path.length >= 3 && !!first && !!last
      && Math.hypot(last[0] - first[0], last[1] - first[1]) < 1e-6,
  };
  RING_GEOMETRY.set(run, geo);
  return geo;
}

/** A ring can be garrisoned only if it has both posts to stand at AND a way up to them. */
export function isGarrisonable(run: BarrierRun): boolean {
  const geo = ringGarrisonGeometry(run);
  return geo.stations.length > 0 && geo.climb !== null;
}

// ── Settlement ↔ ring lookup (shared: `GarrisonSystem.tick` AND the `muster_garrison`/
// `stand_down_garrison` verbs must agree on "does this settlement have a garrisonable wall" —
// one derivation, never two that can drift apart). ────────────────────────────────────────────

/** How far a ring reaches from its own centre — the radius inside which a settlement anchor is
 *  plausibly the thing this wall encloses. */
function ringRadius(b: PlacedBarrier): number {
  const c = b.run.centroid;
  if (!c) return 0;
  let r = 0;
  for (const [x, y] of b.run.path) r = Math.max(r, Math.hypot(x - c[0], y - c[1]));
  return r;
}

/** Which settlement a ring encloses: its recorded owner (a runtime castle records one), else the
 *  nearest POI anchor that actually falls inside the ring's reach. `null` when nothing does — a
 *  standalone croft wall has no garrison to raise. */
function poiForRing(b: PlacedBarrier, pois: readonly POI[]): string | null {
  if (b.ownerPoiId) return b.ownerPoiId;
  const c = b.run.centroid;
  if (!c) return null;
  const reach = ringRadius(b);
  let best: string | null = null;
  let bestD = Infinity;
  for (const poi of pois) {
    if (!poi.position) continue;
    const d = Math.hypot(poi.position.x - c[0], poi.position.y - c[1]);
    if (d <= reach && d < bestD) { bestD = d; best = poi.id; }
  }
  return best;
}

/** Ring per settlement: garrisonable rings only, one per POI (the ring offering the most posts
 *  wins; ties go to the lowest barrier id). Walked lowest-id-first so the pairing is stable. */
export function garrisonableRings(map: GameMap): Map<string, PlacedBarrier> {
  const out = new Map<string, PlacedBarrier>();
  const pois = map.worldSeed?.pois ?? [];
  const runs = [...(map.barrierRuns ?? [])].sort((a, b) => byId(a.id, b.id));
  for (const b of runs) {
    if (!isGarrisonable(b.run)) continue;
    const poiId = poiForRing(b, pois);
    if (!poiId) continue;
    const prev = out.get(poiId);
    if (!prev || ringGarrisonGeometry(b.run).stations.length > ringGarrisonGeometry(prev.run).stations.length) {
      out.set(poiId, b);
    }
  }
  return out;
}

/** The garrisonable ring for ONE settlement, or `undefined` — the single-lookup convenience the
 *  command verbs use (a full `garrisonableRings` scan for a one-poi question). */
export function garrisonableRingFor(map: GameMap, poiId: string): PlacedBarrier | undefined {
  return garrisonableRings(map).get(poiId);
}

/** Living resident soldiers of a settlement, lowest entity id first — the same headcount
 *  `GarrisonSystem` musters from and the verbs refuse "no soldiers" against. */
export function residentSoldiers(world: World, poiId: string): NpcId[] {
  return queryNpcs(world)
    .filter((e) => { const p = npcProps(e); return p.role === 'soldier' && p.homePoiId === poiId; })
    .map((e) => e.id)
    .sort(byId);
}

/** Which post the `i`-th man of `n` takes, on a ring offering `stationCount` posts: the men spread
 *  evenly around the whole circuit (centred in their band) rather than bunching by the stair, so a
 *  thin garrison still reads as a watched wall. */
export function stationIndexFor(i: number, n: number, stationCount: number): number {
  if (stationCount <= 0) return 0;
  const idx = Math.floor(((i + 0.5) * stationCount) / Math.max(1, n));
  return Math.max(0, Math.min(stationCount - 1, idx));
}

// ── The phase machine ───────────────────────────────────────────────────────────────────────

/** Tiles per second climbing the mural stair — slower than open ground, it is a stone flight. */
export const GARRISON_CLIMB_SPEED = 0.8;
/** Tiles per second along the wall-walk — a measured pace behind the parapet, not a jog. */
export const GARRISON_WALL_SPEED = 1.0;
/** How close to the flight's bottom step counts as "at the stair" (tiles). */
export const STAIR_ARRIVAL = 0.75;

/** `stationIdx` sentinel: this man is not heading for a post, he is heading for the stair head to
 *  come down. A `walk` with this index ends in `descend`, never `stationed`. */
export const GARRISON_STAND_DOWN_IDX = -1;

/** Drop every trace of a posting: the man is on the ground and an ordinary NPC again. */
export function clearGarrison(p: NpcProperties): void {
  delete p.garrison;
  delete p.wallZ;
  p.currentPath = undefined;
  p.pathIndex = -1;
}

/** Order a posted man off the wall, from wherever the order finds him. Below the allure he simply
 *  stops being a garrison member; above it he walks back to the stair head and climbs down. */
export function orderStandDown(p: NpcProperties): void {
  const g = p.garrison;
  if (!g) return;
  if (g.phase === 'to_stair') { clearGarrison(p); return; }   // never left the ground
  if (g.phase === 'climb') { g.phase = 'descend'; return; }   // turn round on the steps
  if (g.phase === 'descend') return;                          // already coming down
  g.phase = 'walk';
  g.stationIdx = GARRISON_STAND_DOWN_IDX;
}

/** Signed arc-distance from `t` to `to` along the run, taking the shorter way round a closed ring. */
function arcDelta(geo: RingGarrisonGeometry, t: number, to: number): number {
  let d = to - t;
  if (geo.closed && geo.total > 0) {
    while (d > geo.total / 2) d -= geo.total;
    while (d < -geo.total / 2) d += geo.total;
  }
  return d;
}

/** Keep an arc coordinate inside `[0, total)` on a closed ring; clamp it on an open run. */
function wrapT(geo: RingGarrisonGeometry, t: number): number {
  if (geo.total <= 0) return 0;
  if (!geo.closed) return Math.max(0, Math.min(geo.total, t));
  const m = t % geo.total;
  return m < 0 ? m + geo.total : m;
}

/** Move the entity through the World's dual index (spatial + kind + tag), never by touching
 *  `e.x`/`e.y` — `World.updateEntity` de-indexes from the OLD position first, so a direct write
 *  before the call would corrupt the spatial index. */
function moveTo(world: World, e: Entity, x: number, y: number): void {
  if (e.x === x && e.y === y) return;
  world.updateEntity(e.id, { x, y });
}

/**
 * Advance ONE garrisoning NPC for `dtMs`. Called from the 60 Hz movement tick, which branches
 * here early (like the forced-animation path) before any tile pathfinding runs.
 *
 * Returns TRUE when this function moved (or held) the NPC itself — the caller must then skip
 * ordinary movement entirely. Returns FALSE for the `to_stair` approach, which IS ordinary ground
 * pathfinding: the machine only points `activityTarget` at the flight's bottom step and lets the
 * normal walker do the walking. It also returns false after releasing an NPC whose ring or stair
 * has gone (a scrub, a rolled-back castle foundation), so the man simply resumes civilian life.
 */
export function stepGarrisonMovement(
  world: World, map: GameMap, e: Entity, p: NpcProperties, dtMs: number,
): boolean {
  const g = p.garrison;
  if (!g) return false;
  const placed = (map.barrierRuns ?? []).find((b) => b.id === g.barrierId);
  if (!placed) { clearGarrison(p); return false; }
  const geo = ringGarrisonGeometry(placed.run);
  const climb = geo.climb;
  if (!climb || geo.stations.length === 0) { clearGarrison(p); return false; }

  const dt = dtMs / 1000;
  const [bx, by] = climb.bottom;
  const [tx, ty] = climb.top;

  switch (g.phase) {
    case 'to_stair': {
      const tile = { x: Math.floor(bx), y: Math.floor(by) };
      if (Math.hypot(e.x - (tile.x + 0.5), e.y - (tile.y + 0.5)) <= STAIR_ARRIVAL) {
        g.phase = 'climb';
        g.t = 0;
        p.currentPath = undefined;
        p.pathIndex = -1;
        p.activityTargetX = undefined;
        p.activityTargetY = undefined;
        p.wallZ = 0;
        return true;
      }
      // Re-assert the destination every tick so the activity system cannot pull a posted man off
      // his way to the wall; the ordinary walker then paths him there over walkable ground.
      p.activityTargetX = tile.x;
      p.activityTargetY = tile.y;
      delete p.wallZ;
      return false;
    }

    case 'climb': {
      g.t = Math.min(1, g.t + (GARRISON_CLIMB_SPEED * dt) / geo.flightLen);
      moveTo(world, e, bx + (tx - bx) * g.t, by + (ty - by) * g.t);
      p.wallZ = climb.walkZ * g.t;
      p.direction = directionFromDelta(tx - bx, ty - by);
      animateWalking(p, dtMs);
      if (g.t >= 1) {
        g.phase = 'walk';
        g.t = wrapT(geo, climb.topT);
        p.wallZ = climb.walkZ;
      }
      return true;
    }

    case 'walk': {
      const standDown = g.stationIdx === GARRISON_STAND_DOWN_IDX;
      const idx = Math.max(0, Math.min(geo.stations.length - 1, g.stationIdx));
      const targetT = standDown ? wrapT(geo, climb.topT) : geo.stations[idx].t;
      const d = arcDelta(geo, g.t, targetT);
      const step = GARRISON_WALL_SPEED * dt;
      if (Math.abs(d) <= step) {
        g.t = targetT;
        if (standDown) {
          g.phase = 'descend';
          g.t = 1;                                   // re-read as the flight parameter
          moveTo(world, e, tx, ty);
          p.wallZ = climb.walkZ;
        } else {
          const st = geo.stations[idx];
          g.phase = 'stationed';
          moveTo(world, e, st.x, st.y);
          p.wallZ = st.walkZ;
          p.direction = directionFromDelta(st.outward[0], st.outward[1]);
        }
        return true;
      }
      const prev: Pt = arcLengthPoint(placed.run, g.t);
      g.t = wrapT(geo, g.t + Math.sign(d) * step);
      const next: Pt = arcLengthPoint(placed.run, g.t);
      moveTo(world, e, next[0], next[1]);
      p.wallZ = climb.walkZ;
      p.direction = directionFromDelta(next[0] - prev[0], next[1] - prev[1]);
      animateWalking(p, dtMs);
      return true;
    }

    case 'stationed': {
      const st = geo.stations[Math.max(0, Math.min(geo.stations.length - 1, g.stationIdx))];
      moveTo(world, e, st.x, st.y);
      p.wallZ = st.walkZ;
      p.direction = directionFromDelta(st.outward[0], st.outward[1]);
      animateStationary(p, dtMs);
      return true;
    }

    case 'descend': {
      g.t = Math.max(0, g.t - (GARRISON_CLIMB_SPEED * dt) / geo.flightLen);
      moveTo(world, e, bx + (tx - bx) * g.t, by + (ty - by) * g.t);
      p.direction = directionFromDelta(bx - tx, by - ty);
      animateWalking(p, dtMs);
      if (g.t <= 0) { clearGarrison(p); return true; }
      p.wallZ = climb.walkZ * g.t;
      return true;
    }
  }
}

// ── Orders (W3 — the command-reachable half) ────────────────────────────────────────────────

/** Plain structured-clone-friendly snapshot of `GarrisonOrders`. */
export interface GarrisonOrdersSnapshot {
  standing: string[];
  mustered: string[];
}

/**
 * `GarrisonOrders` — the settlement-keyed ledger of standing muster orders + which garrisons are
 * currently up. Rides `GameState.garrisonOrders` and mirrors `ContentionLedger`
 * (`@/sim/rival-contention`) exactly — serialize/hydrate/`fromSnapshot`, no `SAVE_VERSION` bump,
 * an absent snapshot field hydrates to empty. `GarrisonSystem` reads and writes it through an
 * injected getter (never holds the instance itself), so `muster_garrison`/`stand_down_garrison`
 * (which receive `ctx.state`, never a live system) can reach the same store.
 *
 * Two bits, both genuinely NOT derivable from the rest of the sim:
 *   • `standing` — a standing muster order (`muster_garrison`/`stand_down_garrison`). A fact
 *     about what was COMMANDED, not about the world.
 *   • `mustered` — which garrisons are currently up. HYSTERESIS state (a town sitting at
 *     `tension` is mustered iff it was mustered when it got there) — a snapshot without it
 *     inherits the discarded timeline's muster.
 * Everything else — membership, station assignments, the ring↔settlement pairing — is REDERIVED
 * every tick from live NPCs and the map (`GarrisonSystem.tick`) and never rides here.
 */
export class GarrisonOrders {
  private standing = new Set<string>();
  private mustered = new Set<string>();

  /** Raise or release a STANDING muster order for a settlement. A standing order holds the walls
   *  manned whatever the contention ladder says; releasing it hands the decision back to the
   *  ladder (so a town still at `holy_war` stays manned, and a calm one comes down). */
  setStandingOrder(poiId: string, on: boolean): void {
    if (on) this.standing.add(poiId); else this.standing.delete(poiId);
  }

  hasStandingOrder(poiId: string): boolean {
    return this.standing.has(poiId);
  }

  /** True while this settlement's walls are being held. */
  isMustered(poiId: string): boolean {
    return this.mustered.has(poiId);
  }

  /** `GarrisonSystem.tick`'s write side of the hysteresis bit — never called from a command. */
  setMustered(poiId: string, on: boolean): void {
    if (on) this.mustered.add(poiId); else this.mustered.delete(poiId);
  }

  /** Forget muster state for settlements no longer in `livePoiIds` (no garrisonable ring this
   *  tick), so a razed — or scrubbed-away — wall cannot resurrect its garrison if one is ever
   *  rebuilt. Standing orders are left alone: an order is a fact about what was commanded, and a
   *  rebuilt ring should honour it again. */
  pruneMusteredExcept(livePoiIds: ReadonlySet<string>): void {
    for (const poiId of [...this.mustered]) if (!livePoiIds.has(poiId)) this.mustered.delete(poiId);
  }

  serialize(): GarrisonOrdersSnapshot {
    return { standing: [...this.standing].sort(byId), mustered: [...this.mustered].sort(byId) };
  }

  hydrate(snap: GarrisonOrdersSnapshot): void {
    this.standing = new Set(structuredClone(snap.standing ?? []));
    this.mustered = new Set(structuredClone(snap.mustered ?? []));
  }

  static fromSnapshot(snap: GarrisonOrdersSnapshot): GarrisonOrders {
    const o = new GarrisonOrders();
    o.hydrate(snap);
    return o;
  }
}
