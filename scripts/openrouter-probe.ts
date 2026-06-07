/**
 * OpenRouter image-gen probe — Option B: condition Nano Banana 2 on our own MASSING
 * SILHOUETTE (a boolean-UNION of rectangular wings, walls+roof, NO ground) so the
 * building takes our exact 2:1 isometric angle + footprint, then leaves the surface
 * to the model. Because WE author the massing, we also emit, per building:
 *   - a baked NORMAL map (same projection, face normals packed to RGB)
 *   - full POINT metadata (footprint + eaves outline corners, roof ridges + gable
 *     peaks + hip apex, door threshold, chimney tops) — all normalised to the sprite
 *     bbox so they survive the model repaint + pixelize crop/downscale.
 *
 *   OPENROUTER_API_KEY=… npx tsx scripts/openrouter-probe.ts
 *   REFS_ONLY=1 …                         (rasterise refs + normals + meta, no paid gens)
 *
 * Output → tmp/openrouter-probe/<subject>-{massingguide,normal,text,massing}.png
 * + results.json/js. Run pixelize.ts after.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { request } from 'node:https';
import { PNG } from 'pngjs';

import type { Roof } from '@/world/building-descriptor';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tmp/openrouter-probe');
const API = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'google/gemini-3.1-flash-image-preview'; // Nano Banana 2
const SIZE = 1024;

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) { console.error('OPENROUTER_API_KEY not set.'); process.exit(1); }

// A building is one or more rectangular WINGS in tile coords, rendered as a boolean
// UNION (shared/internal walls culled) so the model sees ONE clean solid, not
// overlapping boxes. Each wing's roof ridge runs along its LONGER axis (gable ends on
// the SHORT ends). L/T/cross wings overlap a shared cell so the union is connected.
interface Wing { x: number; y: number; w: number; h: number; roof: Roof; storeys?: number }
interface Subject { name: string; desc: string; footprint: { w: number; h: number }; wings: Wing[] }
const SUBJECTS: Subject[] = [
  { name: 'cottage', footprint: { w: 3, h: 3 },
    desc: 'a small medieval half-timber cottage with whitewashed plaster panels and a steep thatched gable roof',
    wings: [{ x: 0, y: 0, w: 3, h: 3, roof: 'gable' }] },
  { name: 'tavern', footprint: { w: 3, h: 3 },
    desc: 'a sturdy two-storey medieval timber-framed tavern with a tiled hip roof and a small hanging sign',
    wings: [{ x: 0, y: 0, w: 3, h: 3, roof: 'hip', storeys: 2 }] },
  { name: 'longhouse', footprint: { w: 4, h: 2 },
    desc: 'a long medieval timber longhouse, far longer than it is wide, with a steep thatched gable roof whose ridge runs the full length of the long axis and a triangular gable end on each short end',
    wings: [{ x: 0, y: 0, w: 4, h: 2, roof: 'gable' }] },
  // L-shape: a long wing + a perpendicular wing sharing the NW corner cell.
  { name: 'l_house', footprint: { w: 4, h: 4 },
    desc: 'an L-shaped medieval timber farmstead: two rectangular wings meeting at a right angle, each with its own steep thatched gable roof, the two ridges meeting in an L',
    wings: [{ x: 0, y: 0, w: 4, h: 2, roof: 'gable' }, { x: 0, y: 0, w: 2, h: 4, roof: 'gable' }] },
  // T-shape: a top bar wing + a stem wing dropping from its middle.
  { name: 't_hall', footprint: { w: 4, h: 4 },
    desc: 'a T-shaped medieval timber guildhall: a long main hall with a shorter wing projecting from the middle of one side, each wing gable-roofed',
    wings: [{ x: 0, y: 0, w: 4, h: 2, roof: 'gable' }, { x: 1, y: 1, w: 2, h: 3, roof: 'gable' }] },
  // Cross/+: a nave wing crossed by a transept wing through the centre.
  { name: 'cross_chapel', footprint: { w: 4, h: 4 },
    desc: 'a small cross-shaped medieval stone chapel: a long nave crossed by a shorter transept, each arm steeply gable-roofed, forming a cross plan',
    wings: [{ x: 0, y: 1, w: 4, h: 2, roof: 'gable' }, { x: 1, y: 0, w: 2, h: 4, roof: 'gable' }] },
];

const STYLE =
  'Isometric pixel art, 2:1 dimetric perspective, clean readable pixels, limited palette, ' +
  'crisp single-colour outline, soft top-down lighting, game asset sprite. No text, no border.';
// Generate ON flat magenta so we can chroma-key it out locally (no service needed).
const BG =
  'Place the building on a SOLID FLAT pure magenta #FF00FF background that completely fills the ' +
  'frame behind and around it — one uniform magenta colour, no gradient. Absolutely NO ground, ' +
  'NO floor tile, NO base platform and NO shadow under the building; only magenta behind it.';

// ── projection + raster primitives ───────────────────────────────────────────────
// Tile/height scale is computed PER SUBJECT (two-pass below) so every reference fills
// the same fraction of the frame regardless of footprint. pixelize.ts crops + rescales.
let hW = 64, hH = 32, HU = 64;        // reassigned per subject in massingGuide()
type RGB = [number, number, number];
interface Pt { x: number; y: number }
const shadeRGB = (c: RGB, f: number): RGB => [Math.round(c[0] * f), Math.round(c[1] * f), Math.round(c[2] * f)];
const up = (p: Pt, d: number): Pt => ({ x: p.x, y: p.y - d });
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const lerp = (p: Pt, q: Pt, t: number): Pt => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });

/** Scanline-fill a convex polygon into an RGBA buffer (opaque). */
function fillPoly(data: Uint8ClampedArray, W: number, H: number, pts: Pt[], rgb: RGB): void {
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(H - 1, Math.ceil(maxY)); y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + (y - a.y) / (b.y - a.y) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.ceil(xs[k])); x <= Math.min(W - 1, Math.floor(xs[k + 1])); x++) {
        const i = (y * W + x) * 4; data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
      }
    }
  }
}

const GABLE: Roof[] = ['gable', 'gambrel', 'saltbox', 'cross_gable'];
const HIP: Roof[] = ['hip', 'pyramidal', 'mansard', 'jerkinhead', 'tented', 'spire', 'conical', 'onion'];

// ── research-tuned proportions ───────────────────────────────────────────────────
// In this projection one cube-unit of height == one tile of run, so `pitch` IS
// tan(roof angle): 1.0=45°, 1.19=50°, 1.43=55°. Historic timber/thatch roofs are
// steep (45–60°). Tall storeys + steep roofs stop the model drawing a pancake.
const STOREY = 2.1;                        // tile-height units per storey
// Buildings sit centred with margin: inset the union OUTLINE this many tiles per
// exterior side (interior/shared walls keep their full extent so wings meet cleanly).
const FOOTPRINT_INSET = 0.32;
const PITCH: Partial<Record<Roof, number>> = {
  gable: 1.5, saltbox: 1.45, gambrel: 1.6, cross_gable: 1.5,
  hip: 1.35, jerkinhead: 1.35, pyramidal: 1.7, mansard: 1.4, lean_to: 0.95, tented: 1.55,
};
const KEEP_ROOF: Roof[] = ['flat', 'stepped', 'conical', 'domed', 'onion', 'spire'];
const WALLS: RGB = [150, 150, 158], ROOFC: RGB = [120, 108, 96];
// Door = dark wood on a viewer-facing wall; chimney = brick box rising above the roof
// (NEVER smoking — smoke is a runtime overlay at its recorded top). Distinct colours.
const DOOR: RGB = [92, 62, 40], BRICK: RGB = [150, 78, 58];

// ── normal encoding ──────────────────────────────────────────────────────────────
// One geometry pass emits FACETS (polygon + world normal + albedo). Rasterised twice:
// the grey reference uses `albedo`; the baked normal map uses normalRGB(normal).
type V3 = [number, number, number];
const nrm = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const dot3 = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// Screen basis of our 2:1 dimetric view (world → view), so normals pack to a sprite
// normal map: R=screen-right, G=screen-up, B=toward camera (OpenGL-ish, camera at 1,1,1).
const RIGHT: V3 = [0.7071, -0.7071, 0], DOWN: V3 = [0.4082, 0.4082, -0.8165], VIEW: V3 = [0.5774, 0.5774, 0.5774];
function normalRGB(n: V3): RGB {
  const u = nrm(n), sx = dot3(u, RIGHT), sy = dot3(u, DOWN), sz = dot3(u, VIEW);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round((v * 0.5 + 0.5) * 255)));
  return [c(sx), c(-sy), c(sz)];
}
const WALL_SW: V3 = [0, 1, 0], WALL_SE: V3 = [1, 0, 0], TOPN: V3 = [0, 0, 1];

interface Facet { pts: Pt[]; normal: V3; albedo: RGB }
type FS = (i: number, j: number) => Pt;
const fsFn = (OX: number, OY: number): FS => (i, j) => ({ x: (i - j) * hW + OX, y: (i + j) * hH + OY });

// ── union topology helpers ───────────────────────────────────────────────────────
function occupancy(wings: Wing[]): Set<string> {
  const s = new Set<string>();
  for (const w of wings) for (let i = w.x; i < w.x + w.w; i++) for (let j = w.y; j < w.y + w.h; j++) s.add(i + ',' + j);
  return s;
}
const occHas = (occ: Set<string>, i: number, j: number): boolean => occ.has(i + ',' + j);
function cellStoreys(wings: Wing[], i: number, j: number): number {
  let m = 1;
  for (const w of wings) if (i >= w.x && i < w.x + w.w && j >= w.y && j < w.y + w.h) m = Math.max(m, w.storeys ?? 1);
  return m;
}
/** Inset ground corners of one cell — inset only on EXTERIOR sides (shared sides flush). */
function cellCorners(occ: Set<string>, i: number, j: number, fs: FS): { N: Pt; E: Pt; S: Pt; W: Pt } {
  const a = FOOTPRINT_INSET;
  const x0 = i + (occHas(occ, i - 1, j) ? 0 : a), x1 = i + 1 - (occHas(occ, i + 1, j) ? 0 : a);
  const y0 = j + (occHas(occ, i, j - 1) ? 0 : a), y1 = j + 1 - (occHas(occ, i, j + 1) ? 0 : a);
  return { N: fs(x0, y0), E: fs(x1, y0), S: fs(x1, y1), W: fs(x0, y1) };
}
/** Inset ground corners of a whole wing — inset only where the wing meets open space. */
function wingRect(occ: Set<string>, w: Wing, fs: FS): { N: Pt; E: Pt; S: Pt; W: Pt } {
  const a = FOOTPRINT_INSET;
  const colShared = (ci: number) => { for (let j = w.y; j < w.y + w.h; j++) if (occHas(occ, ci, j)) return true; return false; };
  const rowShared = (rj: number) => { for (let i = w.x; i < w.x + w.w; i++) if (occHas(occ, i, rj)) return true; return false; };
  const x0 = w.x + (colShared(w.x - 1) ? 0 : a), x1 = w.x + w.w - (colShared(w.x + w.w) ? 0 : a);
  const y0 = w.y + (rowShared(w.y - 1) ? 0 : a), y1 = w.y + w.h - (rowShared(w.y + w.h) ? 0 : a);
  return { N: fs(x0, y0), E: fs(x1, y0), S: fs(x1, y1), W: fs(x0, y1) };
}
/** Ordered corner vertices (tile coords) of the union outline, collinear runs removed. */
function outlineCorners(occ: Set<string>): [number, number][] {
  const key = (x: number, y: number) => x + ',' + y;
  const adj = new Map<string, Set<string>>();
  const add = (ax: number, ay: number, bx: number, by: number) => {
    const a = key(ax, ay), b = key(bx, by);
    (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
    (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a);
  };
  for (const k of occ) {
    const [i, j] = k.split(',').map(Number);
    if (!occHas(occ, i, j - 1)) add(i, j, i + 1, j);         // north edge
    if (!occHas(occ, i + 1, j)) add(i + 1, j, i + 1, j + 1); // east edge
    if (!occHas(occ, i, j + 1)) add(i, j + 1, i + 1, j + 1); // south edge
    if (!occHas(occ, i - 1, j)) add(i, j, i, j + 1);         // west edge
  }
  let start = ''; let best = Infinity;
  for (const v of adj.keys()) { const [x, y] = v.split(',').map(Number); const r = y * 1000 + x; if (r < best) { best = r; start = v; } }
  if (!start) return [];
  const pts: [number, number][] = []; let prev = '', cur = start;
  do {
    const [cx, cy] = cur.split(',').map(Number); pts.push([cx, cy]);
    const nbrs = [...adj.get(cur)!]; const next = nbrs.find((n) => n !== prev) ?? nbrs[0];
    prev = cur; cur = next;
  } while (cur !== start && pts.length < 100000);
  const corners: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[(i - 1 + pts.length) % pts.length], c = pts[i], n = pts[(i + 1) % pts.length];
    const d1x = c[0] - p[0], d1y = c[1] - p[1], d2x = n[0] - c[0], d2y = n[1] - c[1];
    if (d1x * d2y - d1y * d2x !== 0) corners.push(c);  // direction change → corner
  }
  return corners.length ? corners : pts;
}

// ── facet builders ───────────────────────────────────────────────────────────────
/** Body of the union: per-cell walls, with shared (interior) walls culled. */
function bodyFacets(wings: Wing[], occ: Set<string>, fs: FS): Facet[] {
  const cells = [...occ].map((k) => k.split(',').map(Number) as [number, number]).sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
  const out: Facet[] = [];
  for (const [i, j] of cells) {
    const { N, E, S, W } = cellCorners(occ, i, j, fs);
    const bodyPx = cellStoreys(wings, i, j) * STOREY * HU;
    const t = { n: up(N, bodyPx), e: up(E, bodyPx), s: up(S, bodyPx), w: up(W, bodyPx) };
    if (!occHas(occ, i, j + 1)) out.push({ pts: [W, S, t.s, t.w], normal: WALL_SW, albedo: shadeRGB(WALLS, 0.62) });
    if (!occHas(occ, i + 1, j)) out.push({ pts: [S, E, t.e, t.s], normal: WALL_SE, albedo: shadeRGB(WALLS, 0.82) });
    out.push({ pts: [t.n, t.e, t.s, t.w], normal: TOPN, albedo: WALLS });
  }
  return out;
}
/** One wing's roof; returns facets + ridge segment (gable) or apex (hip) for metadata. */
function roofFacets(occ: Set<string>, w: Wing, fs: FS): { facets: Facet[]; ridge: [Pt, Pt] | null; apex: Pt | null } {
  const { N, E, S, W } = wingRect(occ, w, fs);
  const bodyPx = (w.storeys ?? 1) * STOREY * HU;
  const shortSpan = Math.max(0.5, Math.min(w.w, w.h) - 2 * FOOTPRINT_INSET);
  const pitch = PITCH[w.roof] ?? 1.0;
  const rise = (KEEP_ROOF.includes(w.roof) ? shortSpan * 0.5 : pitch * (shortSpan / 2)) * HU;
  const t = { n: up(N, bodyPx), e: up(E, bodyPx), s: up(S, bodyPx), w: up(W, bodyPx) };
  const facets: Facet[] = []; let ridge: [Pt, Pt] | null = null, apex: Pt | null = null;
  if (GABLE.includes(w.roof)) {
    if (w.w >= w.h) {
      const ra = up(mid(t.n, t.w), rise), rb = up(mid(t.e, t.s), rise);
      facets.push({ pts: [t.w, t.s, rb, ra], normal: nrm([0, pitch, 1]), albedo: shadeRGB(ROOFC, 0.84) });  // SW front
      facets.push({ pts: [t.n, t.e, rb, ra], normal: nrm([0, -pitch, 1]), albedo: ROOFC });                 // NE back
      ridge = [ra, rb];
    } else {
      const ra = up(mid(t.n, t.e), rise), rb = up(mid(t.s, t.w), rise);
      facets.push({ pts: [t.s, t.e, ra, rb], normal: nrm([pitch, 0, 1]), albedo: shadeRGB(ROOFC, 0.84) });  // SE front
      facets.push({ pts: [t.w, t.n, ra, rb], normal: nrm([-pitch, 0, 1]), albedo: ROOFC });                 // NW back
      ridge = [ra, rb];
    }
  } else if (HIP.includes(w.roof)) {
    const ap = up({ x: (t.e.x + t.w.x) / 2, y: (t.n.y + t.s.y) / 2 }, rise); apex = ap;
    facets.push({ pts: [t.n, t.e, ap], normal: nrm([0, -1, 1]), albedo: shadeRGB(ROOFC, 0.9) });
    facets.push({ pts: [t.e, t.s, ap], normal: nrm([1, 0, 1]), albedo: shadeRGB(ROOFC, 0.78) });
    facets.push({ pts: [t.s, t.w, ap], normal: nrm([0, 1, 1]), albedo: shadeRGB(ROOFC, 0.7) });
    facets.push({ pts: [t.w, t.n, ap], normal: nrm([-1, 0, 1]), albedo: ROOFC });
  } else {
    facets.push({ pts: [t.n, t.e, t.s, t.w], normal: TOPN, albedo: shadeRGB(ROOFC, 0.92) });
  }
  return { facets, ridge, apex };
}
/** Door panel on a chosen exterior wall cell; returns facet + base-centre anchor. */
function doorFacet(occ: Set<string>, d: DoorSpec, fs: FS): { facet: Facet; anchor: Pt } {
  const { E, S, W } = cellCorners(occ, d.i, d.j, fs);
  const [g0, g1, n, shade] = d.face === 'SW' ? [W, S, WALL_SW, 0.5] as const : [S, E, WALL_SE, 0.66] as const;
  const bl = lerp(g0, g1, d.center - d.halfW), br = lerp(g0, g1, d.center + d.halfW);
  const dh = d.height * HU;
  return { facet: { pts: [bl, br, up(br, dh), up(bl, dh)], normal: n, albedo: shadeRGB(DOOR, shade) }, anchor: lerp(g0, g1, d.center) };
}
/** Brick chimney box on a wing ridge; returns facets + top-centre (smoke) anchor. */
function chimneyFacets(occ: Set<string>, w: Wing, c: ChimSpec, fs: FS): { facets: Facet[]; top: Pt } {
  const { N, E, S, W } = wingRect(occ, w, fs);
  const bodyPx = (w.storeys ?? 1) * STOREY * HU;
  const shortSpan = Math.max(0.5, Math.min(w.w, w.h) - 2 * FOOTPRINT_INSET);
  const pitch = PITCH[w.roof] ?? 1.0;
  const rise = (KEEP_ROOF.includes(w.roof) ? shortSpan * 0.5 : pitch * (shortSpan / 2)) * HU;
  const t = { n: up(N, bodyPx), e: up(E, bodyPx), s: up(S, bodyPx), w: up(W, bodyPx) };
  let base: Pt;
  if (GABLE.includes(w.roof)) {
    const ra = (w.w >= w.h) ? up(mid(t.n, t.w), rise) : up(mid(t.n, t.e), rise);
    const rb = (w.w >= w.h) ? up(mid(t.e, t.s), rise) : up(mid(t.s, t.w), rise);
    base = lerp(ra, rb, c.ridgeT);
  } else {
    base = up({ x: (t.e.x + t.w.x) / 2, y: (t.n.y + t.s.y) / 2 }, rise * 0.6);
  }
  const cw = c.width * HU, ch = c.height * HU, top = up(base, ch);
  const T = { n: { x: top.x, y: top.y - cw * 0.5 }, e: { x: top.x + cw, y: top.y }, s: { x: top.x, y: top.y + cw * 0.5 }, w: { x: top.x - cw, y: top.y } };
  const bw = { x: base.x - cw, y: base.y }, bs = { x: base.x, y: base.y + cw * 0.5 }, be = { x: base.x + cw, y: base.y };
  return {
    facets: [
      { pts: [T.w, T.s, bs, bw], normal: WALL_SW, albedo: shadeRGB(BRICK, 0.7) },
      { pts: [T.s, T.e, be, bs], normal: WALL_SE, albedo: shadeRGB(BRICK, 0.85) },
      { pts: [T.n, T.e, T.s, T.w], normal: TOPN, albedo: BRICK },
    ],
    top,
  };
}

// ── seeded feature placement ─────────────────────────────────────────────────────
const hashStr = (s: string): number => { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
function mulberry32(a: number): () => number {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const mainWing = (wings: Wing[]): number => wings.reduce((bi, w, i, a) => (w.w * w.h) > (a[bi].w * a[bi].h) ? i : bi, 0);

interface DoorSpec { i: number; j: number; face: 'SW' | 'SE'; halfW: number; height: number; center: number }
interface ChimSpec { wing: number; ridgeT: number; width: number; height: number }
interface Placement { door: DoorSpec; chimneys: ChimSpec[] }

/** Front-facing exterior wall runs (contiguous SW/SE cell faces) for door placement. */
function wallRuns(occ: Set<string>): { face: 'SW' | 'SE'; cells: [number, number][]; score: number }[] {
  const cells = [...occ].map((k) => k.split(',').map(Number) as [number, number]);
  const runs: { face: 'SW' | 'SE'; cells: [number, number][]; score: number }[] = [];
  const push = (face: 'SW' | 'SE', cs: [number, number][]) => { if (cs.length) runs.push({ face, cells: cs, score: cs.reduce((s, [i, j]) => s + i + j, 0) / cs.length + cs.length * 0.5 }); };
  const js = [...new Set(cells.map(([, j]) => j))];
  for (const j of js) {                 // SW faces: occ(i,j) & !occ(i,j+1), contiguous in i
    const is = cells.filter(([i, jj]) => jj === j && !occHas(occ, i, j + 1)).map(([i]) => i).sort((a, b) => a - b);
    let run: [number, number][] = [];
    for (const i of is) { if (run.length && i !== run[run.length - 1][0] + 1) { push('SW', run); run = []; } run.push([i, j]); }
    push('SW', run);
  }
  const isx = [...new Set(cells.map(([i]) => i))];
  for (const i of isx) {                // SE faces: occ(i,j) & !occ(i+1,j), contiguous in j
    const js2 = cells.filter(([ii, j]) => ii === i && !occHas(occ, i + 1, j)).map(([, j]) => j).sort((a, b) => a - b);
    let run: [number, number][] = [];
    for (const j of js2) { if (run.length && j !== run[run.length - 1][1] + 1) { push('SE', run); run = []; } run.push([i, j]); }
    push('SE', run);
  }
  return runs;
}
/** Seeded door + chimney layout with per-type defaults. Door goes on a prominent
 * exterior wall run (forward + long) so it never lands inside the mass. */
function planFeatures(s: Subject): Placement {
  const rng = mulberry32(hashStr(s.name));
  const occ = occupancy(s.wings);
  const runs = wallRuns(occ).sort((a, b) => b.score - a.score);
  const top = runs.slice(0, Math.max(1, Math.min(3, runs.length)));
  const chosen = top[Math.floor(rng() * top.length)];
  const cell = chosen.cells[Math.floor(chosen.cells.length / 2)];
  const grand = s.name === 'cross_chapel' || s.name === 'tavern';
  const door: DoorSpec = { i: cell[0], j: cell[1], face: chosen.face, halfW: grand ? 0.22 : 0.16, height: grand ? 1.5 : 1.05, center: 0.5 + (rng() - 0.5) * 0.1 };
  let count = 1;
  if (s.name === 'tavern') count = 2;
  if (s.name === 'cross_chapel') count = 0;        // a chapel has no chimney
  const cWing = mainWing(s.wings);
  const chimneys: ChimSpec[] = [];
  for (let k = 0; k < count; k++) {
    const ridgeT = count === 1 ? 0.22 + rng() * 0.22 : (k + 1) / (count + 1) + (rng() - 0.5) * 0.08;
    chimneys.push({ wing: cWing, ridgeT, width: 0.14 + rng() * 0.07, height: 0.8 + rng() * 0.5 });
  }
  return { door, chimneys };
}

// ── assembly ─────────────────────────────────────────────────────────────────────
interface RawMeta { footprint: Pt[]; eaves: Pt[]; ridges: [Pt, Pt][]; peaks: Pt[]; apexes: Pt[]; door: Pt; chimneys: Pt[] }
/** Build every facet (painter-ordered: bodies → roofs → door → chimneys) + raw points. */
function buildFacets(s: Subject, plan: Placement, OX: number, OY: number): { facets: Facet[]; meta: RawMeta } {
  const fs = fsFn(OX, OY), occ = occupancy(s.wings);
  const facets: Facet[] = [...bodyFacets(s.wings, occ, fs)];
  const ridges: [Pt, Pt][] = [], peaks: Pt[] = [], apexes: Pt[] = [];
  const wingOrder = s.wings.map((w, i) => i).sort((p, q) => (s.wings[p].x + s.wings[p].w + s.wings[p].y + s.wings[p].h) - (s.wings[q].x + s.wings[q].w + s.wings[q].y + s.wings[q].h));
  for (const wi of wingOrder) {
    const r = roofFacets(occ, s.wings[wi], fs);
    facets.push(...r.facets);
    if (r.ridge) { ridges.push(r.ridge); peaks.push(r.ridge[0], r.ridge[1]); }
    if (r.apex) apexes.push(r.apex);
  }
  const door = doorFacet(occ, plan.door, fs); facets.push(door.facet);
  const chimneys: Pt[] = [];
  for (const c of plan.chimneys) { const ch = chimneyFacets(occ, s.wings[c.wing], c, fs); facets.push(...ch.facets); chimneys.push(ch.top); }
  // outline corners — ground (footprint) + raised to eaves (max body height)
  const maxBody = Math.max(...s.wings.map((w) => (w.storeys ?? 1))) * STOREY * HU;
  const corners = outlineCorners(occ);
  const footprint = corners.map(([i, j]) => fs(i, j));
  const eaves = footprint.map((p) => up(p, maxBody));
  return { facets, meta: { footprint, eaves, ridges, peaks, apexes, door: door.anchor, chimneys } };
}

function rasterize(facets: Facet[], sz: number, mode: 'albedo' | 'normal'): Uint8ClampedArray {
  const data = new Uint8ClampedArray(sz * sz * 4);
  for (const f of facets) fillPoly(data, sz, sz, f.pts, mode === 'albedo' ? f.albedo : normalRGB(f.normal));
  return data;
}
function opaqueBounds(data: Uint8ClampedArray, sz: number): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = sz, minY = sz, maxX = -1, maxY = -1;
  for (let y = 0; y < sz; y++) for (let x = 0; x < sz; x++) {
    if (data[(y * sz + x) * 4 + 3] > 0) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  return { minX, minY, maxX, maxY };
}

const FILL_FRAC = 0.88;   // larger dimension fills this fraction of the frame

// Normalised (0–1, vs the sprite bbox) so points survive the repaint + crop/downscale.
interface Meta { footprint: { x: number; y: number }[]; eaves: { x: number; y: number }[]; ridges: { a: { x: number; y: number }; b: { x: number; y: number } }[]; peaks: { x: number; y: number }[]; apexes: { x: number; y: number }[]; door: { x: number; y: number }; chimneys: { x: number; y: number }[] }
interface BBox { x: number; y: number; w: number; h: number }   // building's opaque box in the 1024 frame
interface Guide { data: Uint8ClampedArray; normal: Uint8ClampedArray; meta: Meta; bbox: BBox }

/** Grey massing reference + baked normal map + normalised point metadata, sized so
 * every building fills the same fraction of the frame and is centred. */
function massingGuide(sz: number, s: Subject): Guide {
  const plan = planFeatures(s);
  // Pass 1 — unit scale, measure the silhouette bbox.
  hW = 64; hH = 32; HU = 64;
  const OX0 = sz / 2, OY0 = sz * 0.62;
  const bb = opaqueBounds(rasterize(buildFacets(s, plan, OX0, OY0).facets, sz, 'albedo'), sz);
  const bw = bb.maxX - bb.minX + 1, bh = bb.maxY - bb.minY + 1;
  const S2 = (sz * FILL_FRAC) / Math.max(bw, bh);
  const gcx = (bb.minX + bb.maxX) / 2 - OX0, gcy = (bb.minY + bb.maxY) / 2 - OY0;
  // Pass 2 — fitted scale, bbox centred. Emit albedo + normal from the same facets.
  hW = 64 * S2; hH = 32 * S2; HU = 64 * S2;
  const { facets, meta } = buildFacets(s, plan, sz / 2 - S2 * gcx, sz / 2 - S2 * gcy);
  const data = rasterize(facets, sz, 'albedo');
  const normal = rasterize(facets, sz, 'normal');
  const fb = opaqueBounds(data, sz);
  const fbw = Math.max(1, fb.maxX - fb.minX), fbh = Math.max(1, fb.maxY - fb.minY);
  const norm = (p: Pt) => ({ x: (p.x - fb.minX) / fbw, y: (p.y - fb.minY) / fbh });
  return {
    data, normal,
    meta: {
      footprint: meta.footprint.map(norm), eaves: meta.eaves.map(norm),
      ridges: meta.ridges.map(([a, b]) => ({ a: norm(a), b: norm(b) })),
      peaks: meta.peaks.map(norm), apexes: meta.apexes.map(norm),
      door: norm(meta.door), chimneys: meta.chimneys.map(norm),
    },
    bbox: { x: fb.minX, y: fb.minY, w: fbw, h: fbh },
  };
}

// ── networking ──────────────────────────────────────────────────────────────────
function postJson(url: string, payload: unknown): Promise<any> {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body), 'HTTP-Referer': 'https://small-gods.local', 'X-Title': 'small-gods-probe',
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if ((res.statusCode ?? 0) >= 400) { reject(new Error(`HTTP ${res.statusCode} ${text.slice(0, 400)}`)); return; }
        try { resolve(JSON.parse(text)); } catch { reject(new Error(`bad JSON (${text.slice(0, 200)})`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(180_000, () => req.destroy(new Error('timeout 180s')));
    req.write(body); req.end();
  });
}

function extractImage(json: any): string {
  const url: string | undefined = json?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) throw new Error(`no image in response: ${JSON.stringify(json).slice(0, 300)}`);
  const m = /^data:image\/\w+;base64,(.+)$/s.exec(url);
  if (!m) throw new Error(`unexpected image url form: ${url.slice(0, 60)}`);
  return m[1];
}

const IMAGE_CONFIG = { aspect_ratio: '1:1', image_size: '1K' };
const body = (messages: unknown): Record<string, unknown> => ({ model: MODEL, modalities: ['image', 'text'], image_config: IMAGE_CONFIG, messages });
const sanitize = (messages: any, ref?: string): unknown =>
  JSON.parse(JSON.stringify(messages), (k, v) => (k === 'url' && typeof v === 'string' && v.startsWith('data:')) ? `<ref image: ${ref ?? 'inline'}>` : v);

const textPrompt = (desc: string): string => `Pixel art ${desc}. ${STYLE} ${BG}`;
const massingPrompt = (desc: string): string =>
  `Repaint this grey massing block as detailed isometric pixel art: ${desc}. ` +
  'KEEP the exact silhouette, footprint, roof shape, height and 2:1 isometric angle shown — do not change the shape or proportions. ' +
  'CRITICAL — match the orientation exactly: the building and its roof RIDGE must run in the SAME screen direction as the grey block. ' +
  'If the block is elongated, keep it elongated along that same diagonal; do NOT rotate it 90° or stand it up the other way. ' +
  'Paint a wooden door exactly where the dark brown panel sits on the wall, and a brick chimney exactly where the brick block rises from the roof — keep the chimney AS a chimney with absolutely NO smoke and NO fire coming out of it. Add small windows and surface materials. ' +
  `${STYLE} ${BG}`;

interface Result {
  subject: string; variant: string; footprint: { w: number; h: number };
  prompt: string; src: string; ref?: string; normalSrc?: string; meta?: Meta; bbox?: BBox;
  params: { endpoint: string; model: string; modalities: string[]; image_config: typeof IMAGE_CONFIG; nativeSize: number; messages: unknown };
}
const results: Result[] = [];

async function run(s: Subject, fp: { w: number; h: number }, variant: string, prompt: string, messages: unknown, opts: { ref?: string; normalSrc?: string; meta?: Meta } = {}): Promise<void> {
  const entry: Result = {
    subject: s.name, variant, footprint: fp, prompt, src: `${s.name}-${variant}.png`, ref: opts.ref, normalSrc: opts.normalSrc, meta: opts.meta,
    params: { endpoint: API, model: MODEL, modalities: ['image', 'text'], image_config: IMAGE_CONFIG, nativeSize: SIZE, messages: sanitize(messages, opts.ref) },
  };
  try {
    const json = await postJson(API, body(messages));
    await writeFile(join(OUT, entry.src), Buffer.from(extractImage(json), 'base64'));
    results.push(entry);
    console.log(`  ✓ ${entry.src}`);
  } catch (e) {
    console.error(`  ✗ ${s.name}-${variant} — ${(e as Error).message}`);
  }
}

const writePng = async (file: string, buf: Uint8ClampedArray): Promise<void> => {
  const png = new PNG({ width: SIZE, height: SIZE }); png.data = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  await writeFile(join(OUT, file), PNG.sync.write(png));
};

await mkdir(OUT, { recursive: true });
console.log(`OpenRouter probe → ${MODEL} @ ${SIZE}²`);
for (const s of SUBJECTS) {
  console.log(`\n${s.name} (fp ${s.footprint.w}×${s.footprint.h}, ${s.wings.length} wing${s.wings.length > 1 ? 's' : ''})`);

  // rasterise + save the massing reference, its baked normal map, and the metadata
  const guide = massingGuide(SIZE, s);
  const refFile = `${s.name}-massingguide.png`, normalFile = `${s.name}-normal.png`;
  await writePng(refFile, guide.data);
  await writePng(normalFile, guide.normal);
  const uri = `data:image/png;base64,${PNG.sync.write((() => { const p = new PNG({ width: SIZE, height: SIZE }); p.data = Buffer.from(guide.data.buffer, guide.data.byteOffset, guide.data.byteLength); return p; })()).toString('base64')}`;
  console.log(`  · corners:${guide.meta.footprint.length} ridges:${guide.meta.ridges.length} peaks:${guide.meta.peaks.length} apex:${guide.meta.apexes.length} door@(${guide.meta.door.x.toFixed(2)},${guide.meta.door.y.toFixed(2)}) chimneys:${guide.meta.chimneys.length}`);

  if (process.env.REFS_ONLY) {
    // Emit a reference-only entry so the viewer can show the new massing + normal +
    // metadata BEFORE any paid generation.
    results.push({
      subject: s.name, variant: 'ref', footprint: s.footprint, prompt: '(reference only — no generation)',
      src: refFile, ref: refFile, normalSrc: normalFile, meta: guide.meta, bbox: guide.bbox,
      params: { endpoint: API, model: MODEL, modalities: ['image', 'text'], image_config: IMAGE_CONFIG, nativeSize: SIZE, messages: '(reference only)' },
    });
    console.log(`  · ref only`); continue;  // verify geometry without paying for gens
  }

  const tp = textPrompt(s.desc);
  await run(s, s.footprint, 'text', tp, [{ role: 'user', content: tp }]);

  const mp = massingPrompt(s.desc);
  await run(s, s.footprint, 'massing', mp, [{ role: 'user', content: [{ type: 'text', text: mp }, { type: 'image_url', image_url: { url: uri } }] }], { ref: refFile, normalSrc: normalFile, meta: guide.meta });
}

await writeFile(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
await writeFile(join(OUT, 'results.js'), `window.AB_PROBE = ${JSON.stringify(results, null, 2)};\n`);
console.log(`\nDone → tmp/openrouter-probe/  (${results.length} images + refs + normals; run pixelize.ts, then reload viewer)`);
