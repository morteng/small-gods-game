// Small Gods — Electron desktop shell.
//
// WHY Electron (not the src-tauri/ scaffold): Tauri reuses the *system* webview
// (webkit2gtk on Linux), which does not ship WebGPU on stock distros — so it can't
// help the exact users we target (those without WebGPU). Electron bundles its own
// Chromium + Dawn, guaranteeing a modern WebGPU runtime regardless of the host.
//
// The renderer loads the normal web build (dist/) — same code as GitHub Pages — over
// a privileged `app://` origin. We can't use file:// because Chromium blocks fetch()
// on file URLs, and the game fetches world JSON + asset manifests at runtime.

const { app, BrowserWindow, protocol, net, shell, dialog } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// In a packaged build __dirname is .../resources/app.asar/electron, so dist/ sits
// one level up; the same relative layout holds when run unpacked (`electron .`).
const DIST = path.join(__dirname, '..', 'dist');

// A standard, secure scheme gives the page a stable origin against which the build's
// absolute BASE_URL ('/') resolves — and one that supports fetch().
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#1a1a2e',
    title: 'Small Gods',
    // sandbox: renderer runs with no Node primitives (no preload needs them). With
    // contextIsolation + nodeIntegration off this is belt-and-suspenders, but explicit.
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  // External links open in the user's browser, not a stray app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Navigation lock: the window only ever shows our own bundle (app://) or the dev
  // server. A bug or hostile content can't steer the top frame to an arbitrary site —
  // off-origin nav is cancelled and (if http/https) handed to the system browser.
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = process.env.SG_DEV_URL || 'app://';
    if (url.startsWith(allowed)) return;
    event.preventDefault();
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url);
  });

  // SG_DEV_URL=http://localhost:3000 → live dev server (still real WebGPU via Electron's
  // Chromium, handy on a no-WebGPU host). Otherwise serve the packaged build.
  const devUrl = process.env.SG_DEV_URL;
  if (devUrl) {
    win.loadURL(devUrl);
    win.webContents.openDevTools();
  } else {
    win.loadURL('app://sg/index.html');
    initAutoUpdate(win);
  }
}

// Self-update for direct downloads (itch-app installs are updated by itch itself, so
// this is a no-op there — both can coexist). electron-updater reads the feed baked in
// from build.publish (GitHub Releases). Only meaningful in a packaged, self-updatable
// build:
//   - Linux: only the AppImage target is self-updatable (needs process.env.APPIMAGE).
//   - Windows: the NSIS installer is self-updatable.
//   - macOS: Squirrel.Mac requires a *signed* app, and dev builds are unsigned (no cert)
//     — so darwin is deliberately skipped and gets manual updates (download the new dmg).
function initAutoUpdate(win) {
  const selfUpdatable =
    app.isPackaged &&
    (process.platform === 'linux' ? !!process.env.APPIMAGE : process.platform === 'win32');
  if (!selfUpdatable) return; // includes darwin (unsigned → no Squirrel.Mac) and unpackaged previews
  const { autoUpdater } = require('electron-updater');
  // Dev-tagged builds (version has a prerelease suffix, e.g. 0.2.0-dev.3) follow dev
  // prereleases; stable builds ignore them.
  autoUpdater.allowPrerelease = app.getVersion().includes('-');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', async (info) => {
    // Never swap the bundle out from under the player silently — ask, then restart.
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: `Small Gods ${info.version} is ready.`,
      detail: 'Restart to apply it — your world is autosaved.',
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  // A dead feed (offline, repo gone private, first release not cut yet) must never
  // break launch — log and move on.
  autoUpdater.on('error', (err) => {
    console.error('[auto-update]', err == null ? 'unknown error' : (err.stack || err).toString());
  });

  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error('[auto-update] check failed', err);
  });
}

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url); // app://sg/<path>
    let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
    if (rel === '') rel = 'index.html';
    const filePath = path.join(DIST, rel);
    // Contain within DIST — no path traversal out of the bundle.
    if (filePath !== DIST && !filePath.startsWith(DIST + path.sep)) {
      return new Response('forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
