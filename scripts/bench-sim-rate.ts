/**
 * bench-sim-rate — headless throughput bench for R9 Time Controls.
 *
 * Builds the default world (same generate → seed path bootstrap-world uses),
 * registers the live sim systems, and measures how much SIM TIME the budgeted
 * `TimeController.advance` sustains per real second — the number that sets the
 * fast-forward rate ladder (TIME_RATE_LADDER). Also reports the achieved
 * (effective) multiple at a set of requested rates so the ladder rungs are chosen
 * from measurement, not guessed.
 *
 *   npx tsx scripts/bench-sim-rate.ts
 *   npx tsx scripts/bench-sim-rate.ts 777        # gen seed
 *
 * NOTE: this is a NODE bench — no GPU/art/LPC. It registers the sim systems that
 * dominate CPU (the 60 Hz movement + command executor are the wall), which is
 * exactly what the budget bounds. The narrative systems (plot-thread / staging)
 * are low-Hz and cheap; omitting them makes the measured ceiling slightly
 * CONSERVATIVE, which is the safe direction for a ladder.
 */
import { readFileSync } from 'node:fs';
import type { WorldSeed } from '@/core/types';
import { Scheduler } from '@/core/scheduler';
import { createState } from '@/core/state';
import { planWorldLayout } from '@/world/poi-layout';
import { generateWithNoise } from '@/map/map-generator';
import { seedWorld } from '@/world/seed-world';
import { identityOracle } from '@/world/oracle';
import { generateRivalSpirits } from '@/sim/rival-spirit';
import { rivalToSpirit } from '@/sim/command/rival-adapter';
import { WaterDynamics } from '@/render/gpu/water-dynamics';
import { buildFloodWatch } from '@/world/flood-watch';
import { CausalSiteStore } from '@/world/causal-site';
import { queryNpcs, initNpcProps } from '@/world/npc-helpers';
import { PLAYER_SPIRIT_ID } from '@/sim/believers';

import { CommandExecutorSystem } from '@/sim/command/command-system';
import { CommandQueue } from '@/sim/command/command-queue';
import { NpcMovementSystem } from '@/sim/systems/npc-movement-system';
import { NpcSimSystem } from '@/sim/systems/npc-sim-system';
import { NpcActivitySystem } from '@/sim/systems/npc-activity-system';
import { BeliefPropagationSystem } from '@/sim/systems/belief-propagation-system';
import { BeliefContentSystem } from '@/sim/systems/belief-content-system';
import { SettlementEventSystem } from '@/sim/systems/settlement-event-system';
import { AbandonmentSystem } from '@/sim/systems/abandonment-system';
import { SpiritSystem } from '@/sim/spirit-system';
import { RivalSystem } from '@/sim/systems/rival-system';
import { MortalitySystem } from '@/sim/systems/mortality-system';
import { BirthSystem } from '@/sim/systems/birth-system';
import { SettlementGrowthSystem } from '@/sim/systems/settlement-growth-system';
import { RoadEvolutionSystem } from '@/sim/systems/road-evolution-system';
import { TrampleDepositSystem, TramplePromoteDecaySystem } from '@/sim/systems/trample-system';
import { WeatherSystem } from '@/sim/systems/weather-system';
import { PerceptionSystem } from '@/world/perception-system';

import { TimeController } from '@/game/time-controller';

const SIM_MS_PER_TICK = 16.667;
const FRAME_MS = 16.667;
/** Model a mature settlement (default seed is sparse ~6). */
const POP_TARGET = 60;

async function buildWorld(genSeed: number) {
  const ws = JSON.parse(readFileSync('public/data/worlds/default.json', 'utf8')) as WorldSeed;
  const layout = planWorldLayout(ws);
  ws.size = layout.size; ws.pois = layout.pois; ws.connections = layout.connections;

  const state = createState();
  const { map, world, biomeMap, trample } = await generateWithNoise(
    ws.size.width, ws.size.height, genSeed, ws, {},
  );
  state.map = map; state.worldSeed = ws; state.world = world; state.biomeMap = biomeMap; state.trample = trample;

  seedWorld({
    world, log: state.eventLog, clock: state.clock, spirits: state.spirits,
    rng: state.rng, worldSeed: ws, map, oracle: identityOracle,
  });

  // The default seed is sparse (~6 NPCs); a MATURE live world (after settlement
  // growth) carries many more, and the 60 Hz movement + belief propagation cost
  // scales with population. Seed a realistic cohort so the measured ceiling is
  // honest, not optimistic. Spread near the first placed POI, give each some faith
  // in the player so the belief systems actually do work.
  const anchor = (ws.pois ?? []).find((p) => p.position)?.position ?? { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) };
  const roles = ['farmer', 'priest', 'merchant', 'elder', 'soldier'] as const;
  const targetPop = Math.max(0, POP_TARGET - queryNpcs(world).length);
  for (let i = 0; i < targetPop; i++) {
    const role = roles[i % roles.length];
    const p = initNpcProps(`bench_npc_${i}`, role, (i * 2654435761) >>> 0);
    p.beliefs[PLAYER_SPIRIT_ID] = { faith: 0.3 + (i % 5) * 0.1, understanding: 0.4, devotion: 0.3 };
    const x = Math.max(1, Math.min(map.width - 2, anchor.x + ((i * 7) % 21) - 10));
    const y = Math.max(1, Math.min(map.height - 2, anchor.y + ((i * 11) % 21) - 10));
    world.addEntity({ id: `bench_npc_${i}`, kind: 'npc', x, y, properties: p as unknown as Record<string, unknown> });
  }

  // Rivals (mirror bootstrap-world.instantiateRivals).
  const settlementIds = (ws.pois ?? [])
    .filter((p) => Array.isArray((p as { npcs?: unknown[] }).npcs) && (p as { npcs?: unknown[] }).npcs!.length > 0)
    .map((p) => p.id);
  if (settlementIds.length) {
    for (const r of generateRivalSpirits(state.rng.nextInt(0x7fffffff), settlementIds, 2)) {
      state.spirits.set(r.id, rivalToSpirit(r));
    }
  }

  // Weather (mirror bootstrap-world.installWeather).
  state.weather = new WaterDynamics(map);
  const placed = (ws.pois ?? []).filter((p) => p.position);
  state.floodWatch = buildFloodWatch(
    placed.map((p) => ({ id: p.id, name: p.name ?? p.id, x: p.position!.x, y: p.position!.y, radius: 3 })),
    map.width, map.height,
  );
  state.causalSites = new CausalSiteStore(
    map.width, map.height, state.floodWatch.watchedCells(),
    placed.map((p) => ({ name: p.name ?? p.id, x: p.position!.x, y: p.position!.y })),
  );

  // Systems (mirror game.ts registration order; render/narrative-only systems omitted).
  const queue = new CommandQueue();
  const sched = new Scheduler();
  sched.register(new CommandExecutorSystem(queue, undefined, undefined, () => state.weather));
  sched.register(new NpcMovementSystem(() => state.map));
  sched.register(new TrampleDepositSystem(() => state.map, () => state.trample));
  sched.register(new TramplePromoteDecaySystem(() => state.map, () => state.trample));
  sched.register(new SettlementEventSystem());
  sched.register(new NpcSimSystem());
  sched.register(new AbandonmentSystem());
  sched.register(new NpcActivitySystem());
  sched.register(new BeliefPropagationSystem());
  sched.register(new BeliefContentSystem());
  sched.register(new SpiritSystem());
  sched.register(new RivalSystem(queue));
  sched.register(new MortalitySystem());
  sched.register(new BirthSystem());
  sched.register(new SettlementGrowthSystem(() => state.trample));
  sched.register(new RoadEvolutionSystem());
  sched.register(new WeatherSystem(() => state.weather, () => state.floodWatch, () => state.causalSites));
  sched.register(new PerceptionSystem(identityOracle, () => state.map));

  return { state, sched };
}

function ctxFor(state: ReturnType<typeof createState>) {
  return {
    world: state.world!, spirits: state.spirits, log: state.eventLog,
    clock: state.clock, rng: state.rng,
  };
}

/**
 * Drive advance() at `rate` for ~windowMs wall, modelling the real frame loop:
 * each frame does budgeted work then (when `pace`) idles down to a 60 fps floor —
 * so `mult` = sim-ms advanced / real-ms elapsed is the ACHIEVED multiple a player
 * would see. `pace=false` runs frames back-to-back (no idle) → the max sustainable
 * throughput (frames land at the 24 ms budget, never faster).
 */
function measureRate(
  state: ReturnType<typeof createState>, sched: Scheduler, rate: number, windowMs: number, pace: boolean,
): { mult: number; frames: number } {
  const tc = new TimeController({ scheduler: sched, clock: state.clock, eventLog: state.eventLog, state });
  tc.setRate(rate);
  const ctx = ctxFor(state);
  const t0 = performance.now();
  const clock0 = state.clock.now();
  let frames = 0;
  while (performance.now() - t0 < windowMs) {
    const frameStart = performance.now();
    tc.advance(FRAME_MS, ctx);
    frames++;
    // 60 fps floor: if the budgeted work finished early, idle out the rest of the
    // frame (spin — this is a bench, wall-time accuracy is the point).
    if (pace) while (performance.now() - frameStart < FRAME_MS) { /* idle to 60fps */ }
  }
  const realMs = performance.now() - t0;
  const simMs = (state.clock.now() - clock0) * SIM_MS_PER_TICK;
  return { mult: simMs / realMs, frames };
}

async function main(): Promise<void> {
  const genSeed = Number(process.argv[2] ?? 12345);
  process.stdout.write(`Building default world (genSeed ${genSeed})…\n`);
  const { state, sched } = await buildWorld(genSeed);
  const npcCount = queryNpcs(state.world!).length;
  process.stdout.write(`World ready: ${npcCount} NPCs, ${state.spirits.size} spirits, ${sched['systems']?.length ?? '?'} systems.\n\n`);

  // Warm up (JIT) a little before measuring.
  measureRate(state, sched, 60, 500, false);

  // Sustainable ceiling: request a huge rate, back-to-back frames (no idle). The
  // budget caps each frame → the achieved multiple IS the max sustainable
  // throughput over ~10 s wall.
  const ceil = measureRate(state, sched, 1_000_000, 10_000, false);
  process.stdout.write(`MAX SUSTAINABLE: ${ceil.mult.toFixed(0)}× sim/real  (${ceil.frames} frames over ~10s, budget-bounded)\n\n`);

  process.stdout.write('Requested → achieved (effective) multiple, paced to 60 fps:\n');
  for (const r of [8, 60, 600, 3600]) {
    const m = measureRate(state, sched, r, 1500, true);
    const capped = m.mult < r * 0.9 ? '  (budget-capped)' : '';
    process.stdout.write(`  ${String(r).padStart(6)}× → ${m.mult.toFixed(0)}×${capped}\n`);
  }

  // Suggested ladder: 1, ~8, ~60, and a friendly round-down of the ceiling.
  const friendly = (x: number): number => {
    const candidates = [50, 60, 120, 240, 300, 480, 600, 900, 1200, 1800, 2400, 3600, 5400, 7200];
    let best = candidates[0];
    for (const c of candidates) if (c <= x) best = c;
    return best;
  };
  const top = friendly(ceil.mult);
  process.stdout.write(`\nSUGGESTED LADDER: [1, 8, 60, ${top}]\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
