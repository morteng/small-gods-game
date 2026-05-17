/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { mountTimeBar } from '@/ui/panels/time-bar';

function makeDeps(over: Partial<any> = {}) {
  return {
    timeline: {
      isScrubbed: false,
      currentTick: 1240,
      maxTick: 1840,
      jumpTo: vi.fn(),
      returnToLive: vi.fn(),
      commit: vi.fn(),
      onAfterLiveTick: () => {},
    },
    scheduler: { setRate: vi.fn(), getRate: () => 1 },
    eventLog: { subscribe: () => () => {}, since: () => [], size: () => 0 },
    clock: { now: () => 1240 },
    onDismiss: vi.fn(),
    ...over,
  } as unknown as Parameters<typeof mountTimeBar>[1];
}

describe('TimeBar transport + speed', () => {
  it('renders pause, jump-to-start, jump-to-now buttons', () => {
    const container = document.createElement('div');
    mountTimeBar(container, makeDeps());
    expect(container.querySelector('[data-action="rewind-to-start"]')).not.toBeNull();
    expect(container.querySelector('[data-action="toggle-pause"]')).not.toBeNull();
    expect(container.querySelector('[data-action="jump-to-now"]')).not.toBeNull();
  });

  it('renders 1×/2×/4×/8× speed buttons', () => {
    const container = document.createElement('div');
    mountTimeBar(container, makeDeps());
    expect(container.querySelectorAll('[data-rate]').length).toBe(4);
  });

  it('clicking 4× calls scheduler.setRate(4)', () => {
    const container = document.createElement('div');
    const deps = makeDeps();
    mountTimeBar(container, deps);
    (container.querySelector('[data-rate="4"]') as HTMLButtonElement).click();
    expect(deps.scheduler.setRate).toHaveBeenCalledWith(4);
  });

  it('clicking jump-to-now calls timeline.returnToLive', () => {
    const container = document.createElement('div');
    const deps = makeDeps();
    mountTimeBar(container, deps);
    (container.querySelector('[data-action="jump-to-now"]') as HTMLButtonElement).click();
    expect(deps.timeline.returnToLive).toHaveBeenCalledTimes(1);
  });
});
