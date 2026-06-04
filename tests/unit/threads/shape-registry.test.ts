import { describe, it, expect } from 'vitest';
import { SHAPES, getShape, validateShapes, phaseWeight } from '@/sim/threads/shape-registry';

describe('shape-registry', () => {
  it('every seed shape is well-formed', () => {
    expect(() => validateShapes()).not.toThrow();
  });

  it('each shape has exactly one climax phase', () => {
    for (const s of Object.values(SHAPES)) {
      expect(s.phases.filter(p => p.weight === 'climax')).toHaveLength(1);
    }
  });

  it('phase ids are unique within a shape', () => {
    for (const s of Object.values(SHAPES)) {
      expect(new Set(s.phases.map(p => p.id)).size).toBe(s.phases.length);
    }
  });

  it('loss-given-meaning has the canonical phases', () => {
    expect(getShape('loss-given-meaning').phases.map(p => p.id))
      .toEqual(['loss', 'reaching', 'meaning', 'carried']);
  });

  it('phaseWeight resolves a phase weight', () => {
    expect(phaseWeight('trial', 'turning')).toBe('climax');
  });

  it('getShape throws on unknown id', () => {
    expect(() => getShape('nope')).toThrow();
  });
});
