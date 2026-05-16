import type { Entity, BrushContext, Region, WorldReadOnly, GameMap } from '@/core/types';
import { getEntityKindDef } from './entity-kinds';

/**
 * Deterministic id for an entity emitted by a brush. Uses floored tile
 * coordinates so sub-tile offsets do not change the id.
 */
export function idFor(brush: string, kind: string, tileX: number, tileY: number): string {
  return `${brush}-${kind}-${Math.floor(tileX)}-${Math.floor(tileY)}`;
}

/** Region is half-open: [x, x+w) × [y, y+h). */
export function isInRegion(x: number, y: number, r: Region): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/**
 * Build an Entity using the EntityKindDef catalog for default tags.
 * Caller may pass extra properties and extra tags (appended after defaults).
 */
export function defaultEntity(
  brush: string,
  kind: string,
  x: number,
  y: number,
  extraProps: Record<string, unknown> = {},
  extraTags: ReadonlyArray<string> = [],
): Entity {
  const def = getEntityKindDef(kind);
  return {
    id: idFor(brush, kind, x, y),
    kind,
    x,
    y,
    properties: { ...extraProps },
    tags: [...def.defaultTags, ...extraTags],
  };
}

const emptyWorld: WorldReadOnly = {
  query: () => [],
  tileAt: () => undefined,
};

/** Empty BrushContext suitable for unit tests. */
export const EMPTY_CONTEXT: BrushContext = {
  world: emptyWorld,
  tiles: {
    tiles: [],
    width: 0,
    height: 0,
    villages: [],
    seed: 0,
    success: true,
    worldSeed: null,
    stats: { iterations: 0, backtracks: 0 },
    buildings: [],
  } as GameMap,
};
