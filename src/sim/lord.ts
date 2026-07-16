/**
 * lord.ts — mortal power M3: the lord (mortal-power spec, 2026-07-14).
 *
 * A lord is a `kind: 'npc'`, `role: 'noble'` mortal holding a settlement-scoped
 * seat (`LordState`, stored on `World.lords`, snapshot-captured like
 * `activeEvents`). He is a NEED-SATISFIER and an EXTRACTOR, never a god:
 *
 * ⛔ **A lord NEVER gets a `beliefs[]` entry** (brainstorm §6: a mortal in the
 * belief table invents a fifth category of god and hands him divine power
 * regen). He competes for ALLEGIANCE — by removing or manufacturing the crises
 * that make believers — and fights the player only by PROXY, endowing a shrine
 * that grants a rival territorial presence (`ai.settlements` →
 * `isRivalPresent()` → prayer claiming, machinery that already ships).
 *
 * Everything here is pure + deterministic (no rng at all — selection is an
 * argmin, the economy is relaxation arithmetic). The hourly driver is
 * `LordSystem` (`src/sim/systems/lord-system.ts`); the Fate coaching lever is
 * the `set_lord_stance` verb (command registry / fate-tools).
 */
import type { World } from '@/world/world';
import type { Entity, EntityId } from '@/core/types';
import type { SettlementCohorts } from '@/sim/cohorts';
import { cohortPopulation } from '@/sim/cohorts';
import { forEachNpc, npcProps } from '@/world/npc-helpers';
import { clamp01 } from '@/sim/npc-sim';
import { prayerAge, PRAYER_CLAIM_WARNING_TICKS } from '@/sim/rival-claims';

/** The lord's seat at one settlement. Plain data — rides the snapshot via
 *  `World.lords` (captured/restored like `activeEvents`), so a scrub un-seats
 *  a lord who rose after the restore point. */
export interface LordState {
  /** The noble who holds the seat. */
  npcId: EntityId;
  /** The holder's lineage — succession prefers this house ("dynasty is free"). */
  lineageId: EntityId;
  /** Extraction rate, 0…1. Scales down the `work` self-restore (M0.c model (c):
   *  "you work as hard and you get less") and presses the statistical tier's
   *  prosperity mean toward the same tithed equilibrium. */
  tithe: number;
  /** Soldiers resident in the settlement — recomputed hourly (derived truth;
   *  M5 gives them patrols, today it is an honest headcount). */
  garrison: number;
  /** 0…1, integrates extraction pressure: relaxes toward the tithe each game
   *  hour. Sim history — persisted, not derivable from current state. */
  unrest: number;
  /** Keep ladder rung. Always 0 until M4 (castles are blocked on the runtime-POI
   *  question); kept in the state shape so saves need no migration then. */
  keepTier: number;
}

/** A fresh seat starts at a customary mild extraction — Fate coaches it up
 *  (want breeds prayer) or down (the land breathes) via `set_lord_stance`. */
export const DEFAULT_TITHE = 0.1;

/** Per-game-hour relaxation of `unrest` toward the tithe rate. ~0.02/hour ⇒ a
 *  tithe jump is ~62% absorbed into unrest after two fiction days. */
export const UNREST_RELAX_PER_HOUR = 0.02;

export function makeLordState(lord: Entity): LordState {
  const p = npcProps(lord);
  return { npcId: lord.id, lineageId: p.lineageId, tithe: DEFAULT_TITHE, garrison: 0, unrest: 0, keepTier: 0 };
}

/** Eldest-first, id-tiebreak — the deterministic seniority order every
 *  selection below uses. */
function byEldest(a: Entity, b: Entity): number {
  const d = npcProps(a).birthTick - npcProps(b).birthTick;
  if (d !== 0) return d;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The living nobles homed at `poiId`, eldest first. */
export function noblesOf(world: World, poiId: string): Entity[] {
  const out: Entity[] = [];
  forEachNpc(world, (e) => {
    const p = npcProps(e);
    if (p.role === 'noble' && p.homePoiId === poiId) out.push(e);
  });
  out.sort(byEldest);
  return out;
}

/** Who takes (or founds) the seat at `poiId`: the eldest living resident noble,
 *  or null when the settlement has none (no noble, no lord — the seat can not
 *  exist). `lineageId` (a vacated seat's house) is preferred first, so a lord's
 *  death passes the seat within the dynasty while the line lasts. */
export function selectLord(world: World, poiId: string, lineageId?: EntityId): Entity | null {
  const nobles = noblesOf(world, poiId);
  if (nobles.length === 0) return null;
  if (lineageId) {
    const heir = nobles.find((e) => npcProps(e).lineageId === lineageId);
    if (heir) return heir;
  }
  return nobles[0];
}

/** The settlement's current tithe rate — 0 when it has no seated lord. This is
 *  the ONE read the activity system's M0.c scaling makes per work completion. */
export function titheRateFor(world: World, poiId: string | undefined): number {
  if (!poiId) return 0;
  const seat = world.lords.get(poiId);
  return seat ? clamp01(seat.tithe) : 0;
}

/** M0.c, recommended model (c): the tithe scales the `work` self-restore —
 *  you work as hard and you get less. No lord ⇒ 1 (the pre-M3 economy,
 *  bit-for-bit). */
export function workRestoreScale(tithe: number): number {
  return 1 - clamp01(tithe);
}

// ── the situation (buildRivalSituation → buildLordSituation, same pattern) ───

/** What a lord's rule looks like from the outside — pure, deterministic, plain
 *  counts/means (snapshots trivially, prompts cheaply). BOTH population tiers
 *  are counted: named residents AND the statistical cohorts, per the spec's
 *  cohort double-accounting warning. */
export interface LordSituation {
  poiId: string;
  /** Living named residents. */
  namedPopulation: number;
  /** Statistical-tier souls (0 when the settlement has no cohort record). */
  statPopulation: number;
  /** Mean prosperity over the named residents (0 when none). */
  meanProsperityNamed: number;
  /** Population-weighted mean prosperity over the statistical bands (0 when empty). */
  meanProsperityStat: number;
  /** Standing pleas old enough to be at risk (age ≥ PRAYER_CLAIM_WARNING_TICKS). */
  prayerPressure: number;
  tithe: number;
  unrest: number;
  garrison: number;
}

export function buildLordSituation(
  world: World,
  cohorts: ReadonlyMap<string, SettlementCohorts> | null | undefined,
  poiId: string,
  seat: LordState,
  now: number,
): LordSituation {
  let named = 0;
  let prosperitySum = 0;
  let pressure = 0;
  forEachNpc(world, (e) => {
    const p = npcProps(e);
    if (p.homePoiId !== poiId) return;
    named++;
    prosperitySum += p.needs.prosperity;
    if (p.prayerSince !== undefined && prayerAge(p, now) >= PRAYER_CLAIM_WARNING_TICKS) pressure++;
  });
  const sc = cohorts?.get(poiId);
  let statPop = 0;
  let statProsperity = 0;
  if (sc) {
    statPop = cohortPopulation(sc);
    if (statPop > 0) {
      let sum = 0;
      for (const band of sc.bands) sum += band.needs.prosperity * band.count;
      statProsperity = sum / statPop;
    }
  }
  return {
    poiId,
    namedPopulation: named,
    statPopulation: statPop,
    meanProsperityNamed: named > 0 ? prosperitySum / named : 0,
    meanProsperityStat: statProsperity,
    prayerPressure: pressure,
    tithe: seat.tithe,
    unrest: seat.unrest,
    garrison: seat.garrison,
  };
}
