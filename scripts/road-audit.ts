// scripts/road-audit.ts — offline road-network audit (the road A*/drawing fix round's harness,
// cleaned up). Generates the default world headless for one or more seeds and measures the
// drawing-honesty metrics that round drove to zero, so a future road/terrain change can be
// checked against them in minutes:
//
//   * painted %        — road tiles the analytic ribbon actually covers (pavedness > 0.05)
//   * invisible        — road tiles with `baseType` set that NO centerline/street owns
//                        (walkable roads that would render as bare ground) — must stay 0
//   * ribbon-illegal   — planFilletReconcile badCells + planRibbonLegality violations
//                        (the drawn line crossing rock/water/curtain/building/green) — must stay 0
//   * dev(final|walked)— max deviation of the drawn centerline from the walked A* path
//   * offRaster        — max distance of the drawn line from ANY road/bridge tile (sag)
//   * node kinks       — angle between the two drawn tangents at each degree-2 node
//   * grade            — max/over-envelope PHYSICAL step grade (rise/run) of walked paths
//   * repair edges     — `re-repair-*` connectors (real edges since WCV 102)
//
// Usage:  npx tsx scripts/road-audit.ts [seed ...]        (default: 12345 777 999)

import { readFileSync } from 'node:fs';
import { planWorldLayout } from '@/world/poi-layout';
import { generateWithNoise } from '@/map/map-generator';
import { edgeRoadProfile, planFilletReconcile, planRibbonLegality } from '@/world/road-deformation';
import { ROAD_TILE_TYPES } from '@/world/road-graph';
import { WATER_TYPES } from '@/core/constants';
import { getHeightfield } from '@/world/heightfield';
import { styledIslandSpec } from '@/terrain/island-mask';
import { styledShapeSpec } from '@/terrain/terrain-shape';
import { worldStyleOf } from '@/core/world-style';
import { gradeEnvelope } from '@/world/road-state';
import { buildRoadFeatureGeometry, roadPavednessAt } from '@/render/gpu/feature-geometry';
import { METRES_PER_TILE } from '@/render/scale-contract';
import type { WorldSeed } from '@/core/types';

type Pt = { x: number; y: number };

function distToPolyline(pts: ReadonlyArray<Pt>, x: number, y: number): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1].x, ay = pts[i - 1].y;
    const dx = pts[i].x - ax, dy = pts[i].y - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return pts.length === 1 ? Math.hypot(x - pts[0].x, y - pts[0].y) : best;
}

function densify(pts: ReadonlyArray<Pt>, step: number): Pt[] {
  if (pts.length < 2) return pts.slice();
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n });
  }
  return out;
}

async function auditSeed(seed: number, ws: WorldSeed): Promise<void> {
  const layout = planWorldLayout(ws);
  const laidOut: WorldSeed = { ...ws, size: layout.size, pois: layout.pois, connections: layout.connections };
  const W = layout.size.width, H = layout.size.height;
  const { map, world } = await generateWithNoise(W, H, seed, laidOut);
  const graph = map.roadGraph!;
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const poiById = new Map((map.worldSeed?.pois ?? []).map((p) => [p.id, p]));
  const relief = worldStyleOf(map.worldSeed ?? undefined).mountainRelief;
  const hf = getHeightfield(seed, W, H, styledIslandSpec(map.worldSeed), map.worldSeed?.pois ?? null, styledShapeSpec(map.worldSeed));
  const elev = (x: number, y: number): number =>
    hf[Math.max(0, Math.min(H - 1, Math.round(y))) * W + Math.max(0, Math.min(W - 1, Math.round(x)))];

  const roadEdges = graph.edges.filter((e) => e.feature === 'road' && e.polyline.length >= 2);
  const finals = roadEdges
    .map((e) => ({ id: e.id, line: edgeRoadProfile(map, e, nodeById, poiById)?.centerline ?? [] }))
    .filter((f) => f.line.length >= 2);
  const streets = new Set<string>();
  for (const plan of map.settlementPlans ?? []) {
    for (const e of plan.edges ?? []) for (const t of e.tiles) streets.add(`${t.x},${t.y}`);
  }

  // Paint coverage + invisibility.
  const geo = buildRoadFeatureGeometry(map);
  let total = 0, painted = 0, invisible = 0, bridges = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = map.tiles[y][x];
      if (!ROAD_TILE_TYPES.has(t.type)) continue;
      total++;
      if (t.type === 'bridge') { bridges++; continue; }
      if (roadPavednessAt(geo, x, y) > 0.05) { painted++; continue; }
      if (t.baseType === undefined) continue;                      // tile-colour painted — visible
      if (streets.has(`${x},${y}`)) continue;                      // street styling owns it
      let d = Infinity;
      for (const f of finals) d = Math.min(d, distToPolyline(f.line, x, y));
      if (d > 0.9) invisible++;
    }
  }

  // Deviation, sag, grade (physical), per edge.
  let maxDev = 0, maxSag = 0, gradeOverSteps = 0, maxGradePhys = 0;
  const distRoad = (x: number, y: number): number => {
    for (let r = 0; r <= 4; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (ROAD_TILE_TYPES.has(map.tiles[Math.round(y) + dy]?.[Math.round(x) + dx]?.type ?? '')) return Math.hypot(dx, dy);
      }
    }
    return Infinity;
  };
  for (const e of roadEdges) {
    const walked = e.polyline as Pt[];
    const fin = finals.find((f) => f.id === e.id)?.line;
    if (fin) {
      for (const p of densify(fin, 0.25)) {
        maxDev = Math.max(maxDev, distToPolyline(walked, p.x, p.y));
        maxSag = Math.max(maxSag, distRoad(p.x, p.y));
      }
    }
    const env = gradeEnvelope(e.class);
    for (let i = 1; i < walked.length; i++) {
      const run = Math.hypot(walked[i].x - walked[i - 1].x, walked[i].y - walked[i - 1].y);
      if (run < 1e-6) continue;
      const wet = (p: Pt): boolean => {
        const tt = map.tiles[Math.round(p.y)]?.[Math.round(p.x)]?.type ?? '';
        return tt === 'bridge' || WATER_TYPES.has(tt);
      };
      if (wet(walked[i]) || wet(walked[i - 1])) continue;
      const g = (Math.abs(elev(walked[i].x, walked[i].y) - elev(walked[i - 1].x, walked[i - 1].y)) * relief) / (run * METRES_PER_TILE);
      maxGradePhys = Math.max(maxGradePhys, g);
      if (g > env.maxGrade) gradeOverSteps++;
    }
  }

  // Node kinks at degree-2 nodes (drawn tangents ~3 tiles into each edge).
  const nodeEdges = new Map<string, string[]>();
  for (const e of roadEdges) {
    for (const nid of [e.a, e.b]) nodeEdges.set(nid, [...(nodeEdges.get(nid) ?? []), e.id]);
  }
  let kinksOver60 = 0, worstKink = 0;
  for (const [nid, ids] of nodeEdges) {
    if (ids.length !== 2) continue;
    const node = nodeById.get(nid);
    if (!node) continue;
    const dirs: Pt[] = [];
    for (const id of ids) {
      const line = finals.find((f) => f.id === id)?.line;
      if (!line || line.length < 2) continue;
      const nearStart = Math.hypot(line[0].x - node.x, line[0].y - node.y)
        < Math.hypot(line[line.length - 1].x - node.x, line[line.length - 1].y - node.y);
      const p0 = nearStart ? line[0] : line[line.length - 1];
      const p1 = nearStart ? line[Math.min(3, line.length - 1)] : line[Math.max(0, line.length - 4)];
      const L = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
      dirs.push({ x: (p1.x - p0.x) / L, y: (p1.y - p0.y) / L });
    }
    if (dirs.length !== 2) continue;
    const deg = Math.acos(Math.max(-1, Math.min(1, -(dirs[0].x * dirs[1].x + dirs[0].y * dirs[1].y)))) * 180 / Math.PI;
    worstKink = Math.max(worstKink, deg);
    if (deg > 60) kinksOver60++;
  }

  const badSpanCells = planFilletReconcile(map, world).reduce((a, s) => a + s.badCells.length, 0);
  const lineIllegal = planRibbonLegality(map, world).reduce((a, v) => a + v.badCells.length, 0);
  const repairEdges = roadEdges.filter((e) => e.id.startsWith('re-repair')).length;

  console.log(`seed ${seed}: roadTiles=${total} (bridges=${bridges}) painted=${painted} (${(100 * painted / Math.max(1, total - bridges)).toFixed(0)}%) `
    + `INVISIBLE=${invisible} ribbonIllegal=${badSpanCells + lineIllegal} devFinalMax=${maxDev.toFixed(2)} sagMax=${Number.isFinite(maxSag) ? maxSag.toFixed(2) : 'inf'} `
    + `kinks>60=${kinksOver60} worstKink=${worstKink.toFixed(0)} gradeOverSteps=${gradeOverSteps} maxGradePhys=${maxGradePhys.toFixed(2)} repairEdges=${repairEdges}`);
}

async function main(): Promise<void> {
  const seeds = process.argv.slice(2).map(Number).filter(Number.isFinite);
  const ws = JSON.parse(readFileSync('public/data/worlds/default.json', 'utf8')) as WorldSeed;
  for (const s of seeds.length ? seeds : [12345, 777, 999]) await auditSeed(s, ws);
}

main().catch((e) => { console.error(e); process.exit(1); });
