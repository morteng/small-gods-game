/**
 * LordSystem — mortal power M3: seats, succession, and the tithe economy.
 *
 * One fire per GAME HOUR (the day-keyed lifecycle cadence of Mortality/Birth/
 * Cohorts). Each fire, in deterministic (sorted) order:
 *
 *  1. SUCCESSION — a seat whose holder died or left passes to a living resident
 *     noble of the same lineage ("dynasty is free": lineageId already groups by
 *     root ancestor), else to the eldest resident noble, else it LAPSES (the
 *     seat is deleted; a later noble refounds it).
 *  2. ATTACHMENT — every settlement with a resident noble and no seat gets one:
 *     the eldest noble rises (`lord_risen`).
 *  3. ECONOMY — per seat: the garrison headcount is recomputed (derived truth),
 *     a lapsed Peace of God is reaped (`peace_lapsed`) and a sworn seat-holder
 *     is held to his oath's tithe cap (M6),
 *     `unrest` relaxes toward the tithe rate, and the tithe is pressed onto the
 *     STATISTICAL tier (`applyCohortTithe`) so both population tiers feel the
 *     extraction (the spec's cohort double-accounting warning). The NAMED tier
 *     feels it in NpcActivitySystem: the `work` self-restore is scaled by
 *     `workRestoreScale(tithe)` — M0.c model (c), "you work as hard and you
 *     get less".
 *
 * No rng anywhere — selection is an argmin, the economy is relaxation
 * arithmetic. LordState rides the snapshot on `World.lords`.
 */
import type { System, SystemContext } from '@/core/scheduler';
import type { Entity } from '@/core/types';
import type { SettlementCohorts } from '@/sim/cohorts';
import { GAME_HOUR_HZ } from '@/core/calendar';
import { forEachNpc, npcProps } from '@/world/npc-helpers';
import { applyCohortTithe } from '@/sim/cohorts';
import { clamp01 } from '@/sim/npc-sim';
import { makeLordState, selectLord, boundTitheCap, UNREST_RELAX_PER_HOUR } from '@/sim/lord';

/** Per-game-hour relaxation of the statistical tier's prosperity mean toward
 *  the tithed equilibrium (see `applyCohortTithe`). Same time constant as
 *  unrest — the crowd and the mood move together. */
export const COHORT_TITHE_RELAX_PER_HOUR = 0.02;

export class LordSystem implements System {
  readonly name = 'lords';
  readonly tickHz = GAME_HOUR_HZ;

  constructor(
    private readonly getCohorts?: () => ReadonlyMap<string, SettlementCohorts> | null | undefined,
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
        world.lords.delete(poiId);   // the line is spent; the seat lapses
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

    // 3. The economy of every seat (sorted — replay-stable float folds).
    const cohorts = this.getCohorts?.();
    for (const poiId of [...world.lords.keys()].sort()) {
      const seat = world.lords.get(poiId)!;
      seat.garrison = soldiers.get(poiId) ?? 0;
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
      seat.unrest = clamp01(seat.unrest + (clamp01(seat.tithe) - seat.unrest) * UNREST_RELAX_PER_HOUR);
      const sc = cohorts?.get(poiId);
      if (sc) applyCohortTithe(sc, seat.tithe, COHORT_TITHE_RELAX_PER_HOUR);
    }
  }
}
