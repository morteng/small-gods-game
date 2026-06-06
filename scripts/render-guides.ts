// scripts/render-guides.ts
/**
 * Render 3D guide images (color + depth) for every building preset into
 * tmp/guidance/, which scripts/gen-buildings.ts then sends to PixelLab as
 * init_image. Color → tmp/guidance/<preset>.png ; depth → tmp/guidance/<preset>-depth.png
 * Launches the installed Chrome once and reuses it across all presets.
 *
 *   npx tsx scripts/render-guides.ts [preset…]
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BUILDING_PRESETS, synthesizeFromPreset } from '@/world/building-presets';
import { createGuideRenderer } from '@/assetgen/headless/massing-renderer';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GUIDANCE = join(ROOT, 'tmp/guidance');

const requested = process.argv.slice(2);
const presets = requested.length ? requested : Object.keys(BUILDING_PRESETS);

await mkdir(GUIDANCE, { recursive: true });

const renderer = await createGuideRenderer();
let ok = 0;
try {
  for (const name of presets) {
    const d = synthesizeFromPreset(name);
    if (!d) { console.error(`✗ ${name}: unknown preset`); continue; }
    try {
      const { color, depth, width, height } = await renderer.render(d);
      await writeFile(join(GUIDANCE, `${name}.png`), color);
      await writeFile(join(GUIDANCE, `${name}-depth.png`), depth);
      console.log(`✓ ${name.padEnd(14)} ${width}x${height}  (color + depth)`);
      ok++;
    } catch (err) {
      console.error(`✗ ${name}: ${(err as Error).message}`);
    }
  }
} finally {
  await renderer.close();
}
console.log(`\nRendered ${ok}/${presets.length} guides → tmp/guidance/`);
