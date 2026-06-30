// scripts/crossing-approach-dive.ts
// Measures, on the REAL default world (no GPU), how far the road carriageway grade dips
// relative to the local ground on the LAND APPROACHES flanking each river crossing — the
// stretch the floating bridge deck does NOT cover. The river wins the channel UNDER the deck
// (expected, hidden), but if the road's grade-smoothing drags the approach DOWN toward the
// water before the bank, the road visibly plunges on dry land. That dive is the open question.
//
//   npx tsx scripts/crossing-approach-dive.ts
import { readFileSync } from 'node:fs';
import { generateWithNoise } from '../src/map/map-generator';
import { getComposedHeightfield } from '../src/world/road-deformation';
import { getHeightfield, ELEVATION_SEA_LEVEL } from '../src/world/heightfield';
import { styledIslandSpec } from '../src/terrain/island-mask';
import { worldStyleOf } from '../src/core/world-style';
import { WATER_TYPES } from '../src/core/constants';
import type { WorldSeed } from '../src/core/types';
import type { RoadEdge } from '../src/world/road-graph';

async function main(): Promise<void> {
  const ws = JSON.parse(readFileSync('public/data/worlds/default.json', 'utf8')) as WorldSeed;
  const { map } = await generateWithNoise(ws.size.width, ws.size.height, 12345, ws);
  const W = map.width, H = map.height;
  const relief = worldStyleOf(map.worldSeed).mountainRelief;

  const composed = getComposedHeightfield(map);
  const base = getHeightfield(map.seed, W, H, styledIslandSpec(map.worldSeed), map.worldSeed?.pois ?? null);
  const isWater = (x: number, y: number) => {
    const t = map.tiles?.[y]?.[x];
    return !!t && WATER_TYPES.has(t.type);
  };
  const diffM = (x: number, y: number) => (composed[y * W + x] - base[y * W + x]) * relief; // road moved surface, metres
  const groundM = (x: number, y: number) => (base[y * W + x] - ELEVATION_SEA_LEVEL) * relief;

  const edges = map.roadGraph?.edges ?? [];
  const crossingEdges = (edges as RoadEdge[]).filter((e) => e.bridgeCells && e.bridgeCells.length > 0);
  console.log(`road edges: ${edges.length}; edges with a crossing: ${crossingEdges.length}`);
  if (crossingEdges.length === 0) { console.log('no crossings in this world — nothing to measure'); return; }

  let worstApproachDive = 0;   // most negative diff on a DRY approach cell near a crossing (metres)
  let worstUnderDeck = 0;      // most negative diff on the water span (expected, masked by deck)
  let approachBelowGround = 0; // # dry approach cells pulled >0.5 m below their own ground
  let approachCells = 0;

  for (const edge of crossingEdges) {
    const bridges = new Set(edge.bridgeCells);
    const poly = edge.polyline;
    for (let i = 0; i < poly.length; i++) {
      const { x, y } = poly[i];
      const idx = y * W + x;
      const onWater = bridges.has(idx) || isWater(x, y);
      if (onWater) {
        worstUnderDeck = Math.min(worstUnderDeck, diffM(x, y));
        continue;
      }
      // dry land. Is it within 4 polyline steps of a bridge cell (i.e. an approach)?
      let nearCrossing = false;
      for (let k = Math.max(0, i - 4); k <= Math.min(poly.length - 1, i + 4); k++) {
        const p = poly[k];
        if (bridges.has(p.y * W + p.x) || isWater(p.x, p.y)) { nearCrossing = true; break; }
      }
      if (!nearCrossing) continue;
      approachCells++;
      const d = diffM(x, y);
      worstApproachDive = Math.min(worstApproachDive, d);
      if (d < -0.5) approachBelowGround++;
      void groundM; // reserved for richer reporting
    }
  }

  console.log(`approach cells sampled: ${approachCells}`);
  console.log(`worst dive UNDER the deck (water span, expected/masked): ${worstUnderDeck.toFixed(2)} m`);
  console.log(`worst dive on a DRY APPROACH (the open question):        ${worstApproachDive.toFixed(2)} m`);
  console.log(`dry approach cells pulled >0.5 m below ground:          ${approachBelowGround}`);
  const verdict =
    worstApproachDive < -1.5 ? 'SIGNIFICANT visible approach dive — fix is worth the risk'
    : worstApproachDive < -0.5 ? 'MILD approach dive — borderline'
    : 'NEGLIGIBLE approach dive — deck masks it; deferral stands';
  console.log(`VERDICT: ${verdict}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
