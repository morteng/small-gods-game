// Build-time token seam for the private update feed.
//
// COMMITTED STATE (this file): returns null — the source tree and git NEVER hold a
// token. At PACKAGE time electron/after-pack.cjs overwrites the UNPACKED copy of
// THIS file (kept out of app.asar via build.asarUnpack) with one that returns the
// real SG_RELEASES_READ_PAT — only inside the shipped app, only when that env var
// was set at build time. No token baked ⇒ this returns null ⇒ the updater is
// skipped silently (see electron/update-gate.cjs + initAutoUpdate in main.cjs).
module.exports = { resolveUpdateToken: () => null };
