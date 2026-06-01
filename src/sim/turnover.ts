import type { Entity, NpcId, SpiritBelief } from '@/core/types';
import type { Rng } from '@/core/rng';
import { npcProps } from '@/world/npc-helpers';
import { ageInYears, rollDeathYear } from '@/sim/mortality';
import { DAYS_PER_YEAR } from '@/core/calendar';
import {
  FERTILE_MIN_AGE, FERTILE_MAX_AGE, POP_CAP_PER_POI, BIRTH_RATE_PER_PAIR,
} from '@/sim/systems/birth-system';
import { INHERIT_FAITH_FRAC, INHERIT_UNDERSTANDING_FRAC } from '@/world/npc-lifecycle';

/**
 * Annual per-pair birth chance for the once-per-year projection roll. Derived
 * LINEARLY from the per-day system rate, which matches the live `BirthSystem`'s
 * *expected birth count* per pair-year (DAYS_PER_YEAR daily rolls of
 * BIRTH_RATE_PER_PAIR ≈ 0.288 expected births). Note this is NOT the same as
 * P(at least one birth) under daily compounding (1-(1-rate)^DAYS_PER_YEAR ≈ 0.25);
 * the projection rolls a single Bernoulli/pair/year so it cannot yield 2+ births
 * in one year the way the daily system can. D2 should revisit this calibration if
 * the time-skip's population trajectory needs to track real-time play exactly.
 */
export const BIRTH_RATE_PER_PAIR_YEAR = BIRTH_RATE_PER_PAIR * DAYS_PER_YEAR;

export interface ProjectedDeath {
  id: NpcId;
  deathYearOffset: number;
  cause: string;
}

export interface SynthChild {
  id: NpcId;
  parentIds: NpcId[];
  lineageId: NpcId;
  birthYearOffset: number;
  beliefs: Record<string, SpiritBelief>;
}

/** A soul considered by the projection (input NPC or a synthesized child). */
interface Soul {
  id: NpcId;
  lineageId: NpcId;
  /** Age in years at offset 0 of the projection window. */
  baseAge: number;
  /** Year-offset this soul appears (0 for inputs). */
  bornAt: number;
  /** Year-offset this soul dies, or Infinity if it survives the window. */
  diesAt: number;
  beliefs: Record<string, SpiritBelief>;
  homePoiId?: string;
}

function diluteBeliefs(
  a: Record<string, SpiritBelief>, b: Record<string, SpiritBelief>,
): Record<string, SpiritBelief> {
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const out: Record<string, SpiritBelief> = {};
  const ids = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  for (const sid of ids) {
    const fa = a[sid]?.faith ?? 0, fb = b[sid]?.faith ?? 0;
    const ua = a[sid]?.understanding ?? 0, ub = b[sid]?.understanding ?? 0;
    out[sid] = {
      faith:         clamp01(INHERIT_FAITH_FRAC * ((fa + fb) / 2)),
      understanding: clamp01(INHERIT_UNDERSTANDING_FRAC * ((ua + ub) / 2)),
      devotion:      0,
    };
  }
  return out;
}

/**
 * Closed-form generational turnover over `years` — no tick loop, so a century jump
 * is feasible. Fully deterministic given the seeded `rng`. Walks year by year:
 * deaths come from `rollDeathYear`; births are rolled for each co-located fertile
 * pair alive that year (respecting deaths and a per-POI soft cap). Returns the
 * deaths of the input NPCs and the children synthesized during the interval.
 * `now` is the current sim tick (each NPC's starting age = ageInYears(birthTick, now)).
 *
 * This is an annualized APPROXIMATION of the per-day `BirthSystem`/`MortalitySystem`,
 * not an exact tick-by-tick replay: births roll once per year against the annualized
 * per-pair rate and the cap is checked at the start of each year. `diesAt` is
 * inclusive-alive (a soul may parent in its own death year). Homeless souls (no
 * `homePoiId`) don't breed — mirroring `BirthSystem`.
 *
 * D2 wires this into the skip flow; D1 ships it unused by UI.
 */
export function projectTurnover(
  npcs: Entity[], years: number, now: number, rng: Rng,
): { deaths: ProjectedDeath[]; births: SynthChild[] } {
  const souls: Soul[] = npcs.map(e => {
    const p = npcProps(e);
    const baseAge = Math.max(0, ageInYears(p.birthTick, now)); // age at window start (offset 0)
    const diesAt = rollDeathYear(baseAge, years, rng.next());
    return {
      id: e.id, lineageId: p.lineageId, baseAge, bornAt: 0,
      diesAt: diesAt === null ? Infinity : diesAt,
      beliefs: p.beliefs, homePoiId: p.homePoiId,
    };
  });

  const deaths: ProjectedDeath[] = souls
    .filter(s => s.diesAt !== Infinity)
    .map(s => ({ id: s.id, deathYearOffset: s.diesAt, cause: 'old_age' }));

  const births: SynthChild[] = [];
  let synthCounter = 0;

  for (let y = 0; y < years; y++) {
    // Souls alive during year y, grouped by POI.
    const aliveByPoi = new Map<string, Soul[]>();
    for (const s of souls) {
      if (s.bornAt > y || s.diesAt < y) continue;
      const poi = s.homePoiId;
      if (!poi) continue; // homeless souls don't breed — mirrors BirthSystem
      (aliveByPoi.get(poi) ?? aliveByPoi.set(poi, []).get(poi)!).push(s);
    }

    // Sorted POI-key order so the cross-POI rng draw sequence is self-contained.
    for (const poi of [...aliveByPoi.keys()].sort()) {
      const residents = aliveByPoi.get(poi)!;
      if (residents.length >= POP_CAP_PER_POI) continue;
      let headroom = POP_CAP_PER_POI - residents.length;
      const fertile = residents
        .filter(s => {
          const age = s.baseAge + (y - s.bornAt);
          return age >= FERTILE_MIN_AGE && age <= FERTILE_MAX_AGE;
        })
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

      for (let i = 0; i + 1 < fertile.length && headroom > 0; i += 2) {
        if (rng.next() < BIRTH_RATE_PER_PAIR_YEAR) {
          const pa = fertile[i], pb = fertile[i + 1];
          const beliefs = diluteBeliefs(pa.beliefs, pb.beliefs);
          const child: Soul = {
            id: `synth-${y}-${synthCounter++}`,
            lineageId: pa.lineageId,
            baseAge: 0, bornAt: y,
            diesAt: Infinity, // newborn; surviving the rest of the window is fine for D1
            beliefs, homePoiId: pa.homePoiId,
          };
          souls.push(child);
          births.push({
            id: child.id, parentIds: [pa.id, pb.id], lineageId: child.lineageId,
            birthYearOffset: y, beliefs,
          });
          headroom--;
        }
      }
    }
  }

  return { deaths, births };
}
