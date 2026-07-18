import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// The gate is CommonJS (loaded by electron/main.cjs, which is not an ES module),
// so pull it in via createRequire rather than an ESM import.
const require = createRequire(import.meta.url);
const { planAutoUpdate, FEED_OWNER, FEED_REPO } = require('../../electron/update-gate.cjs');

const TOKEN = 'ghp_fake_read_only_token';

describe('planAutoUpdate — desktop auto-update gate', () => {
  it('skips unpackaged builds (dev preview)', () => {
    const plan = planAutoUpdate({
      isPackaged: false,
      platform: 'linux',
      isAppImage: true,
      version: '0.1.0-dev.0',
      token: TOKEN,
    });
    expect(plan).toEqual({ enabled: false, reason: 'not-self-updatable' });
  });

  it('skips darwin even when packaged + tokened (unsigned → no Squirrel.Mac)', () => {
    const plan = planAutoUpdate({
      isPackaged: true,
      platform: 'darwin',
      isAppImage: false,
      version: '0.1.0-dev.0',
      token: TOKEN,
    });
    expect(plan).toEqual({ enabled: false, reason: 'not-self-updatable' });
  });

  it('skips linux when not running as an AppImage', () => {
    const plan = planAutoUpdate({
      isPackaged: true,
      platform: 'linux',
      isAppImage: false,
      version: '0.1.0-dev.0',
      token: TOKEN,
    });
    expect(plan).toEqual({ enabled: false, reason: 'not-self-updatable' });
  });

  it('skips (no-token) a self-updatable AppImage without a baked token', () => {
    const plan = planAutoUpdate({
      isPackaged: true,
      platform: 'linux',
      isAppImage: true,
      version: '0.1.0-dev.0',
      token: null,
    });
    expect(plan).toEqual({ enabled: false, reason: 'no-token' });
  });

  it('treats an empty-string token as no token', () => {
    const plan = planAutoUpdate({
      isPackaged: true,
      platform: 'win32',
      isAppImage: false,
      version: '0.1.0-dev.0',
      token: '',
    });
    expect(plan).toEqual({ enabled: false, reason: 'no-token' });
  });

  it('enables a tokened AppImage with a private feed to the releases repo', () => {
    const plan = planAutoUpdate({
      isPackaged: true,
      platform: 'linux',
      isAppImage: true,
      version: '0.2.0-dev.3',
      token: TOKEN,
    });
    expect(plan.enabled).toBe(true);
    expect(plan.feed).toEqual({
      provider: 'github',
      owner: FEED_OWNER,
      repo: FEED_REPO,
      private: true,
      token: TOKEN,
    });
    expect(FEED_REPO).toBe('small-gods-releases');
  });

  it('enables a tokened Windows NSIS build', () => {
    const plan = planAutoUpdate({
      isPackaged: true,
      platform: 'win32',
      isAppImage: false,
      version: '0.2.0-dev.3',
      token: TOKEN,
    });
    expect(plan.enabled).toBe(true);
    expect(plan.feed.private).toBe(true);
  });

  it('follows the dev channel only when the version has a prerelease suffix', () => {
    const dev = planAutoUpdate({
      isPackaged: true, platform: 'linux', isAppImage: true, version: '0.2.0-dev.3', token: TOKEN,
    });
    const stable = planAutoUpdate({
      isPackaged: true, platform: 'linux', isAppImage: true, version: '0.2.0', token: TOKEN,
    });
    expect(dev.allowPrerelease).toBe(true);
    expect(stable.allowPrerelease).toBe(false);
  });

  it('never leaks a token value into a disabled plan', () => {
    const plan = planAutoUpdate({
      isPackaged: true, platform: 'linux', isAppImage: true, version: '0.1.0', token: TOKEN,
    });
    // A disabled plan (here: linux not-an-AppImage would enable; force disable via
    // darwin) must carry no feed/token. Use a genuinely disabled case:
    const disabled = planAutoUpdate({
      isPackaged: true, platform: 'darwin', isAppImage: false, version: '0.1.0', token: TOKEN,
    });
    expect(JSON.stringify(disabled)).not.toContain(TOKEN);
    // And a no-token AppImage stays disabled with no feed object at all.
    expect('feed' in plan ? plan.feed : null).toBeTruthy(); // sanity: the tokened AppImage IS enabled
  });
});
