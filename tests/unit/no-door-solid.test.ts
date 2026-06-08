// tests/unit/no-door-solid.test.ts
// Guards the clean cut: the additive proud-box door path is gone. Doors are carved
// openings (Blueprint layer), never an assetgen doorSolid.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('no doorSolid / proud-box door path', () => {
  it('no src file references doorSolid, DoorFeature, ResolvedDoor, or placeDoors', () => {
    const offenders: string[] = [];
    for (const f of walk('src')) {
      const src = readFileSync(f, 'utf8');
      if (/\b(doorSolid|DoorFeature|ResolvedDoor|placeDoors)\b/.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
