import { describe, it, expect } from 'vitest';
import { CatalogueRegistry } from '@/catalogue/registry';
import { validate, type Constraint } from '@/catalogue/constraints';

interface Target {
  egress: string;
  era: string;
  roof: string;
}

const chimneyGate: Constraint<Target> = {
  id: 'chimney-era-gate',
  severity: 'warn',
  check: (t) => !(t.egress === 'wall-chimney' && ['ancient', 'classical'].includes(t.era)),
  message: 'chimney is anachronistic before the late medieval period',
  autoCorrect: (t) => ({ ...t, egress: 'louver' }),
};

const flatThatch: Constraint<Target> = {
  id: 'thatch-needs-pitch',
  severity: 'error',
  check: (t) => t.roof !== 'flat',
  message: 'thatch cannot cap a flat roof',
};

describe('constraint engine', () => {
  const reg = new CatalogueRegistry();

  it('a passing target yields no issues', () => {
    const t: Target = { egress: 'louver', era: 'medieval', roof: 'pitched' };
    expect(validate(t, [chimneyGate, flatThatch], reg).issues).toEqual([]);
  });

  it('an error constraint reports severity error', () => {
    const t: Target = { egress: 'louver', era: 'medieval', roof: 'flat' };
    const { issues } = validate(t, [flatThatch], reg);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].constraintId).toBe('thatch-needs-pitch');
  });

  it('a warn constraint reports the issue and applies autoCorrect when apply:true', () => {
    const t: Target = { egress: 'wall-chimney', era: 'ancient', roof: 'pitched' };
    const { issues, corrected } = validate(t, [chimneyGate], reg, { apply: true });
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warn');
    expect(corrected?.egress).toBe('louver');
  });

  it('without apply, the target is not mutated', () => {
    const t: Target = { egress: 'wall-chimney', era: 'ancient', roof: 'pitched' };
    const { corrected } = validate(t, [chimneyGate], reg);
    expect(corrected).toBeUndefined();
    expect(t.egress).toBe('wall-chimney');
  });
});
