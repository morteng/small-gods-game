/**
 * `CharacterSpec` → paper-doll layer stack.
 *
 * The one place that says which vendored sheets a role's wardrobe is made of
 * and in WHAT ORDER they paint. It was born inside the motion studio's
 * "Character" panel; the runtime rig-row bake (`src/render/lpc/rig-rows.ts`)
 * needs the identical stack, so it moved to this leaf and the studio was
 * REPOINTED — two copies of the paint order would drift the moment a role
 * gained a garment.
 *
 * Paths come from the pure resolver (`lpc-walk-path.ts`), i.e. the same sheets
 * the LPC compositor loads, so what bakes here is what the game wears.
 */
import type { CharacterSpec } from './character-builder';
import type { HumanoidCharLayerSpec } from '@/render/paperdoll/humanoid-loader';
import { walkSpriteCandidates } from './lpc-walk-path';

/** Paint order (bottom→top) across every selection key the role recipes use. */
const KEY_ORDER = ['body', 'legs', 'shoes', 'clothes', 'armour', 'arms', 'head', 'expression', 'hair'] as const;

/** Selections that ride the `head` chip WHOLESALE (rect-slicing cuts chins/hair in half). */
const HEAD_KEYS = new Set<string>(['head', 'expression', 'hair']);

/** A resolved layer plus the selection key it came from (the studio labels rows with it). */
export interface HumanoidCharLayer extends HumanoidCharLayerSpec {
  key: string;
}

/**
 * The vendored walk-sheet stack for a character spec, bottom→top. Selections
 * this build doesn't model (`walkSpriteCandidates` returns nothing) are skipped
 * rather than faked — a missing garment is one absent layer, never a broken path.
 */
export function humanoidLayerSpecs(spec: CharacterSpec): HumanoidCharLayer[] {
  const out: HumanoidCharLayer[] = [];
  for (const key of KEY_ORDER) {
    const sel = spec.items[key];
    if (!sel) continue;
    const [primary, fallback] = walkSpriteCandidates(sel.itemId, sel.variant, spec.bodyType);
    if (!primary) continue;
    out.push({
      path: `sprites/lpc/spritesheets/${primary}`,
      fallback: fallback ? `sprites/lpc/spritesheets/${fallback}` : undefined,
      assign: HEAD_KEYS.has(key) ? 'head' : undefined,
      key,
    });
  }
  return out;
}
