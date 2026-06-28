// src/world/connectome/aqueduct-structures.ts
//
// G6 slice 4 — REALIZATION: the emergent aqueduct decision core (sources → demand → routed,
// profiled line) becomes grey-massing World entities, the SAME way G5 bridges do. An aqueduct
// is the inverted river, and its three modes (cut / surface / elevated) each map to massing we
// already have:
//   • surface / cut → a graded CHANNEL trough sitting on the ground (a `deck` with both parapets
//     reads as an open water channel — a flat floor between two low walls); foot-sampled.
//   • elevated      → the iconic arched aqueduct: the channel rides a deck lifted onto its water
//     line via the G4 `liftElev` primitive, carried on an ARCADE of masonry arch bays — each an
//     `arch_span` portal (two posts = the piers, a lintel = the springing under the deck) standing
//     from the ground up to the deck underside. Marches as cardinal bays, exactly like a viaduct.
//     A stretch too low for an arch to read (a shallow lip) falls back to a plain pier.
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

/** Below this clearance (m) a support would be a stub — skip it (the deck seats on the ground). */
const MIN_SUPPORT_HEIGHT_M = 1;
/** Cap support height so a freak deep gorge doesn't spawn an absurd tower. */
const MAX_SUPPORT_HEIGHT_M = 14;
/** Below this clearance an arch can't read as an opening (the deck would meet a squat lintel) —
 *  the bay falls back to a plain pier. Above it, the elevated run marches as an arcade. */
const MIN_ARCH_HEIGHT_M = 1.6;
/** Arcade bay length, tiles. ~6 m bays leave a real opening between the portal posts (a 2-tile
 *  bay collapses to solid once the posts are a channel-width thick). Plus the run's two ends. */
const ARCH_BAY_TILES = 3;
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

  const used = new Set<string>();   // dedupe a support tile shared at a within-mode bend corner
  for (const seg of plan.profile.segments) {
    out.push(channelEntity(tag, seg, widthTiles, mat, opts));
    if (seg.mode === 'elevated') emitArcade(out, tag, seg, stationAt, widthTiles, mat, used);
  }
}

/** One cardinal channel run — the kit's `channel` trough (a recessed floor between two side
 *  walls) along the run's axis. Elevated runs ride their water line via `liftElev`; surface / cut
 *  runs foot-sample to the ground (a cut conduit reads as a covered channel hugging the rise —
 *  true trenching is a later render refinement). */
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
    parts: { channel: { type: 'channel', at: { x: 0, y: 0 }, size: { w: footW, h: footH }, params: {
      lengthM: lenTiles * METRES_PER_TILE,
      axis: ew ? 'x' : 'y',
      // Inner water width = the run width less the two masonry side walls; floored so a
      // narrow run still carries an opening.
      innerWidthM: Math.max(0.4, widthTiles * METRES_PER_TILE - 0.6),
      wallM: 0.3, depthM: 0.6, floorM: 0.4,
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

/** Carry an elevated run on an ARCADE: march it in {@link ARCH_BAY_TILES}-tile bays, each an
 *  `arch_span` portal (two posts = the piers, a lintel = the springing under the deck) standing
 *  from the ground to the deck underside. A bay too low for an arch to read (a shallow lip) falls
 *  back to a plain pier so the deck end is still supported. Adjacent bays share their boundary
 *  post; a 1-tile remainder is merged into the last bay so no bay is a degenerate stub. */
function emitArcade(
  out: Entity[], tag: string, seg: AqueductSegment,
  stationAt: Map<string, AqueductStation>, widthTiles: number, mat: string, used: Set<string>,
): void {
  const pts = tilesAlong(seg.from, seg.to);
  const clearAt = (p: SpanPoint) => stationAt.get(`${p.x},${p.y}`)?.clearM ?? 0;
  let i = 0;
  while (i < pts.length - 1) {
    let jb = Math.min(i + ARCH_BAY_TILES, pts.length - 1);
    if (pts.length - 1 - jb === 1) jb = pts.length - 1;   // absorb a lone trailing tile
    // The lintel must clear under the deck at EVERY tile of the bay, so seat it at the bay's
    // shallowest clearance (the deck rides above it everywhere else).
    let h = Infinity;
    for (let k = i; k <= jb; k++) h = Math.min(h, clearAt(pts[k]));
    if (!Number.isFinite(h) || h < MIN_SUPPORT_HEIGHT_M) { i = jb; continue; }
    const heightM = Math.min(MAX_SUPPORT_HEIGHT_M, h);
    const a = pts[i], b = pts[jb];
    if (heightM >= MIN_ARCH_HEIGHT_M) {
      out.push(archBayEntity(tag, a, b, seg.axis, heightM, widthTiles, mat));
    } else {
      // Too shallow for an opening — a single pier at the bay midpoint props the deck.
      const m = pts[Math.floor((i + jb) / 2)];
      const key = `${m.x},${m.y}`;
      if (!used.has(key)) { used.add(key); out.push(pierEntity(`aqpier:${tag}:${key}`, m.x, m.y, heightM, mat)); }
    }
    i = jb;
  }
}

/** One arcade bay — an `arch_span` portal springing along the run axis from a→b, rising `heightM`
 *  to the deck underside. The portal posts are the piers; the opening between them is the arch. */
function archBayEntity(
  tag: string, a: SpanPoint, b: SpanPoint, axis: 'ns' | 'ew',
  heightM: number, widthTiles: number, mat: string,
): Entity {
  const ew = axis === 'ew';
  const spanTiles = Math.max(1, ew ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y));
  // Post width / frame depth ≈ the channel width (the deck seats across the portal). Clamp so the
  // posts stay slim enough to leave an opening yet chunky enough to read as masonry.
  const frameM = Math.min(2.5, Math.max(1, widthTiles * METRES_PER_TILE));
  const crossTiles = Math.max(1, Math.ceil(frameM / METRES_PER_TILE));
  const alongTiles = spanTiles + 1;   // +1 so both posts fall inside the footprint
  const footW = ew ? alongTiles : crossTiles;
  const footH = ew ? crossTiles : alongTiles;
  const minX = Math.min(a.x, b.x), minY = Math.min(a.y, b.y);
  const halfCross = Math.floor((crossTiles - 1) / 2);
  const ox = ew ? minX : minX - halfCross;
  const oy = ew ? minY - halfCross : minY;

  const bp: Blueprint = {
    version: BLUEPRINT_VERSION, class: 'prop', preset: 'aqueduct_arch', category: 'infrastructure',
    footprint: { w: footW, h: footH }, materials: { walls: mat, roof: mat, ground: 'dirt' },
    parts: { arch: { type: 'arch_span', at: { x: 0, y: 0 }, size: { w: footW, h: footH }, params: {
      spanM: spanTiles * METRES_PER_TILE, riseM: heightM, thicknessM: frameM, dir: axis,
    } } },
  };
  const rb = resolveBlueprint([bp], 0);
  return blueprintEntity(`aqueduct:${tag}:arch:${a.x},${a.y}-${b.x},${b.y}`, rb, ox, oy);
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
