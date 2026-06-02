import { describe, it, expect } from 'vitest';
import { selectionFromHit } from '@/dev/inspector/selection';
import type { HitResult } from '@/core/types';

describe('selectionFromHit', () => {
  it('maps entity hits to entity selections', () => {
    const hit = { type: 'entity', tileX: 1, tileY: 2, entity: { id: 'e1' } } as unknown as HitResult;
    expect(selectionFromHit(hit)).toEqual({ type: 'entity', id: 'e1' });
  });
  it('maps npc hits to entity selections (npcs are entities)', () => {
    const hit = { type: 'npc', tileX: 1, tileY: 2, npc: { id: 'n1' } } as unknown as HitResult;
    expect(selectionFromHit(hit)).toEqual({ type: 'entity', id: 'n1' });
  });
  it('maps tile and decoration hits', () => {
    expect(selectionFromHit({ type: 'tile', tileX: 3, tileY: 4 } as HitResult)).toEqual({ type: 'tile', x: 3, y: 4 });
    const dec = { type: 'decoration', tileX: 0, tileY: 0, decoration: { assetId: 'a' } } as unknown as HitResult;
    expect(selectionFromHit(dec)).toEqual({ type: 'decoration', index: -1 });
  });
  it('returns null for empty hits', () => {
    expect(selectionFromHit({ type: null, tileX: 0, tileY: 0 } as HitResult)).toBeNull();
  });
});
