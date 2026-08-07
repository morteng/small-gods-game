// src/game/world-code.ts
//
// The world-code codec (UI v3 P5b — seed share). A short, human-typeable
// string that encodes `{ genSeed, worldSeedName, contentVersion }` so a player
// can hand another player (or their future self) an exact world to regenerate.
// Deliberately NOT a save — no sim state travels, only what a fresh
// `new_game { genSeed }` needs to reproduce the SAME generated map from the
// SAME `WorldSeed`.
//
// Pure + dependency-free (no DOM, no `Game`) so it is trivially unit-testable
// and importable from both the shell screen and `Game`'s meta-command handler.
//
// Decoding refuses (never silently regenerates something ELSE) when the code
// was minted under a different `WORLD_CONTENT_VERSION` — the exact honesty
// rule the save-slot staleness check already applies to saves (spec §5.2):
// worldgen is content-version-sensitive, so opening a code from an older build
// would quietly hand the player a different world than the one the code names.

/** What a world code identifies. `worldSeedName` is the canonical playable-world
 *  id (file stem, e.g. "default"), and is now FORWARDED to `new_game` so a
 *  pasted code regenerates the SAME world it names (not the demo) — see
 *  `Game.onWorldCodeSubmit` → `newWorld`'s `worldSeedName`. `resolvePlayableWorld`
 *  normalises any older display-name/id the code might carry. */
export interface WorldCode {
  genSeed: number;
  worldSeedName: string;
  contentVersion: number;
}

const FIELD_SEP = '.';

/**
 * Encode `{genSeed, worldSeedName, contentVersion}` as a short, uppercase,
 * base36 string (e.g. `"3TX.DEFAULT.3A"`). `genSeed`/`contentVersion` ride as
 * base36 integers; `worldSeedName` rides VERBATIM — it is already a short
 * identifier (e.g. "default", "woodland"), never itself base36'd, so the code
 * stays legible about which world it names.
 */
export function encodeWorldCode(code: WorldCode): string {
  const seed36 = Math.max(0, Math.floor(code.genSeed)).toString(36);
  const cv36 = Math.max(0, Math.floor(code.contentVersion)).toString(36);
  return [seed36, code.worldSeedName, cv36].join(FIELD_SEP).toUpperCase();
}

export type DecodeResult =
  | { ok: true; code: WorldCode }
  | { ok: false; reason: 'malformed' | 'version-mismatch'; message: string };

/**
 * Decode a world code produced by `encodeWorldCode`. Refuses — never guesses —
 * on anything malformed (wrong shape, non-numeric fields), and refuses with an
 * HONEST, already-interpolated message when the code's `contentVersion`
 * doesn't match `currentContentVersion`: the same "shown and refused, never
 * silently regenerated over" rule the stale-save check applies (spec §5.2).
 *
 * The caller (`Game`'s new-game paste flow) is expected to pass
 * `WORLD_CONTENT_VERSION` for `currentContentVersion` — kept as a parameter
 * rather than importing the constant here so this module stays a pure,
 * dependency-free leaf (easy to unit test, easy to reuse anywhere a version
 * check is meaningful, e.g. a future non-browser tool).
 */
export function decodeWorldCode(raw: string, currentContentVersion: number): DecodeResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: 'malformed', message: 'ENTER A WORLD CODE.' };
  const parts = trimmed.toLowerCase().split(FIELD_SEP);
  if (parts.length !== 3) {
    return { ok: false, reason: 'malformed', message: 'THAT DOES NOT LOOK LIKE A WORLD CODE.' };
  }
  const [seedPart, namePart, cvPart] = parts;
  const genSeed = parseInt(seedPart, 36);
  const contentVersion = parseInt(cvPart, 36);
  if (!namePart || !Number.isFinite(genSeed) || genSeed < 0 || !Number.isFinite(contentVersion) || contentVersion < 0) {
    return { ok: false, reason: 'malformed', message: 'THAT DOES NOT LOOK LIKE A WORLD CODE.' };
  }
  if (contentVersion !== currentContentVersion) {
    return {
      ok: false,
      reason: 'version-mismatch',
      message: `THAT CODE IS FOR AN OLDER WORLD (CONTENT ${contentVersion}; THIS BUILD IS ${currentContentVersion}).`,
    };
  }
  return { ok: true, code: { genSeed, worldSeedName: namePart, contentVersion } };
}
