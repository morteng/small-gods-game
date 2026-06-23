// src/render/connectome-overlay.ts
//
// Draws the ENTIRE world connectome as a graph over the rendered world: POIs as
// labelled nodes, the inter-POI road/river network as edges (from `map.roadGraph`,
// the Slice-0 source of truth), junction/waypoint nodes, and each settlement's
// local street graph (`map.settlementPlans`). A debug/inspection view — toggled
// with `?connectome` — that makes the world's graph structure legible.
//
// Projection matches the T1 GPU terrain EXACTLY (iso + height lift), so nodes and
// edges sit on the lifted surface rather than floating on a flat plane.

import type { RenderContext, Camera, GameMap, POI } from '@/core/types';
import { ISO_TILE_W, ISO_TILE_H } from '@/render/iso/iso-constants';
import { ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import { heightField } from '@/render/gpu/terrain-field';
import { worldStyleOf } from '@/core/world-style';
import { getWaterNetwork } from '@/world/water-network-store';
import type { ReachClass, WaterNodeKind, LakeClass, WaterNetwork } from '@/terrain/river-network';
import type { PressureReport } from '@/world/connectome/pressure';

const HALF_W = ISO_TILE_W / 2;
const HALF_H = ISO_TILE_H / 2;

const EDGE_STYLE: Record<string, { color: string; width: number }> = {
  road: { color: 'rgba(225, 178, 92, 0.9)', width: 2 },
  river: { color: 'rgba(96, 170, 230, 0.85)', width: 3 },
  wall: { color: 'rgba(170, 170, 180, 0.9)', width: 2 },
};

/** Project a tile coord to CSS-pixel screen space, lifted onto the terrain.
 *  Exported as {@link projectConnectome} so the world-studio (drill-down /
 *  hit-testing / focus overlays) shares pixel-exact parity with this overlay. */
export function projectConnectome(map: GameMap, tx: number, ty: number, cam: Camera): { x: number; y: number } {
  return project(map, tx, ty, cam);
}
/** Approximate inverse of {@link projectConnectome}: CSS-pixel screen → tile coord,
 *  IGNORING terrain lift (which is non-invertible). Good enough for coarse placement
 *  (a rain brush, a cursor probe) — the lift error is a fraction of a tile in the y
 *  axis and irrelevant to a multi-tile brush. Clamped to the map. */
export function screenToTileApprox(map: GameMap, sx: number, sy: number, cam: Camera): { tx: number; ty: number } {
  const a = (sx / cam.zoom + cam.x) / HALF_W;   // tx − ty
  const b = (sy / cam.zoom + cam.y) / HALF_H;    // tx + ty (lift omitted)
  const tx = (a + b) / 2;
  const ty = (b - a) / 2;
  return {
    tx: Math.max(0, Math.min(map.width - 1, tx)),
    ty: Math.max(0, Math.min(map.height - 1, ty)),
  };
}
/**
 * Lift-AWARE inverse: CSS-pixel screen → the tile whose LIFTED rendering sits under
 * the cursor. `screenToTileApprox` ignores terrain lift, so on raised ground the tile
 * it returns (re-projected with lift) floats far above the cursor. We refine by
 * fixed-point iteration: re-add the lift at the current estimate and re-invert. A few
 * passes converge on the gentle relief here. Matches {@link project}'s lift exactly.
 */
export function screenToTileLifted(map: GameMap, sx: number, sy: number, cam: Camera, iters = 4): { tx: number; ty: number } {
  const style = worldStyleOf(map.worldSeed);
  const k = style.mountainRelief * style.terrainVerticalExaggeration;
  let { tx, ty } = screenToTileApprox(map, sx, sy, cam);
  for (let i = 0; i < iters; i++) {
    const lift = (renderElevAt(map, tx, ty) - ELEVATION_SEA_LEVEL) * k;
    ({ tx, ty } = screenToTileApprox(map, sx, sy + lift * cam.zoom, cam));
  }
  return { tx, ty };
}
/**
 * The EXACT normalised elevation the GPU terrain lifts by at a (fractional) tile —
 * the composed (road/river carve) + gamma-curved height buffer the shader uploads,
 * BILINEARLY interpolated between vertices. `elevationAt` reads the raw base field
 * floored to a corner, so the overlay floated above carved channels and stepped
 * between vertices; sampling the render buffer puts every node on the lifted surface.
 */
function renderElevAt(map: GameMap, tx: number, ty: number): number {
  const W = map.width, H = map.height;
  const hf = heightField(map);
  const fx = Math.max(0, Math.min(W - 1, tx)), fy = Math.max(0, Math.min(H - 1, ty));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
  const dx = fx - x0, dy = fy - y0;
  const top = hf[y0 * W + x0] * (1 - dx) + hf[y0 * W + x1] * dx;
  const bot = hf[y1 * W + x0] * (1 - dx) + hf[y1 * W + x1] * dx;
  return top * (1 - dy) + bot * dy;
}
function project(map: GameMap, tx: number, ty: number, cam: Camera): { x: number; y: number } {
  const elev = renderElevAt(map, tx, ty);
  // S1 style knobs (default to TERRAIN_RELIEF_M × TERRAIN_Z_PX_PER_M) — must match
  // the GPU terrain lift exactly so overlay nodes sit on the lifted surface.
  const style = worldStyleOf(map.worldSeed);
  const lift = (elev - ELEVATION_SEA_LEVEL) * style.mountainRelief * style.terrainVerticalExaggeration;
  const sx = ((tx - ty) * HALF_W - cam.x) * cam.zoom;
  const sy = ((tx + ty) * HALF_H - lift - cam.y) * cam.zoom;
  return { x: sx, y: sy };
}

function strokePolyline(
  ctx: CanvasRenderingContext2D, map: GameMap, cam: Camera,
  pts: ReadonlyArray<{ x: number; y: number }>,
): void {
  if (pts.length < 2) return;
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const p = project(map, pts[i].x, pts[i].y, cam);
    if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

function dot(
  ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, stroke?: string,
): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
}

/**
 * Draw the whole-world connectome overlay onto the Canvas2D overlay context.
 * No-op when there's no world graph (returns early).
 */
export function drawWorldConnectome(ctx: CanvasRenderingContext2D, rc: RenderContext): void {
  const { map, camera } = rc;
  if (!map) return;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // 1) Settlement street graphs (local lanes) — drawn first, faint, underneath.
  for (const plan of map.settlementPlans ?? []) {
    ctx.strokeStyle = 'rgba(210, 200, 180, 0.35)';
    ctx.lineWidth = 1;
    for (const e of plan.edges) {
      // SettlementPlan edges carry a tile path; project it as a polyline.
      strokePolyline(ctx, map, camera, e.tiles);
    }
  }

  // 2) Inter-POI road / river / wall edges (the world connectome backbone).
  const graph = map.roadGraph;
  if (graph) {
    for (const e of graph.edges) {
      const s = EDGE_STYLE[e.feature] ?? EDGE_STYLE.road;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width * Math.max(0.5, Math.min(camera.zoom, 2));
      strokePolyline(ctx, map, camera, e.polyline);
    }
    // 3) Junction + waypoint nodes.
    for (const n of graph.nodes) {
      if (n.kind === 'poi') continue; // POIs drawn richer below
      const p = project(map, n.x, n.y, camera);
      if (n.kind === 'junction') dot(ctx, p.x, p.y, 3, 'rgba(255, 160, 70, 0.95)');
      else dot(ctx, p.x, p.y, 2, 'rgba(200, 200, 210, 0.7)'); // waypoint / end
    }
  }

  // 3b) Anchor-snap layer: links first (thin, relation-coloured), then anchors as ticked dots.
  const LINK_COLOR: Record<string, string> = {
    connects: 'rgba(120, 230, 160, 0.85)',
    serves: 'rgba(230, 200, 110, 0.85)',
    spans: 'rgba(120, 190, 240, 0.85)',
  };
  for (const link of map.anchorLinks ?? []) {
    ctx.strokeStyle = LINK_COLOR[link.relation] ?? 'rgba(200,200,200,0.7)';
    ctx.lineWidth = 1.25;
    strokePolyline(ctx, map, camera, [link.a, link.b]);
  }
  const ANCHOR_COLOR: Record<string, string> = {
    door: 'rgba(120, 230, 160, 0.95)', frontage: 'rgba(120, 230, 160, 0.7)',
    gate: 'rgba(230, 200, 110, 0.95)', service: 'rgba(230, 200, 110, 0.7)',
    road: 'rgba(225, 178, 92, 0.8)', wall_end: 'rgba(200, 200, 210, 0.9)',
    bank: 'rgba(120, 190, 240, 0.95)', water_edge: 'rgba(120, 190, 240, 0.7)',
  };
  for (const a of map.anchors ?? []) {
    const p = project(map, a.x, a.y, camera);
    const col = ANCHOR_COLOR[a.kind] ?? 'rgba(220,220,220,0.8)';
    dot(ctx, p.x, p.y, 1.8, col);
    // facing tick
    const tip = project(map, a.x + a.facing[0] * 0.6, a.y + a.facing[1] * 0.6, camera);
    ctx.strokeStyle = col;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
  }

  // 4) POI nodes (the whole set, including unconnected ones) with labels.
  const pois: POI[] = map.worldSeed?.pois ?? [];
  ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  for (const poi of pois) {
    if (!poi.position) continue;
    const p = project(map, poi.position.x, poi.position.y, camera);
    const r = poi.importance === 'critical' ? 7 : poi.importance === 'high' ? 6 : 5;
    dot(ctx, p.x, p.y, r, 'rgba(255, 214, 102, 0.95)', 'rgba(40, 30, 10, 0.9)');
    if (poi.name) {
      const label = poi.name;
      const ly = p.y - r - 3;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(10, 12, 18, 0.85)';
      ctx.strokeText(label, p.x, ly);
      ctx.fillStyle = '#fff3d6';
      ctx.fillText(label, p.x, ly);
    }
  }

  ctx.restore();
}

// ── Water connectome overlay (the river-network graph) ───────────────────────
// Strokes each reach's SMOOTHED centreline coloured + weighted by spectrum class,
// then glyphs the nodes by kind. This is the graph the carve and the editor read —
// drawing it makes "this brook / from that pond / two sources merge here" legible.

const REACH_STYLE: Record<ReachClass, { color: string; width: number }> = {
  brook:       { color: 'rgba(150, 205, 235, 0.85)', width: 1.2 },
  stream:      { color: 'rgba(110, 185, 235, 0.9)',  width: 2.0 },
  river:       { color: 'rgba(70, 155, 230, 0.92)',  width: 3.2 },
  major_river: { color: 'rgba(45, 125, 220, 0.95)',  width: 4.6 },
};

// Lake bodies — a ringed marker sized by the still-water spectrum (tarn → mere).
const LAKE_STYLE: Record<LakeClass, { color: string; r: number }> = {
  tarn: { color: 'rgba(90, 215, 230, 0.55)', r: 3.5 },
  pond: { color: 'rgba(70, 195, 230, 0.55)', r: 5.0 },
  lake: { color: 'rgba(55, 170, 225, 0.55)', r: 7.5 },
  mere: { color: 'rgba(45, 140, 220, 0.55)', r: 11.0 },
};

const NODE_STYLE: Record<WaterNodeKind, { color: string; r: number }> = {
  spring:      { color: 'rgba(120, 235, 160, 0.95)', r: 3.2 },   // green — a source
  lake_outlet: { color: 'rgba(80, 220, 230, 0.95)',  r: 3.6 },   // cyan — lake-fed birth
  confluence:  { color: 'rgba(255, 240, 200, 0.95)', r: 3.0 },   // pale — tributaries merge
  lake_inlet:  { color: 'rgba(150, 170, 235, 0.9)',  r: 3.0 },   // indigo — enters a lake
  mouth:       { color: 'rgba(60, 130, 210, 0.95)',  r: 3.8 },   // deep blue — estuary
};

/** Optional draw overrides — the studio editor passes an EDITED network (so a dragged
 *  node + its re-routed reaches render live) and a pressure report to visualize crowding. */
export interface WaterNetworkDrawOpts {
  net?: WaterNetwork;
  pressure?: PressureReport;
}

/**
 * Draw the water connectome (river-network graph) onto the Canvas2D overlay context.
 * No-op when the world has no rivers. `zoom` scales line weight so it reads at any zoom.
 * Pass `opts.net` to render an edited network and `opts.pressure` to ring crowded features.
 */
export function drawWaterNetwork(ctx: CanvasRenderingContext2D, rc: RenderContext, opts: WaterNetworkDrawOpts = {}): void {
  const { map, camera } = rc;
  if (!map) return;
  const net = opts.net ?? getWaterNetwork(map);
  if (net.reaches.length === 0) return;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const zw = Math.max(0.5, Math.min(camera.zoom, 2.5));

  // Lake bodies first — a ringed marker at the centroid, sized by class, under the channels.
  for (const l of net.lakes) {
    const st = LAKE_STYLE[l.klass];
    const p = project(map, l.x + 0.5, l.y + 0.5, camera);
    dot(ctx, p.x, p.y, st.r * Math.min(1.4, zw), st.color, 'rgba(20, 60, 90, 0.8)');
  }

  // Reaches — thick trunks first so thin brooks render on top of their confluence.
  const order: ReachClass[] = ['major_river', 'river', 'stream', 'brook'];
  for (const klass of order) {
    for (const reach of net.reaches) {
      if (reach.klass !== klass) continue;
      const s = REACH_STYLE[klass];
      ctx.strokeStyle = reach.lakeFed ? 'rgba(80, 220, 230, 0.9)' : s.color;
      ctx.lineWidth = s.width * zw;
      strokePolyline(ctx, map, camera, reach.centerline);
    }
  }

  // Pressure rings UNDER the node glyphs — a hot halo whose radius/alpha grows with
  // crowding, so impinging features read at a glance (advisory; nothing is moved).
  if (opts.pressure && opts.pressure.maxPressure > 0) {
    const { perItem, maxPressure } = opts.pressure;
    const ringAt = (id: string, x: number, y: number): void => {
      const v = perItem.get(id);
      if (!v) return;
      const t = Math.min(1, v / maxPressure);
      const p = project(map, x, y, camera);
      const r = (6 + 10 * t) * Math.min(1.4, zw);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, ${Math.round(160 - 120 * t)}, 60, ${0.5 + 0.4 * t})`;
      ctx.lineWidth = 2 + 2 * t;
      ctx.stroke();
    };
    for (const n of net.nodes) ringAt(n.id, n.x + 0.5, n.y + 0.5);
    for (const l of net.lakes) ringAt(l.id, l.x + 0.5, l.y + 0.5);
  }

  // Nodes — glyph by kind.
  for (const n of net.nodes) {
    const st = NODE_STYLE[n.kind];
    const p = project(map, n.x + 0.5, n.y + 0.5, camera);
    dot(ctx, p.x, p.y, st.r, st.color, 'rgba(10, 20, 30, 0.85)');
  }

  ctx.restore();
}
