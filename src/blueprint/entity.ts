// src/blueprint/entity.ts
import type { Entity, ReligiousSignificance } from '@/core/types';
import type { ResolvedBlueprint } from './types';
import type { Connectome } from './connectome/types';
import type { Anchor } from '@/world/anchors';
import { toCollision } from './compile/to-collision';
import { toAnchors } from './compile/to-anchors';

export interface StoredBlueprint {
  rb: ResolvedBlueprint;
  collision: { footprint: { w: number; h: number }; blocked: string[]; doorCells: string[] };
  anchors: Anchor[];
  /** The latent room-graph. It rides on `rb` NON-ENUMERABLY (out of the art-cache key
   *  `canonicalJson(rb)`), but that means JSON/`structuredClone` save+load drops it — so we
   *  also persist it HERE, as an enumerable sibling of `rb` (still outside `canonicalJson(rb)`),
   *  and re-attach it to `rb` on access. Lets reloaded worlds keep their interiors (I-3). */
  connectome?: Connectome;
}

export function blueprintOf(e: Entity): StoredBlueprint | undefined {
  const sb = (e.properties as { blueprint?: StoredBlueprint } | undefined)?.blueprint;
  // Re-attach the persisted connectome to `rb` (non-enumerable, one-time) after a save/load
  // stripped the original. No-op for live blueprints (rb.connectome already present).
  if (sb && sb.connectome && !sb.rb.connectome) {
    Object.defineProperty(sb.rb, 'connectome', {
      value: sb.connectome, enumerable: false, writable: true, configurable: true,
    });
  }
  return sb;
}

/** Entity category (and primary tag) by blueprint class. Buildings keep the legacy
 *  'building' value (all existing presets are class:'building', so byte-unchanged);
 *  props/plants/barriers get their own category so they're not counted as buildings
 *  and don't trip the `category==='building'` placement blocker. */
const CLASS_CATEGORY: Record<string, string> = {
  building: 'building', prop: 'prop', plant: 'vegetation',
  barrier: 'barrier', terrain_feature: 'terrain_feature',
};

export function blueprintEntity(
  id: string, rb: ResolvedBlueprint, x: number, y: number,
  extra: { poiId?: string; religiousSignificance?: ReligiousSignificance; state?: string } = {},
): Entity {
  const collision = toCollision(rb);
  const anchors = toAnchors(rb, x, y);
  const category = CLASS_CATEGORY[rb.class ?? 'building'] ?? 'building';
  return {
    id,
    kind: rb.preset ?? 'building',
    x, y,
    tags: [category, rb.category ?? 'residential'],
    properties: {
      category,
      blueprint: { rb, collision, anchors, ...(rb.connectome ? { connectome: rb.connectome } : {}) } satisfies StoredBlueprint,
      footprint: { ...rb.footprint },
      anchors,
      sortYOffset: rb.footprint.h,
      era: rb.era,
      poiId: extra.poiId,
      religiousSignificance: extra.religiousSignificance ?? (rb.category === 'religious' ? 'sacred' : 'neutral'),
      state: extra.state ?? 'intact',
    },
  };
}
