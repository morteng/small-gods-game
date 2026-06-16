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

/** Storey height (tiles) for a wall-bearing body/wing part. */
function storeyTilesOf(part: ResolvedPart): number {
  const sm = part.params?.storeyM as number | undefined;
  return sm && sm > 0 ? mToTiles(sm) : STOREY;
}

const EAVE_HEADROOM = 0.1;   // keep an opening's head this far (tiles) below the eave

/** Self-check: clamp a window so it can't poke through the eave/roof. Returns the (possibly
 *  reduced) height for an opening at `sill` on a wall whose eave is at `eaveTop` (tiles), and
 *  warns when it had to correct an authored value so the issue surfaces instead of rendering. */
function fitHeightUnderEave(sill: number, height: number, eaveTop: number, label: string): number {
  const max = eaveTop - EAVE_HEADROOM - sill;
  if (height <= max) return height;
  const clamped = Math.max(0.2, max);
  console.warn(`[toGeometry] ${label}: window height ${height.toFixed(2)} breaches the eave (sill ${sill.toFixed(2)} + height > ${eaveTop.toFixed(2)}) — clamped to ${clamped.toFixed(2)}`);
  return clamped;
}

/**
 * Normalise a wall body's window openings:
 *  1. clamp each window's height so it stays under the eave (geometry self-check), and
 *  2. RANK `perStorey` windows up the floors — repeat at each storey's sill so adding a
 *     storey adds its windows automatically.
 * Doors, vents, dormers and non-ranked windows pass through (doors clamp, never rank).
 */
function expandStoreyOpenings(part: ResolvedPart): ResolvedPart['features'] {
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
    const height = fitHeightUnderEave(baseSill, rawH, eaveTop, `${part.type}.${f.id}`);
    const ranked = f.params.perStorey !== false && levels > 1;
    const floors = ranked ? levels : 1;
    for (let s = 0; s < floors; s++) {
      const sill = baseSill + s * sh;
      if (sill + height > eaveTop) continue;   // upper-floor copy wouldn't fit — skip it
      const params = { ...f.params, sill, height };
      out.push(s === 0 ? { ...f, params } : { ...f, id: `${f.id}_l${s}`, params });
    }
  }
  return out;
}

/** A vent feature on a wing-part → an assetgen VentFeature on wing `wingIdx`. */
function ventOf(f: ResolvedPart['features'][number], wingIdx: number): VentFeature {
  const width = f.params.width as number | undefined;
  const height = f.params.height as number | undefined;
  return {
    wing: wingIdx, t: f.params.t as number,
    kind: f.params.kind as VentFeature['kind'],
    placement: f.params.placement as VentFeature['placement'],
    ...(f.face ? { face: f.face } : {}),
    ...(width !== undefined && width >= 0 ? { width } : {}),
    ...(height !== undefined && height >= 0 ? { height } : {}),
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

/** Compile a part's openings → carve boxes (for its wall prim) + filler prims (added back). */
function compileOpenings(part: ResolvedPart, ctx: CompileCtx): { apertures: ApertureBox[]; fillers: Prim[] } {
  const apertures: ApertureBox[] = [];
  const fillers: Prim[] = [];
  for (const f of part.features) {
    const ft = getFeatureType(f.type);
    if (!isOpening(ft)) continue;
    apertures.push(apertureToBox(ft.aperture(f, part, ctx), part));
    if (ft.filler) fillers.push(...ft.filler(f, part, ctx));
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

export function toGeometry(rb: ResolvedBlueprint, opts?: { skirt?: SkirtOpts }): StructureSpec {
  const ctx: CompileCtx = { materials: rb.materials, footprint: rb.footprint };

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
    const part: ResolvedPart = { ...rawPart, features: expandStoreyOpenings(rawPart) };
    const pt = getPartType(part.type);
    const prims = pt.toPrims(part, ctx);
    const { apertures, fillers: partFillers } = compileOpenings(part, ctx);
    fillers.push(...partFillers);

    // A part's openings carve its FIRST wall-bearing prim (building/cylinder/box).
    let openingsAttached = false;
    for (const prim of prims) {
      if (prim.prim === 'building') {
        if (!building) building = { ...prim, wings: [...prim.wings], features: {}, apertures: [], seed: 0 };
        else building.wings.push(...prim.wings);
        const wingIdx = building.wings.length - prim.wings.length;
        for (const f of part.features) {
          if (f.type === 'vent') vents.push(ventOf(f, wingIdx));
          if (f.type === 'dormer') dormers.push(dormerOf(f, wingIdx));
        }
        if (!openingsAttached) { buildingApertures.push(...apertures); openingsAttached = true; }
      } else {
        if (!openingsAttached && WALL_BEARING.has(prim.prim) && apertures.length) {
          (prim as Extract<Prim, { prim: 'box' | 'cylinder' }>).apertures = apertures;
          openingsAttached = true;
        }
        others.push(prim);
      }
    }
    if (!openingsAttached && apertures.length) {
      // The part declared openings but emitted no wall-bearing prim to carve them into —
      // surface it so a future part type doesn't silently drop its doors/windows.
      console.warn(`[toGeometry] part "${part.type}" has ${apertures.length} opening(s) but no wall-bearing prim; apertures dropped`);
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

  return { parts };
}
