/**
 * Topdown silhouette renderer for a BuildingDescriptor — the placeholder until
 * AI-generated art lands. Reads the descriptor's massing (plan / levels /
 * levelInset / roof) and materials. Drawn in world-pixel space (TILE_SIZE
 * units), matching renderer.ts which draws entities at `e.x * TILE_SIZE`.
 *
 * Extend by adding a `case` to drawPlan() / drawRoof(); the `default` keeps an
 * unknown shape rendering (as a rectangle) instead of throwing.
 */
import { TILE_SIZE } from '@/core/constants';
import type { BuildingDescriptor } from '@/world/building-descriptor';
import { buildingMassing, type Massing } from './building-massing-model';

function shade(hex: string, factor: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export function drawBuildingPlaceholder(
  ctx: CanvasRenderingContext2D,
  d: BuildingDescriptor,
  originTileX: number,
  originTileY: number,
): void {
  const m = buildingMassing(d);
  const x = originTileX * TILE_SIZE;
  const y = originTileY * TILE_SIZE;
  const w = m.footprint.w * TILE_SIZE;
  const h = m.footprint.h * TILE_SIZE;

  if (m.plan === 'stepped') {
    drawStepped(ctx, m, x, y, w, h);
  } else {
    ctx.fillStyle = m.walls;
    drawPlan(ctx, m.plan, x, y, w, h);
    drawRoof(ctx, m.roof, x, y, w, h, m.roofColor);
  }
  drawDoor(ctx, m, x, y);
}

function drawPlan(
  ctx: CanvasRenderingContext2D, plan: BuildingDescriptor['plan'],
  x: number, y: number, w: number, h: number,
): void {
  switch (plan) {
    case 'round': {
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'L': {
      ctx.fillRect(x, y, w, h * 0.5);
      ctx.fillRect(x, y, w * 0.5, h);
      break;
    }
    case 'cross': {
      ctx.fillRect(x + w * 0.25, y, w * 0.5, h);
      ctx.fillRect(x, y + h * 0.25, w, h * 0.5);
      break;
    }
    case 'rect':
    default:
      ctx.fillRect(x, y, w, h);
      break;
  }
}

function drawStepped(
  ctx: CanvasRenderingContext2D, m: Massing,
  x: number, y: number, w: number, h: number,
): void {
  const wallColor = m.walls;
  const levels = Math.max(1, m.levels);
  const insetPx = Math.max(1, m.levelInset) * TILE_SIZE * 0.5;
  for (let i = 0; i < levels; i++) {
    const o = i * insetPx;
    const lw = w - o * 2, lh = h - o * 2;
    if (lw <= 0 || lh <= 0) break;
    const f = Math.max(0, 1 - i * 0.12);
    ctx.fillStyle = shade(wallColor, f);
    ctx.fillRect(x + o, y + o, lw, lh);
  }
}

function drawRoof(
  ctx: CanvasRenderingContext2D, roof: BuildingDescriptor['roof'],
  x: number, y: number, w: number, h: number, roofColor: string,
): void {
  ctx.fillStyle = roofColor;
  ctx.strokeStyle = roofColor;
  const cx = x + w / 2, cy = y + h / 2;
  switch (roof) {
    case 'conical':
    case 'domed':
    case 'onion': {
      ctx.beginPath();
      ctx.ellipse(cx, cy, w * 0.18, h * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'gable':
    case 'gambrel':
    case 'saltbox':
    case 'cross_gable': {
      const r = Math.max(1, TILE_SIZE * 0.12);
      ctx.fillRect(cx - r / 2, y + h * 0.15, r, h * 0.7);
      break;
    }
    case 'hip':
    case 'pyramidal':
    case 'mansard':
    case 'jerkinhead':
    case 'tented':
    case 'spire': {
      ctx.fillRect(x + w * 0.2, y + h * 0.2, w * 0.6, h * 0.6);
      break;
    }
    case 'lean_to': {
      ctx.fillRect(x, y, w, h * 0.35);
      break;
    }
    case 'stepped':
    case 'flat':
    default: {
      const b = Math.max(1, TILE_SIZE * 0.1);
      ctx.fillRect(x, y, w, b);
      ctx.fillRect(x, y + h - b, w, b);
      break;
    }
  }
}

function drawDoor(
  ctx: CanvasRenderingContext2D, m: Massing, x: number, y: number,
): void {
  ctx.fillStyle = '#3a2a1a';
  const dx = x + m.door.x * TILE_SIZE + TILE_SIZE * 0.3;
  const dy = y + m.door.y * TILE_SIZE + TILE_SIZE * 0.3;
  ctx.fillRect(dx, dy, TILE_SIZE * 0.4, TILE_SIZE * 0.4);
}
