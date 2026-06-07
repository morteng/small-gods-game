import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');
const ALLOWED = join(SRC, 'assetgen', 'headless'); // only place allowed to import three

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

describe('three.js stays out of the game bundle', () => {
  it('no src file outside assetgen/headless imports three', () => {
    const offenders = walk(SRC)
      .filter(p => !p.startsWith(ALLOWED))
      .filter(p => /from\s+['"]three['"]|from\s+['"]gl['"]/.test(readFileSync(p, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('no src file outside assetgen/headless imports the headless renderer', () => {
    const offenders = walk(SRC)
      .filter(p => !p.startsWith(ALLOWED))
      .filter(p => /assetgen\/headless\//.test(readFileSync(p, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
