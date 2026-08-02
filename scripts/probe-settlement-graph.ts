/**
 * probe-settlement-graph — measure the two blockers Phase 3 named as the reason
 * migration moved zero souls (interaction-scaling plan, "S3.2 … NOT ACHIEVED"):
 *
 *   1. NO LORD IS EVER SEATED. `seedWorld` spawns only the six-soul cradle band,
 *      so the authored POI rosters — which DO carry `noble`s — never become
 *      entities. No noble ⇒ no seat ⇒ tithe 0 ⇒ every band pinned at
 *      STAT_UNTITHED_PROSPERITY, so the prospect function has no prosperity term.
 *   2. THE MIGRATION GRAPH IS DISCONNECTED. `roadNeighbours(map, poi, 1)` returns
 *      nothing for most inhabited POIs, so there is nowhere for a migrant to go
 *      even when a gradient exists.
 *
 * Worldgen only — this probe ticks NO sim (both quantities are properties of the
 * seeded world, and a tick would cost ~10 s/game-hour for nothing). It reports
 * per-POI authored roles, cohort population, road-graph degree and 1/2-hop
 * neighbours, plus the pair count that migration could actually use.
 *
 *   npx tsx scripts/probe-settlement-graph.ts                # default seeds
 *   npx tsx scripts/probe-settlement-graph.ts 12345 --json
 *
 * Harness copied from scripts/probe-scaling.ts (same GOTCHA: `generateWithNoise`
 * calls `snapDrySettlementsOffWater`, which mutates `poi.position` IN PLACE —
 * deep-clone the laid-out POIs per seed).
 */
import { readFileSync } from 'node:fs';
import type { WorldSeed, POI } from '@/core/types';
import { Scheduler } from '@/core/scheduler';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '@/core/calendar';
import { createState } from '@/core/state';
import { planWorldLayout } from '@/world/poi-layout';
import { generateWithNoise } from '@/map/map-generator';
import { seedWorld } from '@/world/seed-world';
import { identityOracle } from '@/world/oracle';
import { seedStatisticalCohorts } from '@/sim/cohorts';
import { cohortPopulation } from '@/sim/cohorts';
import { roadNeighbours } from '@/world/road-neighbours';
import { MIGRATION_MAX_HOPS } from '@/sim/cohort-migration';
import { noblesOf } from '@/sim/lord';
import { npcProps } from '@/world/npc-helpers';
import { LordSystem } from '@/sim/systems/lord-system';
import { CohortSystem } from '@/sim/systems/cohort-system';
import { SettlementAggregateSystem } from '@/sim/systems/settlement-aggregate-system';
import { CohortDynamicsSystem } from '@/sim/systems/cohort-dynamics-system';

interface PoiRow {
  poiId: string;
  type: string;
  size: string;
  authoredNpcs: number;
  authoredRoles: string[];
  authoredNobles: number;
  namedEntities: number;
  residentNobles: number;
  /** A lord actually holds this settlement's seat (LordSystem attachment). */
  seated: boolean;
  tithe: number;
  statPop: number;
  /** The statistical tier's prosperity need — flat 0.5 world-wide until a lord tithes. */
  prosperity: number;
  hasRoadNode: number;
  nb1: string[];
  nb2: string[];
  /** 1-hop neighbours that ALSO carry a cohort — the pairs migration can use. */
  nb1WithCohort: string[];
  /** Why a POI has no `poi` node: how far the nearest graph node of ANY kind sits. */
  nearestNode: { id: string; kind: string; dist: number } | null;
}

/** The closest road-graph node of any kind to a POI's final (post-snap) position. */
function nearestNodeTo(
  map: { roadGraph?: { nodes: { id: string; kind: string; x: number; y: number }[] } },
  poi: POI,
): { id: string; kind: string; dist: number } | null {
  const pos = poi.position;
  if (!pos) return null;
  let best: { id: string; kind: string; dist: number } | null = null;
  for (const n of map.roadGraph?.nodes ?? []) {
    const d = Math.hypot(n.x - pos.x, n.y - pos.y);
    if (!best || d < best.dist) best = { id: n.id, kind: n.kind, dist: d };
  }
  return best;
}

function cloneLaidOutPois(pois: POI[]): POI[] {
  return pois.map((p) => ({ ...p, position: p.position ? { ...p.position } : p.position }));
}

/** One game-hour of sim time, in sim-ms (the scheduler's unit). */
const GAME_HOUR_MS = 3_600_000;

function readDays(): number {
  const i = process.argv.indexOf('--days');
  const n = i >= 0 ? Number(process.argv[i + 1]) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * max/min statistical population across the inhabited settlements — the interaction-scaling
 * plan's own acceptance criterion for S3.2 ("does the population distribution actually
 * spread?"), measured the same way it was measured at 4.000 → 4.000.
 */
function spreadRatio(cohorts: ReadonlyMap<string, { bands: { count: number }[] }>): number {
  const pops = [...cohorts.values()]
    .map((sc) => cohortPopulation(sc as never))
    .filter((p) => p > 0);
  if (pops.length === 0) return 0;
  return Math.max(...pops) / Math.min(...pops);
}

async function runSeed(genSeed: number, laidOut: WorldSeed): Promise<PoiRow[]> {
  const ws: WorldSeed = { ...laidOut, pois: cloneLaidOutPois(laidOut.pois) };

  const state = createState();
  const { map, world, biomeMap, trample } = await generateWithNoise(
    ws.size.width, ws.size.height, genSeed, ws, {},
  );
  state.map = map; state.worldSeed = ws; state.world = world;
  state.biomeMap = biomeMap; state.trample = trample;

  seedWorld({
    world, log: state.eventLog, clock: state.clock, spirits: state.spirits,
    rng: state.rng, worldSeed: ws, map, oracle: identityOracle,
  });
  const cohorts = seedStatisticalCohorts(world, ws, state.spirits, state.clock.now());
  state.cohorts = cohorts;

  // --days N: tick the settlement-economy systems ONLY — the lord/tithe economy that
  // differentiates prosperity, and the mean-field dynamics that read it. Everything else
  // in the roster (movement, encounters, narrative, materialization) is irrelevant to the
  // population-spread question and would only cost wall clock. `LordSystem` and
  // `CohortDynamicsSystem` both fire per GAME_HOUR, so a 30-day run is 720 fires.
  const days = readDays();
  const spreadBefore = spreadRatio(cohorts);
  let migrated = 0;
  if (days > 0) {
    const scheduler = new Scheduler();
    const getCohorts = () => state.cohorts;
    scheduler.register(new LordSystem(getCohorts, () => state.runtimePois));
    const cohortSystem = new CohortSystem(getCohorts);
    scheduler.register(cohortSystem);
    scheduler.register(new SettlementAggregateSystem(
      () => state.settlementAggregates, getCohorts, () => state.settlementFlux));
    scheduler.register(new CohortDynamicsSystem(
      getCohorts, () => state.settlementAggregates, () => state.map, () => state.settlementFlux));

    const ctx = {
      world, spirits: state.spirits, log: state.eventLog,
      clock: state.clock, rng: state.rng,
    };
    // Both systems fire per GAME_HOUR, so the chunk size only has to be small enough not
    // to skip one — a whole game-hour per call is fine here (unlike probe-scaling, which
    // needs 250 ms chunks to interleave per-tick movement/encounter systems).
    let remainingMs = days * (TICKS_PER_DAY / TICKS_PER_HOUR) * GAME_HOUR_MS;
    while (remainingMs > 0) {
      const step = Math.min(GAME_HOUR_MS, remainingMs);
      scheduler.tick(step, ctx);
      remainingMs -= step;
    }
    migrated = cohortSystem.counters.cohortMigrations;
  }

  const namedByPoi = new Map<string, number>();
  for (const e of world.query({ kind: 'npc' })) {
    const home = npcProps(e).homePoiId;
    if (home) namedByPoi.set(home, (namedByPoi.get(home) ?? 0) + 1);
  }

  const rows: PoiRow[] = [];
  const inhabited = (ws.pois ?? []).filter((p) => (p.npcs?.length ?? 0) > 0);
  const withCohort = new Set(
    [...cohorts.entries()].filter(([, sc]) => cohortPopulation(sc) > 0).map(([id]) => id),
  );

  for (const poi of inhabited.slice().sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const roles = (poi.npcs ?? []).map((n) => String((n as { role?: string }).role ?? '?'));
    const nb1 = roadNeighbours(map, poi.id, MIGRATION_MAX_HOPS).map((n) => n.poiId);
    const nb2 = roadNeighbours(map, poi.id, 2).map((n) => n.poiId);
    const sc = cohorts.get(poi.id);
    rows.push({
      poiId: poi.id,
      type: String(poi.type),
      size: String(poi.size ?? 'small'),
      authoredNpcs: poi.npcs?.length ?? 0,
      authoredRoles: roles,
      authoredNobles: roles.filter((r) => r === 'noble').length,
      namedEntities: namedByPoi.get(poi.id) ?? 0,
      residentNobles: noblesOf(world, poi.id).length,
      seated: world.lords.has(poi.id),
      tithe: world.lords.get(poi.id)?.tithe ?? 0,
      statPop: sc ? cohortPopulation(sc) : 0,
      prosperity: sc?.bands.find((b) => b.count > 0)?.needs.prosperity ?? 0,
      hasRoadNode: (map.roadGraph?.nodes ?? []).filter(
        (n) => n.kind === 'poi' && n.poiRef === poi.id,
      ).length,
      nearestNode: nearestNodeTo(map, poi),
      nb1,
      nb2,
      nb1WithCohort: nb1.filter((id) => withCohort.has(id)),
    });
  }

  const roadEdges = (map.roadGraph?.edges ?? []).filter((e) => e.feature === 'road').length;
  const poiNodes = (map.roadGraph?.nodes ?? []).filter((n) => n.kind === 'poi').length;
  if (!process.argv.includes('--json')) {
    console.log(`\n── seed ${genSeed} ──`);
    console.log(
      `road graph: ${map.roadGraph?.nodes.length ?? 0} nodes (${poiNodes} poi), ${roadEdges} road edges`,
    );
    console.log(
      'poi'.padEnd(20) + 'type'.padEnd(11) + 'size'.padEnd(8) +
      'auth'.padEnd(6) + 'nobl'.padEnd(6) + 'named'.padEnd(7) +
      'seat'.padEnd(6) + 'prosp'.padEnd(7) + 'stat'.padEnd(6) + 'node'.padEnd(6) + 'nb1 (with cohort)',
    );
    for (const r of rows) {
      console.log(
        r.poiId.padEnd(20) + r.type.padEnd(11) + r.size.padEnd(8) +
        String(r.authoredNpcs).padEnd(6) + String(r.authoredNobles).padEnd(6) +
        String(r.namedEntities).padEnd(7) +
        (r.seated ? `y@${r.tithe.toFixed(2)}` : String(r.residentNobles)).padEnd(6) +
        r.prosperity.toFixed(4).padEnd(7) +
        String(r.statPop).padEnd(6) + String(r.hasRoadNode).padEnd(6) +
        `${r.nb1.length} (${r.nb1WithCohort.length})` +
        (r.nb1.length ? `  → ${r.nb1.join(', ')}` : '') +
        (r.hasRoadNode === 0 && r.nearestNode
          ? `  [no poi node; nearest ${r.nearestNode.kind} @ ${r.nearestNode.dist.toFixed(1)}t]`
          : ''),
      );
    }
    const pairs = new Set<string>();
    for (const r of rows) for (const o of r.nb1WithCohort) pairs.add([r.poiId, o].sort().join('|'));
    const isolated = rows.filter((r) => r.nb1WithCohort.length === 0).length;
    console.log(
      `\nSUMMARY seed ${genSeed}: ${rows.length} inhabited POIs · ` +
      `${rows.reduce((a, r) => a + r.authoredNobles, 0)} authored nobles · ` +
      `${rows.reduce((a, r) => a + r.residentNobles, 0)} noble ENTITIES · ` +
      `${rows.filter((r) => r.seated).length} SEATED lords · ` +
      `${pairs.size} migration-usable pairs · ${isolated} POIs with no cohort-bearing neighbour`,
    );
    console.log(
      `2-hop reach: ${rows.filter((r) => r.nb2.length > 0).length}/${rows.length} POIs have ≥1 neighbour within 2 hops`,
    );
    if (days > 0) {
      const prosp = rows.map((r) => r.prosperity);
      console.log(
        `after ${days} game-days: spread ratio ${spreadBefore.toFixed(3)} → ` +
        `${spreadRatio(cohorts).toFixed(3)} · ${migrated} souls migrated · ` +
        `prosperity ${Math.min(...prosp).toFixed(4)}…${Math.max(...prosp).toFixed(4)}`,
      );
    }
  }
  return rows;
}

async function main() {
  // `--days N` consumes its own value — otherwise N is read as an extra genSeed and the
  // probe silently reports a DIFFERENT world than the one asked for (it did, once).
  const argv = process.argv.slice(2);
  const daysIdx = argv.indexOf('--days');
  const seedArgs = argv
    .filter((a, i) => !a.startsWith('--') && i !== daysIdx + 1)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  const seeds = seedArgs.length ? seedArgs : [12345, 777];

  const ws = JSON.parse(readFileSync('public/data/worlds/default.json', 'utf8')) as WorldSeed;
  const layout = planWorldLayout(ws);
  const laidOut: WorldSeed = { ...ws, size: layout.size, pois: layout.pois, connections: layout.connections };

  const out: Record<string, PoiRow[]> = {};
  for (const seed of seeds) out[String(seed)] = await runSeed(seed, laidOut);
  if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
