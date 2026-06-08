// tests/unit/no-massing-renderer.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('massing renderer is fully retired', () => {
  it('no source file references drawIsoBuildingMassing or massing-guidance', () => {
    const offenders = walk('src').filter(p => {
      const src = readFileSync(p, 'utf8');
      return src.includes('drawIsoBuildingMassing') || src.includes('massing-guidance');
    });
    expect(offenders).toEqual([]);
  });
});
