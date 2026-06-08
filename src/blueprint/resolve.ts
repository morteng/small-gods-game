// src/blueprint/resolve.ts
import type {
  Blueprint, BlueprintPatch, Part, ResolvedBlueprint, ResolvedPart, ResolvedFeature,
} from './types';
import { BLUEPRINT_VERSION } from './types';
import { getPartType, getFeatureType, type ResolveCtx } from './registry';
import { validateParams } from './param-schema';

/** Deep-merge an ordered list of patches: scalars last-wins, parts by id (null deletes). */
export function mergePatches(patches: BlueprintPatch[]): Blueprint {
  const out: Blueprint = {
    version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 1, h: 1 }, parts: {},
  };
  for (const p of patches) {
    if (p.version !== undefined) out.version = p.version;
    if (p.class !== undefined) out.class = p.class;
    if (p.preset !== undefined) out.preset = p.preset;
    if (p.era !== undefined) out.era = p.era;
    if (p.category !== undefined) out.category = p.category;
    if (p.footprint !== undefined) out.footprint = { ...p.footprint };
    if (p.notes !== undefined) out.notes = p.notes;
    if (p.materials) out.materials = { ...out.materials, ...p.materials };
    if (p.palette) out.palette = { ...out.palette, ...p.palette };
    if (p.parts) {
      for (const [id, patch] of Object.entries(p.parts)) {
        if (patch === null) { delete out.parts[id]; continue; }
        const prev = out.parts[id];
        out.parts[id] = prev ? mergePart(prev, patch) : structuredClone(patch);
      }
    }
  }
  return out;
}

function mergePart(prev: Part, patch: Part): Part {
  return {
    ...prev, ...patch,
    at: patch.at ?? prev.at,
    size: patch.size ?? prev.size,
    params: { ...prev.params, ...patch.params },
    features: { ...prev.features, ...patch.features },
  };
}

/** Merge patches, then run the seeded resolve pass (registry-driven default fill). */
export function resolveBlueprint(patches: BlueprintPatch[], seed: number): ResolvedBlueprint {
  const bp = mergePatches(patches);
  const materials = bp.materials ?? {};
  const ctx: ResolveCtx = { seed, materials };

  const parts: ResolvedPart[] = Object.entries(bp.parts).map(([id, part]) => {
    const pt = getPartType(part.type);
    const validated = validateParams(pt.paramSchema, part.params ?? {});
    const { params } = pt.resolve({ ...part, params: validated }, ctx);
    const features: ResolvedFeature[] = Object.entries(part.features ?? {}).map(([fid, f]) => {
      const ft = getFeatureType(f.type);
      if (!ft) throw new Error(`unknown feature type "${f.type}"`);
      const fv = validateParams(ft.paramSchema, f.params ?? {});
      const { params: fp } = ft.resolve({ ...f, params: fv }, ctx);
      return { id: fid, type: f.type, face: f.face, params: fp };
    });
    return {
      id, type: part.type,
      at: part.at ?? { x: 0, y: 0 },
      size: part.size ?? { w: bp.footprint.w, h: bp.footprint.h },
      material: part.material,
      params, features,
    };
  });

  return {
    version: bp.version, class: bp.class, preset: bp.preset, era: bp.era,
    category: bp.category, parts, materials, palette: bp.palette ?? {},
    footprint: bp.footprint, notes: bp.notes,
  };
}
