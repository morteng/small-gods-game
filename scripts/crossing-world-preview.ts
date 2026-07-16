// scripts/crossing-world-preview.ts
// Render the CURRENT in-world bridge — the real deck/pier/arch entities the crossing pipeline
// places on the default world — assembled at their true relative heights, offline (no browser).
// The runtime lifts each entity vertically by liftPxFromElev(elev): the deck by its authored
// `liftElev` (bank height), piers/arches by terrain foot-z at their tile (the bed). Reproducing
// that one transform stacks the parts exactly as the GPU does — so we can see whether the deck
// already rides the arches, and whether it's flat (no hump). Structure-only (no terrain tiles);
// the RELATIVE stack is the question.
//
//   npx tsx scripts/crossing-world-preview.ts [seed]     # → .dev-grabs/crossing-world-<seed>.png
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { generateWithNoise } from '../src/map/map-generator';
import { getHeightfield, ELEVATION_SEA_LEVEL } from '../src/world/heightfield';
import { curveRenderElev } from '../src/render/gpu/terrain-field';
import { styledIslandSpec } from '../src/terrain/island-mask';
import { styledShapeSpec } from '../src/terrain/terrain-shape';
import { worldStyleOf } from '../src/core/world-style';
import { composeStructure } from '../src/assetgen/compose';
import { toGeometry } from '../src/blueprint/compile/to-geometry';
import { worldToScreen } from '../src/render/iso/iso-projection';
import { liftPxFromElev } from '../src/render/gpu/terrain-lift';
import { blueprintOf } from '../src/blueprint/entity';
import { detectCrossings } from '../src/world/connectome/detect-crossings';
import { buildBridgeObject } from '../src/world/connectome/crossing-structures';
import { WATER_TYPES } from '../src/core/constants';
import type { WorldSeed, Entity } from '../src/core/types';

const OUT = '.dev-grabs';
const BRIDGE_KINDS = new Set(['bridge', 'bridge_deck', 'bridge_pier', 'bridge_arch']);

interface Placed { grey: Uint8ClampedArray; cw: number; ch: number; ox: number; oy: number; footY: number }

async function main(): Promise<void> {
  const seed = Number(process.argv[2] ?? 12345);
  const ws = JSON.parse(readFileSync('public/data/worlds/default.json', 'utf8')) as WorldSeed;
  const { map, world } = await generateWithNoise(ws.size.width, ws.size.height, seed, ws);
  const W = map.width;
  const style = worldStyleOf(map.worldSeed ?? undefined);
  const hf = getHeightfield(seed, W, map.height, styledIslandSpec(map.worldSeed) ?? null, map.worldSeed?.pois ?? null, styledShapeSpec(map.worldSeed));
  const elevAt = (x: number, y: number) => curveRenderElev(hf[Math.round(y) * W + Math.round(x)] ?? ELEVATION_SEA_LEVEL, ELEVATION_SEA_LEVEL, style.terrainHeightGamma);
  const liftOf = (e: Entity): number => {
    const le = (e.properties as { liftElev?: number } | undefined)?.liftElev;
    const elev = le !== undefined ? le : elevAt(e.x, e.y);   // deck rides liftElev; pier/arch foot the bed
    return liftPxFromElev(elev, ELEVATION_SEA_LEVEL, style.mountainRelief, style.terrainVerticalExaggeration);
  };

  let best: Entity[];
  if (process.argv.includes('--new')) {
    // Build the NEW single-object bridge for every crossing and render the longest-span one.
    const isWater = (x: number, y: number) => { const t = map.tiles?.[Math.round(y)]?.[Math.round(x)]; return !!t && WATER_TYPES.has(t.type); };
    const specs = detectCrossings(map.roadGraph, W, { isWater, bridgeAt: isWater, defaults: { era: 'late-medieval', prosperity: 'modest' } });
    const objs = specs.map((s) => buildBridgeObject(s, { deckElevAt: elevAt, reliefM: style.mountainRelief, zPxPerM: style.terrainVerticalExaggeration })).filter((e): e is Entity => !!e);
    if (!objs.length) { console.log(`no crossings on seed ${seed}`); return; }
    const wantMin = process.argv.includes('--short');
    const size = (e: Entity) => { const fp = (e.properties as { footprint?: { w: number; h: number } }).footprint; return (fp?.w ?? 0) + (fp?.h ?? 0); };
    const pick = objs.reduce((m, e) => { const s = size(e); return (wantMin ? s < m.s : s > m.s) ? { e, s } : m; }, { e: objs[0], s: wantMin ? Infinity : 0 });
    best = [pick.e];
    console.log(`seed ${seed}: ${objs.length} one-object bridges; rendering the ${wantMin ? 'shortest' : 'longest'} (${blueprintOf(pick.e)!.rb.parts.length} parts)`);
  } else {
    const bridges = (world.query({}) as Entity[]).filter((e) => BRIDGE_KINDS.has(e.kind));
    if (!bridges.length) { console.log(`no bridge entities on seed ${seed}`); return; }
    // Production emits one 'bridge' entity per crossing — render the longest-span one.
    let objs = bridges.filter((e) => e.kind === 'bridge');
    // --walls=timber|stone narrows to one material class (e.g. inspect the timber-arch default).
    const wallsArg = process.argv.find((a) => a.startsWith('--walls='))?.slice('--walls='.length);
    if (wallsArg && objs.length) {
      const byWalls = objs.filter((e) => blueprintOf(e)?.rb.materials?.walls === wallsArg);
      console.log(`seed ${seed}: ${byWalls.length}/${objs.length} bridge objects have walls=${wallsArg}`);
      if (!byWalls.length) return;   // nothing in that class on this seed — don't fall through to legacy
      objs = byWalls;
    }
    if (objs.length) {
      const size = (e: Entity) => { const fp = (e.properties as { footprint?: { w: number; h: number } }).footprint; return (fp?.w ?? 0) + (fp?.h ?? 0); };
      best = [objs.reduce((m, e) => (size(e) > size(m) ? e : m), objs[0])];
      console.log(`seed ${seed}: ${objs.length} bridge objects (production); rendering the longest (${blueprintOf(best[0])!.rb.parts.length} parts)`);
    } else {
      // Legacy scatter (bridge_deck/pier/arch): cluster the richest crossing.
      const near = (a: Entity, b: Entity) => Math.abs(a.x - b.x) <= 8 && Math.abs(a.y - b.y) <= 8;
      best = [];
      for (const d of bridges.filter((e) => e.kind === 'bridge_deck')) {
        const grp = bridges.filter((e) => near(d, e));
        if (grp.length > best.length) best = grp;
      }
      if (!best.length) best = bridges.slice(0, 12);
      console.log(`seed ${seed}: ${bridges.length} legacy bridge entities; richest crossing has ${best.length}`);
    }
  }

  const placed: Placed[] = [];
  for (const e of best) {
    const sb = blueprintOf(e);
    if (!sb) continue;
    const spec = toGeometry(sb.rb);
    const r = await composeStructure(spec, undefined, { ...(spec.yaw ? { yaw: spec.yaw } : {}) });
    // Opaque bbox crop.
    let minX = r.size, minY = r.size, maxX = 0, maxY = 0;
    for (let y = 0; y < r.size; y++) for (let x = 0; x < r.size; x++) {
      if (r.grey[(y * r.size + x) * 4 + 3] > 8) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    if (maxX < minX) continue;
    const cw = maxX - minX + 1, ch = maxY - minY + 1;
    const crop = new Uint8ClampedArray(cw * ch * 4);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const s = ((minY + y) * r.size + (minX + x)) * 4, dd = (y * cw + x) * 4;
      crop[dd] = r.grey[s]; crop[dd + 1] = r.grey[s + 1]; crop[dd + 2] = r.grey[s + 2]; crop[dd + 3] = r.grey[s + 3];
    }
    const fp = (e.properties as { footprint?: { w: number; h: number } }).footprint ?? { w: 1, h: 1 };
    const sc = worldToScreen(e.x + fp.w / 2, e.y + fp.h / 2, liftOf(e), 0, 0);
    // Anchor the sprite's bottom-centre on the lifted foot point (building draw convention).
    placed.push({ grey: crop, cw, ch, ox: sc.sx - cw / 2, oy: sc.sy - ch, footY: sc.sy });
  }

  // Composite, y-sorted by foot (nearer draws over farther).
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of placed) { minX = Math.min(minX, p.ox); minY = Math.min(minY, p.oy); maxX = Math.max(maxX, p.ox + p.cw); maxY = Math.max(maxY, p.oy + p.ch); }
  const MG = 24;
  const OW = Math.ceil(maxX - minX) + 2 * MG, OH = Math.ceil(maxY - minY) + 2 * MG;
  const png = new PNG({ width: OW, height: OH });
  for (let i = 0; i < png.data.length; i += 4) { png.data[i] = 24; png.data[i + 1] = 26; png.data[i + 2] = 32; png.data[i + 3] = 255; }
  for (const p of [...placed].sort((a, b) => a.footY - b.footY)) {
    const bx = Math.round(p.ox - minX + MG), by = Math.round(p.oy - minY + MG);
    for (let y = 0; y < p.ch; y++) for (let x = 0; x < p.cw; x++) {
      const a = p.grey[(y * p.cw + x) * 4 + 3]; if (a < 8) continue;
      const dx = bx + x, dy = by + y; if (dx < 0 || dy < 0 || dx >= OW || dy >= OH) continue;
      const d = (dy * OW + dx) * 4;
      png.data[d] = p.grey[(y * p.cw + x) * 4]; png.data[d + 1] = p.grey[(y * p.cw + x) * 4 + 1]; png.data[d + 2] = p.grey[(y * p.cw + x) * 4 + 2]; png.data[d + 3] = 255;
    }
  }
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `crossing-world-${seed}.png`);
  writeFileSync(file, PNG.sync.write(png));
  console.log(`→ .dev-grabs/crossing-world-${seed}.png (${OW}×${OH})`);
}

main();
