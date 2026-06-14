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
    if (p.stage !== undefined) out.stage = p.stage;
    if (p.category !== undefined) out.category = p.category;
    if (p.footprint !== undefined) out.footprint = { ...p.footprint };
    if (p.notes !== undefined) out.notes = p.notes;
    if (p.materials) out.materials = { ...out.materials, ...p.materials };
    if (p.palette) out.palette = { ...out.palette, ...p.palette };
    if (p.descriptors) {
      const tags = [...(out.descriptors?.tags ?? []), ...(p.descriptors.tags ?? [])];
      out.descriptors = { ...out.descriptors, ...p.descriptors, ...(tags.length ? { tags: [...new Set(tags)] } : {}) };
    }
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
  const tags = [...(prev.tags ?? []), ...(patch.tags ?? [])];
  return {
    ...prev, ...patch,
    at: patch.at ?? prev.at,
    size: patch.size ?? prev.size,
    params: { ...prev.params, ...patch.params },
    features: { ...prev.features, ...patch.features },
    ...(tags.length ? { tags: [...new Set(tags)] } : {}),
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
      // Include `tags` ONLY when set so a tag-less feature serialises byte-identically.
      return { id: fid, type: f.type, face: f.face, params: fp, ...(f.tags?.length ? { tags: f.tags } : {}) };
    });
    return {
      id, type: part.type,
      at: part.at ?? { x: 0, y: 0 },
      size: part.size ?? { w: bp.footprint.w, h: bp.footprint.h },
      material: part.material,
      params, features,
      ...(part.tags?.length ? { tags: part.tags } : {}),
    };
  });

  return {
    version: bp.version, class: bp.class, preset: bp.preset, era: bp.era,
    category: bp.category, parts, materials, palette: bp.palette ?? {},
    // Include `descriptors`/`stage` ONLY when set so a plain blueprint serialises
    // byte-identically to before (its art-cache key — canonicalJson(rb) — is stable).
    ...(bp.descriptors ? { descriptors: bp.descriptors } : {}),
    ...(bp.stage ? { stage: bp.stage } : {}),
    footprint: bp.footprint, notes: bp.notes,
  };
}
