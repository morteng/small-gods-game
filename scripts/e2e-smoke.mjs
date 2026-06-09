/**
 * e2e-smoke — drive the running dev game (:3000) with Playwright and capture the
 * live canvas. A standard part of the dev loop: render the world, inventory what
 * worldgen produced, and grab per-building close-ups to eyeball geometry.
 *
 *   npm run dev                       # in one terminal (port 3000)
 *   node scripts/e2e-smoke.mjs        # headless, writes PNGs to tmp/e2e/
 *   HEADED=1 node scripts/e2e-smoke.mjs
 *
 * KEY LESSONS baked in (see memory feedback-playwright-in-dev-loop):
 *  - Capture via __game.canvas.toDataURL — Playwright page.screenshot() STALLS
 *    on the continuous-rAF canvas in headed mode.
 *  - Delete IndexedDB + reload to force a fresh world (autosave restores otherwise).
 *  - Modest viewport (1280x800, DPR 1). Big/DPR2 windows are unwieldy and slow.
 *  - Drive the camera by setting __game.state.camera.{x,y,zoom} (iso math inline).
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = process.env.OUT || 'tmp/e2e';
const URL = process.env.URL || 'http://localhost:3000';
const HEADED = process.env.HEADED === '1';
const KINDS = (process.env.KINDS || 'cottage,longhouse,yurt,castle_keep,tower,shrine,temple_small,farm_barn,market_stall,tavern,guard_post').split(',');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: !HEADED });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('dialog', d => d.accept());
page.on('pageerror', e => console.log('PAGEERR:', e.message));

await page.goto(URL, { waitUntil: 'load' });
await page.evaluate(async () => {
  const dbs = (await indexedDB.databases?.()) || [];
  await Promise.all(dbs.map(d => d.name && new Promise(r => { const x = indexedDB.deleteDatabase(d.name); x.onsuccess = x.onerror = () => r(); })));
});
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.state?.world && window.__game.state.world.query({ tag: 'building' }).length > 0, { timeout: 40000 });

const inv = await page.evaluate(() => {
  const w = window.__game.state.world, b = w.query({ tag: 'building' }), byKind = {};
  for (const e of b) (byKind[e.kind] ||= 0), byKind[e.kind]++;
  return { world: window.__game.state.worldSeed?.name, buildings: b.length, byKind, veg: w.query({ tag: 'vegetation' }).length };
});
console.log('INVENTORY:', JSON.stringify(inv, null, 2));

const grab = async (name) => {
  await page.waitForTimeout(400);
  const url = await page.evaluate(() => window.__game.canvas.toDataURL('image/png'));
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
  console.log('  shot', name);
};

// Overview.
await page.evaluate(() => {
  const g = window.__game, c = g.state.camera, vw = g.container.clientWidth, vh = g.container.clientHeight;
  c.zoom = 0.125;
  const tx = g.state.map.width / 2, ty = g.state.map.height / 2;
  c.x = (tx - ty) * 64 - vw / (2 * c.zoom); c.y = (tx + ty) * 32 - vh / (2 * c.zoom);
});
await grab('00-overview');

for (const kind of KINDS) {
  const ok = await page.evaluate(({ kind }) => {
    const g = window.__game, e = g.state.world.query({ kind })[0];
    if (!e) return false;
    const c = g.state.camera, vw = g.container.clientWidth, vh = g.container.clientHeight;
    c.zoom = 4;
    const tx = e.x + 0.5, ty = e.y + 0.5;
    c.x = (tx - ty) * 64 - vw / (2 * c.zoom); c.y = (tx + ty) * 32 - vh / (2 * c.zoom);
    return true;
  }, { kind });
  if (ok) await grab(`bld-${kind}`); else console.log('  (none)', kind);
}

if (!HEADED) await browser.close();
else console.log('HEADED — browser left open; Ctrl-C to close.');
console.log('DONE —', OUT);
