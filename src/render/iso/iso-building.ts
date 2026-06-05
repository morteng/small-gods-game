/**
 * Isometric projector for a building's Massing model. Shape-aware: a `round`
 * plan reads as a domed drum (yurt), `stepped` as a ziggurat (keep), and the
 * rest as extruded boxes whose roof silhouette comes from the descriptor's roof
 * kind (gable ridge / hip pyramid / conical / domed / lean-to / flat). Walls and
 * roof are tinted from the descriptor materials via the shared Massing.
 *
 * Geometry is approximate-but-readable, not architecturally exact — this is the
 * placeholder until AI-generated iso art lands. Extend by adding a case to
 * `drawRoof()` (matching the `Roof` union) or `drawBody()` (matching `Plan`).
 */
import { worldToScreen } from './iso-projection';
import type { IsoDrawCtx } from './iso-sprites';
import type { Massing } from '@/render/building-massing-model';
import type { Roof } from '@/world/building-descriptor';

/** Screen pixels per tile-height unit (one `heightPerLevel`). */
const H_UNIT_PX = 30;

interface P { sx: number; sy: number }

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

function tri(ctx: CanvasRenderingContext2D, a: P, b: P, c: P, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(a.sx, a.sy);
  ctx.lineTo(b.sx, b.sy);
  ctx.lineTo(c.sx, c.sy);
  ctx.closePath();
  ctx.fill();
}

const raise = (p: P, dz: number): P => ({ sx: p.sx, sy: p.sy - dz });

interface Corners { n: P; e: P; s: P; w: P }

function groundCorners(tx: number, ty: number, w: number, h: number, o: IsoDrawCtx): Corners {
  return {
    n: worldToScreen(tx, ty, 0, o.originX, o.originY),
    e: worldToScreen(tx + w, ty, 0, o.originX, o.originY),
    s: worldToScreen(tx + w, ty + h, 0, o.originX, o.originY),
    w: worldToScreen(tx, ty + h, 0, o.originX, o.originY),
  };
}

const center = (c: Corners): P => ({
  sx: (c.e.sx + c.w.sx) / 2,
  sy: (c.n.sy + c.s.sy) / 2,
});

/** Draw the two visible vertical walls + the flat top of a box; returns the raised top corners. */
function drawBox(ctx: CanvasRenderingContext2D, g: Corners, height: number, wall: string): Corners {
  const top: Corners = { n: raise(g.n, height), e: raise(g.e, height), s: raise(g.s, height), w: raise(g.w, height) };
  // left (south-west) wall, right (south-east) wall, then top face
  quad(ctx, g.w, g.s, top.s, top.w, shade(wall, 0.6));
  quad(ctx, g.s, g.e, top.e, top.s, shade(wall, 0.78));
  quad(ctx, top.n, top.e, top.s, top.w, wall);
  return top;
}

/** A round drum (cylinder) body; returns the screen ellipse of its top for the roof cap. */
function drawDrum(
  ctx: CanvasRenderingContext2D, g: Corners, height: number, wall: string,
): { cx: number; cy: number; rx: number; ry: number } {
  const rx = (g.e.sx - g.w.sx) / 2;
  const ry = (g.s.sy - g.n.sy) / 2;
  const cx = (g.e.sx + g.w.sx) / 2;
  const cyBottom = (g.n.sy + g.s.sy) / 2;
  const cyTop = cyBottom - height;
  // bottom ellipse
  ctx.fillStyle = shade(wall, 0.6);
  ctx.beginPath();
  ctx.ellipse(cx, cyBottom, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  // wall band
  ctx.fillStyle = shade(wall, 0.72);
  ctx.beginPath();
  ctx.moveTo(cx - rx, cyBottom);
  ctx.lineTo(cx - rx, cyTop);
  ctx.lineTo(cx + rx, cyTop);
  ctx.lineTo(cx + rx, cyBottom);
  ctx.closePath();
  ctx.fill();
  // top ellipse
  ctx.fillStyle = wall;
  ctx.beginPath();
  ctx.ellipse(cx, cyTop, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  return { cx, cy: cyTop, rx, ry };
}

function drawRoof(
  ctx: CanvasRenderingContext2D, roof: Roof, top: Corners, riseHeight: number, color: string,
): void {
  const c = center(top);
  const apex = raise(c, riseHeight);
  switch (roof) {
    case 'gable': {
      // ridge along the longer axis (n–s if footprint deeper, e–w otherwise),
      // approximated as a ridge between the midpoints of the two short edges.
      const midNE = { sx: (top.n.sx + top.e.sx) / 2, sy: (top.n.sy + top.e.sy) / 2 };
      const midSW = { sx: (top.s.sx + top.w.sx) / 2, sy: (top.s.sy + top.w.sy) / 2 };
      const ridgeA = raise(midNE, riseHeight);
      const ridgeB = raise(midSW, riseHeight);
      quad(ctx, top.w, top.n, ridgeA, ridgeB, color);
      quad(ctx, top.s, top.e, ridgeA, ridgeB, shade(color, 0.82));
      break;
    }
    case 'hip': {
      tri(ctx, top.n, top.e, apex, shade(color, 0.9));
      tri(ctx, top.e, top.s, apex, shade(color, 0.78));
      tri(ctx, top.s, top.w, apex, shade(color, 0.7));
      tri(ctx, top.w, top.n, apex, color);
      break;
    }
    case 'conical': {
      tri(ctx, top.w, top.n, apex, color);
      tri(ctx, top.n, top.e, apex, shade(color, 0.9));
      tri(ctx, top.e, top.s, apex, shade(color, 0.78));
      tri(ctx, top.s, top.w, apex, shade(color, 0.7));
      break;
    }
    case 'lean_to': {
      // single slope rising toward the back (north) edge
      const backN = raise(top.n, riseHeight);
      const backE = raise(top.e, riseHeight);
      quad(ctx, top.w, backN, backE, top.s, color);
      break;
    }
    case 'domed':
    case 'flat':
    case 'stepped':
    default:
      // flat cap (domed drums are capped separately in drawIsoBuildingMassing)
      quad(ctx, top.n, top.e, top.s, top.w, shade(color, 0.92));
      break;
  }
}

function drawDomeCap(
  ctx: CanvasRenderingContext2D, e: { cx: number; cy: number; rx: number; ry: number },
  rise: number, color: string,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(e.cx, e.cy, e.rx, e.ry + rise, 0, Math.PI, 0);
  ctx.fill();
}

/** Draw a building from its Massing at tile (tileX, tileY). */
export function drawIsoBuildingMassing(
  dc: IsoDrawCtx, m: Massing, tileX: number, tileY: number,
): void {
  const ctx = dc.ctx;
  const { w, h } = m.footprint;
  const roofPx = m.roofHeight * H_UNIT_PX;

  // ground shadow
  const g0 = groundCorners(tileX, tileY, w, h, dc);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.moveTo(g0.n.sx, g0.n.sy);
  ctx.lineTo(g0.e.sx, g0.e.sy);
  ctx.lineTo(g0.s.sx, g0.s.sy);
  ctx.lineTo(g0.w.sx, g0.w.sy);
  ctx.closePath();
  ctx.fill();

  if (m.plan === 'round') {
    const ellipse = drawDrum(ctx, g0, m.bodyHeight * H_UNIT_PX, m.walls);
    drawDomeCap(ctx, ellipse, roofPx, m.roofColor);
    return;
  }

  if (m.plan === 'stepped') {
    const levels = Math.max(1, m.levels);
    const perLevel = (m.bodyHeight * H_UNIT_PX) / levels;
    let z = 0;
    for (let i = 0; i < levels; i++) {
      const inset = i * m.levelInset;
      const lw = w - inset * 2;
      const lh = h - inset * 2;
      if (lw <= 0 || lh <= 0) break;
      const g = groundCorners(tileX + inset, tileY + inset, lw, lh, dc);
      // shift the whole stepped level up to sit on the one below
      const lifted: Corners = { n: raise(g.n, z), e: raise(g.e, z), s: raise(g.s, z), w: raise(g.w, z) };
      drawBox(ctx, lifted, perLevel, shade(m.walls, 1 - i * 0.06));
      z += perLevel;
    }
    return;
  }

  // rect / L / cross → extruded box body + roof silhouette
  const top = drawBox(ctx, g0, m.bodyHeight * H_UNIT_PX, m.walls);
  drawRoof(ctx, m.roof, top, roofPx, m.roofColor);
}
