import type { NpcRole } from '@/core/types';
import type { LpcSelections } from './canvas/renderer';

export interface CharacterSpec {
  sex: 'male' | 'female' | 'child';
  bodyType: 'male' | 'female' | 'teen' | 'child' | 'muscular';
  items: LpcSelections;
}

/** Seeded pick from an array. Stable for same seed+offset. */
function pick<T>(seed: number, offset: number, options: readonly T[]): T {
  return options[Math.abs((seed + offset) * 2654435761) % options.length];
}

/** Skin tone variants available on most human head/body items */
const SKIN = ['light', 'amber', 'olive', 'taupe', 'bronze', 'brown'] as const;

/** Earth-toned clothing variants */
const EARTH = ['black', 'blue', 'bluegray'] as const;

function base(seed: number, headItemId: string): LpcSelections {
  const skin = pick(seed, 0, SKIN);
  return {
    body:       { itemId: 'body',         variant: skin },
    head:       { itemId: headItemId,     variant: skin },
    expression: { itemId: 'face_neutral', variant: skin },
  };
}

const ROLE_SPECS: Record<NpcRole, (seed: number) => CharacterSpec> = {

  farmer: (seed) => ({
    sex: 'male', bodyType: 'male',
    items: {
      ...base(seed, 'heads_human_male'),
      hair:    { itemId: 'hair_buzzcut',        variant: pick(seed, 1, ['brown', 'sandy', 'black', 'chestnut'] as const) },
      clothes: { itemId: 'torso_clothes_tunic', variant: pick(seed, 2, EARTH) },
      legs:    { itemId: 'legs_hose',           variant: 'leather' },
      shoes:   { itemId: 'feet_boots_basic',    variant: 'black' },
    },
  }),

  priest: (seed) => ({
    sex: 'male', bodyType: 'male',
    items: {
      ...base(seed, 'heads_human_male'),
      hair:    { itemId: 'hair_plain',          variant: pick(seed, 1, ['blonde', 'sandy', 'white', 'black'] as const) },
      clothes: { itemId: 'torso_clothes_robe',  variant: pick(seed, 2, ['blue', 'black', 'brown'] as const) },
      legs:    { itemId: 'legs_hose',           variant: 'black' },
      shoes:   { itemId: 'feet_sandals',        variant: 'brown' },
    },
  }),

  soldier: (seed) => ({
    sex: 'male', bodyType: 'male',
    items: {
      ...base(seed, 'heads_human_male'),
      hair:   { itemId: 'hair_buzzcut',       variant: pick(seed, 1, ['black', 'brown', 'blonde'] as const) },
      armour: { itemId: 'torso_armour_plate', variant: pick(seed, 2, ['steel', 'iron', 'brass'] as const) },
      arms:   { itemId: 'arms_armour',        variant: pick(seed, 3, ['steel', 'iron', 'brass'] as const) },
      legs:   { itemId: 'legs_armour',        variant: pick(seed, 4, ['steel', 'iron', 'brass'] as const) },
      shoes:  { itemId: 'feet_armour',        variant: pick(seed, 5, ['steel', 'iron', 'brass'] as const) },
    },
  }),

  merchant: (seed) => ({
    sex: 'male', bodyType: 'male',
    items: {
      ...base(seed, 'heads_human_male'),
      hair:    { itemId: 'hair_parted',                    variant: pick(seed, 1, ['brown', 'black', 'blonde', 'sandy'] as const) },
      clothes: { itemId: 'torso_clothes_longsleeve_polo',  variant: pick(seed, 2, ['blue', 'black', 'bluegray'] as const) },
      legs:    { itemId: 'legs_leggings',                  variant: 'black' },
      shoes:   { itemId: 'feet_boots_revised',             variant: 'black' },
    },
  }),

  elder: (seed) => ({
    sex: 'male', bodyType: 'male',
    items: {
      ...base(seed, 'heads_human_male_elderly'),
      hair:    { itemId: 'hair_balding',       variant: pick(seed, 1, ['gray', 'white', 'dark gray'] as const) },
      beard:   { itemId: 'beard_basic_beard',  variant: pick(seed, 2, ['white', 'gray'] as const) },
      clothes: { itemId: 'torso_clothes_robe', variant: pick(seed, 3, ['black', 'blue', 'brown'] as const) },
      legs:    { itemId: 'legs_hose',          variant: 'leather' },
      shoes:   { itemId: 'feet_sandals',       variant: 'brown' },
    },
  }),

  child: (seed) => ({
    sex: 'child', bodyType: 'child',
    items: {
      ...base(seed, 'heads_human_child'),
      hair:    { itemId: pick(seed, 1, ['hair_pigtails', 'hair_plain', 'hair_buzzcut'] as const), variant: pick(seed, 2, ['blonde', 'brown', 'black', 'sandy'] as const) },
      clothes: { itemId: 'torso_clothes_child_shirts', variant: pick(seed, 3, EARTH) },
      legs:    { itemId: 'legs_child_pants',           variant: pick(seed, 4, ['black', 'blue', 'brown'] as const) },
    },
  }),

  noble: (seed) => ({
    sex: 'male', bodyType: 'male',
    items: {
      ...base(seed, 'heads_human_male'),
      hair:    { itemId: pick(seed, 1, ['hair_parted_2', 'hair_parted', 'hair_page'] as const), variant: pick(seed, 2, ['blonde', 'sandy', 'brown', 'black'] as const) },
      clothes: { itemId: 'torso_clothes_longsleeve_2_buttoned', variant: pick(seed, 3, ['blue', 'black', 'bluegray'] as const) },
      legs:    { itemId: 'legs_leggings_2',   variant: 'black' },
      shoes:   { itemId: 'feet_boots_revised', variant: 'black' },
    },
  }),

  beggar: (seed) => ({
    sex: 'male', bodyType: 'male',
    items: {
      ...base(seed, 'heads_human_male_gaunt'),
      hair:    { itemId: pick(seed, 1, ['hair_messy1', 'hair_messy2', 'hair_unkempt'] as const), variant: pick(seed, 2, ['black', 'dark brown', 'dark gray'] as const) },
      clothes: { itemId: 'torso_clothes_tunic', variant: 'black' },
      legs:    { itemId: 'legs_hose',           variant: 'black' },
    },
  }),
};

/**
 * Build a character spec for the given role.
 * The seed makes each NPC instance look slightly different.
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
