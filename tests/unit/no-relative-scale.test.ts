import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import * as sc from '@/render/scale-contract';

describe('no relative-scale regressions', () => {
  it('deprecated relative-scale constants are gone', () => {
    expect((sc as Record<string, unknown>).DOOR_HEIGHT_UNITS).toBeUndefined();
    expect((sc as Record<string, unknown>).HUMAN_HEIGHT_UNITS).toBeUndefined();
  });
  it('scale-contract source defines the metric anchors', () => {
    const src = readFileSync('src/render/scale-contract.ts', 'utf8');
    expect(src).toMatch(/PX_PER_METRE/);
    expect(src).toMatch(/METRES_PER_TILE/);
  });
  it('no src file references a *_UNITS relative-scale constant', () => {
    const hits = execSync(
      "git grep -nE 'DOOR_HEIGHT_UNITS|HUMAN_HEIGHT_UNITS' -- 'src/*' || true",
      { encoding: 'utf8' },
    ).trim();
    expect(hits).toBe('');
  });
});
