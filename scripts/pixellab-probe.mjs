// Standalone probe that runs a prompt through the SAME PixelLab pipeline the
// game uses (src/services/pixellab.ts buildRequestBody → create-image-pixflux),
// then writes the returned PNG to disk so we can eyeball the result.
//
// Usage:
//   PIXELLAB_API_KEY=sk-... node scripts/pixellab-probe.mjs "a small round green bush" bush
//   PIXELLAB_API_KEY=sk-... node scripts/pixellab-probe.mjs "a leafy oak tree"        tree
//
// Mirrors the project recipe baked into every real call.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const API_BASE = 'https://api.pixellab.ai/v2';
const PALETTE_PATH = join(ROOT, 'public/sprites/palette/lpc-anchor.png');

// Same frozen recipe as STYLE_RECIPE in src/services/pixellab.ts
const STYLE_RECIPE = {
  outline: 'single color black outline',
  shading: 'basic shading',
  detail: 'medium detail',
};

const apiKey = process.env.PIXELLAB_API_KEY;
const prompt = process.argv[2] ?? 'a small round green bush';
const label = process.argv[3] ?? 'sprite';
const size = Number(process.argv[4] ?? 32); // decorations are 32×32 in-game

if (!apiKey) {
  console.error('Set PIXELLAB_API_KEY in the environment first.');
  process.exit(1);
}

const paletteB64 = (await readFile(PALETTE_PATH)).toString('base64');

const body = {
  description: prompt,
  image_size: { width: size, height: size },
  no_background: true,
  outline: STYLE_RECIPE.outline,
  shading: STYLE_RECIPE.shading,
  detail: STYLE_RECIPE.detail,
  color_image: { type: 'base64', base64: paletteB64, format: 'png' },
  seed: 0,
};

console.log(`→ ${API_BASE}/create-image-pixflux`);
console.log(`  prompt: "${prompt}"  size: ${size}×${size}`);

const t0 = Date.now();
const res = await fetch(`${API_BASE}/create-image-pixflux`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
});

if (!res.ok) {
  const text = await res.text().catch(() => '');
  console.error(`generate failed: HTTP ${res.status} ${text}`.trim());
  process.exit(1);
}

const json = await res.json();
const b64 = json?.image?.base64;
if (!b64) {
  console.error('missing image.base64 in response:', JSON.stringify(json).slice(0, 400));
  process.exit(1);
}

const outDir = join(ROOT, 'tmp/pixellab-probe');
await mkdir(outDir, { recursive: true });
const outPath = join(outDir, `${label}-${size}.png`);
await writeFile(outPath, Buffer.from(b64, 'base64'));

console.log(`✓ ${Date.now() - t0}ms · wrote ${outPath} (${Buffer.from(b64, 'base64').length} bytes)`);
if (json.usage) console.log('  usage:', JSON.stringify(json.usage));
