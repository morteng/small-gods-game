import { describe, it, expect } from 'vitest';
import { getEntitySortY } from '@/render/entity-sort';
import type { Entity } from '@/core/types';

function building(y: number, sortYOffset?: number, footprintH?: number): Entity {
  return {
    id: 'b', kind: 'cottage', x: 0, y, tags: ['building'],
    properties: {
      category: 'building',
      ...(sortYOffset != null ? { sortYOffset } : {}),
      ...(footprintH != null ? { footprint: { w: 3, h: footprintH } } : {}),
    },
  } as Entity;
}

function npc(y: number): { sortY: number } {
  // Renderer sorts NPCs at the bottom edge of their tile.
  return { sortY: y + 1 };
}

describe('getEntitySortY — buildings sort at footprint front edge', () => {
  it('uses e.y + sortYOffset (the footprint bottom), not the bare top', () => {
    // cottage footprint y=50..52, sortYOffset=3 → front edge at 53
    expect(getEntitySortY(building(50, 3))).toBe(53);
  });

  it('an NPC standing inside/behind the footprint paints BEHIND the building', () => {
    const b = building(50, 3);              // sortY 53
    const behind = npc(50);                 // back corner of footprint → sortY 51
    expect(behind.sortY).toBeLessThan(getEntitySortY(b)); // NPC drawn first = occluded
  });

  it('an NPC stepping in front (south of the front edge) paints ON TOP', () => {
    const b = building(50, 3);              // sortY 53
    const front = npc(53);                  // one tile below footprint → sortY 54
    expect(front.sortY).toBeGreaterThan(getEntitySortY(b));
  });

  it('falls back to footprint height when sortYOffset is absent', () => {
    expect(getEntitySortY(building(50, undefined, 3))).toBe(53);
  });

  it('falls back to the kind yOffsetForSort (1) when no footprint info exists', () => {
    expect(getEntitySortY(building(50))).toBe(51);
  });
});
