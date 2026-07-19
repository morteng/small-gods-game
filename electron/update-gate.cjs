// Pure, dependency-free decision for the desktop auto-updater.
//
// No electron / electron-updater imports live here so the gate is trivially
// unit-testable (tests/unit/update-gate.test.ts). main.cjs feeds it runtime facts
// and acts on the returned plan; ALL side-effectful updater wiring stays in main.cjs.
//
// Feed lives in the SEPARATE private artifacts repo `morteng/small-gods-releases`
// (not the source repo) so the baked read token can never reach source. A private
// feed is unreadable anonymously, so with no token we deliberately DISABLE the
// updater rather than emit 401s — dev builds cut before the PAT exists must be inert.

const FEED_OWNER = 'morteng';
const FEED_REPO = 'small-gods-releases';

/**
 * Decide whether/how the packaged app should self-update.
 * @param {object} f runtime facts
 * @param {boolean} f.isPackaged   app.isPackaged
 * @param {string}  f.platform     process.platform ('linux' | 'win32' | 'darwin' | ...)
 * @param {boolean} f.isAppImage   truthy process.env.APPIMAGE (Linux self-update marker)
 * @param {string}  f.version      app.getVersion() — prerelease suffix ⇒ follow dev channel
 * @param {string|null} f.token    baked read PAT, or null/'' when none
 * @returns {{enabled:false,reason:string} | {enabled:true,allowPrerelease:boolean,feed:object}}
 */
function planAutoUpdate(f) {
  const { isPackaged, platform, isAppImage, version, token } = f || {};

  // Only a packaged, in-place-updatable target self-updates: a Linux AppImage
  // (APPIMAGE set) or a Windows NSIS install. darwin is unsigned → Squirrel.Mac
  // can't run → manual updates. Unpackaged previews never update.
  const selfUpdatable =
    !!isPackaged &&
    (platform === 'linux' ? !!isAppImage : platform === 'win32');
  if (!selfUpdatable) return { enabled: false, reason: 'not-self-updatable' };

  // Private feed ⇒ a token is mandatory; without it, stay silent (no nag, no 401).
  if (!token) return { enabled: false, reason: 'no-token' };

  return {
    enabled: true,
    // Dev-tagged builds (version has a prerelease suffix, e.g. 0.2.0-dev.3) follow
    // dev prereleases; stable builds ignore them.
    allowPrerelease: typeof version === 'string' && version.includes('-'),
    feed: { provider: 'github', owner: FEED_OWNER, repo: FEED_REPO, private: true, token },
  };
}

module.exports = { planAutoUpdate, FEED_OWNER, FEED_REPO };
