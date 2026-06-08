// src/blueprint/compile/to-geometry.ts
// Fold a ResolvedBlueprint to an assetgen StructureSpec. Wing-bearing parts (body/wing)
// merge into ONE prim:'building'; round/stepped bodies and tower/porch/chimney append as
// standalone prims. Openings (door/window) carve their host part's wall-bearing prim and
// append a flush filler leaf/pane prim — uniform across rect/round/stepped.
import type { ResolvedBlueprint, ResolvedPart } from '../types';
import { getPartType, getFeatureType, type CompileCtx } from '../registry';
import type { Part as Prim, StructureSpec } from '@/assetgen/compose';
import type { ApertureBox } from '@/assetgen/geometry/solids';
import type { BuildingFeatures, VentFeature } from '@/assetgen/geometry/building';
import { ISO_TILE_W } from '@/render/iso/iso-constants';
import { isOpening } from '../features/opening';
import { apertureToBox } from '../wall-geometry';

/** A vent feature on a wing-part → an assetgen VentFeature on wing `wingIdx`. */
function ventOf(f: ResolvedPart['features'][number], wingIdx: number): VentFeature {
  return {
    wing: wingIdx, t: f.params.t as number,
    kind: f.params.kind as VentFeature['kind'],
    placement: f.params.placement as VentFeature['placement'],
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

  // structure bounding box (for sprite size), from every part's footprint claim
  let maxX = 0, maxY = 0;
  for (const p of rb.parts) { maxX = Math.max(maxX, p.at.x + p.size.w); maxY = Math.max(maxY, p.at.y + p.size.h); }
  const size = Math.min(640, Math.max(128, Math.round((maxX + maxY) * ISO_TILE_W * 0.65)));

  let building: Extract<Prim, { prim: 'building' }> | null = null;
  const others: Prim[] = [];
  const fillers: Prim[] = [];
  const buildingApertures: ApertureBox[] = [];
  const vents: VentFeature[] = [];

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
        for (const f of part.features) if (f.type === 'vent') vents.push(ventOf(f, wingIdx));
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
    const features: BuildingFeatures = {};
    if (vents.length) features.vents = vents;
    building.features = features;
    if (buildingApertures.length) building.apertures = buildingApertures;
    parts.push(building);
  }
  parts.push(...others, ...fillers);

  return { size, parts };
}
