/**
 * ONE-OFF measurement script for the fix/spawn-and-venue-walkability round
 * (docs/superpowers/plans/2026-08-01-interaction-scaling-plan.md, Phase 3
 * refresh (c)). NOT wired into CI or `scripts/`'s normal roster — run by hand,
 * before and after the fix, on the same default world seed.
 *
 * Defect 1: does a materialized extra's resolved home/work tile land on solid
 * ground? Measured DIRECTLY on `residentSlots`/`workplaceSlots` + `homeTileFor`/
 * `workTileFor`'s output for every inhabited settlement's full resident+worker
 * capacity — no sim ticking, no camera, so this isolates the SPAWN POSITION
 * defect from the unrelated "headless probe never realizes tiles" artifact.
 * Reported two ways:
 *   - `!tile.walkable` — state-INDEPENDENT structural solidity (the real
 *     defect: did the resolved tile land inside a building's blocked cells?).
 *   - `!isWalkable(map,x,y,world)` — the full runtime check (state==='realized'
 *     included), which is what a live game actually gates spawns on, and what
 *     the round's prior 492/492 number used. Reported for comparability, with
 *     the state-inflation caveat spelled out below the table.
 *
 * Defect 2: for every default-world settlement, is `marketAnchorTile` walkable
 * (again state-independent AND full-isWalkable)?
 */
import { readFileSync } from 'node:fs';
import type { WorldSeed } from '@/core/types';
import { Scheduler } from '@/core/scheduler';
import { planWorldLayout } from '@/world/poi-layout';
import { generateWithNoise } from '@/map/map-generator';
import { seedWorld } from '@/world/seed-world';
import { identityOracle } from '@/world/oracle';
import { PerceptionSystem } from '@/world/perception-system';
import { seedStatisticalCohorts } from '@/sim/cohorts';
import { residentCapacityForPoi, residentSlots, workplaceSlots, homeTileFor, workTileFor } from '@/sim/materialization';
import { marketAnchorTile } from '@/sim/population/settlement-demand';
import { isWalkable } from '@/sim/pathfinding';
import { createState } from '@/core/state';

async function main(): Promise<void> {
  const genSeed = Number(process.argv[2] ?? 12345);
  const ws = JSON.parse(readFileSync('public/data/worlds/default.json', 'utf8')) as WorldSeed;
  const layout = planWorldLayout(ws);
  const laidOut: WorldSeed = { ...ws, size: layout.size, pois: layout.pois, connections: layout.connections };

  const state = createState();
  const { map, world, biomeMap, trample } = await generateWithNoise(
    laidOut.size.width, laidOut.size.height, genSeed, laidOut, {},
  );
  state.map = map; state.worldSeed = laidOut; state.world = world; state.biomeMap = biomeMap; state.trample = trample;
  seedWorld({
    world, log: state.eventLog, clock: state.clock, spirits: state.spirits,
    rng: state.rng, worldSeed: laidOut, map, oracle: identityOracle,
  });
  state.cohorts = seedStatisticalCohorts(world, laidOut, state.spirits, state.clock.now());

  // Open every settlement's tiles the way a live game actually does — a headless
  // probe with NO tick at all leaves tile.state==='void' almost everywhere (the
  // documented caveat), which would make isWalkable fail on realization alone
  // regardless of whether the RESOLVED position is otherwise fine. `PerceptionSystem`
  // realizes a disc around each settlement's statistical cohort (P1 ruling) with no
  // camera required, so a few ticks here reproduces what "a settlement anyone has
  // ever looked at" looks like, without ticking the rest of the sim at all.
  const sched = new Scheduler();
  sched.register(new PerceptionSystem(identityOracle, () => state.map, undefined, () => state.cohorts));
  const ctx = { world, spirits: state.spirits, log: state.eventLog, clock: state.clock, rng: state.rng };
  for (let i = 0; i < 5; i++) sched.tick(600, ctx); // 5 × 600ms ≥ 2 perception fires (tickHz=2)

  // ── Defect 1: spawn-tile walkability over every settlement's full capacity ──
  let totalSlots = 0, solidSlots = 0, unwalkableFull = 0;
  const perPoi: { poiId: string; slots: number; solid: number; unwalkableFull: number }[] = [];
  for (const poiId of [...(state.cohorts?.keys() ?? [])].sort()) {
    const cap = residentCapacityForPoi(map, poiId, world);
    if (cap <= 0) continue;
    const homeDraws = residentSlots(map, poiId, cap, world);
    const jobDraws = workplaceSlots(map, poiId, cap, world);
    const homes = homeDraws.map((d) => ({ d, t: homeTileFor(d, map, world) }));
    const jobs = jobDraws.map((d) => ({ d, t: workTileFor(d, map, world) }));
    let solid = 0, full = 0;
    for (const { d, t } of [...homes, ...jobs]) {
      if (!map.tiles[t.y]?.[t.x]?.walkable) {
        solid++;
        console.log(`  STRUCTURAL FAIL ${poiId} building=${d.buildingId} kind=${d.kind} door=(${d.doorX},${d.doorY}) resolvedHome=(${t.x},${t.y})`);
      }
      if (!isWalkable(map, t.x, t.y, world)) full++;
    }
    perPoi.push({ poiId, slots: homes.length + jobs.length, solid, unwalkableFull: full });
    totalSlots += homes.length + jobs.length;
    solidSlots += solid;
    unwalkableFull += full;
  }

  console.log(`\n=== Defect 1 — spawn-tile walkability (seed ${genSeed}) ===`);
  console.log('poiId\tslots\t!walkable(structural)\t!isWalkable(full, incl. state)');
  for (const r of perPoi) console.log(`${r.poiId}\t${r.slots}\t${r.solid}\t${r.unwalkableFull}`);
  console.log(`TOTAL\t${totalSlots}\t${solidSlots}\t${unwalkableFull}`);
  console.log(`structural failure rate: ${solidSlots}/${totalSlots}`);
  console.log(`full isWalkable failure rate: ${unwalkableFull}/${totalSlots} (includes unrealized 'void' tiles — headless-probe artifact, see caveat)`);

  // ── Defect 2: gathering-venue walkability. Two scopes reported —
  // INHABITED (the 9 poiIds carrying a materialization-relevant cohort, matching
  // Defect 1's set and the round's "5 of 9 settlements" framing) and ALL (every
  // POI in the world seed, including uninhabited landmarks with no cohort). ──
  console.log(`\n=== Defect 2 — marketAnchorTile walkability (seed ${genSeed}) ===`);
  const inhabited = new Set(state.cohorts?.keys() ?? []);
  let venuesOk = 0, venuesOkFull = 0, venuesTotal = 0;
  let inhOk = 0, inhOkFull = 0, inhTotal = 0;
  for (const poi of laidOut.pois ?? []) {
    if (!poi.position) continue;
    const anchor = marketAnchorTile(map, poi.id, world);
    if (!anchor) { console.log(`${poi.id}\tNO ANCHOR`); continue; }
    venuesTotal++;
    const structuralOk = !!map.tiles[anchor.y]?.[anchor.x]?.walkable;
    const fullOk = isWalkable(map, anchor.x, anchor.y, world);
    if (structuralOk) venuesOk++;
    if (fullOk) venuesOkFull++;
    const isInhabited = inhabited.has(poi.id);
    if (isInhabited) { inhTotal++; if (structuralOk) inhOk++; if (fullOk) inhOkFull++; }
    console.log(`${poi.id}${isInhabited ? '*' : ''}\t(${anchor.x},${anchor.y})\tstructuralWalkable=${structuralOk}\tfullIsWalkable=${fullOk}`);
  }
  console.log('(* = one of the 9 inhabited settlements)');
  console.log(`ALL venues structurally walkable: ${venuesOk}/${venuesTotal}`);
  console.log(`ALL venues fully isWalkable (incl. state): ${venuesOkFull}/${venuesTotal}`);
  console.log(`INHABITED (9) venues structurally walkable: ${inhOk}/${inhTotal}`);
  console.log(`INHABITED (9) venues fully isWalkable (incl. state): ${inhOkFull}/${inhTotal}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
