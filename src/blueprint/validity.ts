// src/blueprint/validity.ts
// Intrinsic building-validity rules (Tier 1 of the building-validity epic): a building
// must be self-consistent and period-plausible BEFORE it is placed. An invalid combo is
// coerced to the nearest valid value, never crashes — so every resolved blueprint is valid
// by construction. See docs/superpowers/specs/2026-06-16-building-validity-and-situation-design.md.
//
// Slice 2 (DONE): the rules are now declarative `Constraint`s (PART_VALIDITY_CONSTRAINTS) run
// through the shared constraint engine (`validate<T>` in catalogue/constraints.ts), the same
// engine the medieval pack's chimney-era gate and the defended-complex guardrails use. The
// pure `coerceRoof`/`capLevels` helpers stay (the constraints + their tests reuse them);
// `applyPartValidity` is now a thin adapter that builds the target, runs the engine with
// auto-fix, and preserves the byte-stable-when-valid contract (stable art-cache key).
//
// These are UNIVERSAL physics/period rules (organic roofs shed water; era tech caps storeys),
// so they live at the blueprint layer and apply to every resolve path regardless of which
// culture pack is loaded — not in a pack. A pack may add its own part-validity constraints.
import type { Era } from '@/core/era';
import { validate, type Constraint } from '@/catalogue/constraints';
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

// ── The rules, as declarative constraints over a part-validity target ──────────────
// `validate<T>` runs these in order with auto-fix; each `check` reuses the pure helper
// above so the logic has exactly one home. The target carries the part's mutable fields
// (roof shape, storeys) plus the read-only building context (covering, type, era, stage).

/** The slice of a body/wing part the intrinsic rules read & repair. */
export interface PartValidityTarget {
  roof?: string;
  levels?: number;
  /** Read-only context. */
  roofMat?: string;
  type?: string;
  era?: Era;
  stage?: string;
}

/** Rule: an organic roof covering (thatch/hide) cannot sit flat — it must shed water.
 *  Skipped on roofless lifecycle stages, where `roof:'flat'` means the roof is GONE. */
export const organicRoofMustPitch: Constraint<PartValidityTarget> = {
  id: 'organic-roof-must-pitch',
  kind: 'part-validity',
  severity: 'warn',
  check: (t) => {
    if (t.stage !== undefined && ROOFLESS_BUILDING_STAGES.has(t.stage)) return true;
    if (typeof t.roof !== 'string') return true;
    return coerceRoof(t.roof, t.roofMat) === t.roof;
  },
  message: 'organic roof covering cannot be flat (must shed water) — pitching it',
  autoCorrect: (t) => ({ ...t, roof: coerceRoof(t.roof as string, t.roofMat) }),
};

/** Rule: storeys are capped by era construction tech AND by building type. */
export const levelsCappedByEraAndType: Constraint<PartValidityTarget> = {
  id: 'levels-capped-by-era-and-type',
  kind: 'part-validity',
  severity: 'warn',
  check: (t) => typeof t.levels !== 'number' || capLevels(t.levels, t.type, t.era) === t.levels,
  message: 'storeys exceed the era-tech / building-type limit — capping',
  autoCorrect: (t) => ({ ...t, levels: capLevels(t.levels as number, t.type, t.era) }),
};

/** The intrinsic part-validity rule set, in application order. */
export const PART_VALIDITY_CONSTRAINTS: Constraint<PartValidityTarget>[] = [
  organicRoofMustPitch,
  levelsCappedByEraAndType,
];

/**
 * Apply the intrinsic-validity coercions to a body/wing part's resolved params, given
 * the building's roof covering, type, and era. Returns a NEW params object only when a
 * rule fired (so a valid building serialises byte-identically — stable art-cache key);
 * returns the same reference unchanged otherwise. Warns once per fired rule.
 *
 * Thin adapter over the shared constraint engine: build the target → `validate` with
 * auto-fix → fold any corrected fields back onto `params`.
 */
export function applyPartValidity(
  params: Record<string, unknown>,
  ctx: { roofMat?: string; type?: string; era?: Era; stage?: string },
): Record<string, unknown> {
  const target: PartValidityTarget = {
    roof: typeof params.roof === 'string' ? params.roof : undefined,
    levels: typeof params.levels === 'number' ? params.levels : undefined,
    roofMat: ctx.roofMat, type: ctx.type, era: ctx.era, stage: ctx.stage,
  };

  const { issues, corrected } = validate(target, PART_VALIDITY_CONSTRAINTS, undefined, { apply: true });
  if (!corrected) return params; // valid by construction → same reference (stable cache key)

  for (const issue of issues) console.warn(`[validity] ${ctx.type ?? 'building'}: ${issue.message}`);

  const patch: Record<string, unknown> = {};
  if (corrected.roof !== target.roof) patch.roof = corrected.roof;
  if (corrected.levels !== target.levels) patch.levels = corrected.levels;
  return { ...params, ...patch };
}
