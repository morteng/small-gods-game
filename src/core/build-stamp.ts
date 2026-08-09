// src/core/build-stamp.ts
//
// Build identity, baked in by Vite `define` (see vite.config.ts).
//
// A LEAF module: it imports nothing, so any screen can read the version without
// dragging a UI island (or its transitive render deps) along with it. It lives
// here because the desktop artifact no longer carries the version in its
// FILENAME — the AppImage is `small-gods-x86_64.AppImage` at every version so
// self-update overwrites one file instead of littering the download folder with
// one executable per release — which makes the in-app stamp the only place a
// player can see which build they are running. Keep it cheap and importable.
//
// Guarded with `typeof` so the module stays importable under vitest, which does
// not apply the Vite define.

/** Package version, e.g. `0.1.2`. `dev` when not built by Vite. */
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

/** Short git sha of the built commit, e.g. `9dfac135`. `unknown` outside a build. */
export const GIT_SHA = typeof __GIT_SHA__ !== 'undefined' ? __GIT_SHA__ : 'unknown';

/** Full stamp for the settings footer, e.g. `v0.1.2 (9dfac135)`. */
export function buildStamp(): string {
  return `v${APP_VERSION} (${GIT_SHA})`;
}

/**
 * Short stamp for the WebGPU screens, e.g. `V0.1.2`.
 *
 * UPPERCASE deliberately: the UI pixel font's atlas is `A-Z`, `0-9` and a fixed
 * punctuation set (`RENDERABLE_GLYPHS` in `ui-runtime.ts`) — it has no lowercase
 * glyphs at all, so a lowercase `v` draws as a blank/garbled cell. Learned by
 * rendering it. Use `buildStamp()` for DOM surfaces, which have a real font.
 */
export function versionStamp(): string {
  return `V${APP_VERSION}`.toUpperCase();
}
