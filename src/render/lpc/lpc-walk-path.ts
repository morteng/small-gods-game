/**
 * Resolves an LpcSelections entry to the vendored walk-sprite path(s) it would
 * load, mirroring the runtime loader's variant→variantless fallback
 * (load-image.js): try `…/walk/<variant>.png`, then `…/walk.png`. Returns paths
 * relative to `public/sprites/lpc/spritesheets/`.
 *
 * This is the single place that encodes the itemId→folder + body-type-folder
 * conventions for the item families the role recipes use, so a test can assert
 * every referenced sprite is actually vendored (no broken NPC layers).
 */

type BodyType = 'male' | 'female' | 'teen' | 'child' | 'muscular';

/** Female & teen bodies share the "thin" clothing folder upstream. */
const thin = (b: BodyType): string => (b === 'female' || b === 'teen' ? 'thin' : 'male');

const HEAD_FOLDER: Record<string, string> = {
  heads_human_male: 'male',
  heads_human_female: 'female',
  heads_human_male_elderly: 'male_elderly',
  heads_human_male_gaunt: 'male_gaunt',
  heads_human_child: 'child',
};

/**
 * Folder (under spritesheets/, without the trailing `/walk…`) for an item on a
 * body type, or null for an item family this resolver doesn't model.
 */
export function walkFolder(itemId: string, bodyType: BodyType): string | null {
  if (itemId === 'body') return `body/bodies/${bodyType}`;
  if (itemId in HEAD_FOLDER) return `head/heads/human/${HEAD_FOLDER[itemId]}`;
  if (itemId === 'face_neutral') {
    const face = bodyType === 'female' ? 'female' : bodyType === 'child' ? 'child' : 'male';
    return `head/faces/${face}/neutral`;
  }
  if (itemId.startsWith('hair_')) return `hair/${itemId.slice(5)}/adult`;

  switch (itemId) {
    case 'torso_clothes_longsleeve2_polo':     return 'torso/clothes/longsleeve/longsleeve2_polo/male';
    case 'torso_clothes_longsleeve2_buttoned': return 'torso/clothes/longsleeve/longsleeve2_buttoned/male';
    case 'torso_clothes_blouse':               return 'torso/clothes/blouse/female';
    case 'torso_clothes_blouse_longsleeve':    return 'torso/clothes/blouse_longsleeve/female';
    case 'torso_clothes_child_shirt':          return 'torso/clothes/shirt/child';
    case 'torso_armour_plate':                 return 'torso/armour/plate/male';
    case 'arms_armour':                        return 'arms/armour/plate/male';
    case 'legs_armour':                        return 'legs/armour/plate/male';
    case 'legs_hose':                          return `legs/hose/${thin(bodyType)}`;
    case 'legs_leggings':                      return `legs/leggings/${thin(bodyType)}`;
    case 'legs_leggings2':                     return 'legs/leggings2/male';
    case 'legs_childpants':                    return 'legs/pants/child';
    case 'feet_boots_basic':                   return `feet/boots/basic/${thin(bodyType)}`;
    case 'feet_boots_revised':                 return 'feet/boots/revised/male';
    case 'feet_sandals':                       return `feet/sandals/${thin(bodyType)}`;
    case 'feet_armour':                        return 'feet/armour/plate/male';
    default:                                   return null;
  }
}

/**
 * Candidate vendored paths for a selection, variant first then the variantless
 * fallback — the loader accepts whichever exists.
 */
export function walkSpriteCandidates(itemId: string, variant: string, bodyType: BodyType): string[] {
  const folder = walkFolder(itemId, bodyType);
  if (!folder) return [];
  return [`${folder}/walk/${variant}.png`, `${folder}/walk.png`];
}
