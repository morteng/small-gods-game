import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

describe('pixi.js stays out of the main bundle chunk', () => {
  it('no src file STATICALLY imports pixi.js (dynamic import + import type only)', () => {
    // The WebGL entity layer loads pixi.js lazily (`await import('pixi.js')`)
    // so the ~450 kB dependency lives in its own Vite chunk, fetched only when
    // the layer initializes. `import type` is erased at compile time and is
    // fine; a static value import would drag pixi into the entry chunk.
    const offenders = walk(SRC).filter(p => {
      const text = readFileSync(p, 'utf8');
      // import ... from 'pixi.js' — but not `import type`.
      return /import\s+(?!type\b)[^;]*from\s+['"]pixi\.js['"]/.test(text);
    });
    expect(offenders).toEqual([]);
  });
});
