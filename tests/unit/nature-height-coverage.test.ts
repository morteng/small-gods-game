import { describe, it, expect } from 'vitest';
import { NATURE_HEIGHT_M } from '@/render/scale-contract';
import { entityKinds } from '@/world/entity-kinds';

// Every vegetation / terrain-feature kind must have an authored metric height,
// so nothing silently falls back to the default.
describe('NATURE_HEIGHT_M coverage', () => {
  it('covers every vegetation and terrain-feature kind', () => {
    const missing: string[] = [];
    for (const [id, def] of entityKinds) {
      if (def.category === 'vegetation' || def.category === 'terrain-feature') {
        if (!(id in NATURE_HEIGHT_M)) missing.push(id);
      }
    }
    expect(missing).toEqual([]);
  });
});
