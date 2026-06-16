// src/blueprint/validity.ts
// Intrinsic building-validity rules (Tier 1 of the building-validity epic): a building
// must be self-consistent and period-plausible BEFORE it is placed. These are pure,
// data-driven coercions applied at resolve-time (resolveBlueprint) with auto-fix —
// an invalid combo is coerced to the nearest valid value, never crashes — so every
// resolved blueprint is valid by construction. See
// docs/superpowers/specs/2026-06-16-building-validity-and-situation-design.md.
//
// Slice 2 will fold these into the declarative constraint engine (catalogue/constraints.ts);
// for now they live here as focused, independently-testable functions.
import type { Era } from '@/core/era';
import { ROOF_KIND, ROOF_MAT } from './parts/body';
import { ROOFLESS_BUILDING_STAGES } from './lifecycle';

// ── Rule: organic roof coverings must be pitched (no flat thatch) ──────────────────
// Thatch (and hide, which maps to the thatch covering) sheds water only off a slope;
// a flat thatch roof rots. If the resolved roof covering is thatch but the roof shape
// is flat, coerce the shape to a pitched default.
const PITCH_REQUIRED_ROOF_MAT = new Set(['thatch']);
const PITCHED_FALLBACK_ROOF = 'gable';

/** The (possibly corrected) roof shape for a roof covering. Pure. */
export function coerceRoof(roofParam: string, roofMatKey: string | undefined): string {
  if (!roofMatKey) return roofParam;
  const mat = ROOF_MAT[roofMatKey];
  if (mat && PITCH_REQUIRED_ROOF_MAT.has(mat) && ROOF_KIND[roofParam] === 'flat') {
    return PITCHED_FALLBACK_ROOF;
  }
  return roofParam;
}

// ── Rule: building height is capped by era construction tech AND by type ───────────
// Max storeys a period's tech (materials, framing, foundations) supports. A primordial
// hide tent is one storey; a current brick block can stack. The era cap is the firm
// limit ("no 6-storey early-medieval cottage").
const ERA_MAX_LEVELS: Record<Era, number> = {
  primordial: 1, ancient: 2, classical: 3, medieval: 3, current: 6,
};

// Per-type storey caps — a cottage is never a tower, regardless of era. Calibrated AT
// OR ABOVE every authored preset's storeys, so the cap blocks excess (an out-of-range
// request, era/wealth inflation) without retro-clamping the hand-authored presets.
// Deliberately-tall types (tower/keep) carry a high cap. Unlisted types take DEFAULT.
const TYPE_MAX_LEVELS: Record<string, number> = {
  cottage: 2, longhouse: 1, hovel: 1, hut: 1, cabin: 1, yurt: 1,
  shrine: 1, market_stall: 1, dock: 1, well: 1, graveyard: 1, bell_tent: 1,
  temple_small: 2, chapel: 2, farm_barn: 2, granary: 2, watermill: 2, guard_post: 2,
  tavern: 3, townhouse: 4, manor: 4, warehouse: 3,
  tower: 12, watchtower: 12, belltower: 12, castle_keep: 12, keep: 12,
};
const DEFAULT_TYPE_MAX = 4;

/** Storeys allowed for a building `type` in an `era` — min of the era-tech cap and the
 *  per-type cap (and never below 1). Pure. */
export function capLevels(levels: number, type: string | undefined, era: Era | undefined): number {
  const eraCap = era ? (ERA_MAX_LEVELS[era] ?? 8) : 8;
  const typeCap = (type ? TYPE_MAX_LEVELS[type] : undefined) ?? DEFAULT_TYPE_MAX;
  return Math.max(1, Math.min(levels, eraCap, typeCap));
}

/**
 * Apply the intrinsic-validity coercions to a body/wing part's resolved params, given
 * the building's roof covering, type, and era. Returns a NEW params object only when a
 * rule fired (so a valid building serialises byte-identically — stable art-cache key);
 * returns the same reference unchanged otherwise. Warns on each correction.
 */
export function applyPartValidity(
  params: Record<string, unknown>,
  ctx: { roofMat?: string; type?: string; era?: Era; stage?: string },
): Record<string, unknown> {
  let out = params;
  const set = (patch: Record<string, unknown>) => { out = out === params ? { ...params, ...patch } : Object.assign(out, patch); };

  // Skip the thatch-pitch coercion on roofless lifecycle stages (ruin/burnt/cleared/…):
  // their `roof: 'flat'` means the roof is GONE, not a flat thatch covering.
  const rooflessStage = ctx.stage !== undefined && ROOFLESS_BUILDING_STAGES.has(ctx.stage);

  if (!rooflessStage && typeof params.roof === 'string') {
    const fixed = coerceRoof(params.roof, ctx.roofMat);
    if (fixed !== params.roof) {
      console.warn(`[validity] ${ctx.type ?? 'building'}: ${ctx.roofMat} roof cannot be '${params.roof}' (must shed water) → '${fixed}'`);
      set({ roof: fixed });
    }
  }

  if (typeof params.levels === 'number') {
    const capped = capLevels(params.levels, ctx.type, ctx.era);
    if (capped !== params.levels) {
      console.warn(`[validity] ${ctx.type ?? 'building'}: ${params.levels} storeys exceeds the ${ctx.era ?? 'untyped'}-era/type limit → ${capped}`);
      set({ levels: capped });
    }
  }

  return out;
}
