// tests/unit/building-structure-rect.test.ts
import { describe, it, expect } from 'vitest';
import { structureRect } from '@/world/building-descriptor';
import { synthesizeFromPreset } from '@/world/building-presets';

describe('structureRect', () => {
  it('defaults to the whole footprint when no structure is set', () => {
    const d = synthesizeFromPreset('tavern')!;          // no structure field
    const s = structureRect(d);
    expect(s).toEqual({ w: d.footprint.w, h: d.footprint.h, dx: 0, dy: 0 });
  });

  it('returns the explicit structure rect when present', () => {
    const d = { ...synthesizeFromPreset('tavern')!, structure: { w: 2, h: 2, dx: 1, dy: 0 } };
    expect(structureRect(d)).toEqual({ w: 2, h: 2, dx: 1, dy: 0 });
  });
});
