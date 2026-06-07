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

describe('heavy 3D / WebGL deps stay out of the game bundle', () => {
  it('no src file imports three or gl', () => {
    // Building art is generated text-only via PixelLab — there is no in-bundle 3D
    // renderer. three.js / headless-gl must never creep into the shipped game.
    const offenders = walk(SRC).filter(p =>
      /from\s+['"]three['"]|from\s+['"]gl['"]/.test(readFileSync(p, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
