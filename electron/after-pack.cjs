// electron-builder afterPack hook — bakes the private update-feed read token into
// the PACKAGED app only. The source tree and git never hold it.
//
// Reads SG_RELEASES_READ_PAT from the build env. If unset, does nothing (the
// committed electron/update-token.cjs stub returns null ⇒ updater skipped). The
// stub is kept OUT of app.asar via build.asarUnpack, so we can overwrite the copy
// that actually ships (resources/app.asar.unpacked/electron/update-token.cjs);
// require('./update-token.cjs') from main.cjs (inside the asar) transparently
// resolves to that unpacked file at runtime.
//
// darwin is skipped: it never self-updates (unsigned → no Squirrel.Mac), so there
// is no reason to ship the token to mac testers.

const path = require('node:path');
const fs = require('node:fs');

exports.default = async function afterPack(context) {
  const token = process.env.SG_RELEASES_READ_PAT;
  if (!token) {
    console.log('[after-pack] SG_RELEASES_READ_PAT unset — shipping without an update token (updater will be skipped).');
    return;
  }
  if (context.electronPlatformName === 'darwin') {
    console.log('[after-pack] darwin does not self-update — not baking the update token.');
    return;
  }

  const resourcesDir = context.packager.getResourcesDir(context.appOutDir);
  const target = path.join(resourcesDir, 'app.asar.unpacked', 'electron', 'update-token.cjs');
  const body =
    '// GENERATED AT PACKAGE TIME by electron/after-pack.cjs — do not commit.\n' +
    'module.exports = { resolveUpdateToken: () => ' + JSON.stringify(token) + ' };\n';

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body, { mode: 0o600 });
  console.log('[after-pack] baked update token into', path.relative(context.appOutDir, target));
};
