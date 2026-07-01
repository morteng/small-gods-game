// scripts/dev-gallery.ts
// Build a simple web gallery of every PNG in .dev-grabs/ so offline renders (barrier previews,
// building previews, __debug grabs) can be eyeballed in a browser instead of opened one by one.
// Writes .dev-grabs/index.html (newest-first, filename + size + mtime, click to open full-size,
// auto-refreshes every few seconds so re-running a preview shows up live).
//
//   npm run gallery                       # (re)build the gallery
//   npm run gallery:serve                 # build + serve on http://localhost:8848
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = '.dev-grabs';

function main(): void {
  let files: string[] = [];
  try { files = readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.png')); }
  catch { console.error(`no ${DIR}/ directory yet — run a preview first`); process.exit(1); }

  const items = files
    .map((f) => ({ f, m: statSync(join(DIR, f)).mtimeMs, s: statSync(join(DIR, f)).size }))
    .sort((a, b) => b.m - a.m);

  const cards = items.map(({ f, m, s }) => `
    <figure>
      <a href="${f}" target="_blank"><img src="${f}" loading="lazy" alt="${f}"></a>
      <figcaption><b>${f}</b><span>${(s / 1024).toFixed(0)} KB · ${new Date(m).toLocaleTimeString()}</span></figcaption>
    </figure>`).join('');

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Small Gods · dev renders</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #14161c; color: #cfd3dc; font: 14px/1.4 ui-monospace, monospace; }
  header { position: sticky; top: 0; background: #1c1f28; padding: 10px 16px; border-bottom: 1px solid #2a2e3a; display: flex; gap: 16px; align-items: baseline; }
  header h1 { font-size: 15px; margin: 0; color: #fff; }
  header span { color: #7f8696; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; padding: 16px; }
  figure { margin: 0; background: #1c1f28; border: 1px solid #2a2e3a; border-radius: 8px; overflow: hidden; }
  figure img { width: 100%; display: block; background:
      repeating-conic-gradient(#22252f 0% 25%, #191c24 0% 50%) 50% / 22px 22px; cursor: zoom-in; }
  figcaption { padding: 8px 10px; display: flex; justify-content: space-between; gap: 10px; }
  figcaption b { color: #e7eaf0; word-break: break-all; }
  figcaption span { color: #7f8696; white-space: nowrap; }
</style></head><body>
<header><h1>Small Gods · dev renders</h1><span>${items.length} image(s) in ${DIR}/ · newest first · auto-refresh 4s</span></header>
<div class="grid">${cards || '<p style="padding:16px">no PNGs yet</p>'}</div>
<script>setTimeout(() => location.reload(), 4000);</script>
</body></html>`;

  writeFileSync(join(DIR, 'index.html'), html);
  console.log(`gallery → ${join(DIR, 'index.html')} (${items.length} image(s))`);
}

main();
