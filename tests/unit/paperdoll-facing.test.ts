import { describe, expect, it } from 'vitest';
import { HUMANOID_FACINGS } from '@/render/paperdoll/facing';
import { LPC_HUMANOID_SOUTH } from '@/render/paperdoll/lpc-humanoid';
import { LPC_HUMANOID_NORTH } from '@/render/paperdoll/lpc-humanoid-north';
import { LPC_HUMANOID_WEST } from '@/render/paperdoll/lpc-humanoid-west';

describe('HUMANOID_FACINGS', () => {
  it('covers all four directions with the right templates and sheet rows', () => {
    expect(HUMANOID_FACINGS.down).toEqual({ template: LPC_HUMANOID_SOUTH, mirror: false, sheetRow: 2 });
    expect(HUMANOID_FACINGS.up).toEqual({ template: LPC_HUMANOID_NORTH, mirror: false, sheetRow: 0 });
    expect(HUMANOID_FACINGS.left).toEqual({ template: LPC_HUMANOID_WEST, mirror: false, sheetRow: 1 });
    expect(HUMANOID_FACINGS.right).toEqual({ template: LPC_HUMANOID_WEST, mirror: true, sheetRow: 1 });
  });

  it('east is the only mirrored facing (one authored profile vocabulary)', () => {
    const mirrored = Object.entries(HUMANOID_FACINGS).filter(([, f]) => f.mirror);
    expect(mirrored.map(([d]) => d)).toEqual(['right']);
    expect(HUMANOID_FACINGS.right.template).toBe(HUMANOID_FACINGS.left.template);
  });

  it('south and north share a clip vocabulary; west does not', () => {
    const names = (t: { chips: { name: string }[] }): string[] => t.chips.map((c) => c.name);
    expect(names(LPC_HUMANOID_NORTH)).toEqual(names(LPC_HUMANOID_SOUTH));
    expect(names(LPC_HUMANOID_WEST)).not.toEqual(names(LPC_HUMANOID_SOUTH));
  });
});
