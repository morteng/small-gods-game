/**
 * Isometric draw for linear barrier runs (walls / palisades / fences …).
 *
 * A barrier entity carries `properties.barrier: BarrierRun` — a polyline with a
 * height, a material, optional crenellation/posts and zero-or-more gate gaps.
 * We walk each path segment in unit steps and draw an iso "wall slab" per step:
 * the near (south-facing) vertical face plus the flat top. Steps whose midpoint
 * falls inside a gate span are skipped, so a gated run paints fewer quads than an
 * identical ungated run. Geometry is approximate-but-readable, mirroring the
 * parametric building draw (worldToScreen + plain ctx fills, no new deps).
 */
import type { Entity } from '@/core/types';
import type { BarrierRun } from '@/world/barrier';
import { worldToScreen } from './iso-projection';
import { ISO_TILE_H } from './iso-constants';

interface P { sx: number; sy: number }

/** Screen pixels per height unit — one unit reads as roughly one tile tall. */
const H_UNIT_PX = ISO_TILE_H;

const MATERIAL_COLORS: Record<string, string> = {
  stone: '#8a8a8a',
  timber: '#8B5A2B',
  wood: '#8B5A2B',
  brick: '#9c5a4a',
  earth: '#9b7b53',
};
const FALLBACK_COLOR = '#8a8a8a';

function shade(hex: string, factor: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * factor));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * factor));
  const b = Math.min(255, Math.round((n & 255) * factor));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function quad(ctx: CanvasRenderingContext2D, a: P, b: P, c: P, d: P, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(a.sx, a.sy);
  ctx.lineTo(b.sx, b.sy);
  ctx.lineTo(c.sx, c.sy);
  ctx.lineTo(d.sx, d.sy);
  ctx.closePath();
  ctx.fill();
}

const raise = (p: P, dz: number): P => ({ sx: p.sx, sy: p.sy - dz });

// --- local polyline helpers (mirror src/world/barrier.ts; kept private) ---
function pointAt(path: [number, number][], t: number): [number, number] {
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (t <= acc + len) { const u = (t - acc) / (len || 1); return [ax + (bx - ax) * u, ay + (by - ay) * u]; }
    acc += len;
  }
  return path[path.length - 1];
}
function pathLength(path: [number, number][]): number {
  let s = 0;
  for (let i = 1; i < path.length; i++) s += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return s;
}

/** Is path distance `t` inside any gate span? */
function inGate(run: BarrierRun, t: number): boolean {
  for (const g of run.gates) {
    const half = g.width / 2;
    if (t >= g.t - half && t <= g.t + half) return true;
  }
  return false;
}

export function drawIsoBarrier(
  ctx: CanvasRenderingContext2D,
  entity: Entity,
  o: { originX: number; originY: number },
): void {
  const run = entity.properties?.barrier as BarrierRun | undefined;
  if (!run || run.path.length < 2) return;

  const base = MATERIAL_COLORS[run.material] ?? FALLBACK_COLOR;
  const riseZ = Math.max(0.1, run.height) * H_UNIT_PX;
  const total = pathLength(run.path);
  const step = 1; // one unit-tile per slab

  // Walk the polyline in unit steps; each step is one wall slab unless gated.
  for (let t = 0; t < total; t += step) {
    const t1 = Math.min(t + step, total);
    const mid = (t + t1) / 2;
    if (inGate(run, mid)) continue;

    const [ax, ay] = pointAt(run.path, t);
    const [bx, by] = pointAt(run.path, t1);
    const a0 = worldToScreen(ax, ay, 0, o.originX, o.originY);
    const b0 = worldToScreen(bx, by, 0, o.originX, o.originY);
    const aTop = raise(a0, riseZ);
    const bTop = raise(b0, riseZ);

    // near (front-facing) wall face
    quad(ctx, a0, b0, bTop, aTop, shade(base, 0.7));
    // top edge of the slab (thin cap)
    const capLift = Math.max(2, run.thickness * (ISO_TILE_H / 8));
    quad(ctx, aTop, bTop, raise(bTop, capLift), raise(aTop, capLift), base);

    // crenellation: small merlon notches along the top
    if (run.crenellated) {
      const mx = (aTop.sx + bTop.sx) / 2;
      const my = (aTop.sy + bTop.sy) / 2;
      const merlonH = riseZ * 0.18;
      const mw = 6;
      quad(ctx,
        { sx: mx - mw, sy: my },
        { sx: mx + mw, sy: my },
        { sx: mx + mw, sy: my - merlonH },
        { sx: mx - mw, sy: my - merlonH },
        shade(base, 0.85));
    }
  }

  // posts: a small upright at each path vertex
  if (run.posts) {
    const postZ = riseZ * 1.1;
    const pw = 4;
    for (const [vx, vy] of run.path) {
      const g = worldToScreen(vx, vy, 0, o.originX, o.originY);
      const tp = raise(g, postZ);
      quad(ctx,
        { sx: g.sx - pw, sy: g.sy },
        { sx: g.sx + pw, sy: g.sy },
        { sx: tp.sx + pw, sy: tp.sy },
        { sx: tp.sx - pw, sy: tp.sy },
        shade(base, 0.6));
    }
  }
}
