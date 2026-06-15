import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

// The renderer is WebGPU-only. The legacy PixiJS WebGL entity layer was removed
// in the WebGPU-only cut, so pixi.js is no longer a dependency at all. These
// guards stop it from creeping back in.
describe('pixi.js is fully removed (WebGPU-only renderer)', () => {
  it('no src file imports pixi.js (static OR dynamic)', () => {
    const offenders = walk(SRC).filter(p => {
      const text = readFileSync(p, 'utf8');
      // `import ... from 'pixi.js'`, `import('pixi.js')`, `require('pixi.js')`.
      return /from\s+['"]pixi\.js['"]|import\(\s*['"]pixi\.js['"]\s*\)|require\(\s*['"]pixi\.js['"]\s*\)/.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it('pixi.js is not a declared dependency', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.['pixi.js']).toBeUndefined();
    expect(pkg.devDependencies?.['pixi.js']).toBeUndefined();
  });
});
