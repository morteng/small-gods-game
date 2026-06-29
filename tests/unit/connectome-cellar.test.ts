// @vitest-environment node
// L3b cellars (content hookup): deriveCellar sinks a building's DECLARED cellar room
// (buildingType.cellar → a roomType placed at level:-1) under a masonry-framed building.
// Driven off REAL synthesized connectomes so the generative gate stays honest.
import { describe, it, expect } from 'vitest';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { interiorPlan } from '@/blueprint/interior';

describe('deriveCellar (L3b content hookup)', () => {
  it('a stone church/temple sinks a crypt at level:-1 under its sanctum', () => {
    for (const preset of ['parish-church', 'temple_small']) {
      const con = synthesizeBlueprint(preset, [], 1)!.connectome!;
      const crypt = con.zones.find((z) => (z.level ?? 0) < 0);
      expect(crypt, `${preset} should sink a crypt`).toBeDefined();
      expect(crypt!.type).toBe('crypt');
      // It is wired into the graph (a stair down from a real zone), not orphaned.
      expect(con.portals.some((p) => p.to === crypt!.id)).toBe(true);
    }
  });

  it('surfaces as a negative level in the interior plan (the cutaway cellar plate)', () => {
    expect(interiorPlan(synthesizeBlueprint('parish-church', [], 1)!)!.levels).toContain(-1);
  });

  it('a building that declares no cellar (a light-framed cottage/manor) gets none', () => {
    for (const preset of ['cottage', 'manor', 'tavern']) {
      const con = synthesizeBlueprint(preset, [], 1)!.connectome!;
      expect(con.zones.every((z) => (z.level ?? 0) >= 0), `${preset} should have no sub-grade zone`).toBe(true);
    }
  });
});
