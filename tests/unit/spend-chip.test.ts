import { describe, it, expect, beforeEach } from 'vitest';
import { mountSpendChip } from '@/ui/spend-chip';
import { CostTracker } from '@/llm/cost-tracker';

beforeEach(() => localStorage.clear());

describe('mountSpendChip', () => {
  it('renders session + month spend and updates on record', () => {
    const host = document.createElement('div');
    const t = new CostTracker(() => new Date(2026, 5, 6));
    const chip = mountSpendChip(host, t);
    t.record({ cost: 0.0123 });
    expect(host.textContent).toContain('session');
    expect(host.textContent).toContain('month');
    expect(host.textContent).toContain('$0.01');
    chip.destroy();
    expect(host.querySelector('.sg-spend')).toBeNull();
  });

  it('hides when setVisible(false)', () => {
    const host = document.createElement('div');
    const t = new CostTracker(() => new Date(2026, 5, 6));
    const chip = mountSpendChip(host, t);
    chip.setVisible(false);
    const el = host.querySelector('.sg-spend') as HTMLElement;
    expect(el.style.display).toBe('none');
    chip.destroy();
  });
});
