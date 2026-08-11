/** Per-deck bridge classifier: where did each placed deck END UP relative to the water the
 *  player SEES?
 *
 *  THIS IS THE ACCEPTANCE INSTRUMENT for every bridge-siting change. The criterion is always
 *  "where did the deck end up relative to the DRAWN water", never a decline count — three
 *  rounds of bridge fixes each judged themselves against a different, convenient metric
 *  (most recently a "crossing decline count", which only asks whether banks could be seated
 *  on a ribbon) and shipped while the player's bug was untouched. A decline count is reported
 *  here only as a per-deck diagnostic string; it is NOT a success metric.
 *
 *  Per deck (= per post-reconcile `CrossingSpec`, from a re-run of the span pass that
 *  worldgen itself uses at `src/map/map-generator.ts` — `detectCrossings(roadGraph, width,
 *  { isWater: renderWaterAt, bridgeAt: renderWaterAt, defaults: { era: 'late-medieval',
 *  prosperity: 'modest' } })`, with `renderWaterAt` = `getRenderWaterMask(map)`). Keep this
 *  call byte-identical to that call site: if it drifts, the probe measures a different world
 *  than the game builds.
 *
 *  Reported per deck: the two abutment cells; drawn-water samples along the abutment chord
 *  (`getRenderWaterMask` per cell + `getRenderWaterDist` at 0.1-tile steps); per-cell
 *  `tile.type` / `baseType` / ribbon `WaterType`; a `blind` count; bank distances to every
 *  drawn road ribbon and to the deck's OWN edge ribbon; the decline reason; and three class
 *  flags:
 *    - class1 — the deck spans no drawn water at all
 *    - class2 — BOTH abutments stand in drawn water
 *    - class3 — a bank sits >=2 tiles off every drawn road ribbon
 *
 *  Mechanism fingerprints (which cause put the deck there), also per deck:
 *    - blind (mask blindness): chord cells whose baseType is water but the render mask reads
 *      dry — the tile fallback was destroyed by the road/bridge stamp and the ribbon never
 *      covered the cell
 *    - bank ribbon-wet but tile-dry: the +0.7-tile render stamp margin
 *    - nearestDry fingerprint: a seated bank sitting >0.75 tiles off its OWN edge's drawn
 *      ribbon (the normal `banksOnRibbon` walk returns points ON the ribbon by construction,
 *      so an off-ribbon bank can only have come from the `nearestDry` tangent/ring rescue)
 *
 *  A trailing aggregate audits every routed bridge CELL (not just seated decks) for the same
 *  disagreement the router and the renderer can have: the router bridges
 *  `WATER_TYPES.has(tile.type)`, the seater reads the painted mask.
 *
 *  Usage: npx tsx scripts/probe-bridge-decks.ts [world] [seed] [--summary]
 *         e.g. npx tsx scripts/probe-bridge-decks.ts default 777
 *  `--summary` prints only the per-combo table row (decks / class1 / class2 / class3).
 */
import { readFileSync } from 'node:fs';
import { planWorldLayout } from '@/world/poi-layout';
import { generateWithNoise } from '@/map/map-generator';
import { getRenderWaterMask, getRenderWaterDist } from '@/world/render-water';
import { buildRenderWaterTypeMemo } from '@/render/gpu/render-water-mask';
import { detectCrossings } from '@/world/connectome/detect-crossings';
import { smoothCenterline, type Pt } from '@/terrain/road-centerline';
import { WATER_TYPES } from '@/core/constants';
import { WaterType } from '@/core/types';
import type { GameMap, WorldSeed } from '@/core/types';
import type { RoadGraph } from '@/world/road-graph';

export interface Row {
  world: string; seed: number; id: string; seated: boolean; declineReason?: string;
  b0: [number, number]; b1: [number, number]; spanLen: number;
  // interior chord cells (excluding the two bank cells)
  nCells: number; maskWet: number; tileWet: number; baseWet: number; ribbonWet: number; blind: number;
  chordCrossesDist: boolean;        // any continuous sample dist<0 strictly between banks
  bank0Wet: boolean; bank1Wet: boolean;               // mask at bank cell
  bank0RibbonVal: number; bank1RibbonVal: number;     // WaterType at bank per ribbon array
  bank0TileWet: boolean; bank1TileWet: boolean;
  bank0RoadDist: number; bank1RoadDist: number;       // min dist to ANY drawn road ribbon sample
  bank0OwnDist: number; bank1OwnDist: number;         // min dist to OWN edge's drawn ribbon
  nearestVisWater: number;                            // ring dist from chord midpoint to mask/tile wet
  waterKindNear: string;                              // ribbon WaterType at that nearest wet cell (or 'tile-only')
  class1: boolean; class2: boolean; class3: boolean;
}

export interface BridgeCellStats {
  bridged: number; cellTileWet: number; cellPaintedWet: number; tileOnly: number; unpaintedNearPaint: number;
  unpaintedLines: string[];
}

/**
 * THE per-deck classifier — the acceptance instrument for bridge siting (see file header).
 * Exported so OTHER callers (tests, other probes) score a generated map the SAME way the
 * CLI does; never reimplement this logic at a second call site.
 */
export function classifyBridgeDecks(map: GameMap, worldName = '', seed = 0): Row[] {
  const W = map.width;
  const mask = getRenderWaterMask(map);
  const dist = getRenderWaterDist(map);
  let ribbonArr: Uint8Array | null = null;
  try { ribbonArr = buildRenderWaterTypeMemo(map); } catch { ribbonArr = null; }
  const graph = (map as unknown as { roadGraph?: RoadGraph }).roadGraph;
  if (!graph) return [];

  // Reproduce the span pass detection EXACTLY (see the header note on the map-generator call site).
  const specs = detectCrossings(graph, W, {
    isWater: mask, bridgeAt: mask,
    defaults: { era: 'late-medieval', prosperity: 'modest' },
  });

  // Drawn road ribbons: smoothCenterline(polyline, pins) per road edge, sampled at 0.25 tiles.
  const ribbonSamples = new Map<string, Pt[]>();
  for (const e of graph.edges) {
    if (e.feature !== 'road' || e.polyline.length < 2) continue;
    const sm = smoothCenterline(e.polyline as Pt[], e.pins?.length ? { keepIndices: new Set(e.pins) } : {});
    const out: Pt[] = [];
    for (let i = 0; i < sm.length - 1; i++) {
      const ax = sm[i].x, ay = sm[i].y, bx = sm[i + 1].x, by = sm[i + 1].y;
      const len = Math.hypot(bx - ax, by - ay);
      const steps = Math.max(1, Math.ceil(len / 0.25));
      for (let s = 0; s < steps; s++) out.push({ x: ax + (bx - ax) * (s / steps), y: ay + (by - ay) * (s / steps) });
    }
    out.push(sm[sm.length - 1]);
    ribbonSamples.set(e.id, out);
  }
  const allSamples: Pt[] = [];
  for (const pts of ribbonSamples.values()) allSamples.push(...pts);
  const minDistTo = (pts: Pt[], x: number, y: number): number => {
    let best = Infinity;
    for (const p of pts) { const d = Math.hypot(p.x - x, p.y - y); if (d < best) best = d; }
    return best;
  };

  const tileAt = (x: number, y: number) => map.tiles[y]?.[x];
  const isTileWet = (x: number, y: number) => WATER_TYPES.has(tileAt(x, y)?.type ?? '');
  const isBaseWet = (x: number, y: number) => {
    const t = tileAt(x, y) as unknown as { type?: string; baseType?: string } | undefined;
    return WATER_TYPES.has(t?.type ?? '') || (t?.baseType !== undefined && WATER_TYPES.has(t.baseType));
  };

  const rows: Row[] = [];
  for (const spec of specs) {
    const banks = spec.bankCells
      ? [{ x: spec.bankCells[0][0], y: spec.bankCells[0][1] }, { x: spec.bankCells[1][0], y: spec.bankCells[1][1] }]
      : spec.banks;
    if (!banks) continue;
    const [b0, b1] = banks;
    const spanLen = Math.hypot(b1.x - b0.x, b1.y - b0.y);
    // Interior chord cells (unique), excluding the bank cells themselves.
    const cells = new Map<string, [number, number]>();
    const steps = Math.max(2, Math.ceil(spanLen / 0.1));
    let chordCrossesDist = false;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = b0.x + (b1.x - b0.x) * t, y = b0.y + (b1.y - b0.y) * t;
      const cx = Math.round(x), cy = Math.round(y);
      const isBank = (cx === Math.round(b0.x) && cy === Math.round(b0.y)) || (cx === Math.round(b1.x) && cy === Math.round(b1.y));
      if (!isBank) cells.set(`${cx},${cy}`, [cx, cy]);
      // continuous sample strictly between banks (0.75 tiles clear of each end)
      const arc = t * spanLen;
      if (arc > 0.75 && spanLen - arc > 0.75 && dist(x + 0.5, y + 0.5) < 0) chordCrossesDist = true;
    }
    let maskWet = 0, tileWet = 0, baseWet = 0, ribbonWet = 0, blind = 0;
    for (const [, [cx, cy]] of cells) {
      const m = mask(cx, cy), tw = isTileWet(cx, cy), bw = isBaseWet(cx, cy);
      const rv = ribbonArr ? ribbonArr[cy * W + cx] : WaterType.Dry;
      if (m) maskWet++;
      if (tw) tileWet++;
      if (bw) baseWet++;
      if (rv !== WaterType.Dry) ribbonWet++;
      if (bw && !m) blind++;
    }
    const rb0 = { x: Math.round(b0.x), y: Math.round(b0.y) }, rb1 = { x: Math.round(b1.x), y: Math.round(b1.y) };
    // nearest visibly wet cell (mask OR tile) from chord midpoint, ring search
    const mid = { x: Math.round((b0.x + b1.x) / 2), y: Math.round((b0.y + b1.y) / 2) };
    let nearestVisWater = Infinity; let waterKindNear = 'none';
    outer: for (let r = 0; r <= 8; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const cx = mid.x + dx, cy = mid.y + dy;
        if (mask(cx, cy) || isTileWet(cx, cy)) {
          nearestVisWater = r;
          const rv = ribbonArr ? ribbonArr[cy * W + cx] : WaterType.Dry;
          waterKindNear = rv === WaterType.River ? 'river-ribbon' : rv === WaterType.Lake ? 'lake' : rv === WaterType.Ocean ? 'ocean' : 'tile-only';
          break outer;
        }
      }
    }
    const edgeId = spec.id.replace(/^crossing@/, '').replace(/#\d+$/, '');
    const own = ribbonSamples.get(edgeId);
    const bank0Wet = mask(rb0.x, rb0.y), bank1Wet = mask(rb1.x, rb1.y);
    const row: Row = {
      world: worldName, seed, id: spec.id, seated: !!spec.bankCells,
      declineReason: spec.declineReason,
      b0: [rb0.x, rb0.y], b1: [rb1.x, rb1.y], spanLen: Math.round(spanLen * 100) / 100,
      nCells: cells.size, maskWet, tileWet, baseWet, ribbonWet, blind,
      chordCrossesDist,
      bank0Wet, bank1Wet,
      bank0RibbonVal: ribbonArr ? ribbonArr[rb0.y * W + rb0.x] : -1,
      bank1RibbonVal: ribbonArr ? ribbonArr[rb1.y * W + rb1.x] : -1,
      bank0TileWet: isTileWet(rb0.x, rb0.y), bank1TileWet: isTileWet(rb1.x, rb1.y),
      bank0RoadDist: Math.round(minDistTo(allSamples, rb0.x, rb0.y) * 100) / 100,
      bank1RoadDist: Math.round(minDistTo(allSamples, rb1.x, rb1.y) * 100) / 100,
      bank0OwnDist: own ? Math.round(minDistTo(own, rb0.x, rb0.y) * 100) / 100 : -1,
      bank1OwnDist: own ? Math.round(minDistTo(own, rb1.x, rb1.y) * 100) / 100 : -1,
      nearestVisWater: Number.isFinite(nearestVisWater) ? nearestVisWater : -1,
      waterKindNear,
      class1: maskWet === 0 && !chordCrossesDist,
      class2: bank0Wet && bank1Wet,
      class3: false,
    };
    row.class3 = Math.max(row.bank0RoadDist, row.bank1RoadDist) >= 2;
    rows.push(row);
  }
  return rows;
}

/**
 * Routed-bridge-CELL audit: the router bridges `WATER_TYPES.has(tile.type)`
 * (`src/world/road-graph.ts`), the crossing seater reads the painted mask. Where they
 * disagree at a bridged cell, the deck spans something the player cannot see. This is a
 * LOOSER, whole-edge aggregate than {@link classifyBridgeDecks} (every tile the road walker
 * marked as bridge, not just each crossing's own interior chord) — exported for the same
 * "score it the way the CLI does" reason.
 */
export function classifyBridgeCells(map: GameMap): BridgeCellStats {
  const W = map.width;
  const mask = getRenderWaterMask(map);
  const graph = (map as unknown as { roadGraph?: RoadGraph }).roadGraph;
  const tileAt = (x: number, y: number) => map.tiles[y]?.[x];
  const isBaseWet = (x: number, y: number) => {
    const t = tileAt(x, y) as unknown as { type?: string; baseType?: string } | undefined;
    return WATER_TYPES.has(t?.type ?? '') || (t?.baseType !== undefined && WATER_TYPES.has(t.baseType));
  };
  let bridged = 0, cellTileWet = 0, cellPaintedWet = 0, tileOnly = 0, unpaintedNearPaint = 0;
  const unpaintedLines: string[] = [];
  if (!graph) return { bridged, cellTileWet, cellPaintedWet, tileOnly, unpaintedNearPaint, unpaintedLines };
  for (const e of graph.edges) {
    if (!e.bridgeCells?.length) continue;
    const rows2: string[] = [];
    for (const idx of e.bridgeCells) {
      const x = idx % W, y = Math.floor(idx / W);
      const t = tileAt(x, y) as unknown as { type?: string; baseType?: string } | undefined;
      const tw = isBaseWet(x, y);
      const pw = mask(x, y);
      bridged++; if (tw) cellTileWet++; if (pw) cellPaintedWet++; if (tw && !pw) tileOnly++;
      if (!pw) {
        let near = false;
        for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) if (mask(x + dx, y + dy)) { near = true; break; }
        if (near) unpaintedNearPaint++;
        rows2.push(`   (${x},${y}) tile=${t?.type} base=${t?.baseType ?? '-'} tileWet=${tw} PAINTED=false paintedWithin2=${near}`);
      }
    }
    if (rows2.length) {
      unpaintedLines.push(`== ${e.id}: ${rows2.length}/${e.bridgeCells.length} bridged cells are NOT painted water`, ...rows2);
    }
  }
  return { bridged, cellTileWet, cellPaintedWet, tileOnly, unpaintedNearPaint, unpaintedLines };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const summary = args.includes('--summary');
  const positional = args.filter((a) => !a.startsWith('--'));
  const worldName = positional[0] ?? 'default';
  const seed = Number(positional[1] ?? 777);
  const ws = JSON.parse(readFileSync(`public/data/worlds/${worldName}.json`, 'utf8')) as WorldSeed;
  const layout = planWorldLayout(ws);
  const laidOut: WorldSeed = { ...ws, size: layout.size, pois: layout.pois, connections: layout.connections };
  const { map } = await generateWithNoise(laidOut.size.width, laidOut.size.height, seed, laidOut, {});
  const graph = (map as unknown as { roadGraph?: RoadGraph }).roadGraph;
  if (!graph) { console.log('NO ROAD GRAPH'); return; }

  const rows = classifyBridgeDecks(map, worldName, seed);

  const c1 = rows.filter((r) => r.class1), c2 = rows.filter((r) => r.class2), c3 = rows.filter((r) => r.class3);
  if (summary) {
    console.log(`| ${worldName}/${seed} | ${rows.length} | ${c1.length} | ${c2.length} | ${c3.length} |`);
    return;
  }

  for (const r of rows) console.log(JSON.stringify(r));
  console.log(`\n== ${worldName}/${seed}: decks ${rows.length} | class1(no-visible-water) ${c1.length} | class2(banks-in-water) ${c2.length} | class3(bank>=2-off-road) ${c3.length}`);
  console.log(`   class1 with blind(baseType-water) chord cells: ${c1.filter((r) => r.blind > 0).length}`);
  console.log(`   class1 with visible water within 2 of midpoint: ${c1.filter((r) => r.nearestVisWater >= 0 && r.nearestVisWater <= 2).length}`);
  console.log(`   seated decks with a bank >0.75 off OWN ribbon (nearestDry fingerprint): ${rows.filter((r) => r.seated && Math.max(r.bank0OwnDist, r.bank1OwnDist) > 0.75).length}`);

  const { bridged, cellTileWet, cellPaintedWet, tileOnly, unpaintedNearPaint, unpaintedLines } = classifyBridgeCells(map);
  console.log('\n-- routed bridge cells vs painted water');
  for (const line of unpaintedLines) console.log(line);
  console.log(`bridged cells ${bridged} | tile/base-wet ${cellTileWet} | painted-wet ${cellPaintedWet} | tile-wet-but-NOT-painted ${tileOnly} | unpainted-with-paint-within-2 ${unpaintedNearPaint}`);
}
// Run the CLI only when this file is the entry point — `classifyBridgeDecks` /
// `classifyBridgeCells` are also imported as a library (e.g. by
// `tests/integration/testbed-context.test.ts`, which reuses this classifier rather than
// reimplementing it), and an unconditional `main()` would re-run the whole CLI (default
// world/seed, stdout spam, `process.exit`) as a side effect of that import.
if (import.meta.url === new URL(process.argv[1] ?? '', 'file:').href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
