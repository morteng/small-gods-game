// src/sim/garrison.ts
// MANNING THE WALLS (W1) — the pure half of the garrison: the roster shape, the ring geometry a
// garrison is derived against, and the phase machine that walks a soldier from his door to a post
// between the merlons and back down again.
//
// TWO pieces of state, deliberately split:
//   • the ROSTER (`GarrisonRoster`) — ONE settlement-keyed object owned by `GarrisonSystem`:
//     which ring, which men, mustered or not. Membership and orders live HERE, never scattered
//     across NPCs. This is a proto-`Group`: phase 2 of the tactical-behaviour track
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
import type { Entity, GameMap, NpcProperties, NpcId } from '@/core/types';
import type { World } from '@/world/world';
import { pathLength, type BarrierRun } from '@/world/barrier';
import {
  arcLengthPoint, stairClimbOf, wallStations, type WallStationPosition,
} from '@/world/tactical-positions';
import { animateStationary, animateWalking, directionFromDelta } from '@/sim/npc-pose';

type Pt = [number, number];

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
