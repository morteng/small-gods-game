/**
 * probe-belief-decay — what a believer is WORTH at rest, and how long a god
 * takes to climb the tier ladder.
 *
 * Written for the round that gave `understanding` and `devotion` a passive
 * proportional fade (`UNDERSTANDING_FADE_PER_DAY` / `DEVOTION_FADE_PER_DAY` in
 * `@/sim/belief-forces`). Before that round both were written monotonically, so
 * they pinned at 1.0 within two game-hours and `beliefContribution` was
 * permanently 9·faith. Neither number was observable anywhere: the shipped
 * probe (`probe-scaling.ts`) fits interaction exponents, not belief levels.
 *
 *   npx tsx scripts/probe-belief-decay.ts bench            # seconds — no worldgen
 *   npx tsx scripts/probe-belief-decay.ts world --hours 48 # the default world
 *   npx tsx scripts/probe-belief-decay.ts world --seed 777 --hours 24 --json
 *
 * TWO MODES, because they answer different questions:
 *
 *  • `bench` — a CONTROLLED homogeneous village of 13 souls at the population
 *    median (skepticism/piety/sociability/trust all 0.5, all needs 0.5 so
 *    neither comfort nor desperation is running), complete graph, run through
 *    the REAL named pipeline (`tickAllNpcEntities` then `BeliefPropagationSystem`)
 *    to its fixed point. Reports f*, u*, d*, the per-believer contribution, and
 *    how many such believers each tier edge costs. Then it SEVERS the graph and
 *    measures how long the congregation's mass takes to fall under `FADE_MASS`
 *    — the Track 5 question, which the ceiling made ~3× harder than designed.
 *    The mean field (`driftSettlementBelief`) is run on the same fixture beside
 *    it; the two differ by the stochastic edge-propagation channel the mean
 *    field deliberately does not model (see `cohort-drift.ts`'s header).
 *
 *  • `world` — the real default world with the P3 drift live, sampled once per
 *    game-hour: per-spirit belief mass / tier / power, and the population-mean
 *    f/u/d over BOTH tiers. Reports the first game-hour each spirit reaches
 *    `cult` and `major`. Harness copied from `probe-scaling.ts` (including its
 *    per-seed POI deep-clone gotcha and its 250 ms scheduler chunk, which is
 *    what keeps the systems interleaved), plus the two systems P3 added —
 *    `SettlementAggregateSystem` then `CohortDynamicsSystem`, in the
 *    `sim-systems.ts` order, because the drift reads THIS hour's aggregates.
 */
import { readFileSync } from 'node:fs';
import type { WorldSeed, POI, Entity, GameMap, NpcNeeds, NpcProperties, Tile } from '@/core/types';
import { Scheduler } from '@/core/scheduler';
import { createState } from '@/core/state';
import { planWorldLayout } from '@/world/poi-layout';
import { generateWithNoise } from '@/map/map-generator';
import { seedWorld } from '@/world/seed-world';
import { identityOracle } from '@/world/oracle';
import { generateRivalSpirits } from '@/sim/rival-spirit';
import { rivalToSpirit } from '@/sim/command/rival-adapter';
import { seedStatisticalCohorts } from '@/sim/cohorts';
import { RATE_CHUNK_SIM_MS } from '@/game/time-controller';
import { World } from '@/world/world';
import { SilentEventLog } from '@/core/events';
import { createRng } from '@/core/rng';
import { initNpcProps, npcProps } from '@/world/npc-helpers';
import { MAX_SOCIAL_DEGREE } from '@/sim/systems/npc-encounter-system';
import { tickAllNpcEntities } from '@/sim/npc-sim';
import {
  UNDERSTANDING_FADE_PER_DAY, DEVOTION_FADE_PER_DAY, FIRES_PER_DAY,
} from '@/sim/belief-forces';
import { beliefContribution, emptySettlementCohorts, addSoul, type SoulObservation } from '@/sim/cohorts';
import { driftSettlementBelief, FIRES_PER_GAME_HOUR } from '@/sim/cohort-drift';
import { CULT_IN, MAJOR_IN, FADE_MASS, tierFor, type GodTier } from '@/sim/god-tier';

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
import { SettlementAggregateSystem } from '@/sim/systems/settlement-aggregate-system';
import { CohortDynamicsSystem } from '@/sim/systems/cohort-dynamics-system';
import { WeatherSystem } from '@/sim/systems/weather-system';
import { PerceptionSystem } from '@/world/perception-system';
import { WaterDynamics } from '@/render/gpu/water-dynamics';
import { buildFloodWatch } from '@/world/flood-watch';

const TICKS_PER_HOUR_MS = 3_600_000;

const f3 = (n: number): string => n.toFixed(3);
const f4 = (n: number): string => n.toFixed(4);

function banner(): void {
  console.log(
    `# fades: understanding ${UNDERSTANDING_FADE_PER_DAY}/day  devotion ${DEVOTION_FADE_PER_DAY}/day`
    + `  (per fire: ${(UNDERSTANDING_FADE_PER_DAY / FIRES_PER_DAY).toExponential(3)}`
    + ` / ${(DEVOTION_FADE_PER_DAY / FIRES_PER_DAY).toExponential(3)})`,
  );
}

// ── bench: the controlled village ────────────────────────────────────────────

const SOULS = MAX_SOCIAL_DEGREE + 1;       // complete graph at exactly the edge budget
const MEDIAN = { assertiveness: 0.5, skepticism: 0.5, piety: 0.5, sociability: 0.5 };
const TRUST = 0.5;
/** All four at 0.5: above DESPERATION_THRESHOLD (0.4) and below
 *  COMFORT_THRESHOLD (0.6), so neither the desperation boost nor the comfort
 *  decay is running and the fixed point measured is the BASELINE one. */
const HELD_NEEDS: NpcNeeds = { safety: 0.5, prosperity: 0.5, community: 0.5, meaning: 0.5 };

function emptyMap(): GameMap {
  const w = 8, h = 8;
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: w, height: h, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

function benchVillage(n: number, faith: number, u: number, d: number, connected: boolean): World {
  const world = new World(emptyMap());
  const souls: Entity[] = [];
  for (let i = 0; i < n; i++) {
    const p = initNpcProps(`s${i}`, 'farmer', 11 + i) as NpcProperties;
    p.personality = { ...MEDIAN };
    p.needs = { ...HELD_NEEDS };
    p.beliefs = { player: { faith, understanding: u, devotion: d } };
    p.relationships = [];
    p.activity = 'idle';
    const e: Entity = { id: `s${i}`, kind: 'npc', x: 1, y: 1, properties: p as unknown as Record<string, unknown> };
    world.addEntity(e);
    souls.push(e);
  }
  if (connected) {
    for (let i = 0; i < souls.length; i++) {
      for (let j = i + 1; j < souls.length; j++) {
        npcProps(souls[i]).relationships.push({ npcId: souls[j].id, type: 'friend', trust: TRUST });
        npcProps(souls[j]).relationships.push({ npcId: souls[i].id, type: 'friend', trust: TRUST });
      }
    }
  }
  return world;
}

/** `fires` fires of the REAL named pipeline, needs re-stamped each fire (the
 *  fixture holds needs fixed so the belief fixed point is not chasing a moving
 *  need vector — the same control `cohort-drift-parity.test.ts` uses). */
function benchFires(
  world: World, sys: BeliefPropagationSystem, rngSeed: number, fires: number,
  needs: NpcNeeds = HELD_NEEDS,
): void {
  const ctx = {
    world, spirits: new Map(), log: new SilentEventLog(null as never),
    clock: { now: () => 0, advance: () => {} } as never,
    rng: createRng(rngSeed), dt: 1000, now: 0,
  };
  for (let t = 0; t < fires; t++) {
    tickAllNpcEntities(world);
    sys.tick(ctx as never);
    world.query({ kind: 'npc' }).forEach(e => { npcProps(e).needs = { ...needs }; });
  }
}

function benchHour(world: World, sys: BeliefPropagationSystem, rngSeed: number): void {
  benchFires(world, sys, rngSeed, FIRES_PER_GAME_HOUR);
}

function benchMeans(world: World): { f: number; u: number; d: number; contribution: number } {
  let f = 0, u = 0, d = 0, c = 0, n = 0;
  for (const e of world.query({ kind: 'npc' })) {
    const b = npcProps(e).beliefs.player;
    if (!b) continue;
    f += b.faith; u += b.understanding; d += b.devotion; c += beliefContribution(b); n++;
  }
  return n === 0
    ? { f: 0, u: 0, d: 0, contribution: 0 }
    : { f: f / n, u: u / n, d: d / n, contribution: c / n };
}

function runBench(): void {
  banner();
  console.log(`\n## bench — ${SOULS} souls, complete graph @ trust ${TRUST}, median personality, needs 0.5`);
  console.log('hour |    f*      u*      d*   | contribution/believer');
  const world = benchVillage(SOULS, 0.4, 0.1, 0.05, true);
  const sys = new BeliefPropagationSystem();
  const track: number[] = [];
  for (let hour = 1; hour <= 72; hour++) {
    benchHour(world, sys, 7 + hour);
    const m = benchMeans(world);
    track.push(m.contribution);
    if (hour <= 12 || hour % 12 === 0) {
      console.log(`${String(hour).padStart(4)} | ${f4(m.f)}  ${f4(m.u)}  ${f4(m.d)} | ${f4(m.contribution)}`);
    }
  }
  const eq = benchMeans(world);
  const settledHour = track.findIndex(c => Math.abs(c - eq.contribution) / eq.contribution < 0.02) + 1;
  console.log(`\nwithin 2% of the fixed point by game-hour ${settledHour || '>72'}`);
  console.log(`  f* = ${f4(eq.f)}   u* = ${f4(eq.u)}   d* = ${f4(eq.d)}   contribution = ${f4(eq.contribution)}`);
  console.log(`  believers needed to hold  FADE_MASS(${FADE_MASS}) = ${(FADE_MASS / eq.contribution).toFixed(1)}`
    + `   CULT_IN(${CULT_IN}) = ${(CULT_IN / eq.contribution).toFixed(1)}`
    + `   MAJOR_IN(${MAJOR_IN}) = ${(MAJOR_IN / eq.contribution).toFixed(1)}`);

  // Mean field on the identical fixture — a sanity read, not the parity gate
  // (that lives in tests/unit/cohort-drift-parity.test.ts). It differs by the
  // stochastic edge-propagation channel the mean field does not model.
  const sc = emptySettlementCohorts('bench');
  for (let i = 0; i < SOULS; i++) {
    const obs: SoulObservation = {
      age: 30, beliefs: { player: { faith: 0.4, understanding: 0.1, devotion: 0.05 } },
      needs: { ...HELD_NEEDS },
    };
    addSoul(sc, obs);
  }
  for (let hour = 0; hour < 72; hour++) {
    driftSettlementBelief(sc, {
      fires: FIRES_PER_GAME_HOUR,
      params: { skepticism: 0.5, piety: 0.5, sociability: 0.5, trust: TRUST },
    });
  }
  let sf = 0, su = 0, sd = 0, sc2 = 0, sn = 0;
  for (const band of sc.bands) {
    const rec = band.belief.player;
    if (!rec || rec.believerCount <= 0) continue;
    sf += rec.sumFaith; su += rec.sumU; sd += rec.sumD; sc2 += rec.sumContribution; sn += rec.believerCount;
  }
  console.log(`  mean field on the same fixture: f* = ${f4(sf / sn)}  u* = ${f4(su / sn)}`
    + `  d* = ${f4(sd / sn)}  contribution = ${f4(sc2 / sn)}`);

  // ── Track 5, experiment 1: isolation. Sampled in game-MINUTES, because the
  // faith half of the collapse runs at 0.001/fire and is over inside an hour.
  console.log('\n## fade A — the congregation is SEVERED at its fixed point (no communion, no propagation)');
  console.log('   (starting u/d are this build\'s equilibrium, so the run is comparable across builds)');
  for (const n of [SOULS, 5, 1]) {
    const cut = benchVillage(n, eq.f, eq.u, eq.d, false);
    const cutSys = new BeliefPropagationSystem();
    let mins = -1;
    for (let m10 = 1; m10 <= 6 * 24; m10++) {          // 10-game-minute steps, 24 h
      benchFires(cut, cutSys, 990 + m10, FIRES_PER_GAME_HOUR / 6);
      if (benchMeans(cut).contribution * n < FADE_MASS) { mins = m10 * 10; break; }
    }
    const m = benchMeans(cut);
    console.log(`  ${String(n).padStart(2)} believers: mass under FADE_MASS after `
      + `${mins < 0 ? '>24h' : `${mins} game-minutes`}  (then u=${f3(m.u)} d=${f3(m.d)} f=${f3(m.f)})`);
  }

  // ── Track 5, experiment 2: COMFORT. This is the one the ceiling actually
  // broke. `COMFORT_DECAY` is scaled by (1 − devotion), so a congregation whose
  // devotion sat pinned at 1.0 was IMMUNE to secularization by construction —
  // the whole VISION §4 comfort trap was unreachable while u/d could not fall.
  // Fully connected (communion still running), all four needs at 0.8.
  const COMFY: NpcNeeds = { safety: 0.8, prosperity: 0.8, community: 0.8, meaning: 0.8 };
  console.log('\n## fade B — a COMFORTABLE congregation (all needs 0.8 ⇒ COMFORT_DECAY runs, resisted by devotion)');
  const comfy = benchVillage(SOULS, eq.f, eq.u, eq.d, true);
  const comfySys = new BeliefPropagationSystem();
  for (let hour = 1; hour <= 48; hour++) {
    benchFires(comfy, comfySys, 4200 + hour, FIRES_PER_GAME_HOUR, COMFY);
    if (hour <= 4 || hour % 12 === 0) {
      const m = benchMeans(comfy);
      console.log(`  h${String(hour).padStart(3)}  f ${f4(m.f)}  u ${f4(m.u)}  d ${f4(m.d)}`
        + `  contribution ${f4(m.contribution)}  mass(${SOULS}) ${f3(m.contribution * SOULS)}`);
    }
  }
  const cm = benchMeans(comfy);
  console.log(`  comfort resistance actually in force: 1 − d = ${f3(1 - cm.d)}`
    + `  ⇒ effective comfort decay ${f4(0.004 * ((0.8 - 0.6) / 0.4) * (1 - cm.d))}/fire`);
}

// ── world: the real default world ────────────────────────────────────────────

function cloneLaidOutPois(pois: POI[]): POI[] {
  return pois.map((p) => ({ ...p, position: p.position ? { ...p.position } : p.position }));
}

async function buildWorld(genSeed: number, laidOut: WorldSeed) {
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
  const settlementIds = (ws.pois ?? [])
    .filter((p) => Array.isArray(p.npcs) && p.npcs.length > 0)
    .map((p) => p.id);
  if (settlementIds.length) {
    for (const r of generateRivalSpirits(state.rng.nextInt(0x7fffffff), settlementIds, 2)) {
      state.spirits.set(r.id, rivalToSpirit(r));
    }
  }
  state.cohorts = seedStatisticalCohorts(world, ws, state.spirits, state.clock.now());
  state.weather = new WaterDynamics(map);
  const placed = (ws.pois ?? []).filter((p) => p.position);
  state.floodWatch = buildFloodWatch(
    placed.map((p) => ({ id: p.id, name: p.name ?? p.id, x: p.position!.x, y: p.position!.y, radius: 3 })),
    map.width, map.height,
  );

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
  sched.register(new NpcEncounterSystem());
  sched.register(new BeliefPropagationSystem());
  sched.register(new BeliefContentSystem());
  const getCohorts = () => state.cohorts;
  sched.register(new SpiritSystem(getCohorts));
  sched.register(new RivalSystem(queue, getCohorts, () => state.contention));
  sched.register(new MortalitySystem());
  sched.register(new BirthSystem({ cohorts: getCohorts, housingCapacity: housingCapacityByPoi }));
  sched.register(new CohortSystem(getCohorts));
  // P3's two additions, in the `sim-systems.ts` order — the drift reads THIS
  // hour's aggregates, so the sweep must be registered before it.
  sched.register(new SettlementAggregateSystem(
    () => state.settlementAggregates, getCohorts, () => state.settlementFlux));
  sched.register(new CohortDynamicsSystem(
    getCohorts, () => state.settlementAggregates, () => state.map, () => state.settlementFlux));
  sched.register(new SettlementGrowthSystem(() => state.trample, getCohorts));
  sched.register(new RoadEvolutionSystem(
    () => state.roadUse, getCohorts, () => state.crossingTiers, () => state.trample, () => state.adoptions));
  sched.register(new WeatherSystem(() => state.weather, () => state.floodWatch, () => state.causalSites));
  sched.register(new PerceptionSystem(identityOracle, () => state.map, undefined, getCohorts));
  return { state, sched, world };
}

interface Sample {
  hour: number;
  spiritId: string;
  mass: number;
  tier: GodTier;
  power: number;
  believers: number;
  meanF: number;
  meanU: number;
  meanD: number;
}

async function runWorld(genSeed: number, hours: number, asJson: boolean): Promise<void> {
  const raw = JSON.parse(readFileSync('public/data/worlds/default.json', 'utf8')) as WorldSeed;
  const layout = planWorldLayout(raw);
  const laidOut: WorldSeed = { ...raw, size: layout.size, pois: layout.pois, connections: layout.connections };
  const { state, sched, world } = await buildWorld(genSeed, laidOut);

  const ctx = {
    world: state.world!, spirits: state.spirits, log: state.eventLog,
    clock: state.clock, rng: state.rng,
  };
  const samples: Sample[] = [];
  const firstCult = new Map<string, number>();
  const firstMajor = new Map<string, number>();

  const sample = (hour: number): void => {
    for (const [sid, spirit] of [...state.spirits].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      // Population-mean belief over BOTH tiers, over the souls that HOLD a
      // record for this spirit (the same denominator `cohort-drift.ts` uses).
      let f = 0, u = 0, d = 0, n = 0;
      for (const e of world.query({ kind: 'npc' })) {
        const b = (e.properties as unknown as NpcProperties).beliefs?.[sid];
        if (!b) continue;
        f += b.faith; u += b.understanding; d += b.devotion; n++;
      }
      for (const sc of state.cohorts?.values() ?? []) {
        for (const band of sc.bands) {
          const rec = band.belief[sid];
          if (!rec || rec.believerCount <= 0) continue;
          f += rec.sumFaith; u += rec.sumU; d += rec.sumD; n += rec.believerCount;
        }
      }
      const mass = spirit.beliefMass ?? 0;
      const tier = spirit.tier ?? tierFor(mass);
      if (mass >= CULT_IN && !firstCult.has(sid)) firstCult.set(sid, hour);
      if (mass >= MAJOR_IN && !firstMajor.has(sid)) firstMajor.set(sid, hour);
      samples.push({
        hour, spiritId: sid, mass, tier, power: spirit.power,
        believers: n,
        meanF: n ? f / n : 0, meanU: n ? u / n : 0, meanD: n ? d / n : 0,
      });
    }
  };

  let remainingMs = hours * TICKS_PER_HOUR_MS;
  let sinceSample = 0;
  let hour = 0;
  const t0 = Date.now();
  while (remainingMs > 0) {
    const step = Math.min(RATE_CHUNK_SIM_MS, remainingMs);
    sched.tick(step, ctx);
    remainingMs -= step;
    sinceSample += step;
    if (sinceSample >= TICKS_PER_HOUR_MS) {
      sinceSample = 0; hour++;
      sample(hour);
      if (!asJson) {
        const rows = samples.filter(s => s.hour === hour);
        for (const s of rows) {
          console.log(`h${String(s.hour).padStart(3)} ${s.spiritId.padEnd(10)} `
            + `mass ${s.mass.toFixed(2).padStart(9)}  ${s.tier.padEnd(8)} `
            + `believers ${String(s.believers).padStart(4)}  `
            + `f ${f3(s.meanF)}  u ${f3(s.meanU)}  d ${f3(s.meanD)}`);
        }
        console.log(`   (${((Date.now() - t0) / 1000).toFixed(0)}s elapsed)`);
      }
    }
  }

  if (asJson) {
    console.log(JSON.stringify({
      genSeed, hours,
      fades: { understanding: UNDERSTANDING_FADE_PER_DAY, devotion: DEVOTION_FADE_PER_DAY },
      firstCult: Object.fromEntries(firstCult), firstMajor: Object.fromEntries(firstMajor),
      samples,
    }, null, 2));
    return;
  }
  banner();
  console.log('\n## tier ladder (first game-hour at or above the IN edge)');
  for (const sid of [...state.spirits.keys()].sort()) {
    console.log(`  ${sid.padEnd(10)} cult @ ${firstCult.get(sid) ?? '—'}h   major @ ${firstMajor.get(sid) ?? '—'}h`);
  }
  console.log('\n## final');
  for (const s of samples.filter(x => x.hour === hour)) {
    console.log(`  ${s.spiritId.padEnd(10)} mass ${s.mass.toFixed(2).padStart(9)}  ${s.tier.padEnd(8)}`
      + ` power ${s.power.toFixed(1).padStart(10)}  believers ${String(s.believers).padStart(4)}`
      + `  f ${f3(s.meanF)}  u ${f3(s.meanU)}  d ${f3(s.meanD)}`);
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const mode = argv.find(a => !a.startsWith('-')) ?? 'bench';
  const num = (flag: string, dflt: number): number => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : dflt;
  };
  if (mode === 'bench') { runBench(); return; }
  await runWorld(num('--seed', 12345), num('--hours', 48), argv.includes('--json'));
}

main().catch((err) => { console.error(err); process.exit(1); });
