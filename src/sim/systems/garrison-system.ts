// src/sim/systems/garrison-system.ts
/**
 * GarrisonSystem — MANNING THE WALLS (W1, orders extended onto `GameState` in W3).
 *
 * A settlement whose contention has reached `schism` (or whose lord has a standing muster order)
 * puts its resident soldiers on the wall-walk: up the mural stair, along the allure, standing
 * between the merlons facing the field. It stands them down again when the town goes `calm`.
 *
 * WHAT LIVES WHERE — this is the shape phase 2's first-class `Group` retrofits onto:
 *   • the ROSTER (`GarrisonRoster`, one per settlement) is owned HERE: which ring, which men,
 *     mustered or not. Membership is NEVER scattered across NPCs.
 *   • the per-NPC `p.garrison` carries ONLY the transient phase-machine scratch (phase / station /
 *     progress), driven at 60 Hz by `stepGarrisonMovement` out of `npc-movement.ts`.
 *   • the ORDERS (standing muster orders + the muster hysteresis side) live on
 *     `GameState.garrisonOrders` (`GarrisonOrders`, `@/sim/garrison`) — NOT here. W3's
 *     `muster_garrison`/`stand_down_garrison` verbs receive `ctx.state`/`ctx.world`, never a live
 *     system instance, so the command-reachable state has to sit where a command can reach it —
 *     mirroring `ContentionLedger`/`state.contention` exactly. This system reads and writes that
 *     store through an injected getter, same as it already does for `state.contention`.
 *
 * Membership, station assignments, and the ring↔settlement pairing are all REDERIVED every tick
 * from live NPCs and the map (never persisted), because a member can die, be rehomed by
 * `found_castle`, or fold back into the statistical tier between two ticks.
 *
 * Deterministic and `Math.random`-free: it draws no RNG at all (rosters are id-sorted, stations
 * are a pure spread), so replay from a seed reproduces the same men at the same posts.
 */
import type { System, SystemContext } from '@/core/scheduler';
import type { NpcId } from '@/core/types';
import { getNpc, npcProps, queryNpcs } from '@/world/npc-helpers';
import { stateRank, type ContentionLedger } from '@/sim/rival-contention';
import {
  GARRISON_RING_CAP, GARRISON_STAND_DOWN_IDX, garrisonableRings, orderStandDown, residentSoldiers,
  ringGarrisonGeometry, stationIndexFor, type GarrisonOrders, type GarrisonRoster,
} from '@/sim/garrison';

/** The rung at which the walls go up on their own. At/above this the garrison musters; at `calm`
 *  it stands down; `tension` in between HOLDS whichever side it was on — the ladder's own on/off
 *  bands already supply the hysteresis, and a second one here would only fight it. */
const MUSTER_RANK = stateRank('schism');

export class GarrisonSystem implements System {
  readonly name = 'garrison';
  /** Low Hz on purpose: mustering is an ORDER, not a motion. The 60 Hz movement tick does the
   *  walking; this only decides who is posted where, twice a sim second. */
  readonly tickHz = 0.5;

  /** Live rosters, keyed by settlement POI id. Rebuilt every tick — never persisted. */
  private rosters = new Map<string, GarrisonRoster>();

  constructor(
    private readonly getContention: () => ContentionLedger,
    private readonly getOrders: () => GarrisonOrders,
  ) {}

  // ── Order surface (W3's verbs are a thin call onto the GarrisonOrders store) ─────────────

  /** Raise or release a STANDING muster order for a settlement. A standing order holds the walls
   *  manned whatever the contention ladder says; releasing it hands the decision back to the
   *  ladder (so a town still at `holy_war` stays manned, and a calm one comes down). */
  setStandingOrder(poiId: string, on: boolean): void {
    this.getOrders().setStandingOrder(poiId, on);
  }

  hasStandingOrder(poiId: string): boolean {
    return this.getOrders().hasStandingOrder(poiId);
  }

  /** True while this settlement's walls are being held. */
  isMustered(poiId: string): boolean {
    return this.getOrders().isMustered(poiId);
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
    const orders = this.getOrders();
    const rings = garrisonableRings(map);
    const rosters = new Map<string, GarrisonRoster>();
    /** Everyone accounted for by a live posting this tick; anyone else carrying garrison state
     *  (dead ring, rehomed, over cap, stood down) is ordered off the wall below. */
    const posted = new Set<NpcId>();

    for (const [poiId, ring] of rings) {
      const standingOrder = orders.hasStandingOrder(poiId);
      const contention = ledger.stateOf(poiId);
      const wasMustered = orders.isMustered(poiId);
      let mustered = wasMustered;
      if (standingOrder || stateRank(contention) >= MUSTER_RANK) mustered = true;
      else if (contention === 'calm') mustered = false;
      orders.setMustered(poiId, mustered);
      // The OBSERVABLE half (W3): log the muster/stand-down EDGE only — never every tick — so
      // the divine inbox can surface ONE coalesced "the walls of X are manned" tiding regardless
      // of whether the ladder or a standing order triggered it.
      if (mustered !== wasMustered) {
        ctx.log.append(mustered ? { type: 'garrison_mustered', poiId } : { type: 'garrison_stood_down', poiId });
      }

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
    orders.pruneMusteredExcept(new Set(rosters.keys()));
  }
}
