import type { System, SystemContext } from '@/core/scheduler';
import type { Entity } from '@/core/types';
import type { World } from '@/world/world';
// Type-only (erased at runtime): cohorts.ts value-imports this module's fertile
// ages at eval time, so a value import back would be a circular-eval hazard.
import type { SettlementCohorts } from '@/sim/cohorts';
import { queryNpcs, npcProps } from '@/world/npc-helpers';
import { birthNpc } from '@/world/npc-lifecycle';
import { ageInYears } from '@/sim/mortality';
import { GAME_HOUR_HZ, perCheckFromPerDay } from '@/core/calendar';

export const FERTILE_MIN_AGE = 18;
export const FERTILE_MAX_AGE = 45;
/** Legacy soft cap on living NPCs per POI. P1 (two-tier population, spec §5.2)
 *  retires it as the PRIMARY birth gate in favor of the housing-derived cap
 *  below; it survives as (a) the fallback for POIs with no housing data (bare
 *  test worlds / camps without dwelling entities keep the old behavior) and
 *  (b) the cap `turnover.ts` still applies to skip projections (P3 aligns the
 *  skip path with the housing cap). */
export const POP_CAP_PER_POI = 24;
/** Per-pair per-DAY birth chance. Tunable baseline. (Under the old compressed
 *  clock this was per-fire = per-day; the per-day meaning is the tuned intent
 *  and is what `turnover.ts` annualizes for the closed-form skip.) */
export const BIRTH_RATE_PER_PAIR = 0.003;

/** Medieval overcrowding slack (spec §5.2): births throttle as COMBINED
 *  population (named + statistical) approaches housing capacity × this slack —
 *  the same overshoot pressure that makes SettlementGrowthSystem fire at all. */
export const HOUSING_SLACK = 1.25;

/** One fire per GAME HOUR, matching MortalitySystem's cadence (see its note on
 *  why day-keyed lifecycle systems check hourly under 1:1 realtime). */
export const BIRTH_TICK_HZ = GAME_HOUR_HZ;

/** Per-hour chance preserving the per-day rate (24 checks per day). */
const BIRTH_RATE_PER_PAIR_PER_CHECK = perCheckFromPerDay(BIRTH_RATE_PER_PAIR, 24);

export interface BirthSystemDeps {
  /** P1 (two-tier population): the statistical tier — its souls count against
   *  the settlement's housing headroom, so houses gate births for people who
   *  exist statistically too (people cause houses, NEVER the reverse). */
  cohorts?: () => ReadonlyMap<string, SettlementCohorts> | null | undefined;
  /** Housing capacity per POI (Σ DWELLING_CAPACITY over standing dwellings) —
   *  injected (typically `housingCapacityByPoi` from the settlement-growth
   *  system) rather than imported, to keep this module a dependency leaf.
   *  Absent ⇒ every POI falls back to the legacy POP_CAP_PER_POI. */
  housingCapacity?: (world: World) => Map<string, number>;
}

/** Total statistical souls in one settlement's bands (inlined so this module
 *  never value-imports cohorts.ts — see the type-import note above). */
function statPopulation(sc: SettlementCohorts | undefined): number {
  if (!sc) return 0;
  let n = 0;
  for (const band of sc.bands) n += band.count;
  return n;
}

export class BirthSystem implements System {
  readonly name = 'births';
  readonly tickHz = BIRTH_TICK_HZ;

  constructor(private readonly deps?: BirthSystemDeps) {}

  tick(ctx: SystemContext): void {
    // Group living NPCs by home POI (skip NPCs without a home — they can't pair).
    const byPoi = new Map<string, Entity[]>();
    for (const e of queryNpcs(ctx.world)) {
      const poi = npcProps(e).homePoiId;
      if (!poi) continue;
      (byPoi.get(poi) ?? byPoi.set(poi, []).get(poi)!).push(e);
    }

    const cohorts = this.deps?.cohorts?.();
    const capacityByPoi = this.deps?.housingCapacity?.(ctx.world);

    // Iterate POIs in sorted key order so the cross-POI rng draw sequence is
    // self-contained (independent of KindIndex insertion order) — replay-stable.
    for (const poi of [...byPoi.keys()].sort()) {
      const residents = byPoi.get(poi)!;
      // Soft cap (spec §5.2): housing-derived when the POI has dwelling data —
      // COMBINED population (named + statistical) throttles against capacity ×
      // slack, so growth building homes for statistical souls relaxes it. POIs
      // with no housing data keep the legacy POP_CAP_PER_POI. Either way the
      // cap NEVER removes anyone — death is a separate, old-age-only event.
      const housing = capacityByPoi?.get(poi) ?? 0;
      const cap = housing > 0 ? Math.ceil(housing * HOUSING_SLACK) : POP_CAP_PER_POI;
      const combined = residents.length + statPopulation(cohorts?.get(poi));
      if (combined >= cap) continue;
      let headroom = cap - combined;

      // Stable order so rng draws reproduce under replay. P2: exclude
      // materialized extras from PARENTING — they're temporary embodiments of
      // statistical cohort souls, so letting them breed would both mint phantom
      // named souls and make births focus-dependent (the extras only exist while
      // the settlement is watched). They STILL count in `combined` above (as
      // named entities their origin cohort dropped via removeSoul), so the
      // housing throttle stays invariant whether or not the town is focused.
      const fertile = residents
        .filter(e => {
          const p = npcProps(e);
          if (p.materializedTemp === true) return false;
          const age = ageInYears(p.birthTick, ctx.now);
          return age >= FERTILE_MIN_AGE && age <= FERTILE_MAX_AGE;
        })
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

      for (let i = 0; i + 1 < fertile.length && headroom > 0; i += 2) {
        if (ctx.rng.next() < BIRTH_RATE_PER_PAIR_PER_CHECK) {
          birthNpc(ctx.world, [fertile[i], fertile[i + 1]], ctx.now, ctx.rng, ctx.log);
          headroom--;
        }
      }
    }
  }
}
