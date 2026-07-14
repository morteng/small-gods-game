// scripts/rock-settle-preview.ts
// Offline BEFORE/AFTER render of rock ground-settling (WCV 98) — no browser, no WebGPU.
//
// It renders the real thing, not a mock:
//   * the rock sprites come out of the SAME parametric pipeline the game uses
//     (synthesizeBlueprint → toGeometry → composeStructure);
//   * every sprite pixel is lit by `bandedPbrPixel` — the executable CPU reference the lit
//     WGSL is pinned against — with the same snow whiten and the same contact blend the
//     shader applies, so what lands in the PNG is what the GPU draws;
//   * the settle PADS are the real `discDeformation`s the world builds (radius, depth and
//     feather straight out of `rock-deformation.ts`), composed through the real
//     DeformationStore.
// The BASE ground is a synthetic gentle field rather than the seed heightfield — the seed
// noise at this zoom is louder than the 6–16 cm dish we are trying to SEE, and the point of
// the render is to show the dish and the contact line.
//
//   npx tsx scripts/rock-settle-preview.ts     → .dev-grabs/rock-settle-{grass,snow}.png
//
// LEFT panel  = BEFORE (flat 10–20 % bury, no pad, no contact blend)
// RIGHT panel = AFTER  (size-scaled bury + settle pad + terrain contact blend)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { synthesizeBlueprint } from '../src/blueprint/presets';
import { toGeometry } from '../src/blueprint/compile/to-geometry';
import { composeStructure, type StructureResult } from '../src/assetgen/compose';
import { bandedPbrPixel } from '../src/render/gpu/banded-pbr';
import { worldToScreen } from '../src/render/iso/iso-projection';
import { rockPadRadiusTiles, rockPadDepthM, ROCK_PAD_MIN_SIZE_M } from '../src/world/rock-deformation';
import { discDeformation, DeformationStore, type Deformation } from '../src/world/terrain-deformation';
import { TILE_COLORS } from '../src/core/constants';
import { SNOW_TONE, contactBlendFor } from '../src/render/ground-contact';
import { natureSizeM } from '../src/world/entity-kinds';

const OUT = '.dev-grabs';
const W = 760, H = 400, PANEL = 380;
const GRID = 8;
const Z_PX_PER_M = 20;   // terrainVerticalExaggeration (world-style default)
/** Screen datum: the lift is drawn RELATIVE to this ground height, so the patch frames
 *  instead of flying 200 px off the top. Vertical SCALE (the thing the dish is measured in)
 *  is untouched — a 0.16 m pad is still 3.2 px, exactly as the game draws it. */
const DATUM_M = 9.6;

const norm = (v: readonly number[]): [number, number, number] => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const L = {
  ambient: [0.44, 0.46, 0.52] as [number, number, number],
  sunDir: norm([-0.5, 0.62, 0.6]),
  sunColor: [0.78, 0.74, 0.66] as [number, number, number],
  bands: 4,
};

const ROCKS = [
  { kind: 'boulder', x: 2.5, y: 2.6, scale: 1.15 },
  { kind: 'standing_stone', x: 5.4, y: 2.4, scale: 1.0 },
  { kind: 'boulder', x: 3.6, y: 5.0, scale: 0.95 },
  { kind: 'rock_pile', x: 6.0, y: 5.4, scale: 1.0 },
];

/** Gentle synthetic ground (metres) — legible at the scale of a 6–16 cm settle dish. */
const baseM = (x: number, y: number): number =>
  9 + 0.22 * x - 0.10 * y + 0.30 * Math.sin(x * 0.55) * Math.cos(y * 0.5);

function padsFor(): Deformation[] {
  const out: Deformation[] = [];
  for (const r of ROCKS) {
    const sizeM = natureSizeM(r.kind, r.scale);
    if (sizeM < ROCK_PAD_MIN_SIZE_M) continue;   // rock_pile / pebbles: no pad, by design
    out.push(discDeformation({
      id: `pad:rock:${r.x},${r.y}`, source: 'rock:pad',
      cx: r.x, cy: r.y,
      radius: rockPadRadiusTiles(sizeM),
      target: baseM(Math.floor(r.x), Math.floor(r.y)) - rockPadDepthM(sizeM),
      feather: 0.75, priority: 8,
    }));
  }
  return out;
}

/** base ⊕ pads, the same level-op the DeformationStore composes. */
function groundM(store: DeformationStore, x: number, y: number): number {
  const base = baseM(x, y);
  let acc = base;
  for (const d of store.at(x, y)) {
    if (d.op !== 'level' || d.target === undefined) continue;
    const m = d.mask(x, y);
    acc = acc + (d.target - acc) * m;
  }
  return acc;
}

interface Ctx { px: Uint8Array; ox: number }
/** GOTCHA: png.data is a Buffer (Uint8Array) — assignment WRAPS modulo 256, it does not
 *  clamp. An overbright pixel (a lit snow surface easily exceeds 1.0) wrapped to near-zero
 *  and painted black/red holes into the ground. Clamp explicitly. */
const c255 = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(v))) : 0);
function put(c: Ctx, x: number, y: number, r: number, g: number, b: number, a = 1): void {
  const sx = Math.round(x) + c.ox, sy = Math.round(y);
  if (sx < c.ox || sx >= c.ox + PANEL || sy < 0 || sy >= H) return;
  const i = (sy * W + sx) * 4;
  c.px[i] = c255(c.px[i] * (1 - a) + r * 255 * a);
  c.px[i + 1] = c255(c.px[i + 1] * (1 - a) + g * 255 * a);
  c.px[i + 2] = c255(c.px[i + 2] * (1 - a) + b * 255 * a);
  c.px[i + 3] = 255;
}

function hex(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

function groundColor(tile: string, snow: number): [number, number, number] {
  const b = hex(TILE_COLORS[tile] ?? '#7a7f6a');
  return [
    b[0] + (SNOW_TONE[0] - b[0]) * snow,
    b[1] + (SNOW_TONE[1] - b[1]) * snow,
    b[2] + (SNOW_TONE[2] - b[2]) * snow,
  ];
}

/** Fill a screen triangle with a flat colour (barycentric, top-left-ish). The ground is
 *  rasterized as real TRIANGLES, not stamped points: a point-stamped heightfield tears at
 *  any slope discontinuity (the pad rim is one) and no stamp size fixes it. */
function fillTri(
  c: Ctx, a: [number, number], b: [number, number], d: [number, number],
  col: [number, number, number],
): void {
  const minX = Math.floor(Math.min(a[0], b[0], d[0])), maxX = Math.ceil(Math.max(a[0], b[0], d[0]));
  const minY = Math.floor(Math.min(a[1], b[1], d[1])), maxY = Math.ceil(Math.max(a[1], b[1], d[1]));
  const area = (b[0] - a[0]) * (d[1] - a[1]) - (d[0] - a[0]) * (b[1] - a[1]);
  if (Math.abs(area) < 1e-9) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((b[0] - a[0]) * (py - a[1]) - (px - a[0]) * (b[1] - a[1])) / area;
      const w1 = ((px - a[0]) * (d[1] - a[1]) - (d[0] - a[0]) * (py - a[1])) / area;
      if (w0 < -0.002 || w1 < -0.002 || w0 + w1 > 1.002) continue;
      put(c, x, y, col[0], col[1], col[2]);
    }
  }
}

function drawGround(c: Ctx, store: DeformationStore, col: [number, number, number], ox: number, oy: number): void {
  const SUB = 16;                                 // sub-quads per tile edge
  const N = GRID * SUB;
  const proj = (wx: number, wy: number): [number, number] => {
    const s = worldToScreen(wx, wy, 0, ox, oy);
    return [s.sx, s.sy - (groundM(store, wx, wy) - DATUM_M) * Z_PX_PER_M];
  };
  const quads: { i: number; j: number; depth: number }[] = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) quads.push({ i, j, depth: i + j });
  quads.sort((p, q) => p.depth - q.depth);        // painter order: far → near
  for (const { i, j } of quads) {
    const x0 = i / SUB, x1 = (i + 1) / SUB, y0 = j / SUB, y1 = (j + 1) / SUB;
    const h00 = groundM(store, x0, y0), h10 = groundM(store, x1, y0);
    const h01 = groundM(store, x0, y1), h11 = groundM(store, x1, y1);
    // Flat-shade off the quad's own gradient — a settle dish must read AS a dish.
    const gx = ((h10 + h11) - (h00 + h01)) / (2 * (x1 - x0));
    const gy = ((h01 + h11) - (h00 + h10)) / (2 * (y1 - y0));
    const n = norm([-gx, 1, -gy]);
    const nd = Math.max(0.1, n[0] * L.sunDir[0] + n[1] * L.sunDir[1] + n[2] * L.sunDir[2]);
    const sh = 0.5 + 0.62 * (Math.floor(nd * 6 + 0.5) / 6);
    const shaded: [number, number, number] = [col[0] * sh, col[1] * sh, col[2] * sh];
    const p00 = proj(x0, y0), p10 = proj(x1, y0), p01 = proj(x0, y1), p11 = proj(x1, y1);
    fillTri(c, p00, p10, p11, shaded);
    fillTri(c, p00, p11, p01, shaded);
  }
}

const packs = new Map<string, StructureResult>();
async function packFor(kind: string): Promise<StructureResult> {
  const hit = packs.get(kind);
  if (hit) return hit;
  const rb = synthesizeBlueprint(kind, [], 0);
  if (!rb) throw new Error(`no blueprint for ${kind}`);
  const r = await composeStructure(toGeometry(rb)!, undefined, { surfaceTexture: true });
  packs.set(kind, r);
  return r;
}

/** The pre-98 bury: flat 10–20 %, seeded per position. */
function oldBury(x: number, y: number): number {
  let h = Math.imul((Math.trunc(x * 97) * 374761393) ^ (Math.trunc(y * 71) * 668265263), 1274126177) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
  return 0.10 + 0.10 * ((h >>> 0) / 4294967296);
}
/** The WCV-98 bury: size-scaled (iso-sprites natureBuryFrac). */
function newBury(kind: string, scale: number, x: number, y: number): number {
  const sizeM = natureSizeM(kind, scale);
  const t = Math.min(1, Math.max(0, (sizeM - 0.3) / (2.0 - 0.3)));
  let h = Math.imul((Math.trunc(x * 97) * 374761393) ^ (Math.trunc(y * 71) * 668265263), 1274126177) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
  return 0.10 + 0.14 * t + 0.05 * ((h >>> 0) / 4294967296);
}

async function panel(c: Ctx, after: boolean, tile: string, snow: number): Promise<void> {
  const store = new DeformationStore();
  if (after) store.add(...padsFor());
  const col = groundColor(tile, snow);
  const ox = PANEL / 2, oy = 96;
  drawGround(c, store, col, ox, oy);

  for (const r of [...ROCKS].sort((a, b) => (a.x + a.y) - (b.x + b.y))) {
    const res = await packFor(r.kind);
    const bb = { x: Math.round(res.bbox.x), y: Math.round(res.bbox.y), w: Math.round(res.bbox.w), h: Math.round(res.bbox.h) };
    const bury = after ? newBury(r.kind, r.scale, r.x, r.y) : oldBury(r.x, r.y);
    const buryPx = Math.max(0, Math.min(bb.h - 1, Math.round(bb.h * Math.min(0.4, bury))));
    const visH = bb.h - buryPx;
    const s = worldToScreen(r.x, r.y, 0, ox, oy);
    const footY = s.sy - (groundM(store, r.x, r.y) - DATUM_M) * Z_PX_PER_M;
    const dx = Math.round(s.sx) - Math.round(bb.w / 2);
    const dy = Math.round(footY) - visH;
    const cb = after ? contactBlendFor('rock', snow) : null;

    for (let y = 0; y < visH; y++) {
      for (let x = 0; x < bb.w; x++) {
        const si = ((bb.y + y) * res.size + (bb.x + x)) * 4;
        const a = res.grey[si + 3] / 255;
        if (a < 0.5) continue;
        let alb: [number, number, number] = [res.grey[si] / 255, res.grey[si + 1] / 255, res.grey[si + 2] / 255];
        const nrm: [number, number, number, number] = [
          res.normal[si] / 255, res.normal[si + 1] / 255, res.normal[si + 2] / 255, res.normal[si + 3] / 255];
        const mat: [number, number, number, number] = [
          res.material[si] / 255, res.material[si + 1] / 255, res.material[si + 2] / 255, res.material[si + 3] / 255];

        // snow whiten (lit-wgsl) — applied in BOTH panels: it already shipped.
        if (snow > 0) {
          const ny = nrm[3] > 0.5 ? nrm[1] * 2 - 1 : 0;
          const k = snow * Math.min(1, Math.max(0, ny * 0.5 + 0.5));
          alb = [alb[0] + (SNOW_TONE[0] - alb[0]) * k, alb[1] + (SNOW_TONE[1] - alb[1]) * k, alb[2] + (SNOW_TONE[2] - alb[2]) * k];
        }
        // ground CONTACT blend (lit-wgsl) — the AFTER panel only.
        if (cb) {
          const vFoot = (y + 0.5) / visH;                     // shader's corner.y (1 = foot)
          const band = Math.max(cb.band, 1e-4);
          const t = Math.min(1, Math.max(0, (vFoot - (1 - band)) / band));
          const k = cb.strength * t * t;
          alb = [alb[0] + (col[0] - alb[0]) * k, alb[1] + (col[1] - alb[1]) * k, alb[2] + (col[2] - alb[2]) * k];
        }
        const o = bandedPbrPixel({ albedo: [alb[0], alb[1], alb[2], a], normal: nrm, material: mat }, L);
        put(c, dx + x, dy + y, o[0] / Math.max(o[3], 1e-6), o[1] / Math.max(o[3], 1e-6), o[2] / Math.max(o[3], 1e-6), a);
      }
    }
  }
}

async function render(name: string, tile: string, snow: number): Promise<void> {
  const png = new PNG({ width: W, height: H });
  const px = png.data as unknown as Uint8Array;
  for (let i = 0; i < px.length; i += 4) { px[i] = 16; px[i + 1] = 18; px[i + 2] = 24; px[i + 3] = 255; }
  await panel({ px, ox: 0 }, false, tile, snow);
  await panel({ px, ox: PANEL }, true, tile, snow);
  for (let y = 0; y < H; y++) { const i = (y * W + PANEL) * 4; px[i] = 200; px[i + 1] = 60; px[i + 2] = 60; }
  // 2× nearest upscale for legibility (viewing only — every source pixel is still 1:1).
  const up = new PNG({ width: W * 2, height: H * 2 });
  for (let y = 0; y < H * 2; y++) {
    for (let x = 0; x < W * 2; x++) {
      const s0 = ((y >> 1) * W + (x >> 1)) * 4, d = (y * W * 2 + x) * 4;
      up.data[d] = px[s0]; up.data[d + 1] = px[s0 + 1]; up.data[d + 2] = px[s0 + 2]; up.data[d + 3] = 255;
    }
  }
  mkdirSync(OUT, { recursive: true });
  const p = join(OUT, `${name}.png`);
  writeFileSync(p, PNG.sync.write(up));
  console.log(`wrote ${p}  (LEFT = before | RIGHT = after)`);
}

async function main(): Promise<void> {
  await render('rock-settle-grass', 'grass', 0);
  await render('rock-settle-snow', 'snow', 0.9);
}
main().catch((e) => { console.error(e); process.exit(1); });
