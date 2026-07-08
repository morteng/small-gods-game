import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION } from '@/core/content-version';
import { verifySpriteBundle } from '../../scripts/verify-sprite-bundle';

// The prebaked parametric sprite bundle (public/data/parametric-sprites/<ver>/)
// is what lets a first-visit player skip the ~53s cold compose backlog. It is a
// MANUAL reseed (scripts/seed-parametric-sprites.ts), so this test — plus the
// prebuild gate wired into `npm run build` — is the tripwire that stops an
// ART_RECIPE_VERSION bump from shipping without a matching reseed.
describe('prebaked parametric sprite bundle', () => {
  it(`is present, complete, and matches ART_RECIPE_VERSION (${ART_RECIPE_VERSION})`, () => {
    const r = verifySpriteBundle();
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.count).toBeGreaterThan(0);
  });

  it('reports errors for a version that was never seeded', () => {
    const r = verifySpriteBundle('v-does-not-exist');
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});
