/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { mountTimeBar } from '@/ui/panels/time-bar';

function makeDeps(over: Partial<any> = {}) {
  return {
    timeline: { isScrubbed: false, currentTick: 1180, maxTick: 1840, jumpTo: vi.fn(), returnToLive: vi.fn(), commit: vi.fn(), onAfterLiveTick:()=>{}, ...(over.timeline ?? {}) },
    scheduler: { setRate: vi.fn(), getRate: () => 1 },
    eventLog: { subscribe: () => () => {}, since: () => [], size: () => 0 },
    clock: { now: () => 1180 },
    onDismiss: vi.fn(),
  } as unknown as Parameters<typeof mountTimeBar>[1];
}

describe('TimeBar commit row', () => {
  it('is hidden when isScrubbed=false', () => {
    const container = document.createElement('div');
    mountTimeBar(container, makeDeps());
    expect(container.querySelector('.sg-time-bar__row--commit')).toBeNull();
  });

  it('is visible when isScrubbed=true with the three buttons', () => {
    const container = document.createElement('div');
    const deps = makeDeps({ timeline: { isScrubbed: true, currentTick: 1180, maxTick: 1840 } });
    const bar = mountTimeBar(container, deps);
    bar.refresh();
    expect(container.querySelector('.sg-time-bar__row--commit')).not.toBeNull();
    expect(container.querySelector('[data-action="back-to-now"]')).not.toBeNull();
    expect(container.querySelector('[data-action="commit"]')).not.toBeNull();
    expect(container.querySelector('[data-action="reroll"]')).not.toBeNull();
  });

  it('clicking Continue calls timeline.commit({ reroll: false })', () => {
    const container = document.createElement('div');
    const deps = makeDeps({ timeline: { isScrubbed: true, currentTick: 1180, maxTick: 1840 } });
    const bar = mountTimeBar(container, deps);
    bar.refresh();
    (container.querySelector('[data-action="commit"]') as HTMLButtonElement).click();
    expect(deps.timeline.commit).toHaveBeenCalledWith({ reroll: false });
  });

  it('clicking Try a different way calls timeline.commit({ reroll: true })', () => {
    const container = document.createElement('div');
    const deps = makeDeps({ timeline: { isScrubbed: true, currentTick: 1180, maxTick: 1840 } });
    const bar = mountTimeBar(container, deps);
    bar.refresh();
    (container.querySelector('[data-action="reroll"]') as HTMLButtonElement).click();
    expect(deps.timeline.commit).toHaveBeenCalledWith({ reroll: true });
  });
});
