import { describe, it, expect } from 'vitest';
import { createBootProgressMapper } from '@/ui/boot-progress';

describe('createBootProgressMapper', () => {
  it('maps phase announcements into the band, monotonically increasing', () => {
    const m = createBootProgressMapper(0.6, 0.97);
    let last = 0.6;
    for (const msg of ['Generating terrain fields...', 'Carving rivers...', 'Placing settlements...']) {
      const u = m.next(msg)!;
      expect(u.fraction).toBeGreaterThan(last);
      expect(u.fraction).toBeLessThan(0.97);
      last = u.fraction;
    }
  });

  it('skips stat lines (no trailing ellipsis) so the shipped bar stays clean', () => {
    const m = createBootProgressMapper(0.6, 0.97);
    expect(m.next('Trampled 136 tiles')).toBeNull();
    expect(m.next('Reconciled 37 road tiles under filleted approaches')).toBeNull();
  });

  it('never exceeds the cap however many phases fire', () => {
    const m = createBootProgressMapper(0.6, 0.97, 5);
    let u: { fraction: number } | null = null;
    for (let i = 0; i < 200; i++) u = m.next('Phase...');
    expect(u!.fraction).toBeLessThanOrEqual(0.97);
    expect(u!.fraction).toBeGreaterThan(0.96);
  });

  it('normalises the label ellipsis and strips the dots', () => {
    const m = createBootProgressMapper(0, 1);
    expect(m.next('Carving rivers...')!.label).toBe('Carving rivers…');
    expect(m.next('Growing…')!.label).toBe('Growing…');
  });
});
