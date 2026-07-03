/**
 * Drift guard: every SHIPPED story pack must register against the REAL command
 * capability registry's verb set — the same gate `game.ts` applies via
 * `busAllowedVerbs(bus)` (bus capabilities are the registry's verbs).
 *
 * Why this exists: the drought-omen pack shipped with a `do` effect naming an
 * unregistered verb (`grant_belief`), so the live game silently rejected the
 * ENTIRE pack at boot ("[story] sample pack rejected") and no storylet could
 * ever arm or play. Content and capabilities drift independently — this pins
 * them together at test time instead of at a boot-console warning nobody reads.
 */
import { describe, it, expect } from 'vitest';
import { StoryRegistry } from '@/story/story-registry';
import { droughtOmenPack } from '@/story/samples/the-drought-omen';
import { CAPABILITY_REGISTRY } from '@/sim/command/registry';

const SHIPPED_PACKS = [droughtOmenPack];

describe('shipped story packs validate against the live capability registry', () => {
  const allowedVerbs = new Set(Object.keys(CAPABILITY_REGISTRY));

  for (const pack of SHIPPED_PACKS) {
    it(`pack "${pack.id}" registers with zero errors`, () => {
      const registry = new StoryRegistry();
      const errors = registry.register(pack, { allowedVerbs });
      expect(errors).toEqual([]);
      expect(registry.storyletIds().size).toBeGreaterThan(0);
    });
  }
});
