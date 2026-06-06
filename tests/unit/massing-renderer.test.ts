// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { PNG } from 'pngjs';
import { synthesizeFromPreset } from '@/world/building-presets';
import { resolveChromePath } from '@/assetgen/headless/massing-renderer';

const chromeOk = existsSync(resolveChromePath());

describe.skipIf(!chromeOk)('renderGuide (via headless Chrome)', () => {
  it('renders a color + depth PNG of the expected size for a preset', async () => {
    const { renderGuide } = await import('@/assetgen/headless/massing-renderer');
    const { color, depth, width, height } = await renderGuide(synthesizeFromPreset('cottage')!);
    expect(width).toBeGreaterThan(0);
    const cp = PNG.sync.read(color);
    expect(cp.width).toBe(width);
    expect(cp.height).toBe(height);
    let opaque = 0;
    for (let i = 3; i < cp.data.length; i += 4) if (cp.data[i] > 10) opaque++;
    expect(opaque).toBeGreaterThan(0); // the building actually drew
    expect(() => PNG.sync.read(depth)).not.toThrow();
  }, 60_000);
});
