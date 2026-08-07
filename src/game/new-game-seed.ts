// src/game/new-game-seed.ts
//
// The "WHICH WORLD" choice for a NEW GAME. Rolls a world-gen seed — the ONLY
// deliberately nondeterministic value in boot, and deliberately OUTSIDE the
// seeded rng. The sim's Math.random-free law governs `src/sim/` (the replay
// stream); picking a new world at the player's "begin a New Game" is not a sim
// value, it is the identity of the run. The rolled seed becomes the world's
// `genSeed` and is persisted with the save, so the world is fully deterministic
// and replayable FROM that seed the moment it exists.
//
// This is what makes "New Game" a fresh random run instead of re-landing on the
// pinned demo world (DEFAULT_ORIGIN-free: the origin-profile variety — same
// seed ⇒ same opening — becomes reachable, because different New Games now roll
// different seeds). DEMO and pasted/URL seeds never call this (they pass their
// own explicit seed).

import { PLAYABLE_WORLD_NAMES } from '@/world/playable-worlds';

/** One uniform 32-bit draw from the platform CSPRNG (Math.random fallback on
 *  hosts without `crypto`). Shared by both pickers below so they use the SAME
 *  randomness discipline. */
function randomUint(): number {
  const c = (globalThis as { crypto?: { getRandomValues?(a: Uint32Array): void } }).crypto;
  if (c && typeof c.getRandomValues === 'function') {
    const b = new Uint32Array(1);
    c.getRandomValues(b);
    return b[0];
  }
  return Math.floor(Math.random() * 0xffffffff);
}

/** A uniform integer seed in [1, 0x7fffffff] — a valid world-gen seed (bootstrap
 *  requires `> 0` and finite).
 *
 *  This is the ONLY deliberately nondeterministic value in boot, and deliberately
 *  OUTSIDE the seeded rng: it picks WHICH world (the run's identity), not any
 *  sim value, so the sim is fully deterministic/replayable FROM the rolled seed
 *  once it is persisted as the world's `genSeed`. */
export function newGameSeed(): number {
  return (randomUint() % 0x7fffffff) + 1;
}

/** Pick which PLAYABLE world a New Game starts in — uniformly among
 *  `PLAYABLE_WORLD_NAMES`, from the same CSPRNG. Same nondeterministic "which
 *  world" discipline as `newGameSeed()`. With a single-entry registry this is
 *  always `'default'` (a no-op, as expected). */
export function pickPlayableWorld(): string {
  const n = PLAYABLE_WORLD_NAMES.length;
  return n === 0 ? 'default' : PLAYABLE_WORLD_NAMES[randomUint() % n];
}
