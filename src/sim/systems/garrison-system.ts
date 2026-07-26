// src/sim/systems/garrison-system.ts
/**
 * GarrisonSystem — MANNING THE WALLS (W1).
 *
 * A settlement whose contention has reached `schism` (or whose lord has a standing muster order)
 * puts its resident soldiers on the wall-walk: up the mural stair, along the allure, standing
 * between the merlons facing the field. It stands them down again when the town goes `calm`.
 *
 * WHAT LIVES WHERE — this is the shape phase 2's first-class `Group` retrofits onto:
 *   • the ROSTER (`GarrisonRoster`, one per settlement) is owned HERE: which ring, which men,
 *     mustered or not. Membership and orders are NEVER scattered across NPCs.
 *   • the per-NPC `p.garrison` carries ONLY the transient phase-machine scratch (phase / station /
 *     progress), driven at 60 Hz by `stepGarrisonMovement` out of `npc-movement.ts`.
 *
 * WHAT IS PERSISTED — as little as honesty allows (`SerializableSystem`, the WP-D snapshot seam,
 * so scrub / commit / save-load all restore it, and NO `GameState` field is added):
 *   • `standing`  — standing muster orders. Genuinely NOT derivable from anything else in the sim:
 *                   an order is a fact about what was commanded, not about the world.
 *   • `mustered`  — which garrisons are currently up. This is HYSTERESIS state (a town sitting at
 *                   `tension` is mustered iff it was mustered when it got there), exactly the
 *                   "threshold edge side" class of state `system-state.ts` exists for; a snapshot
 *                   without it inherits the discarded timeline's muster.
 * Everything else — membership, station assignments, the ring↔settlement pairing — is REDERIVED
 * every tick from live NPCs and the map, because a member can die, be rehomed by `found_castle`,
 * or fold back into the statistical tier between two ticks.
 *
 * Deterministic and `Math.random`-free: it draws no RNG at all (rosters are id-sorted, stations
 * are a pure spread), so replay from a seed reproduces the same men at the same posts.
 */
import type { System, SystemContext } from '@/core/scheduler';
import type { GameMap, NpcId, POI } from '@/core/types';
import type { SerializableSystem } from '@/core/system-state';
import type { World } from '@/world/world';
import type { PlacedBarrier } from '@/world/barrier';
import { getNpc, npcProps, queryNpcs } from '@/world/npc-helpers';
import { stateRank, type ContentionLedger } from '@/sim/rival-contention';
import {
  GARRISON_RING_CAP, GARRISON_STAND_DOWN_IDX, isGarrisonable, orderStandDown,
  ringGarrisonGeometry, stationIndexFor, type GarrisonRoster,
} from '@/sim/garrison';

/** The rung at which the walls go up on their own. At/above this the garrison musters; at `calm`
 *  it stands down; `tension` in between HOLDS whichever side it was on — the ladder's own on/off
 *  bands already supply the hysteresis, and a second one here would only fight it. */
const MUSTER_RANK = stateRank('schism');

/** Ordered lowest-id-first — the stable walk every roster/assignment decision is made in. */
function byId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Living resident soldiers of a settlement, lowest entity id first. */
function residentSoldiers(world: World, poiId: string): NpcId[] {
  return queryNpcs(world)
    .filter((e) => { const p = npcProps(e); return p.role === 'soldier' && p.homePoiId === poiId; })
    .map((e) => e.id)
    .sort(byId);
}

/** How far the ring reaches from its own centre — the radius inside which a settlement anchor is
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

export class GarrisonSystem implements System, SerializableSystem {
  readonly name = 'garrison';
  /** Low Hz on purpose: mustering is an ORDER, not a motion. The 60 Hz movement tick does the
   *  walking; this only decides who is posted where, twice a sim second. */
  readonly tickHz = 0.5;

  /** Live rosters, keyed by settlement POI id. Rebuilt every tick — never persisted. */
  private rosters = new Map<string, GarrisonRoster>();
  /** Standing muster orders (W3's `muster_garrison`). Persisted: not derivable. */
  private standing = new Set<string>();
  /** Which garrisons are currently up. Persisted: hysteresis state at `tension`. */
  private mustered = new Set<string>();

  constructor(private readonly getContention: () => ContentionLedger) {}

  // ── Order surface (W3's verbs are a thin call onto this) ─────────────────────────────────

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

  /** The settlement's garrison as of the last tick (undefined = no garrisonable ring). */
  rosterOf(poiId: string): GarrisonRoster | undefined {
    return this.rosters.get(poiId);
  }

  /** All live rosters (read-only view for tests / W3 previews / dev readouts). */
  allRosters(): ReadonlyMap<string, GarrisonRoster> {
    return this.rosters;
  }

  // ── Tick ─────────────────────────────────────────────────────────────────────────────────

  tick(ctx: SystemContext): void {
    const map = ctx.world.tiles;
    const ledger = this.getContention();
    const rings = this.garrisonableRings(map);
    const rosters = new Map<string, GarrisonRoster>();
    /** Everyone accounted for by a live posting this tick; anyone else carrying garrison state
     *  (dead ring, rehomed, over cap, stood down) is ordered off the wall below. */
    const posted = new Set<NpcId>();

    for (const [poiId, ring] of rings) {
      const standingOrder = this.standing.has(poiId);
      const contention = ledger.stateOf(poiId);
      let mustered = this.mustered.has(poiId);
      if (standingOrder || stateRank(contention) >= MUSTER_RANK) mustered = true;
      else if (contention === 'calm') mustered = false;
      if (mustered) this.mustered.add(poiId); else this.mustered.delete(poiId);

      const geo = ringGarrisonGeometry(ring.run);
      const cap = Math.min(GARRISON_RING_CAP, geo.stations.length);
      const members = mustered ? residentSoldiers(ctx.world, poiId).slice(0, cap) : [];

      for (let i = 0; i < members.length; i++) {
        const e = getNpc(ctx.world, members[i]);
        if (!e) continue;
        const p = npcProps(e);
        const stationIdx = stationIndexFor(i, members.length, geo.stations.length);
        const g = p.garrison;
        if (!g || g.barrierId !== ring.id) {
          // Fresh posting: out the door and across the town to the foot of the stair.
          p.garrison = { barrierId: ring.id, phase: 'to_stair', stationIdx, t: 0 };
        } else if (g.stationIdx === GARRISON_STAND_DOWN_IDX) {
          // Re-mustered on his way off the wall — turn him round for a post again.
          g.stationIdx = stationIdx;
          if (g.phase === 'descend') g.phase = 'climb';
        } else if (g.stationIdx !== stationIdx) {
          // The roster changed size under him: WALK to the new post (never teleport). His current
          // post's arc coordinate is where that walk starts.
          if (g.phase === 'stationed') {
            g.t = geo.stations[Math.min(g.stationIdx, geo.stations.length - 1)]?.t ?? g.t;
            g.phase = 'walk';
          }
          g.stationIdx = stationIdx;
        }
        posted.add(e.id);
      }

      rosters.set(poiId, {
        poiId, barrierId: ring.id, members, mustered, standingOrder,
        stationCount: geo.stations.length,
      });
    }

    // Anyone still carrying a posting who is no longer on a live roster comes down.
    for (const e of queryNpcs(ctx.world)) {
      const p = npcProps(e);
      if (p.garrison && !posted.has(e.id)) orderStandDown(p);
    }

    this.rosters = rosters;
    // Forget muster state for settlements that no longer have a garrisonable ring, so a razed
    // (or scrubbed-away) wall cannot resurrect its garrison if one is ever rebuilt.
    for (const poiId of [...this.mustered]) if (!rosters.has(poiId)) this.mustered.delete(poiId);
  }

  /** Ring per settlement: garrisonable rings only, one per POI (the ring offering the most posts
   *  wins; ties go to the lowest barrier id). Walked lowest-id-first so the pairing is stable. */
  private garrisonableRings(map: GameMap): Map<string, PlacedBarrier> {
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

  // ── Snapshot seam (WP-D) ──────────────────────────────────────────────────────────────────

  serialize(): unknown {
    return {
      standing: [...this.standing].sort(byId),
      mustered: [...this.mustered].sort(byId),
    };
  }

  hydrate(state: unknown): void {
    this.rosters = new Map();
    this.standing = new Set();
    this.mustered = new Set();
    const s = state as { standing?: unknown; mustered?: unknown } | undefined;
    if (!s) return;                       // old save / hand-built snapshot → a clean, unmustered world
    if (Array.isArray(s.standing)) for (const id of s.standing) if (typeof id === 'string') this.standing.add(id);
    if (Array.isArray(s.mustered)) for (const id of s.mustered) if (typeof id === 'string') this.mustered.add(id);
  }
}
