// tests/unit/assetgen-no-random.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function listTs(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) listTs(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('assetgen determinism guard', () => {
  it('no Math.random() in src/assetgen — seed all jitter via createRng', () => {
    const offenders = listTs('src/assetgen').filter(f => /Math\.random\s*\(/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
