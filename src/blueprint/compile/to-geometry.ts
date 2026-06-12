// src/blueprint/compile/to-geometry.ts
// Fold a ResolvedBlueprint to an assetgen StructureSpec. Wing-bearing parts (body/wing)
// merge into ONE prim:'building'; round/stepped bodies and tower/porch/chimney append as
// standalone prims. Openings (door/window) carve their host part's wall-bearing prim and
// append a flush filler leaf/pane prim — uniform across rect/round/stepped.
import type { ResolvedBlueprint, ResolvedPart } from '../types';
import { getPartType, getFeatureType, type CompileCtx } from '../registry';
import type { Part as Prim, StructureSpec } from '@/assetgen/compose';
import type { ApertureBox } from '@/assetgen/geometry/solids';
import type { BuildingFeatures, VentFeature, DormerFeature } from '@/assetgen/geometry/building';
import { isOpening } from '../features/opening';
import { apertureToBox } from '../wall-geometry';

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

export function toGeometry(rb: ResolvedBlueprint): StructureSpec {
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

  for (const part of rb.parts) {
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

  return { parts };
}
