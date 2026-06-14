// src/blueprint/lifecycle.ts
// Every asset has a TIMELINE: a tree runs sapling → young → mature → dying →
// fallen/stub; a building runs cleared-plot → construction → complete → ruin →
// burnt → old-ruin (Slice E). A lifecycle STAGE is a per-instance patch layer on
// the base Blueprint — like era and descriptors — so each stage gets its own
// art-cache key automatically. The CANONICAL stage (a tree "in its prime", a
// building "complete") is the no-op: requesting it is byte-identical to the
// stageless asset, so the seeded library stays valid. See the asset-catalogue
// design doc §4 (lifecycle).
import type { Blueprint, BlueprintPatch, EntityClass, Part, Condition } from './types';

// ── plant lifecycle ─────────────────────────────────────────────────────────
export type PlantStage = 'sapling' | 'young' | 'mature' | 'dying' | 'fallen' | 'stub';
export const PLANT_STAGES: readonly PlantStage[] = ['sapling', 'young', 'mature', 'dying', 'fallen', 'stub'];
/** The stage a bare (stageless) request resolves to — the tree in its prime. A
 *  request for THIS stage is a no-op (same art-cache key as the stageless tree). */
export const PLANT_DEFAULT_STAGE: PlantStage = 'mature';

interface PlantProfile {
  scale: number;          // overall size multiplier (height/crown/trunk)
  crownScale?: number;    // extra crown multiplier (1 = track size; <1 = thinning)
  form?: string;          // override crown silhouette ('bare' = leaf-drop)
}
// A growth curve over the tree's metric params: a sapling is a quarter-height
// wisp, maturity is full size, dying thins + drops leaves, fallen/stub collapse.
// (A true horizontal "laid log" pose for `fallen` needs flora geometry support —
// deferred; for now it reads as a bare, low, broken trunk.)
const PLANT_PROFILES: Record<PlantStage, PlantProfile> = {
  sapling: { scale: 0.25, crownScale: 0.6 },
  young:   { scale: 0.55, crownScale: 0.85 },
  mature:  { scale: 1.0 },
  dying:   { scale: 0.95, crownScale: 0.5, form: 'bare' },
  fallen:  { scale: 0.85, crownScale: 0.0, form: 'bare' },
  stub:    { scale: 0.12, crownScale: 0.0 },
};

const round = (n: number, dp = 2): number => { const f = 10 ** dp; return Math.round(n * f) / f; };

/** Build the patch a plant stage implies for `base` — scales the tree part's metric
 *  params along the growth curve. Pure; deterministic. Returns an empty patch for the
 *  default stage (no-op). */
export function plantStagePatch(base: Blueprint, stage: PlantStage): BlueprintPatch {
  if (stage === PLANT_DEFAULT_STAGE) return {};
  const prof = PLANT_PROFILES[stage];
  const patch: BlueprintPatch = { stage };
  const parts: Record<string, Part> = {};
  for (const [pid, part] of Object.entries(base.parts)) {
    if (part.type !== 'tree') continue;
    const p = part.params ?? {};
    const h = (p.heightM as number) ?? 10;
    const c = (p.crownM as number) ?? 6;
    const r = (p.trunkR as number) ?? 0.16;
    const crownMul = prof.scale * (prof.crownScale ?? 1);
    const params: Record<string, unknown> = {
      heightM: round(h * prof.scale),
      crownM: round(c * crownMul),
      trunkR: round(r * prof.scale, 3),
    };
    if (prof.form) params.form = prof.form;
    parts[pid] = { type: part.type, params };
  }
  if (Object.keys(parts).length) patch.parts = parts;
  return patch;
}

// ── building lifecycle ──────────────────────────────────────────────────────
// A built structure runs cleared-plot → construction → complete → fire-damage →
// ruin → burnt → old-ruin. Buildings aren't a single scalar like a tree, so a
// stage transform works the geometry knobs it HAS (drop the roof, collapse a
// storey) and routes the rest through the descriptor `condition` channel + a
// prompt phrase the img2img model paints (scorch, scaffolding, overgrowth).
export type BuildingStage =
  | 'cleared' | 'construction' | 'complete' | 'fire_damaged' | 'ruin' | 'burnt' | 'old_ruin';
export const BUILDING_STAGES: readonly BuildingStage[] =
  ['cleared', 'construction', 'complete', 'fire_damaged', 'ruin', 'burnt', 'old_ruin'];
export const BUILDING_DEFAULT_STAGE: BuildingStage = 'complete';

interface BuildingProfile {
  roofless?: boolean;     // roof gone → set the body's roof param to 'flat'
  levelDelta?: number;    // storeys collapsed (clamped to ≥1)
  condition?: Condition;  // weathering descriptor (rides into the prompt phrase)
  tag: string;            // descriptor tag + img2img cue
  phrase: string;         // prompt lead, e.g. 'a burnt-out, charred ruin of'
}
const BUILDING_PROFILES: Record<BuildingStage, BuildingProfile> = {
  cleared:      { roofless: true, levelDelta: -8, tag: 'cleared-plot', phrase: 'a cleared, staked-out building plot for' },
  construction: { roofless: true, condition: 'lived_in', tag: 'under-construction', phrase: 'a half-built, scaffolded, under-construction' },
  complete:     { tag: '', phrase: '' },
  fire_damaged: { condition: 'worn', tag: 'fire-damaged', phrase: 'a fire-scorched, smoke-blackened' },
  ruin:         { roofless: true, levelDelta: -1, condition: 'dilapidated', tag: 'ruined', phrase: 'a crumbling, roofless ruin of' },
  burnt:        { roofless: true, levelDelta: -1, condition: 'dilapidated', tag: 'burnt-out', phrase: 'a burnt-out, charred ruin of' },
  old_ruin:     { roofless: true, levelDelta: -2, condition: 'dilapidated', tag: 'ancient-ruin', phrase: 'ancient, overgrown, moss-covered stone ruins of' },
};

/** Build the patch a building stage implies for `base`. Pure; deterministic. The
 *  default stage (complete) is a no-op. */
export function buildingStagePatch(base: Blueprint, stage: BuildingStage): BlueprintPatch {
  if (stage === BUILDING_DEFAULT_STAGE) return {};
  const prof = BUILDING_PROFILES[stage];
  const patch: BlueprintPatch = { stage };

  // Descriptor channel: condition + a stage tag (the prompt + material bias read these).
  const tags = prof.tag ? [prof.tag] : [];
  patch.descriptors = { ...(prof.condition ? { condition: prof.condition } : {}), ...(tags.length ? { tags } : {}) };

  // Geometry: drop the roof / collapse storeys on every body part the base has.
  const parts: Record<string, Part> = {};
  for (const [pid, part] of Object.entries(base.parts)) {
    if (part.type !== 'body') continue;
    const params: Record<string, unknown> = {};
    if (prof.roofless) params.roof = 'flat';
    if (prof.levelDelta) {
      const lv = (part.params?.levels as number) ?? 1;
      params.levels = Math.max(1, lv + prof.levelDelta);
    }
    if (Object.keys(params).length) parts[pid] = { type: part.type, params };
  }
  if (Object.keys(parts).length) patch.parts = parts;

  return patch;
}

/** A prompt-ready phrase for a lifecycle stage (e.g. 'a burnt-out ruin of'), or ''
 *  for the default/unknown stage. Fed to the img2img prompt so the painted art reads
 *  as that point on the asset's timeline. */
export function stagePhrase(cls: EntityClass, stage: string | undefined): string {
  if (!stage) return '';
  if (cls === 'building' && (BUILDING_STAGES as readonly string[]).includes(stage)) {
    return BUILDING_PROFILES[stage as BuildingStage].phrase;
  }
  return '';
}

// ── stage registry (class-dispatched) ───────────────────────────────────────
/** The ordered stage list for an asset class (UI scrubber, seeding matrix). */
export function stagesFor(cls: EntityClass): readonly string[] {
  if (cls === 'plant') return PLANT_STAGES;
  if (cls === 'building') return BUILDING_STAGES;
  return [];
}
/** The canonical (no-op) stage for an asset class, or undefined if the class has
 *  no lifecycle. */
export function defaultStageFor(cls: EntityClass): string | undefined {
  if (cls === 'plant') return PLANT_DEFAULT_STAGE;
  if (cls === 'building') return BUILDING_DEFAULT_STAGE;
  return undefined;
}
/** Build the stage patch for `base` (dispatched by class). Empty patch when the
 *  class has no lifecycle or the stage is the canonical one. */
export function stagePatch(base: Blueprint, stage: string): BlueprintPatch {
  if (base.class === 'plant' && (PLANT_STAGES as readonly string[]).includes(stage)) {
    return plantStagePatch(base, stage as PlantStage);
  }
  if (base.class === 'building' && (BUILDING_STAGES as readonly string[]).includes(stage)) {
    return buildingStagePatch(base, stage as BuildingStage);
  }
  return {};
}
