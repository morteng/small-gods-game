/**
 * LordSystem — mortal power M3: seats, succession, and the tithe economy.
 * M5 adds the KNIGHT layer: dominion links + grip transitions — the castle's
 * garrison carries the extraction back to the settlement that raised it.
 *
 * One fire per GAME HOUR (the day-keyed lifecycle cadence of Mortality/Birth/
 * Cohorts). Each fire, in deterministic (sorted) order:
 *
 *  1. SUCCESSION — a seat whose holder died or left passes to a living resident
 *     noble of the same lineage ("dynasty is free": lineageId already groups by
 *     root ancestor), else to the eldest resident noble, else it LAPSES (the
 *     seat is deleted; a later noble refounds it). A lapsing castle seat that
 *     held a settlement in its grip logs `grip_broken` — the line is spent and
 *     the knights answer to nobody.
 *  2. ATTACHMENT — every settlement with a resident noble and no seat gets one:
 *     the eldest noble rises (`lord_risen`).
 *  3. DOMINION (M5) — the links (gripped settlement → castle) are re-derived
 *     from runtime-POI provenance (`rebuildDominions`), garrisons are
 *     recomputed for every seat, and each link's ACTIVE state (seated lord +
 *     garrison > 0) is diffed against the castle seat's `gripsPoiId` memory:
 *     transitions log `grip_taken` / `grip_broken`.
 *  4. ECONOMY — per seat: a lapsed Peace of God is reaped (`peace_lapsed`) and
 *     a sworn seat-holder is held to his oath's tithe cap (M6), `unrest`
 *     relaxes toward the settlement's EFFECTIVE tithe (own seat OR a gripping
 *     castle's — `titheRateFor`), and that same effective rate is pressed onto
 *     the STATISTICAL tier (`applyCohortTithe`). Gripped settlements WITHOUT a
 *     local seat get the cohort press too — both population tiers feel the
 *     knights (the spec's cohort double-accounting warning; the NAMED tier
 *     feels them through `titheRateFor` in NpcActivitySystem's work restore).
 *
 * No rng anywhere — selection is an argmin, the economy is relaxation
 * arithmetic. LordState (incl. `gripsPoiId`) rides the snapshot on
 * `World.lords`; `world.dominions` is derived and rebuilt here + on restore.
 */
import type { System, SystemContext } from '@/core/scheduler';
import type { Entity } from '@/core/types';
import type { SettlementCohorts } from '@/sim/cohorts';
import type { RuntimePoiStore } from '@/world/runtime-poi';
import { rebuildDominions } from '@/world/runtime-poi';
import { GAME_HOUR_HZ } from '@/core/calendar';
import { forEachNpc, npcProps } from '@/world/npc-helpers';
import { applyCohortTithe } from '@/sim/cohorts';
import { clamp01 } from '@/sim/npc-sim';
import { makeLordState, selectLord, boundTitheCap, titheRateFor, UNREST_RELAX_PER_HOUR } from '@/sim/lord';

/** Per-game-hour relaxation of the statistical tier's prosperity mean toward
 *  the tithed equilibrium (see `applyCohortTithe`). Same time constant as
 *  unrest — the crowd and the mood move together. */
export const COHORT_TITHE_RELAX_PER_HOUR = 0.02;

export class LordSystem implements System {
  readonly name = 'lords';
  readonly tickHz = GAME_HOUR_HZ;

  constructor(
    private readonly getCohorts?: () => ReadonlyMap<string, SettlementCohorts> | null | undefined,
    private readonly getRuntimePois?: () => RuntimePoiStore | null | undefined,
  ) {}

  tick(ctx: SystemContext): void {
    const world = ctx.world;

    // One pass over the living: which settlements have nobles / how many soldiers.
    const noblePois = new Set<string>();
    const soldiers = new Map<string, number>();
    const living = new Map<string, Entity>();
    forEachNpc(world, (e) => {
      const p = npcProps(e);
      living.set(e.id, e);
      if (!p.homePoiId) return;
      if (p.role === 'noble') noblePois.add(p.homePoiId);
      else if (p.role === 'soldier') soldiers.set(p.homePoiId, (soldiers.get(p.homePoiId) ?? 0) + 1);
    });

    // 1. Succession / lapse over the existing seats (sorted — replay-stable).
    for (const poiId of [...world.lords.keys()].sort()) {
      const seat = world.lords.get(poiId)!;
      const holder = living.get(seat.npcId);
      if (holder && npcProps(holder).role === 'noble' && npcProps(holder).homePoiId === poiId) continue;
      const heir = selectLord(world, poiId, seat.lineageId);
      if (heir) {
        seat.npcId = heir.id;
        seat.lineageId = npcProps(heir).lineageId;
        ctx.log.append({ type: 'lord_risen', poiId, npcId: heir.id, lineageId: seat.lineageId, succession: true });
      } else {
        // The line is spent; the seat lapses — and a castle seat's grip dies
        // with it (M5): the knights hold nothing for a lord who isn't there.
        if (seat.gripsPoiId) {
          ctx.log.append({ type: 'grip_broken', castlePoiId: poiId, poiId: seat.gripsPoiId });
        }
        world.lords.delete(poiId);
      }
    }

    // 2. Attachment: a settlement with nobles and no seat crowns its eldest.
    for (const poiId of [...noblePois].sort()) {
      if (world.lords.has(poiId)) continue;
      const lord = selectLord(world, poiId);
      if (!lord) continue;   // cannot happen (noblePois came from the same pass); belt-and-braces
      const seat = makeLordState(lord);
      world.lords.set(poiId, seat);
      ctx.log.append({ type: 'lord_risen', poiId, npcId: lord.id, lineageId: seat.lineageId, succession: false });
    }

    // 3. Dominion (M5): re-derive the links, refresh every garrison headcount
    //    (derived truth — grips and effective tithes read it), then diff each
    //    link's ACTIVE state against the castle seat's grip memory.
    rebuildDominions(world.dominions, this.getRuntimePois?.());
    for (const poiId of [...world.lords.keys()].sort()) {
      world.lords.get(poiId)!.garrison = soldiers.get(poiId) ?? 0;
    }
    for (const [gripped, castleId] of [...world.dominions].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const seat = world.lords.get(castleId);
      if (!seat) continue;                       // vacant castle: a lapse logged its break above
      const active = seat.garrison > 0;
      if (active && seat.gripsPoiId !== gripped) {
        seat.gripsPoiId = gripped;
        ctx.log.append({ type: 'grip_taken', castlePoiId: castleId, poiId: gripped, garrison: seat.garrison });
      } else if (!active && seat.gripsPoiId !== undefined) {
        delete seat.gripsPoiId;
        ctx.log.append({ type: 'grip_broken', castlePoiId: castleId, poiId: gripped });
      }
    }

    // 4. The economy of every seat (sorted — replay-stable float folds).
    const cohorts = this.getCohorts?.();
    for (const poiId of [...world.lords.keys()].sort()) {
      const seat = world.lords.get(poiId)!;
      // M6 — the Peace of God: reap a lapsed oath (logged; the inbox surfaces it
      // as a tiding), then HOLD a sworn seat-holder to his oath's tithe cap — a
      // lord who creeps his extraction back up is bound here every hour. An
      // UNSWORN successor is not bound (dynasty passes the seat, not the oath).
      if (seat.peace && ctx.now >= seat.peace.untilTick) {
        ctx.log.append({ type: 'peace_lapsed', poiId, spiritId: seat.peace.spiritId });
        delete seat.peace;
      }
      const cap = boundTitheCap(seat, ctx.now);
      if (cap !== null && seat.tithe > cap) seat.tithe = cap;
      // M5: unrest + the statistical press both take the EFFECTIVE rate — what
      // this settlement actually loses, whether to its own lord or to the
      // knights of a gripping castle (never both: titheRateFor is a max).
      const effective = titheRateFor(world, poiId);
      seat.unrest = clamp01(seat.unrest + (effective - seat.unrest) * UNREST_RELAX_PER_HOUR);
      const sc = cohorts?.get(poiId);
      if (sc) applyCohortTithe(sc, effective, COHORT_TITHE_RELAX_PER_HOUR);
    }

    // 5. M5: gripped settlements with NO local seat still bleed — the knights
    //    carry the castle's tithe to their statistical tier too (the named
    //    tier reads titheRateFor per work completion, so it is already covered).
    for (const [gripped] of [...world.dominions].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (world.lords.has(gripped)) continue;    // pressed at the effective rate in 4.
      const effective = titheRateFor(world, gripped);
      if (effective <= 0) continue;
      const sc = cohorts?.get(gripped);
      if (sc) applyCohortTithe(sc, effective, COHORT_TITHE_RELAX_PER_HOUR);
    }
  }
}
