// src/blueprint/compile/to-geometry.ts
// Fold a ResolvedBlueprint to an assetgen StructureSpec. Wing-bearing parts (body/wing)
// merge into ONE prim:'building'; round/stepped bodies and tower/porch/chimney append as
// standalone prims. Openings (door/window) carve their host part's wall-bearing prim and
// append a flush filler leaf/pane prim — uniform across rect/round/stepped.
import type { ResolvedBlueprint, ResolvedPart } from '../types';
import { getPartType, getFeatureType, type CompileCtx } from '../registry';
import type { Part as Prim, StructureSpec } from '@/assetgen/compose';
import type { Mat } from '@/assetgen/types';
import type { ApertureBox } from '@/assetgen/geometry/solids';
import type { BuildingFeatures, VentFeature, DormerFeature } from '@/assetgen/geometry/building';
import { isOpening } from '../features/opening';
import { apertureToBox } from '../wall-geometry';
import { STOREY } from '@/assetgen/geometry/building';
import { mToTiles } from '@/render/scale-contract';
import { toMountAnchors } from './to-mount-anchors';
import { yawForOrientation } from '../orientation';
import { emitDiagnostic, type GeometryDiagnostic } from './diagnostics';

/** Storey height (tiles) for a wall-bearing body/wing part. */
function storeyTilesOf(part: ResolvedPart): number {
  const sm = part.params?.storeyM as number | undefined;
  return sm && sm > 0 ? mToTiles(sm) : STOREY;
}

const EAVE_HEADROOM = 0.1;   // keep an opening's head this far (tiles) below the eave

/** Self-check: clamp a window so it can't poke through the eave/roof. Returns the (possibly
 *  reduced) height for an opening at `sill` on a wall whose eave is at `eaveTop` (tiles), and
 *  warns when it had to correct an authored value so the issue surfaces instead of rendering. */
function fitHeightUnderEave(
  sill: number, height: number, eaveTop: number, label: string,
  part: string, feature: string, sink?: GeometryDiagnostic[],
): number {
  const max = eaveTop - EAVE_HEADROOM - sill;
  if (height <= max) return height;
  const clamped = Math.max(0.2, max);
  emitDiagnostic(sink, {
    code: 'eave-breach', severity: 'warn', part, feature,
    message: `${label}: window height ${height.toFixed(2)} breaches the eave (sill ${sill.toFixed(2)} + height > ${eaveTop.toFixed(2)}) — clamped to ${clamped.toFixed(2)}`,
    detail: { sill: +sill.toFixed(3), height: +height.toFixed(3), eaveTop: +eaveTop.toFixed(3), clamped: +clamped.toFixed(3) },
  });
  return clamped;
}

/**
 * Normalise a wall body's window openings:
 *  1. clamp each window's height so it stays under the eave (geometry self-check), and
 *  2. RANK `perStorey` windows up the floors — repeat at each storey's sill so adding a
 *     storey adds its windows automatically.
 * Doors, vents, dormers and non-ranked windows pass through (doors clamp, never rank).
 */
// Per-storey light shrink for ranked (perStorey) windows: each floor up carries a shorter,
// slightly narrower light than the one below — the half-timbered read where the upper
// windows sit clear of the eave lip rather than crashing into the roof line.
const UPPER_STOREY_LIGHT_SHRINK = 0.8;    // height factor per floor above the ground
const UPPER_STOREY_LIGHT_NARROW = 0.92;   // half-width factor per floor above the ground

function expandStoreyOpenings(part: ResolvedPart, sink?: GeometryDiagnostic[]): ResolvedPart['features'] {
  const levels = Math.max(1, (part.params?.levels as number) ?? 1);
  const plan = part.params?.plan;
  // Round/stepped bodies own their own height envelope; leave their openings untouched.
  if (plan === 'round' || plan === 'stepped') return part.features;
  const sh = storeyTilesOf(part), eaveTop = sh * levels;
  const out: ResolvedPart['features'] = [];
  for (const f of part.features) {
    if (f.type !== 'window') { out.push(f); continue; }
    const baseSill = (f.params.sill as number) ?? 0;
    const rawH = (f.params.height as number) ?? 0;
    const ranked = f.params.perStorey !== false && levels > 1;
    const floors = ranked ? levels : 1;
    const baseHalfW = (f.params.halfW as number) ?? 0;
    for (let s = 0; s < floors; s++) {
      // Upper storeys carry SMALLER lights than the ground floor — shorter (and a touch
      // narrower) each floor up, so they sit clear of the eave lip instead of crashing into
      // the roof line (the real half-timbered read; matches the tavern reference).
      const scale = s === 0 ? 1 : Math.pow(UPPER_STOREY_LIGHT_SHRINK, s);
      const height = fitHeightUnderEave(baseSill, rawH * scale, eaveTop, `${part.type}.${f.id}`, part.id, f.id, sink);
      const halfW = baseHalfW * (s === 0 ? 1 : Math.pow(UPPER_STOREY_LIGHT_NARROW, s));
      const sill = baseSill + s * sh;
      if (sill + height > eaveTop) continue;   // upper-floor copy wouldn't fit — skip it
      const params = { ...f.params, sill, height, halfW };
      out.push(s === 0 ? { ...f, params } : { ...f, id: `${f.id}_l${s}`, params });
    }
  }
  return out;
}

// ── pick provenance (studio click-to-select) ────────────────────────────────────────
// Every pickable atom carries a stable id threaded from the blueprint down to the pixel:
// `<partId>` for a whole part (walls/roof/a standalone prim) or `<partId>/<featureId>` for an
// individual opening/vent. `expandStoreyOpenings` mints per-storey feature ids (`win_s_l1`);
// STRIP that suffix so an upper-storey window still selects the AUTHORED `win_s` node.
// STRICTLY OPT-IN (`toGeometry(rb, { pickIds: true })`, studio-only): the runtime parametric
// sprite cache keys on `canonicalJson(toGeometry(rb))`, so stamping ids by default would move
// EVERY cached pack's key and force a full warm-boot recompose. Absent ⇒ spec byte-identical.
const stripStorey = (id: string): string => id.replace(/_l\d+$/, '');
const featureKey = (partId: string, featureId: string): string => `${partId}/${stripStorey(featureId)}`;

/** A vent feature on a wing-part → an assetgen VentFeature on wing `wingIdx`. `pickPartId`
 *  (set only under `opts.pickIds`) threads the pick key onto the vent so a click on the
 *  chimney selects THAT feature; absent ⇒ no id field, vent byte-identical. */
function ventOf(f: ResolvedPart['features'][number], wingIdx: number, pickPartId?: string): VentFeature {
  const width = f.params.width as number | undefined;
  const height = f.params.height as number | undefined;
  const material = f.params.material as string | undefined;
  const side = f.params.side as string | undefined;
  return {
    wing: wingIdx, t: f.params.t as number,
    ...(pickPartId ? { id: featureKey(pickPartId, f.id) } : {}),
    kind: f.params.kind as VentFeature['kind'],
    placement: f.params.placement as VentFeature['placement'],
    ...(f.face ? { face: f.face } : {}),
    ...(side === 'back' ? { side: 'back' as const } : {}),
    ...(width !== undefined && width >= 0 ? { width } : {}),
    ...(height !== undefined && height >= 0 ? { height } : {}),
    ...(material && material !== 'default' ? { mat: material as VentFeature['mat'] } : {}),
  };
}

/** A dormer feature on a wing-part → an assetgen DormerFeature on wing `wingIdx`. */
function dormerOf(f: ResolvedPart['features'][number], wingIdx: number): DormerFeature {
  return {
    wing: wingIdx, t: f.params.t as number,
    width: f.params.width as number,
    ...(f.face ? { face: f.face } : {}),
  };
}

/** Compile a part's openings → carve boxes (for its wall prim) + filler prims (added back).
 *  Under `pickIds`, each filler prim (window sill/lintel/mullions/pane, door leaf/trim) is
 *  stamped with its feature's pick key (`<partId>/<featureId>`, storey suffix stripped) so a
 *  click on the visible furniture selects the AUTHORED feature node. Opt-in metadata only —
 *  the aperture holes themselves carve the wall and need nothing (their pixels ARE wall =
 *  the part key), and without `pickIds` every filler prim is byte-identical (cache-key safe). */
function compileOpenings(part: ResolvedPart, ctx: CompileCtx, pickIds: boolean): { apertures: ApertureBox[]; fillers: Prim[] } {
  const apertures: ApertureBox[] = [];
  const fillers: Prim[] = [];
  for (const f of part.features) {
    const ft = getFeatureType(f.type);
    if (!isOpening(ft)) continue;
    apertures.push(apertureToBox(ft.aperture(f, part, ctx), part));
    if (!ft.filler) continue;
    const prims = ft.filler(f, part, ctx);
    // `srcId` may already be set by an exotic filler builder — keep the more specific tag.
    fillers.push(...(pickIds ? prims.map((p) => ({ ...p, srcId: p.srcId ?? featureKey(part.id, f.id) })) : prims));
  }
  return { apertures, fillers };
}

const WALL_BEARING = new Set(['building', 'cylinder', 'box']);

/** Opt-in ground apron under a building (the "skirt"). Off by default: passing no
 *  `skirt` leaves geometry — and the golden hashes — unchanged. */
export interface SkirtOpts {
  /** Apron overhang past the footprint edge, in tiles (1 tile = 2 m). */
  margin?: number;
  /** Foundation-lip depth below the ground plane, in tiles. */
  thickness?: number;
  /** Override the apron material (else derived from `materials.ground`). */
  material?: Mat;
}

/** Map a free-form `materials.ground` descriptor onto a render Mat for the apron. */
function groundMat(ground: string | undefined): Mat {
  switch (ground) {
    case 'cobble': case 'stone': case 'flagstone': case 'paving': return 'stone';
    case 'gravel': case 'sand': return 'plaster';
    case 'grass': case 'turf': case 'meadow': return 'foliage';
    default: return 'earth';   // packed-earth yard
  }
}

interface Rect { x: number; y: number; w: number; h: number }

/** XY footprint rect PER wall-bearing piece (structure-local tiles), for the skirt.
 *  One rect per wing / box / round body so the aprons union into an outline that hugs
 *  the walls — a single bbox would fill an L-plan's concave notch. */
function footprintRects(parts: Prim[]): Rect[] {
  const rects: Rect[] = [];
  for (const p of parts) {
    if (p.prim === 'building') for (const w of p.wings) rects.push({ x: w.x, y: w.y, w: w.w, h: w.h });
    else if (p.prim === 'box') rects.push({ x: p.at[0], y: p.at[1], w: p.size[0], h: p.size[1] });
    else if (p.prim === 'cylinder' || p.prim === 'cone' || p.prim === 'prism')
      rects.push({ x: p.center[0] - p.radius, y: p.center[1] - p.radius, w: 2 * p.radius, h: 2 * p.radius });
    else if (p.prim === 'ellipsoid')
      rects.push({ x: p.center[0] - p.radii[0], y: p.center[1] - p.radii[1], w: 2 * p.radii[0], h: 2 * p.radii[1] });
  }
  return rects;
}

export function toGeometry(rb: ResolvedBlueprint, opts?: {
  skirt?: SkirtOpts; diagnostics?: GeometryDiagnostic[];
  /** OPT-IN pick provenance (studio click-to-select): stamp every emitted prim/vent with its
   *  blueprint part/feature id (`srcId`) so `composeStructure({ pickIds })` can build the
   *  per-pixel pick buffer. MUST stay off on the runtime/seeder paths — the parametric sprite
   *  cache keys on this spec's canonical JSON (see the pick-provenance comment above). */
  pickIds?: boolean;
  /** EPHEMERAL door-open (and future interaction) state, keyed by the pick key the pick
   *  channel uses (`<partId>/<featureId>`). Threaded into `CompileCtx` so an opening's
   *  `filler` hook can emit its leaf SWUNG when `open > 0`. Studio-only: NOT a blueprint
   *  param (that would move `canonicalJson(rb)` and bust the sprite cache) — an ephemeral
   *  compose arg, exactly like `pickIds`. Absent OR containing no open door ⇒ the spec is
   *  byte-identical to the default path (the door filler only diverges when `open > 0`). */
  featureStates?: Record<string, { open?: number }>;
}): StructureSpec {
  const sink = opts?.diagnostics;
  const pickIds = opts?.pickIds === true;
  const ctx: CompileCtx = {
    materials: rb.materials, footprint: rb.footprint,
    ...(rb.palette && Object.keys(rb.palette).length ? { palette: rb.palette } : {}),
    ...(opts?.featureStates ? { featureStates: opts.featureStates } : {}),
  };

  // No `size` is set: buildings render at a FIXED metric scale (composeStructure →
  // fixedFit), with the sprite canvas sized to the projected content. Pinning a `size`
  // here would re-engage the legacy fit-to-box path and squash heights — see
  // docs/superpowers/specs/2026-06-09-metric-scale-standardization-design.md §3.

  let building: Extract<Prim, { prim: 'building' }> | null = null;
  const others: Prim[] = [];
  const fillers: Prim[] = [];
  const buildingApertures: ApertureBox[] = [];
  const vents: VentFeature[] = [];
  const dormers: DormerFeature[] = [];

  for (const rawPart of rb.parts) {
    // Rank perStorey windows up the floors before compiling openings (and below, for vents).
    const part: ResolvedPart = { ...rawPart, features: expandStoreyOpenings(rawPart, sink) };
    const pt = getPartType(part.type);
    const prims = pt.toPrims(part, ctx);
    const { apertures, fillers: partFillers } = compileOpenings(part, ctx, pickIds);
    fillers.push(...partFillers);

    // A part's openings carve its FIRST wall-bearing prim (building/cylinder/box).
    let openingsAttached = false;
    for (const prim of prims) {
      if (prim.prim === 'building') {
        // Under pickIds, the merged building prim keeps the FIRST wing-bearing part's id as
        // its pick key: CSG unions all wings' walls/roof into one solid, erasing finer
        // identity — clicking any wall/roof pixel selects the body part (accepted for v1;
        // vents/openings carry their own finer keys which win via the `??=` stamp in compose).
        if (!building) building = { ...prim, wings: [...prim.wings], features: {}, apertures: [], seed: 0, ...(pickIds ? { srcId: part.id } : {}) };
        else building.wings.push(...prim.wings);
        const wingIdx = building.wings.length - prim.wings.length;
        for (const f of part.features) {
          if (f.type === 'vent') vents.push(ventOf(f, wingIdx, pickIds ? part.id : undefined));
          if (f.type === 'dormer') dormers.push(dormerOf(f, wingIdx));
        }
        if (!openingsAttached) { buildingApertures.push(...apertures); openingsAttached = true; }
      } else {
        if (!openingsAttached && WALL_BEARING.has(prim.prim) && apertures.length) {
          (prim as Extract<Prim, { prim: 'box' | 'cylinder' }>).apertures = apertures;
          openingsAttached = true;
        }
        // Standalone prims (furnace/stairs/posts/tower/porch/…) pick as their whole part.
        others.push(pickIds && !prim.srcId ? { ...prim, srcId: part.id } : prim);
      }
    }
    if (!openingsAttached && apertures.length) {
      // The part declared openings but emitted no wall-bearing prim to carve them into —
      // surface it so a future part type doesn't silently drop its doors/windows.
      emitDiagnostic(sink, {
        code: 'apertures-dropped', severity: 'error', part: part.id,
        message: `part "${part.type}" has ${apertures.length} opening(s) but no wall-bearing prim; apertures dropped`,
        detail: { partType: part.type, count: apertures.length },
      });
    }
  }

  const parts: Prim[] = [];
  if (building) {
    // Always set vents (even empty): a blueprint with no vent features means NO smoke
    // — period-correct for barns/temples/towers. (resolveFeatures only synthesizes a
    // seeded default chimney when the list is absent entirely, i.e. raw assetgen specs.)
    const features: BuildingFeatures = { vents };
    if (dormers.length) features.dormers = dormers;
    building.features = features;
    if (buildingApertures.length) building.apertures = buildingApertures;
    parts.push(building);
  }
  parts.push(...others, ...fillers);

  if (opts?.skirt) {
    // A narrow ground lip that hugs the walls: ~30 cm (0.15 tiles) past each footprint
    // piece by default, NOT a lot-filling apron. One skirt prim per footprint rect; they
    // overlap/union in the raster so multi-wing plans get a wall-hugging outline.
    const m = opts.skirt.margin ?? 0.15;
    const mat = opts.skirt.material ?? groundMat(rb.materials.ground);
    const skirts = footprintRects(parts).map((r): Prim => ({
      prim: 'skirt',
      rect: { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m },
      thickness: opts.skirt!.thickness,
      material: mat,
    }));
    // Prepend so the aprons are the first parts (drawn underneath everything else).
    parts.unshift(...skirts);
  }

  // Mount sockets (sign/lamp/perch/smoke/…) derived from the SAME resolved geometry, in the
  // blueprint-local frame (origin 0,0 = footprint top-left) so they share the wings' tile
  // coords. composeStructure projects them onto the sprite as `anchors.tags`.
  // Placement orientation (0..3) becomes a turntable yaw the composer applies to every
  // facet + anchor — geometry's half of the single-source-of-truth rotation (the footprint/
  // collision/door-anchor half lives in to-collision/to-anchors). Omitted when canonical so
  // the yaw-0 golden path is byte-unchanged.
  const o = rb.orientation ?? 0;
  return { parts, mountAnchors: toMountAnchors(rb, 0, 0), ...(o ? { yaw: yawForOrientation(o) } : {}) };
}
