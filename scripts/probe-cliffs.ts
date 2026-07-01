/**
 * Offline probe: does the `cliffs` POI form a real cliff coast on the demo island?
 * Mirrors the live worldgen path (island spec + laid-out POIs + reliefM 55) and
 * reports, near the cliffs anchor, how many coastal cells classify as Cliff /
 * RockyShore / Beach, and the biome of the clifftop itself (should be green, not
 * mountain). Run: npx tsx scripts/probe-cliffs.ts [seed1 seed2 ...]
 */
import { readFileSync } from 'node:fs';
import { generateTerrainFields, classifyBiomes } from '@/terrain/terrain-generator';
import { erodeElevation } from '@/terrain/erosion';
import { applyPoiInfluences } from '@/terrain/poi-influence';
import { styledIslandSpec } from '@/terrain/island-mask';
import { styledShapeSpec } from '@/terrain/terrain-shape';
import { worldStyleOf } from '@/core/world-style';
import { planWorldLayout } from '@/world/poi-layout';
import { buildCoastalLandmarks } from '@/world/coastal-landmarks';
import type { WorldSeed, TerrainConfig } from '@/core/types';

const ws = JSON.parse(readFileSync('public/data/worlds/default.json', 'utf8')) as WorldSeed;
const layout = planWorldLayout(ws);
const W = layout.size.width, H = layout.size.height;
const pois = layout.pois;
const relief = worldStyleOf(ws).mountainRelief;
const cliff = pois.find(p => p.type === 'cliffs');
console.log(`map ${W}x${H}  relief=${relief}  cliffs POI @ (${cliff?.position?.x},${cliff?.position?.y}) coast=${(cliff as any)?.coast}`);

const seeds = process.argv.slice(2).map(Number);
if (seeds.length === 0) seeds.push(1000, 2000, 3000, 4242, 7777);

function run(seed: number, withCliffs: boolean) {
  const maxDim = Math.max(W, H);
  const cfg: TerrainConfig = {
    seed, width: W, height: H,
    elevationScale: 6.0 / maxDim, moistureScale: 8.0 / maxDim,
    seaLevel: 0.35, poleFalloff: true, continentWarp: 2.0,
    island: styledIslandSpec(ws), shape: styledShapeSpec(ws), reliefM: relief,
  };
  const fields = generateTerrainFields(cfg);
  fields.elevation = erodeElevation(fields.elevation, W, H, { seed });
  const coastal = new Set(['cliffs', 'sea_stacks', 'cove', 'headland']);
  const usePois = withCliffs ? pois : pois.filter(p => !coastal.has(p.type));
  if (usePois.length) applyPoiInfluences(fields, usePois, cfg);
  const bm = classifyBiomes(fields, cfg);
  return { bm, elev: fields.elevation };
}

const SEA = 0.35;
function maxSeawardSlopeM(elev: Float32Array, x: number, y: number): number {
  // Steepest drop to an adjacent SEA cell, in metres/tile (the cliff-face metric).
  let s = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    if (elev[ny * W + nx] < SEA) {
      const drop = (elev[y * W + x] - SEA) * relief;   // height above the water it meets
      if (drop > s) s = drop;
    }
  }
  return s;
}

for (const seed of seeds) {
  const off = run(seed, false);
  const on = run(seed, true);
  // Locate the plateau by the biggest elevation increase (the carve the cliffs POI made).
  let ax = -1, ay = -1, dMax = 0;
  for (let i = 0; i < on.elev.length; i++) {
    const d = on.elev[i] - off.elev[i];
    if (d > dMax) { dMax = d; ax = i % W; ay = (i / W) | 0; }
  }
  // Around the plateau: how many shoreline cells now plunge to the sea with a
  // face steeper than CLIFF_SLOPE_M (1.2 m/tile)? And the clifftop height/biome.
  let faceCells = 0, faceRock = 0, topElev = 0, topBiome = '?';
  const R = 30;
  for (let y = Math.max(0, ay - R); y < Math.min(H, ay + R); y++)
    for (let x = Math.max(0, ax - R); x < Math.min(W, ax + R); x++) {
      const e = on.elev[y * W + x];
      if (e < SEA) continue;
      if (maxSeawardSlopeM(on.elev, x, y) >= 1.2) {
        faceCells++;
        const b = on.bm.biomes[y * W + x];
        if (b === 'mountain' || b === 'peak' || b === 'cliff' || b === 'rocky_shore') faceRock++;
      }
      if (e > topElev) { topElev = e; topBiome = on.bm.biomes[y * W + x]; }
    }
  const topM = ((topElev - SEA) * relief).toFixed(1);
  // Sea stacks: cells that crossed sea→land (were ocean off, are rock now) — i.e.
  // new islets the sea_stacks POI raised. Count + classify their biome.
  let stackCells = 0, stackRock = 0, floodCells = 0;
  for (let i = 0; i < on.elev.length; i++) {
    if (off.elev[i] < SEA && on.elev[i] >= SEA) {
      stackCells++;                                       // sea→land: stacks + headland/cliff toe
      const b = on.bm.biomes[i];
      if (b === 'mountain' || b === 'peak' || b === 'cliff' || b === 'rocky_shore') stackRock++;
    }
    if (off.elev[i] >= SEA && on.elev[i] < SEA) floodCells++;   // land→sea: the cove flooding in
  }
  const arches = buildCoastalLandmarks(on.bm.biomes, W, H, seed);
  const archNearCliff = arches.filter(a => Math.abs((a.x | 0) - ax) < 60 && Math.abs((a.y | 0) - ay) < 60).length;
  console.log(
    `seed ${seed}: plateau@(${ax},${ay}) +${dMax.toFixed(3)} → top ${topM}m (${topBiome})` +
    `  | sheer-face=${faceCells}(rock ${faceRock})  cove flood=${floodCells}` +
    `  | sea_arches=${arches.length} @ ${arches.map(a => `(${a.x | 0},${a.y | 0})`).join(' ')} [${archNearCliff} near cliffs]`,
  );
}
