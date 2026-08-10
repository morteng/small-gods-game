/**
 * probe-mill-gap — does a placed watermill's WHEEL actually reach the water it was
 * sited against? (Believability round WP-1, docs/audit/IMPLEMENTATION-PLAN.md §1.2.)
 *
 * The user-visible defect this measures has TWO halves:
 *
 *   LATERAL  — `computeMillSites` tagged the bank off the render water-TYPE mask, which is
 *              the smoothed ribbon PLUS its fringe. Both the cell the mill stands on and the
 *              cell its wheel hangs over are now judged by `paintedWaterAt` instead — the one
 *              query that answers "is this cell BLUE on screen".
 *   VERTICAL — the dominant half. The wheel hangs a CONSTANT `submerge` below the mill's foot
 *              (`blueprint/parts/structural.ts`, `cz = radius − submerge`), so on any bank
 *              standing higher than the drawn fill line the wheel stops short of it.
 *
 * Everything is reported in ONE unit — metres of terrain elevation — because the wheel and
 * the terrain live in different vertical spaces (see `metresPerPrimZ` in
 * `src/world/mill-site-store.ts`; a metre of terrain is NOT a metre of sprite).
 *
 *   npx tsx scripts/probe-mill-gap.ts                 # default seeds 12345, 777
 *   npx tsx scripts/probe-mill-gap.ts 12345 --census  # + the whole-map site census
 *   npx tsx scripts/probe-mill-gap.ts --json
 *
 * Worldgen only — no sim ticks (mills are placed once, at gen). GOTCHA inherited from
 * probe-settlement-graph.ts: `generateWithNoise` calls `snapDrySettlementsOffWater`,
 * which mutates `poi.position` IN PLACE — deep-clone the laid-out POIs per seed.
 */
import { readFileSync } from 'node:fs';
import type { GameMap, WorldSeed, POI } from '@/core/types';
import { planWorldLayout } from '@/world/poi-layout';
import { generateWithNoise } from '@/map/map-generator';
import { heightField } from '@/render/gpu/terrain-field';
import { worldStyleOf } from '@/core/world-style';
import { getMillSites, millWheelGapM, millWaterDrawnAt, metresPerPrimZ } from '@/world/mill-site-store';
import { flankPoint, faceVector, type CardinalFace } from '@/world/settlement-plan';
import { blueprintOf } from '@/blueprint/entity';
import type { Entity } from '@/core/types';

interface MillRow {
  poiId: string;
  /** Footprint origin of the seated 2×2 mill precinct. */
  x: number; y: number;
  waterFace: CardinalFace | null;
  /** The cell the wheel hangs over (`flankPoint` of the water face). */
  wheelX: number; wheelY: number;
  /** Is the water plane PAINTED over the wheel cell (`paintedWaterAt`, via millWaterDrawnAt)? */
  wheelWet: boolean;
  /** Chebyshev distance to the nearest painted cell (0 when the wheel cell itself is painted). */
  wetDist: number;
  /** Metres the mill's foot stands above the drawn surface at the wheel cell. */
  gapM: number | null;
  /** False for a plan-only precinct: POIs with a zero-building zone rule reserve a mill rect
   *  but never emit a building, so there is nothing to judge. */
  built: boolean;
  /** The `submerge` param on the placed blueprint's waterwheel part (prim z units). */
  submerge: number | null;
  /** gapM − submerge·METRES_PER_PRIM_Z: ≤ 0 means the wheel's lower arc reaches the water. */
  shortfallM: number | null;
}

interface SeedReport {
  genSeed: number;
  sites: number;
  wetSites: number;
  gapQuantiles: { min: number; p50: number; p75: number; max: number } | null;
  mills: MillRow[];
}

function cloneLaidOutPois(pois: POI[]): POI[] {
  return pois.map((p) => ({ ...p, position: p.position ? { ...p.position } : p.position }));
}

/** Chebyshev distance from (x,y) to the nearest PAINTED water cell, capped at `max`. */
function nearestWetDist(map: GameMap, x: number, y: number, max = 6): number {
  for (let r = 0; r <= max; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (millWaterDrawnAt(map, x + dx, y + dy)) return r;
      }
    }
  }
  return max + 1;
}

function quantiles(xs: number[]): { min: number; p50: number; p75: number; max: number } | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const at = (f: number): number => s[Math.min(s.length - 1, Math.floor(f * s.length))];
  return { min: s[0], p50: at(0.5), p75: at(0.75), max: s[s.length - 1] };
}

/** The `submerge` param of a placed mill entity's waterwheel part, if it has one. */
function submergeOf(e: Entity): number | null {
  const rb = blueprintOf(e)?.rb;
  const wheel = rb?.parts.find((p) => p.type === 'waterwheel');
  const v = wheel?.params.submerge;
  return typeof v === 'number' ? v : null;
}

async function runSeed(genSeed: number, laidOut: WorldSeed, census: boolean): Promise<SeedReport> {
  const ws: WorldSeed = { ...laidOut, pois: cloneLaidOutPois(laidOut.pois) };
  const { map, world } = await generateWithNoise(ws.size.width, ws.size.height, genSeed, ws, {});

  const hf = heightField(map);
  const relief = worldStyleOf(map.worldSeed).mountainRelief;
  const mpz = metresPerPrimZ(map);

  // ── Site census: how many tagged sites survive a "the water is genuinely DRAWN here" test?
  let sites = 0, wetSites = 0;
  const gaps: number[] = [];
  if (census) {
    const all = getMillSites(map);
    sites = all.length;
    for (const s of all) {
      const g = millWheelGapM(map, s.x, s.y, s.waterFace, hf, relief);
      if (g === null) continue;
      wetSites++;
      gaps.push(g);
    }
  }

  // ── Placed mills. The precinct rect + its resolved water face live on the settlement plan;
  //    the entity carries the blueprint whose wheel `submerge` we are judging.
  const millEntities = new Map<string, Entity>();
  for (const e of world.query({})) {
    if ((e.properties as { civic?: string } | undefined)?.civic === 'mill') {
      millEntities.set(`${e.x},${e.y}`, e);
    }
  }

  const mills: MillRow[] = [];
  for (const plan of map.settlementPlans ?? []) {
    for (const c of plan.civics) {
      if (c.type !== 'mill') continue;
      const face = (c.waterFace ?? null) as CardinalFace | null;
      const wheel = face
        ? flankPoint(c.x, c.y, c.w, c.h, face)
        : { x: c.x, y: c.y };
      const wheelPainted = millWaterDrawnAt(map, wheel.x, wheel.y);
      // The BANK cell is the footprint cell the wheel hangs off — flankPoint minus the face
      // vector — NOT the footprint origin (for a 2×2 on an east/south flank they differ, and
      // measuring from the origin reads a cell that isn't under the wheel at all).
      const bank = face
        ? { x: wheel.x - faceVector(face)[0], y: wheel.y - faceVector(face)[1] }
        : null;
      const gapM = face && bank ? millWheelGapM(map, bank.x, bank.y, face, hf, relief) : null;
      const e = millEntities.get(`${c.x},${c.y}`);
      const submerge = e ? submergeOf(e) : null;
      mills.push({
        poiId: plan.poiId ?? '?',
        x: c.x, y: c.y,
        waterFace: face,
        wheelX: wheel.x, wheelY: wheel.y,
        wheelWet: wheelPainted,
        built: e !== undefined,
        wetDist: nearestWetDist(map, wheel.x, wheel.y),
        gapM,
        submerge,
        shortfallM: gapM !== null && submerge !== null ? gapM - submerge * mpz : null,
      });
    }
  }

  if (!process.argv.includes('--json')) {
    const zPxPerM = worldStyleOf(map.worldSeed).terrainVerticalExaggeration;
    console.log(`\n── seed ${genSeed} ── (relief ${relief} m/unit · ${zPxPerM} px/m · ${mpz.toFixed(3)} m per prim-z unit)`);
    if (census) {
      const q = quantiles(gaps);
      console.log(
        `site census: ${wetSites}/${sites} tagged sites have a genuinely WET wheel cell` +
        (q ? ` · gap min ${q.min.toFixed(2)} p50 ${q.p50.toFixed(2)} p75 ${q.p75.toFixed(2)} max ${q.max.toFixed(2)} m` : ''),
      );
    }
    if (mills.length === 0) console.log('mill precincts: NONE');
    for (const m of mills) {
      const gap = m.gapM === null ? '   —  ' : `${m.gapM.toFixed(2)}m`;
      const short = m.shortfallM === null ? '   —  ' : `${m.shortfallM.toFixed(2)}m`;
      console.log(
        `${m.poiId.padEnd(22)} @(${m.x},${m.y}) face ${String(m.waterFace).padEnd(6)}` +
        ` wheel (${m.wheelX},${m.wheelY}) ${m.wheelWet ? 'WET ' : 'DRY '}` +
        `nearestWet ${m.wetDist}t  gap ${gap}  submerge ${m.submerge ?? '—'}  ` +
        `shortfall ${short} ` +
        (!m.built ? '· plan-only (no building emitted)'
          : m.wheelWet && m.shortfallM !== null && m.shortfallM <= 0 ? '✓ reaches' : '✗ SHORT'),
      );
    }
  }
  return { genSeed, sites, wetSites, gapQuantiles: quantiles(gaps), mills };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const census = argv.includes('--census');
  const seedArgs = argv.filter((a) => !a.startsWith('--')).map(Number).filter((n) => Number.isFinite(n));
  const seeds = seedArgs.length ? seedArgs : [12345, 777];

  const ws = JSON.parse(readFileSync('public/data/worlds/default.json', 'utf8')) as WorldSeed;
  const layout = planWorldLayout(ws);
  const laidOut: WorldSeed = { ...ws, size: layout.size, pois: layout.pois, connections: layout.connections };

  const out: SeedReport[] = [];
  for (const seed of seeds) out.push(await runSeed(seed, laidOut, census));
  if (argv.includes('--json')) console.log(JSON.stringify(out, null, 2));
  else {
    const built = out.flatMap((r) => r.mills).filter((m) => m.built);
    const reaching = built.filter((m) => m.wheelWet && m.shortfallM !== null && m.shortfallM <= 0);
    const worst = built.reduce((a, m) => Math.max(a, m.shortfallM ?? 0), 0);
    console.log(
      `\nSUMMARY: ${reaching.length}/${built.length} BUILT mills have a wheel that both hangs over `
      + `painted water and reaches it (worst residual shortfall ${worst.toFixed(2)} m).`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
