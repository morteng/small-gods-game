/**
 * probe-scaling — Phase 0 (interaction-scaling plan) headless multi-seed sim
 * probe. Ticks a real sim for N game-hours per seed, records per-settlement
 * interaction quantities, and fits log-log scaling slopes (quantity vs total
 * population) pooled across settlements AND seeds — the "before photo" every
 * later phase of docs/superpowers/plans/2026-08-01-interaction-scaling-plan.md
 * gets compared against.
 *
 *   npx tsx scripts/probe-scaling.ts                     # default seeds/hours
 *   npx tsx scripts/probe-scaling.ts 12345 777 42 --hours 6 --json
 *
 * Harness shape copied from scripts/bench-sim-rate.ts (state → planWorldLayout
 * → generateWithNoise → seedWorld → cohort seeding → rival spirits →
 * Scheduler → advance loop), with registration order mirroring
 * src/game/sim-systems.ts. DELIBERATELY OMITTED: PlotThreadSystem /
 * StagingActivationSystem (narrative substrate — need a discoveryQueue /
 * attentionStore / storyRegistry / Fate wiring with zero bearing on the
 * quantities this probe measures) and MaterializationSystem / LordSystem /
 * RivalContentionSystem (camera-focus / runtime-POI / contention-ledger gated
 * subsystems with no live effect in a headless run that never focuses a
 * settlement). This is the same call bench-sim-rate.ts's header already makes
 * for "render/narrative-only" systems — omitting them is the CONSERVATIVE
 * direction (fewer secondary belief/prayer inflows, not more).
 *
 * CRITICAL GOTCHA: `generateWithNoise` calls `snapDrySettlementsOffWater`,
 * which mutates `poi.position` IN PLACE. A shared POI array across seeds
 * leaks one seed's snapped position into the next run. Deep-clone the laid-out
 * POIs per seed — see scripts/connectome-lint.ts:57-60 for the established
 * pattern this copies.
 *
 * Wall-clock calibration (2026-08-01, this machine): timed single-seed runs at
 * 1h/3h/8h (worldgen dominates — it's a fixed cost per seed regardless of sim
 * duration) gave a ~73s fixed cost + ~9.6s per simulated game-hour. 3 seeds ×
 * 6h ≈ 3 × (73 + 9.6×6) ≈ 393s (~6.6 min), inside the ~8-minute budget with
 * headroom for slower CI hardware; 3 × 8h ≈ 450s (~7.5 min) would still just
 * fit but leaves less margin. --hours overrides the default.
 */
import { readFileSync } from 'node:fs';
import type { WorldSeed, POI, EntityId } from '@/core/types';
import { Scheduler } from '@/core/scheduler';
import { createState } from '@/core/state';
import { planWorldLayout } from '@/world/poi-layout';
import { generateWithNoise } from '@/map/map-generator';
import { seedWorld } from '@/world/seed-world';
import { identityOracle } from '@/world/oracle';
import { generateRivalSpirits } from '@/sim/rival-spirit';
import { rivalToSpirit } from '@/sim/command/rival-adapter';
import { seedStatisticalCohorts } from '@/sim/cohorts';
import { residentsByPoi } from '@/sim/systems/settlement-growth-system';
import { type RoadClass } from '@/world/road-graph';

import { CommandExecutorSystem } from '@/sim/command/command-system';
import { CommandQueue } from '@/sim/command/command-queue';
import { NpcMovementSystem } from '@/sim/systems/npc-movement-system';
import { TrampleDepositSystem, TramplePromoteDecaySystem } from '@/sim/systems/trample-system';
import { SettlementEventSystem } from '@/sim/systems/settlement-event-system';
import { NpcSimSystem } from '@/sim/systems/npc-sim-system';
import { AbandonmentSystem } from '@/sim/systems/abandonment-system';
import { NpcActivitySystem } from '@/sim/systems/npc-activity-system';
import { NpcEncounterSystem } from '@/sim/systems/npc-encounter-system';
import { BeliefPropagationSystem } from '@/sim/systems/belief-propagation-system';
import { BeliefContentSystem } from '@/sim/systems/belief-content-system';
import { SpiritSystem } from '@/sim/spirit-system';
import { RivalSystem } from '@/sim/systems/rival-system';
import { MortalitySystem } from '@/sim/systems/mortality-system';
import { BirthSystem } from '@/sim/systems/birth-system';
import { SettlementGrowthSystem, housingCapacityByPoi } from '@/sim/systems/settlement-growth-system';
import { RoadEvolutionSystem } from '@/sim/systems/road-evolution-system';
import { CohortSystem } from '@/sim/systems/cohort-system';
import { WeatherSystem } from '@/sim/systems/weather-system';
import { PerceptionSystem } from '@/world/perception-system';
import { WaterDynamics } from '@/render/gpu/water-dynamics';
import { buildFloodWatch } from '@/world/flood-watch';

const TICKS_PER_HOUR_MS = 3_600_000; // one game-hour of sim time = 3600 sim-seconds = 3,600,000 sim-ms

// A defensible relative carriageway-width factor per road class. No such
// constant exists in game code (roads render at a fixed tile width regardless
// of class) — this is a probe-only weighting so "road surface" isn't just a
// cell count, matching the plan's "covered edge cells × a class-width factor"
// wording. Roughly doubling per rung, the qualitative shape a real
// path→track→road→highway hierarchy has.
const ROAD_CLASS_WIDTH: Record<RoadClass, number> = { path: 1, track: 1.5, road: 2.5, highway: 4 };

interface SettlementRow {
  seed: number;
  poiId: string;
  name: string;
  popNamed: number;
  popStatistical: number;
  popTotal: number;
  encounters: number;
  rumours: number;
  beliefDeltaSum: number;
  prayers: number;
  roadSurface: number;
  buildings: number;
}

function cloneLaidOutPois(pois: POI[]): POI[] {
  return pois.map((p) => ({ ...p, position: p.position ? { ...p.position } : p.position }));
}

async function buildWorld(genSeed: number, laidOut: WorldSeed) {
  // Deep-clone the laid-out POIs THIS seed will mutate in place (the gotcha
  // above) — every other seed in the run must see the untouched layout.
  const ws: WorldSeed = { ...laidOut, pois: cloneLaidOutPois(laidOut.pois) };

  const state = createState();
  const { map, world, biomeMap, trample } = await generateWithNoise(
    ws.size.width, ws.size.height, genSeed, ws, {},
  );
  state.map = map; state.worldSeed = ws; state.world = world; state.biomeMap = biomeMap; state.trample = trample;

  seedWorld({
    world, log: state.eventLog, clock: state.clock, spirits: state.spirits,
    rng: state.rng, worldSeed: ws, map, oracle: identityOracle,
  });

  // Rivals (mirror bootstrap-world.instantiateRivals) — before cohort seeding,
  // same order as the live boot path.
  const settlementIds = (ws.pois ?? [])
    .filter((p) => Array.isArray(p.npcs) && p.npcs.length > 0)
    .map((p) => p.id);
  if (settlementIds.length) {
    for (const r of generateRivalSpirits(state.rng.nextInt(0x7fffffff), settlementIds, 2)) {
      state.spirits.set(r.id, rivalToSpirit(r));
    }
  }

  // Two-tier population (P1): seed the statistical tier so a bigger settlement
  // isn't just its handful of named residents — this is what "population"
  // means for the fit (residentsByPoi folds both tiers).
  state.cohorts = seedStatisticalCohorts(world, ws, state.spirits, state.clock.now());

  // Weather (mirror bootstrap-world.installWeather) — WeatherSystem is in the
  // sim-systems.ts roster, so it needs somewhere real to read from.
  state.weather = new WaterDynamics(map);
  const placed = (ws.pois ?? []).filter((p) => p.position);
  state.floodWatch = buildFloodWatch(
    placed.map((p) => ({ id: p.id, name: p.name ?? p.id, x: p.position!.x, y: p.position!.y, radius: 3 })),
    map.width, map.height,
  );

  // Instrumentation: probe-only observer hooks (default undefined elsewhere —
  // zero behaviour change). Wired below once the systems + counters exist.
  const queue = new CommandQueue();
  const sched = new Scheduler();
  sched.register(new CommandExecutorSystem(queue, undefined, undefined, () => state.weather));
  sched.register(new NpcMovementSystem(() => state.map));
  sched.register(new TrampleDepositSystem(() => state.map, () => state.trample, () => state.roadUse));
  sched.register(new TramplePromoteDecaySystem(() => state.map, () => state.trample));
  sched.register(new SettlementEventSystem());
  sched.register(new NpcSimSystem());
  sched.register(new AbandonmentSystem());
  sched.register(new NpcActivitySystem(() => state.map));
  const encounters = new NpcEncounterSystem();
  sched.register(encounters);
  const propagation = new BeliefPropagationSystem();
  sched.register(propagation);
  sched.register(new BeliefContentSystem());
  const getCohorts = () => state.cohorts;
  sched.register(new SpiritSystem(getCohorts));
  sched.register(new RivalSystem(queue, getCohorts, () => state.contention));
  sched.register(new MortalitySystem());
  sched.register(new BirthSystem({ cohorts: getCohorts, housingCapacity: housingCapacityByPoi }));
  const cohortSystem = new CohortSystem(getCohorts);
  sched.register(cohortSystem);
  sched.register(new SettlementGrowthSystem(() => state.trample, getCohorts));
  sched.register(new RoadEvolutionSystem(
    () => state.roadUse, getCohorts, () => state.crossingTiers, () => state.trample, () => state.adoptions));
  sched.register(new WeatherSystem(() => state.weather, () => state.floodWatch, () => state.causalSites));
  sched.register(new PerceptionSystem(identityOracle, () => state.map, undefined, getCohorts));

  return { state, sched, world, encounters, propagation, ws };
}

function ctxFor(state: ReturnType<typeof createState>) {
  return { world: state.world!, spirits: state.spirits, log: state.eventLog, clock: state.clock, rng: state.rng };
}

async function runSeed(genSeed: number, laidOut: WorldSeed, hours: number): Promise<SettlementRow[]> {
  const { state, sched, world, encounters, propagation, ws } = await buildWorld(genSeed, laidOut);

  // Per-poi counters, filled by the instrumentation hooks + a prayer-answered
  // subscription (no EventLog.range scan — `subscribe` is an O(1)-per-append
  // listener, not a windowed read).
  const encounterCount = new Map<string, number>();
  const rumourCount = new Map<string, number>();
  const beliefDeltaSum = new Map<string, number>();
  const prayerCount = new Map<string, number>();
  const bump = (m: Map<string, number>, key: string | undefined, by = 1): void => {
    if (!key) return;
    m.set(key, (m.get(key) ?? 0) + by);
  };

  encounters.onEncounter = (_a, _b, poiId): void => bump(encounterCount, poiId);
  encounters.onRumour = (_from, _to, poiId): void => bump(rumourCount, poiId);
  const homePoiOf = (id: EntityId): string | undefined => world.registry.get(id)?.properties?.homePoiId as string | undefined;
  propagation.onPropagate = (entityId, _kind, delta): void => bump(beliefDeltaSum, homePoiOf(entityId), delta);

  // "worship/prayer activity count": the RivalSystem only CLAIMS a stale plea
  // past PRAYER_CLAIM_WINDOW_TICKS (half a fiction-day, ~12 game-hours —
  // src/sim/rival-claims.ts) and there is no player here to answer sooner, so
  // an `answer_prayer` event count would read zero for any probe run shorter
  // than that window — measuring rival policy lag, not prayer pressure. NpcActivitySystem
  // has no probe hook (out of S0.1's instrumentation scope — only the encounter
  // + propagation systems get one), so instead sample the population actually
  // IN `activity === 'worship'` once per game-hour boundary (the same cadence
  // the day-keyed lifecycle systems already fire at) and accumulate — a cheap,
  // bounded, non-event-log signal for how much of the settlement is standing at
  // the shrine over the run. Named tier only (statistical cohorts carry no
  // per-soul activity — audit finding #3, "the cohort tier has no dynamics").
  const sampleWorship = (): void => {
    for (const e of world.query({ kind: 'npc' })) {
      if (e.properties?.activity === 'worship') bump(prayerCount, e.properties?.homePoiId as string | undefined);
    }
  };

  const ctx = ctxFor(state);
  let remainingMs = hours * TICKS_PER_HOUR_MS;
  const CHUNK_MS = TICKS_PER_HOUR_MS; // one game-hour per Scheduler.tick call
  while (remainingMs > 0) {
    const step = Math.min(CHUNK_MS, remainingMs);
    sched.tick(step, ctx);
    remainingMs -= step;
    sampleWorship();
  }

  const residents = residentsByPoi(world, state.cohorts);
  const roadGraph = state.map!.roadGraph;
  const roadSurfaceByPoi = new Map<string, number>();
  if (roadGraph) {
    const poiIds = new Set((ws.pois ?? []).filter((p) => p.position).map((p) => p.id));
    for (const edge of roadGraph.edges) {
      const cells = edge.polyline.length;
      const width = ROAD_CLASS_WIDTH[edge.class];
      const surface = cells * width;
      const aNode = roadGraph.nodes.find((n) => n.id === edge.a);
      const bNode = roadGraph.nodes.find((n) => n.id === edge.b);
      // Attribute to every POI endpoint this edge actually touches — a road
      // between two settlements is frontage for BOTH, same convention
      // road-evolution.ts already uses for its endpoint-driven wear terms.
      for (const node of [aNode, bNode]) {
        if (node?.poiRef && poiIds.has(node.poiRef)) {
          roadSurfaceByPoi.set(node.poiRef, (roadSurfaceByPoi.get(node.poiRef) ?? 0) + surface);
        }
      }
    }
  }

  const buildingsByPoi = new Map<string, number>();
  for (const b of state.map!.buildings ?? []) {
    if (b.poiId) buildingsByPoi.set(b.poiId, (buildingsByPoi.get(b.poiId) ?? 0) + 1);
  }

  const rows: SettlementRow[] = [];
  for (const poi of ws.pois ?? []) {
    if (!poi.position) continue; // unplaced POI — not a real settlement in this world
    const named = world.query({ kind: 'npc' }).filter((e) => e.properties?.homePoiId === poi.id).length;
    const popTotal = residents.get(poi.id) ?? 0;
    if (popTotal <= 0) continue; // an uninhabited POI carries no interaction signal
    rows.push({
      seed: genSeed,
      poiId: poi.id,
      name: poi.name ?? poi.id,
      popNamed: named,
      popStatistical: Math.max(0, popTotal - named),
      popTotal,
      encounters: encounterCount.get(poi.id) ?? 0,
      rumours: rumourCount.get(poi.id) ?? 0,
      beliefDeltaSum: beliefDeltaSum.get(poi.id) ?? 0,
      prayers: prayerCount.get(poi.id) ?? 0,
      roadSurface: roadSurfaceByPoi.get(poi.id) ?? 0,
      buildings: buildingsByPoi.get(poi.id) ?? 0,
    });
  }
  return rows;
}

/** Least-squares log-log slope + R² over the points with both coordinates
 *  strictly positive (log of zero/negative is undefined — those settlements
 *  carry no signal for THIS quantity and are excluded from ITS fit only). */
function fitLogLog(points: { x: number; y: number }[]): { slope: number; r2: number; n: number } | null {
  const valid = points.filter((p) => p.x > 0 && p.y > 0);
  if (valid.length < 2) return null;
  const xs = valid.map((p) => Math.log(p.x));
  const ys = valid.map((p) => Math.log(p.y));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { slope, r2, n };
}

const QUANTITIES = ['encounters', 'rumours', 'beliefDeltaSum', 'prayers', 'roadSurface', 'buildings'] as const;
type Quantity = typeof QUANTITIES[number];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const hoursIdx = args.indexOf('--hours');
  const hours = hoursIdx >= 0 ? Number(args[hoursIdx + 1]) : 6;
  const skip = new Set([hoursIdx, hoursIdx + 1]);
  const seedArgs = args
    .filter((a, i) => a !== '--json' && a !== '--hours' && !skip.has(i))
    .map(Number).filter((n) => Number.isFinite(n));
  const seeds = seedArgs.length ? seedArgs : [12345, 777, 42];

  const ws = JSON.parse(readFileSync('public/data/worlds/default.json', 'utf8')) as WorldSeed;
  const layout = planWorldLayout(ws);
  const laidOut: WorldSeed = { ...ws, size: layout.size, pois: layout.pois, connections: layout.connections };

  const t0 = performance.now();
  const allRows: SettlementRow[] = [];
  for (const seed of seeds) {
    if (!asJson) process.stdout.write(`seed ${seed}: generating + simulating ${hours}h…\n`);
    const rows = await runSeed(seed, laidOut, hours);
    allRows.push(...rows);
  }
  const wallMs = performance.now() - t0;

  const fits: Record<Quantity, { slope: number; r2: number; n: number } | null> = {} as never;
  for (const q of QUANTITIES) {
    fits[q] = fitLogLog(allRows.map((r) => ({ x: r.popTotal, y: r[q] })));
  }

  if (asJson) {
    console.log(JSON.stringify({ seeds, hours, wallMs, settlements: allRows, fits }, null, 2));
    return;
  }

  process.stdout.write(`\n${allRows.length} settlements across ${seeds.length} seed(s), ${hours}h simulated each (${(wallMs / 1000).toFixed(1)}s wall)\n\n`);
  const header = ['seed', 'poi', 'name', 'pop', 'enc', 'rumour', 'beliefΔ', 'prayer', 'road', 'bldg'];
  process.stdout.write(header.join('\t') + '\n');
  for (const r of allRows.sort((a, b) => a.popTotal - b.popTotal)) {
    process.stdout.write([
      r.seed, r.poiId, r.name, r.popTotal, r.encounters, r.rumours,
      r.beliefDeltaSum.toFixed(3), r.prayers, r.roadSurface.toFixed(1), r.buildings,
    ].join('\t') + '\n');
  }

  process.stdout.write('\nlog-log fit vs total population (slope, R², n):\n');
  for (const q of QUANTITIES) {
    const f = fits[q];
    process.stdout.write(f
      ? `  ${q.padEnd(14)} slope=${f.slope.toFixed(3)}  r2=${f.r2.toFixed(3)}  n=${f.n}\n`
      : `  ${q.padEnd(14)} — insufficient positive-valued settlements to fit\n`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
