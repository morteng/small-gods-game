import { describe, it, expect } from 'vitest';
import { BLUEPRINT_VERSION, type Blueprint } from '@/blueprint/types';

describe('blueprint types', () => {
  it('exposes a numeric schema version', () => {
    expect(typeof BLUEPRINT_VERSION).toBe('number');
    expect(BLUEPRINT_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('a minimal building blueprint type-checks and round-trips through JSON', () => {
    const bp: Blueprint = {
      version: BLUEPRINT_VERSION,
      class: 'building',
      footprint: { w: 3, h: 3 },
      parts: { body: { type: 'body', size: { w: 2, h: 2 } } },
    };
    expect(JSON.parse(JSON.stringify(bp))).toEqual(bp);
  });
});
