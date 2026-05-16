import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadDecorations,
  saveDecorations,
  clearDecorations,
} from '@/services/decoration-store';

beforeEach(() => {
  localStorage.clear();
});

describe('decoration-store', () => {
  it('returns [] when nothing is stored', () => {
    expect(loadDecorations('default')).toEqual([]);
  });

  it('returns [] for empty world name', () => {
    saveDecorations('default', [{ tileX: 1, tileY: 2, assetId: 'abc' }]);
    expect(loadDecorations('')).toEqual([]);
  });

  it('round-trips decorations', () => {
    const items = [
      { tileX: 1, tileY: 2, assetId: 'abc' },
      { tileX: 3, tileY: 4, assetId: 'def' },
    ];
    saveDecorations('default', items);
    expect(loadDecorations('default')).toEqual(items);
  });

  it('namespaces by world name', () => {
    saveDecorations('worldA', [{ tileX: 1, tileY: 1, assetId: 'a' }]);
    saveDecorations('worldB', [{ tileX: 2, tileY: 2, assetId: 'b' }]);
    expect(loadDecorations('worldA')).toEqual([{ tileX: 1, tileY: 1, assetId: 'a' }]);
    expect(loadDecorations('worldB')).toEqual([{ tileX: 2, tileY: 2, assetId: 'b' }]);
  });

  it('overwrites on subsequent save', () => {
    saveDecorations('w', [{ tileX: 1, tileY: 1, assetId: 'a' }]);
    saveDecorations('w', [{ tileX: 2, tileY: 2, assetId: 'b' }]);
    expect(loadDecorations('w')).toEqual([{ tileX: 2, tileY: 2, assetId: 'b' }]);
  });

  it('clearDecorations removes entries', () => {
    saveDecorations('w', [{ tileX: 1, tileY: 1, assetId: 'a' }]);
    clearDecorations('w');
    expect(loadDecorations('w')).toEqual([]);
  });

  it('drops malformed items but keeps valid siblings', () => {
    localStorage.setItem(
      'smallgods.decorations.w',
      JSON.stringify({
        schemaVersion: 1,
        items: [
          { tileX: 1, tileY: 1, assetId: 'a' },
          { tileX: 'oops', tileY: 1, assetId: 'b' },
          { tileX: 2, tileY: 2, assetId: '' },
          { tileX: 3, tileY: 3, assetId: 'c' },
        ],
      }),
    );
    expect(loadDecorations('w')).toEqual([
      { tileX: 1, tileY: 1, assetId: 'a' },
      { tileX: 3, tileY: 3, assetId: 'c' },
    ]);
  });

  it('returns [] when payload has wrong schemaVersion', () => {
    localStorage.setItem(
      'smallgods.decorations.w',
      JSON.stringify({ schemaVersion: 999, items: [{ tileX: 1, tileY: 1, assetId: 'a' }] }),
    );
    expect(loadDecorations('w')).toEqual([]);
  });

  it('returns [] when stored value is not JSON', () => {
    localStorage.setItem('smallgods.decorations.w', 'not-json{');
    expect(loadDecorations('w')).toEqual([]);
  });
});
