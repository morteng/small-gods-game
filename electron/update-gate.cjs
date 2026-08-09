// Pure, dependency-free decision for the desktop auto-updater.
//
// No electron / electron-updater imports live here so the gate is trivially
// unit-testable (tests/unit/update-gate.test.ts). main.cjs feeds it runtime facts
// and acts on the returned plan; ALL side-effectful updater wiring stays in main.cjs.
//
// TWO CHANNELS, picked by the version string — which is exactly how the two
// publishing paths differ, so nothing extra has to be baked in at build time:
//
//   stable  `0.2.0`        → PUBLIC releases on the source repo (scripts/release-linux.sh).
//                            Anonymous reads work, so NO token is needed — and the
//                            private-feed token is deliberately NOT forwarded here.
//   dev     `0.2.0-dev.3`  → PRIVATE artifacts repo `morteng/small-gods-releases`
//                            (scripts/dev-build.sh), kept off the source repo so the
//                            baked read token can never reach source. A private feed is
//                            unreadable anonymously, so with no token we DISABLE the
//                            updater rather than emit 401s — dev builds cut before the
//                            PAT exists must be inert.

const FEED_OWNER = 'morteng';
const FEED_REPO = 'small-gods-releases';
const STABLE_FEED_REPO = 'small-gods-game';

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

  // A prerelease suffix (0.2.0-dev.3) marks a dev build → private feed, prereleases on.
  const isDevChannel = typeof version === 'string' && version.includes('-');

  if (isDevChannel) {
    // Private feed ⇒ a token is mandatory; without it, stay silent (no nag, no 401).
    if (!token) return { enabled: false, reason: 'no-token' };
    return {
      enabled: true,
      allowPrerelease: true,
      feed: { provider: 'github', owner: FEED_OWNER, repo: FEED_REPO, private: true, token },
    };
  }

  // Stable: the public source repo serves its own releases. No token — a read PAT
  // scoped to the private artifacts repo has no business being sent to another repo,
  // and the feed needs no auth anyway.
  return {
    enabled: true,
    allowPrerelease: false,
    feed: { provider: 'github', owner: FEED_OWNER, repo: STABLE_FEED_REPO },
  };
}

module.exports = { planAutoUpdate, FEED_OWNER, FEED_REPO, STABLE_FEED_REPO };
