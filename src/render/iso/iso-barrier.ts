/**
 * Isometric draw for linear barrier runs (walls / palisades / fences …).
 *
 * A barrier entity carries `properties.barrier: BarrierRun` — a polyline with a
 * height, a material, optional crenellation/posts and zero-or-more gate gaps.
 * We walk each path segment in unit steps and emit an iso "wall slab" per step:
 * the near (south-facing) vertical face plus the flat top. Steps whose midpoint
 * falls inside a gate span are skipped, so a gated run paints fewer quads than an
 * identical ungated run. Geometry is approximate-but-readable, mirroring the
 * parametric building draw (worldToScreen + plain quads, no new deps).
 *
 * `barrierItems` emits neutral draw-list items; `drawIsoBarrier` is the
 * Canvas2D wrapper kept for direct callers/tests.
 */
import type { Entity } from '@/core/types';
import type { BarrierRun } from '@/world/barrier';
import { worldToScreen } from './iso-projection';
import { HEIGHT_UNIT_PX, ISO_TILE_H } from '@/render/scale-contract';
import { type DrawItem } from './draw-list';
import { packAlbedoSource, mapSize, type BarrierPiece } from './sprite-canvas';

/**
 * One composed-and-lit barrier chunk → an image DrawItem, placed pixel-exactly: the chunk's
 * `refX/refY` (a real z=0 world point) projects to screen, and the sprite is offset so its
 * normalised anchor pixel lands there. Co-registered normal/material/emissive + the geometry
 * cast shadow ride along (Canvas2D ignores the maps; the WebGPU scene lights them). The general
 * form of the building foot-anchor, but for an arbitrary geometry point (a wall has no
 * bottom-centre footprint to anchor on).
 */
export function barrierPieceItem(o: { originX: number; originY: number }, piece: BarrierPiece): DrawItem {
  const { pack } = piece;
  const src = packAlbedoSource(pack);
  const { w, h } = mapSize(src);
  const s = worldToScreen(piece.refX, piece.refY, 0, o.originX, o.originY);
  const item: DrawItem = {
    t: 'image', src,
    dx: Math.round(s.sx - piece.anchorNX * w),
    dy: Math.round(s.sy - piece.anchorNY * h),
    dw: w, dh: h,
    // Terrain foot-z: sample at the piece's true grade anchor (a wall has no footprint diamond, so
    // the building `dw/4` convention samples an off-anchor tile and splits seams on slopes). D6.
    foot: { sx: s.sx, sy: s.sy },
  };
  if (pack.normal || pack.normalData || pack.material || pack.materialData || pack.emissive || pack.emissiveData) {
    item.maps = {
      normal: pack.normal as CanvasImageSource | undefined,
      normalData: pack.normalData,
      material: pack.material as CanvasImageSource | undefined,
      materialData: pack.materialData,
      emissive: pack.emissive as CanvasImageSource | undefined,
      emissiveData: pack.emissiveData,
    };
  }
  if (pack.shadow) item.shadowSprite = { src: pack.shadow.canvas, dx: pack.shadow.dx, dy: pack.shadow.dy };
  return item;
}

interface P { sx: number; sy: number }

const MATERIAL_COLORS: Record<string, string> = {
  stone: '#8a8a8a',
  timber: '#8B5A2B',
  wood: '#8B5A2B',
  brick: '#9c5a4a',
  earth: '#9b7b53',
  hedge: '#4a7c3a',
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

const quadItem = (a: P, b: P, c: P, d: P, color: string): DrawItem => ({
  t: 'poly',
  points: [{ x: a.sx, y: a.sy }, { x: b.sx, y: b.sy }, { x: c.sx, y: c.sy }, { x: d.sx, y: d.sy }],
  color,
});

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

/**
 * One independently y-sortable piece of a barrier run: its draw items plus a
 * WORLD anchor tile (`wx`/`wy`) the entity draw list uses as the iso-depth key.
 * A long fence is many slabs, so each slab interleaves with buildings/NPCs at
 * its OWN depth — without this a whole run sorts at the entity anchor and draws
 * entirely in front of or behind a house it actually weaves past.
 */
export interface BarrierSlab {
  wx: number;
  wy: number;
  items: DrawItem[];
}

/**
 * Decompose a barrier run into per-slab pieces, each carrying its own world
 * anchor for y-sorting. Wall slabs walk the polyline in unit steps (gated steps
 * dropped); posts become one slab per vertex. The screen geometry is identical
 * to the old single-list emit — only the grouping (and thus draw order) changes.
 */
export function barrierSlabs(
  entity: Entity,
  o: { originX: number; originY: number },
): BarrierSlab[] {
  const run = entity.properties?.barrier as BarrierRun | undefined;
  if (!run || run.path.length < 2) return [];

  const slabs: BarrierSlab[] = [];
  const base = MATERIAL_COLORS[run.material] ?? FALLBACK_COLOR;
  const riseZ = Math.max(0.1, run.height) * HEIGHT_UNIT_PX;
  const total = pathLength(run.path);
  const step = 1; // one unit-tile per slab
  const capLift = Math.max(2, run.thickness * (ISO_TILE_H / 8));

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

    const items: DrawItem[] = [
      // near (front-facing) wall face
      quadItem(a0, b0, bTop, aTop, shade(base, 0.7)),
      // top edge of the slab (thin cap)
      quadItem(aTop, bTop, raise(bTop, capLift), raise(aTop, capLift), base),
    ];

    // crenellation: small merlon notches along the top
    if (run.crenellated) {
      const mx = (aTop.sx + bTop.sx) / 2;
      const my = (aTop.sy + bTop.sy) / 2;
      const merlonH = riseZ * 0.18;
      const mw = 6;
      items.push(quadItem(
        { sx: mx - mw, sy: my },
        { sx: mx + mw, sy: my },
        { sx: mx + mw, sy: my - merlonH },
        { sx: mx - mw, sy: my - merlonH },
        shade(base, 0.85)));
    }

    // anchor the slab at its midpoint tile so it y-sorts where it actually sits
    const [cx, cy] = pointAt(run.path, mid);
    slabs.push({ wx: cx, wy: cy, items });
  }

  // posts: a small upright at each path vertex, each its own y-sorted piece
  if (run.posts) {
    const postZ = riseZ * 1.1;
    const pw = 4;
    for (const [vx, vy] of run.path) {
      const g = worldToScreen(vx, vy, 0, o.originX, o.originY);
      const tp = raise(g, postZ);
      slabs.push({
        wx: vx, wy: vy,
        items: [quadItem(
          { sx: g.sx - pw, sy: g.sy },
          { sx: g.sx + pw, sy: g.sy },
          { sx: tp.sx + pw, sy: tp.sy },
          { sx: tp.sx - pw, sy: tp.sy },
          shade(base, 0.6))],
      });
    }
  }

  return slabs;
}

/** Flattened single-list emit — kept for direct callers/tests. Per-slab y-sort
 *  ordering is applied by the entity draw list via {@link barrierSlabs}. */
export function barrierItems(
  entity: Entity,
  o: { originX: number; originY: number },
): DrawItem[] {
  return barrierSlabs(entity, o).flatMap((s) => s.items);
}
