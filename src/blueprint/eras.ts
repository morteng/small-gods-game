// src/blueprint/eras.ts
// Turn an era choice into a BlueprintPatch that RESTYLES a type for that period —
// so one "house" concept reads as primordial → ancient → classical → medieval →
// current. Parallel to descriptors.ts: an era profile overrides materials + window
// style/glazing + roof vent kind, applied as a patch and recorded on the blueprint
// (so each era variant gets its own art-cache key). See the asset-catalogue design
// doc §3 + slice C.
import type { Blueprint, BlueprintPatch, Era, Part, Feature } from './types';
import { ERAS } from '@/core/era';

export const ERA_LEVELS: readonly Era[] = ERAS;

interface EraProfile {
  materials: Partial<Record<'walls' | 'roof' | 'ground', string>>;
  window?: string;     // window style for the period
  glazed?: boolean;    // glass available?
  vent?: string;       // ridge vent kind (smokehole vs chimney)
}

// Period construction signatures (kept deliberately broad — a type's own structure
// + descriptors still dominate; this shifts the material/feature palette by age).
//
// Smoke `vent` ownership (post-connectome Slice 1): the building connectome is the
// single source for DERIVED vents — for commoner dwellings (cottage/longhouse/yurt,
// vents stripped from their presets) it expands the hearth→smoke-egress chain from
// the catalogue's smoke-systems timeline and applies the vent patch LAST in
// resolveAsset, so the `vent` below is overridden (dead) for them. The `vent` here
// stays meaningful ONLY for presets that author their own vent (tavern/keep/
// townhouse), which the connectome leaves untouched — for those it era-restyles the
// existing stack (chimney in medieval/current, smokehole in earlier ages). The two
// are complementary, not duplicative; do not remove `vent` expecting the connectome
// to cover authored-vent buildings (it deliberately doesn't).
const ERA_PROFILES: Record<Era, EraProfile> = {
  primordial: { materials: { walls: 'hide', roof: 'thatch', ground: 'dirt' }, window: 'plain', glazed: false, vent: 'smokehole' },
  ancient: { materials: { walls: 'wattle', roof: 'thatch', ground: 'packed_dirt' }, window: 'shuttered', glazed: false, vent: 'smokehole' },
  classical: { materials: { walls: 'stone', roof: 'tile', ground: 'flagstone' }, window: 'arched', glazed: false, vent: 'smokehole' },
  medieval: { materials: { walls: 'timber', roof: 'tile', ground: 'packed_dirt' }, window: 'shuttered', glazed: false, vent: 'chimney' },
  current: { materials: { walls: 'brick', roof: 'slate', ground: 'cobble' }, window: 'arched', glazed: true, vent: 'chimney' },
};

/** The period's window style + glazing — the single source of truth shared by the
 *  era patch (which restyles AUTHORED windows) and the connectome openings derivation
 *  (which GENERATES windows for gen-openings presets), so both agree per era. */
export function eraWindowStyle(era: Era | undefined): { style: string; glazed: boolean } {
  const prof = ERA_PROFILES[era ?? 'medieval'] ?? ERA_PROFILES.medieval;
  return { style: prof.window ?? 'shuttered', glazed: prof.glazed ?? false };
}

/** Build the patch an era implies for `base`. Pure; deterministic. Overrides only
 *  the roles/features the base actually has (a type with no windows gains none). */
export function eraPatch(base: Blueprint, era: Era): BlueprintPatch {
  const prof = ERA_PROFILES[era];
  const patch: BlueprintPatch = { era };

  // Materials: override only roles the base declares (don't invent a roof on a well).
  const materials: Record<string, string> = {};
  for (const role of ['walls', 'roof', 'ground'] as const) {
    if (base.materials?.[role] && prof.materials[role]) materials[role] = prof.materials[role]!;
  }
  if (Object.keys(materials).length) patch.materials = materials;

  // Per-part feature restyle: window style/glazing + vent kind.
  const parts: Record<string, Part> = {};
  for (const [pid, part] of Object.entries(base.parts)) {
    const feats: Record<string, Feature> = {};
    for (const [fid, f] of Object.entries(part.features ?? {})) {
      if (f.type === 'window' && prof.window) {
        feats[fid] = { ...f, params: { ...f.params, style: prof.window, glazed: prof.glazed ?? false } };
      } else if (f.type === 'vent' && prof.vent) {
        feats[fid] = { ...f, params: { ...f.params, kind: prof.vent } };
      }
    }
    if (Object.keys(feats).length) parts[pid] = { type: part.type, features: feats };
  }
  if (Object.keys(parts).length) patch.parts = parts;

  return patch;
}
