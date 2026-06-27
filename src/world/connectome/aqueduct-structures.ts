// src/world/connectome/aqueduct-structures.ts
//
// G6 slice 4 — REALIZATION: the emergent aqueduct decision core (sources → demand → routed,
// profiled line) becomes grey-massing World entities, the SAME way G5 bridges do. An aqueduct
// is the inverted river, and its three modes (cut / surface / elevated) each map to massing we
// already have:
//   • surface / cut → a graded CHANNEL trough sitting on the ground (a `deck` with both parapets
//     reads as an open water channel — a flat floor between two low walls); foot-sampled.
//   • elevated      → the iconic arched aqueduct: the channel rides a deck lifted onto its water
//     line via the G4 `liftElev` primitive, carried on PIERS standing from the ground up to its
//     underside (`clearM` tall). Marches as cardinal pieces, exactly like a bridge deck's bays.
// No new geometry, no LinearFeature, no terrain feature-buffer / WGSL — purely additive entity
// spawning through the existing blueprint pipeline (so it renders grey today and picks up art on
// a funded reseed). Pure + deterministic: returns `Entity[]`, the caller adds them at world-build
// time before the static draw cache is built.

import type { Entity } from '@/core/types';
import type { WaterNetwork } from '@/terrain/river-network';
import { BLUEPRINT_VERSION, type Blueprint } from '@/blueprint/types';
import { blueprintEntity } from '@/blueprint/entity';
import { resolveBlueprint } from '@/blueprint/resolve';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { METRES_PER_TILE } from '@/render/scale-contract';
import { findHighlandSources } from './aqueduct-sources';
import { planAqueducts, type SettlementSite, type AqueductPlan } from './aqueduct-placement';
import type { AqueductSegment, AqueductStation } from './aqueduct-profile';
import type { SpanPoint } from './road-span';

export interface AqueductStructureOptions {
  /** Normalised [0,1] ground elevation at a tile (the field stairs/roads/profile sample). */
  elevAt: (x: number, y: number) => number;
  /** Metres of relief per normalised elevation unit (`worldStyle.mountainRelief`). */
  reliefM: number;
  /** Grid extent — the router stays in `[0,width) × [0,height)`. */
  width: number;
  height: number;
  /** Render-lift (the `curveRenderElev` space the terrain `heights` buffer and `liftElev` use) for
   *  a water-surface height in METRES — `(waterM) => curveRenderElev(waterM / reliefM, sea, gamma)`.
   *  Rides an elevated channel deck on its water line over the ground. */
  liftForWaterM: (waterM: number) => number;
  /** Demand gate: a settlement that actually needs an aqueduct (dry / inland). Default: all demand
   *  (the head + distance + feasibility gates then decide which towns actually get one). */
  needsAqueduct?: (s: SettlementSite) => boolean;
  /** A tile the channel may not route through (open water body, building footprint). */
  blocked?: (x: number, y: number) => boolean;
  /** Keep only highland sources at least this high (metres). Default 0 — the head check filters. */
  minSourceElevM?: number;
  /** Channel trough width, tiles. Default 1 (a ~2 m conduit). */
  channelWidthTiles?: number;
  /** Massing material for the channel + piers. Default 'stone' (a masonry aqueduct). */
  material?: string;
  // Planner pass-throughs (optional; sensible defaults live in the planner).
  minHeadM?: number;
  maxRouteTiles?: number;
  maxGrade?: number;
}

/** Below this clearance (m) a pier would be a stub — skip it (the deck seats on the ground). */
const MIN_PIER_HEIGHT_M = 1;
/** Cap pier height so a freak deep gorge doesn't spawn an absurd tower. */
const MAX_PIER_HEIGHT_M = 14;
/** Place an elevated-run pier every N tiles (plus always at the run's two ends). */
const PIER_SPACING_TILES = 2;
/** Masonry aqueduct piers taper (batter) like bridge piers — read as built, not poured. */
const PIER_BATTER = 0.15;

/**
 * Build the grey-massing aqueduct entities a world's water network + settlements imply. Lifts the
 * network's springs / lake-outlets into highland intakes, lets {@link planAqueducts} choose which
 * dry settlement each feeds and along which line, then realises every profile segment as channel /
 * pier massing. Pure + deterministic (the decision core is; ids derive from source/sink/coords).
 */
export function buildAqueductStructureEntities(
  net: WaterNetwork,
  settlements: SettlementSite[],
  opts: AqueductStructureOptions,
): Entity[] {
  ensureBuildingTypesRegistered();   // inline deck/pier blueprints resolve directly
  if (settlements.length === 0) return [];
  const sources = findHighlandSources(net, {
    elevAt: opts.elevAt, reliefM: opts.reliefM, minElevM: opts.minSourceElevM,
  });
  if (sources.length === 0) return [];

  const plans = planAqueducts(settlements, sources, {
    elevAt: opts.elevAt, reliefM: opts.reliefM, width: opts.width, height: opts.height,
    blocked: opts.blocked, needsAqueduct: opts.needsAqueduct,
    minHeadM: opts.minHeadM, maxRouteTiles: opts.maxRouteTiles, maxGrade: opts.maxGrade,
  });

  const out: Entity[] = [];
  for (const plan of plans) emitPlan(out, plan, opts);
  return out;
}

function emitPlan(out: Entity[], plan: AqueductPlan, opts: AqueductStructureOptions): void {
  const mat = opts.material ?? 'stone';
  const widthTiles = Math.max(0.5, opts.channelWidthTiles ?? 1);
  const tag = `${plan.sourceId}->${plan.settlementId}`;

  // Per-tile clearance lookup so a pier knows how tall to stand at its station.
  const stationAt = new Map<string, AqueductStation>();
  for (const s of plan.profile.stations) stationAt.set(`${s.x},${s.y}`, s);

  const pierTiles = new Set<string>();   // dedupe piers shared at a within-mode bend corner
  for (const seg of plan.profile.segments) {
    out.push(channelEntity(tag, seg, widthTiles, mat, opts));
    if (seg.mode === 'elevated') emitPiers(out, tag, seg, stationAt, mat, pierTiles);
  }
}

/** One cardinal channel run — a `deck` trough (both parapets = the channel walls) along the run's
 *  axis. Elevated runs ride their water line via `liftElev`; surface / cut runs foot-sample to the
 *  ground (a cut conduit reads as a covered channel hugging the rise — true trenching is a later
 *  render refinement). */
function channelEntity(
  tag: string, seg: AqueductSegment, widthTiles: number, mat: string, opts: AqueductStructureOptions,
): Entity {
  const ew = seg.axis === 'ew';
  // +1 tile so adjacent runs overlap and seat together (no gap at a bend / mode boundary).
  const lenTiles = Math.max(1, Math.round(seg.runTiles) + 1);
  const crossTiles = Math.max(1, Math.ceil(widthTiles));
  const footW = ew ? lenTiles : crossTiles;
  const footH = ew ? crossTiles : lenTiles;
  // Footprint origin = the run's min corner, centred on the run line across its width.
  const minX = Math.min(seg.from.x, seg.to.x);
  const minY = Math.min(seg.from.y, seg.to.y);
  const halfCross = Math.floor((crossTiles - 1) / 2);
  const ox = ew ? minX : minX - halfCross;
  const oy = ew ? minY - halfCross : minY;

  const bp: Blueprint = {
    version: BLUEPRINT_VERSION, class: 'prop', preset: 'aqueduct_channel', category: 'infrastructure',
    footprint: { w: footW, h: footH }, materials: { walls: mat, roof: mat, ground: 'dirt' },
    parts: { channel: { type: 'deck', at: { x: 0, y: 0 }, size: { w: footW, h: footH }, params: {
      lengthM: lenTiles * METRES_PER_TILE, widthM: widthTiles * METRES_PER_TILE,
      thicknessM: 0.5, dir: seg.axis, parapet: 'both',
    } } },
  };
  const rb = resolveBlueprint([bp], 0);
  const id = `aqueduct:${tag}:${seg.from.x},${seg.from.y}-${seg.to.x},${seg.to.y}`;
  const e = blueprintEntity(id, rb, ox, oy);
  if (seg.mode === 'elevated') {
    (e.properties as Record<string, unknown>).liftElev = opts.liftForWaterM((seg.fromWaterM + seg.toWaterM) / 2);
  }
  return e;
}

/** Piers under an elevated run — one every {@link PIER_SPACING_TILES} tiles plus the two ends,
 *  each standing from the ground to the channel underside (`clearM` tall). */
function emitPiers(
  out: Entity[], tag: string, seg: AqueductSegment,
  stationAt: Map<string, AqueductStation>, mat: string, pierTiles: Set<string>,
): void {
  const pts = tilesAlong(seg.from, seg.to);
  for (let i = 0; i < pts.length; i++) {
    const isEnd = i === 0 || i === pts.length - 1;
    if (!isEnd && i % PIER_SPACING_TILES !== 0) continue;
    const key = `${pts[i].x},${pts[i].y}`;
    if (pierTiles.has(key)) continue;
    const st = stationAt.get(key);
    if (!st) continue;
    const h = Math.min(MAX_PIER_HEIGHT_M, st.clearM);
    if (h < MIN_PIER_HEIGHT_M) continue;
    pierTiles.add(key);
    out.push(pierEntity(`aqpier:${tag}:${key}`, pts[i].x, pts[i].y, h, mat));
  }
}

function pierEntity(id: string, x: number, y: number, heightM: number, mat: string): Entity {
  const bp: Blueprint = {
    version: BLUEPRINT_VERSION, class: 'prop', preset: 'aqueduct_pier', category: 'infrastructure',
    footprint: { w: 1, h: 1 }, materials: { walls: mat, roof: mat, ground: 'dirt' },
    parts: { pier: { type: 'pier', at: { x: 0, y: 0 }, size: { w: 1, h: 1 }, params: { heightM, widthM: 1, batter: PIER_BATTER } } },
  };
  const rb = resolveBlueprint([bp], 0);
  return blueprintEntity(id, rb, x, y);
}

/** Integer tiles from a to b inclusive along their cardinal run (a,b are cardinal-colinear). */
function tilesAlong(a: SpanPoint, b: SpanPoint): SpanPoint[] {
  const dx = Math.sign(b.x - a.x);
  const dy = Math.sign(b.y - a.y);
  const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  const out: SpanPoint[] = [];
  for (let i = 0; i <= steps; i++) out.push({ x: a.x + dx * i, y: a.y + dy * i });
  return out;
}
