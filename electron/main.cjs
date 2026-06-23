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

const { app, BrowserWindow, protocol, net, shell } = require('electron');
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
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  // External links open in the user's browser, not a stray app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // SG_DEV_URL=http://localhost:3000 → live dev server (still real WebGPU via Electron's
  // Chromium, handy on a no-WebGPU host). Otherwise serve the packaged build.
  const devUrl = process.env.SG_DEV_URL;
  if (devUrl) {
    win.loadURL(devUrl);
    win.webContents.openDevTools();
  } else {
    win.loadURL('app://sg/index.html');
  }
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
