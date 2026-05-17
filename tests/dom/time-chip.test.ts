// tests/dom/time-chip.test.ts
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { mountTimeChip } from '@/ui/panels/time-chip';
import { SimClock } from '@/core/clock';

describe('TimeChip', () => {
  it('renders the calendar label and the current rate', () => {
    const host = document.createElement('div');
    const clock = new SimClock();
    const chip = mountTimeChip(host, {
      clock,
      getRate: () => 1,
      isPaused: () => false,
      onClick: () => {},
    });
    expect(host.textContent).toContain('Y1 spring');
    expect(host.textContent).toContain('1×');
    chip.dispose();
  });

  it('shows paused state when isPaused() returns true', () => {
    const host = document.createElement('div');
    const clock = new SimClock();
    const chip = mountTimeChip(host, {
      clock,
      getRate: () => 0,
      isPaused: () => true,
      onClick: () => {},
    });
    chip.refresh();
    expect(host.textContent).toContain('paused');
    chip.dispose();
  });

  it('fires onClick when clicked', () => {
    const host = document.createElement('div');
    const onClick = vi.fn();
    const chip = mountTimeChip(host, {
      clock: new SimClock(),
      getRate: () => 1,
      isPaused: () => false,
      onClick,
    });
    (host.querySelector('.sg-time-chip') as HTMLElement).click();
    expect(onClick).toHaveBeenCalledTimes(1);
    chip.dispose();
  });
});
