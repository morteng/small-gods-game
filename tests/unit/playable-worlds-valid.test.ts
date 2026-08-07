// tests/unit/playable-worlds-valid.test.ts
// The B1 per-world gate: every PLAYABLE world must be schema-valid AND produce a
// deterministic doctor report — same (world, genSeed) ⇒ byte-identical world.
// This is the "same world code, same world" replay guarantee for New Game, plus
// the structural validity floor an authored world must clear before it ships.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PLAYABLE_WORLD_NAMES } from '@/world/playable-worlds';
import { validateWorldSeed } from '@/core/schema';
import { diagnoseWorldSeed } from '@/world/world-doctor';
import type { WorldSeed } from '@/core/types';

describe('every playable world', () => {
  for (const id of PLAYABLE_WORLD_NAMES) {
    it(`"${id}" is schema-valid (0 errors) and generates deterministically`, async () => {
      const ws = JSON.parse(readFileSync(`public/data/worlds/${id}.json`, 'utf8')) as WorldSeed;

      // Schema: a structurally broken seed must never ship.
      const v = validateWorldSeed(ws);
      expect(v.errors).toEqual([]);

      // Determinism: two independent full-generations of the same (world, seed)
      // produce an identical doctor report — pins the New Game replay guarantee.
      const first = JSON.stringify(await diagnoseWorldSeed(ws, 12345));
      const second = JSON.stringify(await diagnoseWorldSeed(ws, 12345));
      expect(second).toEqual(first);
    }, 180_000);
  }
});
