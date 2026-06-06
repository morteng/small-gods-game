import type { NpcRole } from '@/core/types';
import type { LpcSelections } from './canvas/renderer';

export interface CharacterSpec {
  sex: 'male' | 'female' | 'child';
  bodyType: 'male' | 'female' | 'teen' | 'child' | 'muscular';
  items: LpcSelections;
}

/** Seeded pick from an array. Stable for same seed+offset. */
function pick<T>(seed: number, offset: number, options: readonly T[]): T {
  const hash = Math.imul(seed + offset, 2654435761) >>> 0;
  return options[hash % options.length];
}

/** Seeded boolean with the given probability of `true`. */
function chance(seed: number, offset: number, p: number): boolean {
  return ((Math.imul(seed + offset, 2654435761) >>> 0) % 1000) / 1000 < p;
}

// Skin tone and hair colour are variantless upstream (only a single walk.png is
// served — the per-tone files 404), so these variants are cosmetic no-ops that
// fall back to the default sheet. Diversity comes from body type, hair STYLE,
// and clothing colour instead. Kept so the data still reads intentionally.
const SKIN = ['light', 'amber', 'olive', 'taupe', 'bronze', 'brown'] as const;
const HAIR_COLOR = 'black';

// ── Hair style pools (variantless files; many styles vendored) ──────────────
const MALE_HAIR = ['hair_buzzcut', 'hair_parted', 'hair_parted2', 'hair_page', 'hair_messy1', 'hair_messy2', 'hair_unkempt', 'hair_plain'] as const;
const FEMALE_HAIR = ['hair_bob', 'hair_bob_side_part', 'hair_long', 'hair_long_straight', 'hair_bangs', 'hair_pixie', 'hair_pigtails', 'hair_plain'] as const;

// ── Female wardrobe (female/thin body folders; per-variant colours vendored) ─
const FEMALE_TOP = ['torso_clothes_blouse', 'torso_clothes_blouse_longsleeve'] as const;
// Intersection of colours vendored for BOTH tops, so any pick resolves.
const FEMALE_TOP_COLOR = ['black', 'blue', 'green', 'walnut'] as const;
const FEMALE_LEG = ['legs_hose', 'legs_leggings'] as const;       // → /thin/ for female
const FEMALE_LEG_COLOR = ['black', 'brown', 'gray'] as const;     // vendored for both
const FEMALE_FEET = ['feet_boots_basic', 'feet_sandals'] as const; // → /thin/ for female
const FEMALE_FEET_COLOR = ['black', 'brown'] as const;            // vendored for both

/** Common male body/head/face selections at a seeded skin tone. */
function maleBase(seed: number, headItemId: string): LpcSelections {
  const skin = pick(seed, 0, SKIN);
  return {
    body:       { itemId: 'body',         variant: skin },
    head:       { itemId: headItemId,     variant: skin },
    expression: { itemId: 'face_neutral', variant: skin },
  };
}

/**
 * A generic female adult: female body/head/face, a blouse, hose-or-leggings and
 * boots-or-sandals, hair from the female pool. `hair` lets a role bias the
 * style pool. Used as the female half of the mixed-sex adult roles below.
 */
function femaleAdult(seed: number, hair: readonly string[] = FEMALE_HAIR): CharacterSpec {
  const skin = pick(seed, 0, SKIN);
  return {
    sex: 'female', bodyType: 'female',
    items: {
      body:       { itemId: 'body',                variant: skin },
      head:       { itemId: 'heads_human_female',  variant: skin },
      expression: { itemId: 'face_neutral',        variant: skin },
      hair:    { itemId: pick(seed, 1, hair),         variant: HAIR_COLOR },
      clothes: { itemId: pick(seed, 2, FEMALE_TOP),   variant: pick(seed, 3, FEMALE_TOP_COLOR) },
      legs:    { itemId: pick(seed, 4, FEMALE_LEG),   variant: pick(seed, 5, FEMALE_LEG_COLOR) },
      shoes:   { itemId: pick(seed, 6, FEMALE_FEET),  variant: pick(seed, 7, FEMALE_FEET_COLOR) },
    },
  };
}

/** Male half of a mixed-sex adult role, sharing the male hair pool. */
type MaleBuilder = (seed: number) => CharacterSpec;

/**
 * Wrap a male recipe so the role renders as a man or a woman by seed. Roles
 * gated to male-only (soldier's plate armour, the elderly head, the child body)
 * are defined directly and never call this.
 */
function mixedSex(male: MaleBuilder, femaleHair: readonly string[] = FEMALE_HAIR): MaleBuilder {
  return (seed) => (chance(seed, 50, 0.5) ? femaleAdult(seed, femaleHair) : male(seed));
}

const ROLE_SPECS: Record<NpcRole, (seed: number) => CharacterSpec> = {

  farmer: mixedSex((seed) => ({
    sex: 'male', bodyType: 'male',
    items: {
      ...maleBase(seed, 'heads_human_male'),
      hair:    { itemId: pick(seed, 1, MALE_HAIR),         variant: HAIR_COLOR },
      clothes: { itemId: 'torso_clothes_longsleeve2_polo', variant: 'black' },
      legs:    { itemId: 'legs_hose',                      variant: pick(seed, 5, ['leather', 'brown', 'gray'] as const) },
      shoes:   { itemId: 'feet_boots_basic',               variant: pick(seed, 6, ['black', 'brown'] as const) },
    },
  })),

  priest: mixedSex((seed) => ({
    sex: 'male', bodyType: 'male',
    items: {
      ...maleBase(seed, 'heads_human_male'),
      hair:    { itemId: pick(seed, 1, ['hair_plain', 'hair_balding', 'hair_page'] as const), variant: HAIR_COLOR },
      clothes: { itemId: 'torso_clothes_longsleeve2_buttoned', variant: 'black' },
      legs:    { itemId: 'legs_hose',    variant: 'black' },
      shoes:   { itemId: 'feet_sandals', variant: 'brown' },
    },
  }), ['hair_long', 'hair_long_straight', 'hair_plain', 'hair_bob']),

  soldier: (seed) => ({
    // Male-only: plate armour is vendored for the male body folder.
    sex: 'male', bodyType: 'male',
    items: {
      ...maleBase(seed, 'heads_human_male'),
      hair:   { itemId: pick(seed, 1, ['hair_buzzcut', 'hair_unkempt'] as const), variant: HAIR_COLOR },
      armour: { itemId: 'torso_armour_plate', variant: pick(seed, 2, ['steel', 'iron', 'brass'] as const) },
      arms:   { itemId: 'arms_armour',        variant: pick(seed, 3, ['steel', 'iron', 'brass'] as const) },
      legs:   { itemId: 'legs_armour',        variant: pick(seed, 4, ['steel', 'iron', 'brass'] as const) },
      shoes:  { itemId: 'feet_armour',        variant: pick(seed, 5, ['steel', 'iron', 'brass'] as const) },
    },
  }),

  merchant: mixedSex((seed) => ({
    sex: 'male', bodyType: 'male',
    items: {
      ...maleBase(seed, 'heads_human_male'),
      hair:    { itemId: pick(seed, 1, ['hair_parted', 'hair_parted2', 'hair_page'] as const), variant: HAIR_COLOR },
      clothes: { itemId: 'torso_clothes_longsleeve2_polo', variant: 'black' },
      legs:    { itemId: 'legs_leggings', variant: 'black' },
      shoes:   { itemId: 'feet_boots_revised', variant: 'black' },
    },
  }), ['hair_bob', 'hair_bob_side_part', 'hair_bangs', 'hair_long']),

  elder: (seed) => ({
    // Male-only: the elderly head is only served for the male body.
    sex: 'male', bodyType: 'male',
    items: {
      ...maleBase(seed, 'heads_human_male_elderly'),
      hair:    { itemId: pick(seed, 1, ['hair_balding', 'hair_plain'] as const), variant: HAIR_COLOR },
      clothes: { itemId: 'torso_clothes_longsleeve2_buttoned', variant: 'black' },
      legs:    { itemId: 'legs_hose',    variant: 'leather' },
      shoes:   { itemId: 'feet_sandals', variant: 'brown' },
    },
  }),

  child: (seed) => ({
    sex: 'child', bodyType: 'child',
    items: {
      ...maleBase(seed, 'heads_human_child'),
      hair:    { itemId: pick(seed, 1, ['hair_pigtails', 'hair_plain', 'hair_buzzcut', 'hair_bob'] as const), variant: HAIR_COLOR },
      clothes: { itemId: 'torso_clothes_child_shirt', variant: pick(seed, 3, ['black', 'blue', 'brown'] as const) },
      legs:    { itemId: 'legs_childpants',           variant: pick(seed, 4, ['black', 'blue', 'brown'] as const) },
    },
  }),

  noble: mixedSex((seed) => ({
    sex: 'male', bodyType: 'male',
    items: {
      ...maleBase(seed, 'heads_human_male'),
      hair:    { itemId: pick(seed, 1, ['hair_parted2', 'hair_parted', 'hair_page'] as const), variant: HAIR_COLOR },
      clothes: { itemId: 'torso_clothes_longsleeve2_buttoned', variant: 'black' },
      legs:    { itemId: 'legs_leggings',      variant: 'black' },
      shoes:   { itemId: 'feet_boots_revised', variant: 'black' },
    },
  }), ['hair_long', 'hair_long_straight', 'hair_bob_side_part', 'hair_bangs']),

  beggar: mixedSex((seed) => ({
    sex: 'male', bodyType: 'male',
    items: {
      ...maleBase(seed, 'heads_human_male_gaunt'),
      hair:    { itemId: pick(seed, 1, ['hair_messy1', 'hair_messy2', 'hair_unkempt'] as const), variant: HAIR_COLOR },
      clothes: { itemId: 'torso_clothes_longsleeve2_polo', variant: 'black' },
      legs:    { itemId: 'legs_hose',    variant: pick(seed, 5, ['brown', 'gray'] as const) },
      shoes:   { itemId: 'feet_sandals', variant: 'brown' },
    },
  }), ['hair_messy1', 'hair_messy2', 'hair_pixie', 'hair_bangs']),
};

/**
 * Build a character spec for the given role. The seed picks the NPC's sex (for
 * mixed-sex roles), hair style, and outfit colours, so a crowd of one role
 * still reads as many distinct people rather than clones.
 */
export function buildCharacterSpec(role: NpcRole, seed: number): CharacterSpec {
  return ROLE_SPECS[role](seed);
}

/**
 * Build a character spec from an explicit item selection.
 * Used for LLM-driven or custom character descriptions.
 */
export function specFromItems(
  items: LpcSelections,
  sex: 'male' | 'female' | 'child' = 'male',
  bodyType: 'male' | 'female' | 'teen' | 'child' | 'muscular' = 'male',
): CharacterSpec {
  return { sex, bodyType, items };
}
