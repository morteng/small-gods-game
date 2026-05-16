import { describe, it, expect } from 'vitest';
import { formatNpcTooltip } from '@/ui/npc-tooltip';

describe('formatNpcTooltip', () => {
  it('shows name and role', () => {
    const text = formatNpcTooltip({ name: 'Elder Bramwell', role: 'elder', mood: 0.55 });
    expect(text).toContain('Elder Bramwell');
    expect(text).toContain('elder');
  });

  it('shows a mood label', () => {
    expect(formatNpcTooltip({ name: 'a', role: 'farmer', mood: 0.9 }).toLowerCase()).toContain('content');
    expect(formatNpcTooltip({ name: 'a', role: 'farmer', mood: 0.5 }).toLowerCase()).toContain('uneasy');
    expect(formatNpcTooltip({ name: 'a', role: 'farmer', mood: 0.1 }).toLowerCase()).toContain('miserable');
  });
});
