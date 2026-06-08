// tests/unit/blueprint-register-buildings.test.ts
import { describe, it, expect } from 'vitest';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { getPartType, getFeatureType } from '@/blueprint/registry';

describe('register-buildings', () => {
  it('registers all v1 building parts and features (idempotent)', () => {
    ensureBuildingTypesRegistered();
    ensureBuildingTypesRegistered();   // second call must not throw
    for (const t of ['body', 'wing', 'tower', 'porch', 'chimney', 'prim']) expect(getPartType(t).type).toBe(t);
    for (const t of ['door', 'vent', 'window']) expect(getFeatureType(t)?.type).toBe(t);
  });
});
