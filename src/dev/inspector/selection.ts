import type { HitResult } from '@/core/types';

/** A unified selection that drives the Inspector detail pane. */
export type Selection =
  | { type: 'entity'; id: string }
  | { type: 'tile'; x: number; y: number }
  | { type: 'decoration'; index: number }
  | { type: 'spirit'; id: string }
  | { type: 'world' }
  | { type: 'lore' }
  | { type: 'poi'; id: string };

/** Map a canvas right-click HitResult into a Selection (or null for empties). */
export function selectionFromHit(hit: HitResult | null): Selection | null {
  if (!hit || hit.type === null) return null;
  switch (hit.type) {
    case 'entity': return hit.entity ? { type: 'entity', id: hit.entity.id } : null;
    case 'npc':    return hit.npc ? { type: 'entity', id: (hit.npc as { id: string }).id } : null;
    case 'tile':   return { type: 'tile', x: hit.tileX, y: hit.tileY };
    // Decoration hits don't carry an index; the Inspector resolves it against
    // state.generatedDecorations. -1 means "unresolved" until then.
    case 'decoration': return { type: 'decoration', index: -1 };
    default: return null;
  }
}
