import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function listFilesRec(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) listFilesRec(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('determinism guard', () => {
  it('no Math.random() in src/sim/ — use ctx.rng', () => {
    const files = listFilesRec('src/sim');
    const offenders = files.filter(f => /Math\.random\s*\(/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
