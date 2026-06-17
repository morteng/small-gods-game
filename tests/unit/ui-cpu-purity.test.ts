import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const UI_DIR = join(ROOT, 'src', 'render', 'ui');

// The UI layer splits into pure-CPU modules (batcher/context/palette/colour/fonts
// — Node-testable, no device) and a thin WebGPU edge (`ui-pass.ts`, `ui-layer.ts`,
// and `wgsl/`). The CPU modules must stay device-free so the bulk of the UI is
// unit-testable and the WebGPU surface is isolated to those two files.
const GPU_EDGE = new Set(['ui-pass.ts', 'ui-layer.ts']);

function tsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'wgsl' ? [] : tsFiles(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

describe('UI CPU modules are device-free', () => {
  it('no GPU* / navigator.gpu / createShaderModule outside the WebGPU edge', () => {
    const offenders = tsFiles(UI_DIR)
      .filter((p) => !GPU_EDGE.has(p.split('/').pop()!))
      .filter((p) => /\bGPU[A-Z]\w*|navigator\.gpu|createShaderModule|createRenderPipeline/.test(readFileSync(p, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
