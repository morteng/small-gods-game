import { describe, it, expect } from 'vitest';
import { buildYSortBucket, type YSortEntry } from '@/render/iso/iso-ysort';

describe('iso-ysort: single-tile entities', () => {
  it('sorts by (tx+ty) ascending (back-to-front paint order)', () => {
    const entries: YSortEntry[] = [
      { id: 'a', kind: 'npc', tx: 5, ty: 5, z: 0, kindPriority: 0 },
      { id: 'b', kind: 'npc', tx: 1, ty: 1, z: 0, kindPriority: 0 },
      { id: 'c', kind: 'npc', tx: 9, ty: 0, z: 0, kindPriority: 0 },
    ];
    const sorted = buildYSortBucket(entries);
    expect(sorted.map(e => e.id)).toEqual(['b', 'c', 'a']);
  });

  it('breaks ties with z then kindPriority', () => {
    const entries: YSortEntry[] = [
      { id: 'low',  kind: 'npc',  tx: 3, ty: 3, z: 0, kindPriority: 1 },
      { id: 'high', kind: 'tree', tx: 3, ty: 3, z: 50, kindPriority: 0 },
      { id: 'same', kind: 'deco', tx: 3, ty: 3, z: 0, kindPriority: 0 },
    ];
    const sorted = buildYSortBucket(entries);
    expect(sorted.map(e => e.id)).toEqual(['same', 'low', 'high']);
  });
});
