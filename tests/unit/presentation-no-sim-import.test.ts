import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

/**
 * The presentation layer is a one-way observer of sim truth (design doc §2): it
 * reads GameState but the SIM must never depend on it. If src/sim or src/core
 * imported src/presentation, presentation logic could sneak onto the
 * deterministic/replayable path. Guard against that direction of dependency.
 */
describe('presentation stays off the sim path', () => {
  it('no src/sim or src/core file imports src/presentation', () => {
    const dirs = [join(SRC, 'sim'), join(SRC, 'core')];
    const offenders: string[] = [];
    for (const dir of dirs) {
      for (const p of walk(dir)) {
        if (/from\s+['"]@\/presentation\/|from\s+['"]\.\.?\/.*presentation/.test(readFileSync(p, 'utf8'))) {
          offenders.push(p);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the presentation modules import no sim mutators', () => {
    // Reading state is fine; importing things that advance/mutate the sim is not.
    const banned = /from\s+['"]@\/(sim\/systems|core\/scheduler|core\/snapshot|core\/timeline)['"]/;
    const offenders = walk(join(SRC, 'presentation')).filter((p) => banned.test(readFileSync(p, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
