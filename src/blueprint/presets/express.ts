/**
 * expressBuilding — the layered-connectome pipeline in ONE call.
 *
 * The epic's thesis: a building isn't *built up* from a frozen preset, it is EXPRESSED
 * by layering pure subsystems onto one graph, then projecting to geometry. This is the
 * single composable entry that runs that stack, in dependency order:
 *
 *   PROGRAM    expand(type)            zones(rooms) + portals(doors) + hearth   (Layer 0/4)
 *   STRUCTURE  annotateStructure       frame from wall material + era/region    (Layer 1)
 *   FABRIC     deriveSmokeEgress       hearth egress, GATED by the frame        (Layer 3)
 *     ↓ projections to the geometric Blueprint:
 *   FORM       connectomeForm          vertical massing DEFAULT (pre)           (Layer 2)
 *   OPENINGS   connectomeOpenings      doors + windows on the frame's rhythm    (Layer 3)
 *   VENT       connectomeToBlueprint   the smoke vent over the hearth           (Layer 3)
 *   CAP        connectomeStructure     lowers any massing that exceeds the frame (last)
 *
 * The patches come back split into `pre` (derived DEFAULTS — form massing — applied
 * BEFORE the caller's override patches so a deliberate +storey still wins) and `post`
 * (derived projections + the frame cap, the hard last word). The caller folds
 * `[base, ...pre, ...overrides, ...post]`. Pure + deterministic — the connectome already
 * encodes all randomness, so the same (base, type, ctx, seed) always expresses the same
 * building. A named preset is just a pinned shortcut into this product space.
 */
import { catalogue } from '@/catalogue/pack';
import { loadDefaultPacks } from '@/catalogue/default-packs';
import { expand } from '../connectome/grammar';
import { deriveSmokeEgress } from '../connectome/smoke';
import { connectomeToBlueprint } from '../connectome/to-blueprint';
import { connectomeOpenings } from '../connectome/openings';
import { annotateStructure, connectomeStructure } from '../connectome/structure';
import { connectomeForm } from '../connectome/form';
import type { Connectome, ExpandCtx } from '../connectome/types';
import type { Blueprint, BlueprintPatch, Era } from '../types';

/** The expressed building: its connectome plus the resolve-stack patches, pre-split. */
export interface ExpressedBuilding {
  connectome: Connectome;
  /** Derived DEFAULT patches (form massing) — fold BEFORE the caller's overrides. */
  pre: BlueprintPatch[];
  /** Derived projection + structural-cap patches — fold AFTER the overrides. */
  post: BlueprintPatch[];
}

/** True if any part of `base` already declares a hand-authored vent feature. */
export function hasAuthoredVent(base: Blueprint): boolean {
  return Object.values(base.parts).some((p) =>
    Object.values(p.features ?? {}).some((f) => f.type === 'vent'),
  );
}

const nonEmpty = (p: BlueprintPatch): boolean => Object.keys(p).length > 0;

/**
 * Express `type` over the geometric `base` in the given context. `era`/`wealth` steer
 * structure (frame) + fabric (egress, fenestration); `seed` is carried for the program
 * expansion. Returns `{ connectome, pre, post }`; only buildings have a connectome —
 * the caller guards on `base.class === 'building'` before calling.
 */
export function expressBuilding(
  base: Blueprint,
  type: string,
  era: Era | undefined,
  wealth: string | undefined,
  seed: number,
): ExpressedBuilding {
  loadDefaultPacks();
  const ctx: ExpandCtx = { era: era ?? base.era ?? 'medieval', wealth, seed, registry: catalogue };

  // PROGRAM → STRUCTURE → FABRIC(smoke). Structure is annotated BEFORE smoke so the egress
  // gate can consult the frame (a non-flue frame is barred from a masonry wall-chimney).
  const connectome = deriveSmokeEgress(annotateStructure(expand(type, ctx), base, ctx), ctx);

  const pre: BlueprintPatch[] = [];
  const post: BlueprintPatch[] = [];

  // FORM is the derived massing DEFAULT — it must lose to a caller's explicit override
  // (an opulent +storey), so it goes in `pre`, ahead of the override patches.
  const form = connectomeForm(connectome, base, ctx);
  if (nonEmpty(form)) pre.push(form);

  // OPENINGS + VENT are projections of the graph; the frame CAP is the hard limit. All
  // go in `post`, after the overrides — same order the two call sites used before.
  const openings = connectomeOpenings(connectome, base, ctx.era);
  if (nonEmpty(openings)) post.push(openings);
  if (!hasAuthoredVent(base)) {
    const vent = connectomeToBlueprint(connectome, base);
    if (nonEmpty(vent)) post.push(vent);
  }
  const cap = connectomeStructure(connectome, base);
  if (nonEmpty(cap)) post.push(cap);

  return { connectome, pre, post };
}
