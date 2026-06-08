// tests/unit/no-building-descriptor.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('BuildingDescriptor is fully retired', () => {
  it('no src file imports building-descriptor / building-spec / building-presets or descriptorToSpec', () => {
    const offenders: string[] = [];
    for (const f of walk('src')) {
      const t = readFileSync(f, 'utf8');
      if (/building-descriptor|iso\/building-spec|world\/building-presets|descriptorToSpec|BuildingDescriptor/.test(t)) offenders.push(f);
    }
    expect(offenders, `still referencing the retired descriptor:\n${offenders.join('\n')}`).toEqual([]);
  });
});
