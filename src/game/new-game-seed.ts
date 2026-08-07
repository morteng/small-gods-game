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

/** A uniform integer seed in [1, 0x7fffffff] — a valid world-gen seed (bootstrap
 *  requires `> 0` and finite). Prefers the platform CSPRNG; falls back to
 *  `Math.random` on hosts without `crypto`. */
export function newGameSeed(): number {
  let u = 0;
  const c = (globalThis as { crypto?: { getRandomValues?(a: Uint32Array): void } }).crypto;
  if (c && typeof c.getRandomValues === 'function') {
    const b = new Uint32Array(1);
    c.getRandomValues(b);
    u = b[0];
  } else {
    u = Math.floor(Math.random() * 0xffffffff);
  }
  return (u % 0x7fffffff) + 1;
}
