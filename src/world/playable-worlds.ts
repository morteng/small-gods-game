// src/world/playable-worlds.ts
//
// The registry of PLAYABLE worlds (the world seeds a NEW GAME can start in).
// A playable world is a full `WorldSeed` JSON under `public/data/worlds/` with
// real society: POIs, settlements + a founding band, nobles/lords, and
// connections (contrast the no-POI `TERRAIN_GENOMES`, which are terrain-only
// shader studies and are NOT playable).
//
// This is the single place "which worlds exist to begin a game in" lives. It is
// intentionally a pure leaf (no DOM, no `Game`) so a headless test can pin the
// set and the CSPRNG picker (`new-game-seed.ts`) can index into it. Adding a
// world = add its JSON + add its canonical stem here.
//
// Canonical ids: file stem, lowercase (e.g. "default"). Codes, URLs and New
// Game carry these ids; the human display name (`WorldSeed.name`) is separate.

/** Canonical ids of the playable worlds. The code is `$0` and currently ships
 *  exactly one (the pinned default); RANDOM with a single entry is identical to
 *  today, which is EXPECTED — the variety lands as more worlds are authored
 *  (each id added here + a JSON under `public/data/worlds/`). */
export const PLAYABLE_WORLD_NAMES: readonly string[] = ['default'];

/**
 * Normalise an arbitrary token (a code's `worldSeedName`, a url, a display
 * name) to a canonical playable-world id. Unknown/empty → `'default'` (the safe
 * fallback), never throws. `'Verdant Vale'` and `'dawnwood'` both miss and fall
 * back to `default` until their id is registered here.
 */
export function resolvePlayableWorld(raw: string | undefined): string {
  const key = (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return PLAYABLE_WORLD_NAMES.includes(key) ? key : 'default';
}
