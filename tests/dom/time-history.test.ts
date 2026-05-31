/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mountTimeHistory } from '@/ui/panels/time-history';
import { EventLog } from '@/core/events';
import { SimClock } from '@/core/clock';

function makeDeps(overrides: Partial<{ clockNow: number }> = {}) {
  const clock = new SimClock(1);
  if (overrides.clockNow != null) clock.advance(overrides.clockNow);
  const eventLog = new EventLog(clock);
  const timeline = {
    jumpTo: vi.fn(),
    get currentTick() { return clock.now(); },
  };
  return { eventLog, timeline, clock };
}

function makeContainer(): HTMLElement {
  const c = document.createElement('div');
  document.body.appendChild(c);
  return c;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('mountTimeHistory', () => {
  it('renders one chip per whisper and timeline_commit event in chronological order', () => {
    const deps = makeDeps();
    deps.clock.advance(10);
    deps.eventLog.append({ type: 'whisper', spiritId: 'player' as any, npcId: 'n1' as any });
    deps.clock.advance(10);
    deps.eventLog.append({ type: 'timeline_commit', parentTick: 20, rerolled: false });
    deps.clock.advance(10);
    deps.eventLog.append({ type: 'whisper', spiritId: 'player' as any, npcId: 'n1' as any });

    const c = makeContainer();
    const handle = mountTimeHistory(c, deps as any);

    const chips = c.querySelectorAll('.sg-time-history__chip');
    expect(chips).toHaveLength(3);
    expect(chips[0].textContent).toContain('10');
    expect(chips[1].textContent).toContain('20');
    expect(chips[2].textContent).toContain('30');
    handle.dispose();
  });

  it('surfaces divine acts and losses (answer_prayer, dream, believer_lost) as chips', () => {
    const deps = makeDeps();
    deps.clock.advance(5);
    deps.eventLog.append({ type: 'answer_prayer', spiritId: 'player' as any, npcId: 'n1' as any });
    deps.clock.advance(5);
    deps.eventLog.append({ type: 'dream', spiritId: 'player' as any, npcId: 'n1' as any });
    deps.clock.advance(5);
    deps.eventLog.append({ type: 'believer_lost', npcId: 'n2' as any });

    const c = makeContainer();
    const handle = mountTimeHistory(c, deps as any);

    const chips = c.querySelectorAll('.sg-time-history__chip');
    expect(chips).toHaveLength(3);
    expect(chips[0].textContent).toMatch(/answered/i);
    expect(chips[1].textContent).toMatch(/deepened/i);
    expect(chips[2].textContent).toMatch(/lost/i);
    handle.dispose();
  });

  it('filters out non-relevant events (e.g. belief_cross)', () => {
    const deps = makeDeps();
    deps.clock.advance(10);
    deps.eventLog.append({ type: 'belief_cross', npcId: 'n1' as any, spiritId: 'player' as any, kind: 'high', faith: 0.8 });

    const c = makeContainer();
    const handle = mountTimeHistory(c, deps as any);
    expect(c.querySelectorAll('.sg-time-history__chip')).toHaveLength(0);
    handle.dispose();
  });

  it('clicking a chip calls timeline.jumpTo with the chip tick', () => {
    const deps = makeDeps();
    deps.clock.advance(42);
    deps.eventLog.append({ type: 'whisper', spiritId: 'p' as any, npcId: 'n' as any });

    const c = makeContainer();
    const handle = mountTimeHistory(c, deps as any);
    const chip = c.querySelector('.sg-time-history__chip') as HTMLElement;
    chip.click();
    expect(deps.timeline.jumpTo).toHaveBeenCalledTimes(1);
    expect(deps.timeline.jumpTo).toHaveBeenCalledWith(42);
    handle.dispose();
  });

  it('appends a new chip when a relevant event is appended after mount', () => {
    const deps = makeDeps();
    const c = makeContainer();
    const handle = mountTimeHistory(c, deps as any);
    expect(c.querySelectorAll('.sg-time-history__chip')).toHaveLength(0);

    deps.clock.advance(15);
    deps.eventLog.append({ type: 'whisper', spiritId: 'p' as any, npcId: 'n' as any });
    expect(c.querySelectorAll('.sg-time-history__chip')).toHaveLength(1);
    handle.dispose();
  });

  it('drops chips whose tick > parentTick on timeline_commit', () => {
    const deps = makeDeps();
    deps.clock.advance(10);
    deps.eventLog.append({ type: 'whisper', spiritId: 'p' as any, npcId: 'n' as any });
    deps.clock.advance(20);
    deps.eventLog.append({ type: 'whisper', spiritId: 'p' as any, npcId: 'n' as any });
    deps.clock.advance(20);
    deps.eventLog.append({ type: 'whisper', spiritId: 'p' as any, npcId: 'n' as any });

    const c = makeContainer();
    const handle = mountTimeHistory(c, deps as any);
    expect(c.querySelectorAll('.sg-time-history__chip')).toHaveLength(3);

    // Commit at parentTick=25; clock is at 50 so the commit chip lands at 50.
    deps.eventLog.append({ type: 'timeline_commit', parentTick: 25, rerolled: false });

    const chips = c.querySelectorAll('.sg-time-history__chip');
    // Surviving: whisper@10, plus the new commit chip@50.
    expect(chips).toHaveLength(2);
    expect(chips[0].textContent).toContain('10');
    expect(chips[1].textContent).toMatch(/commit|▼/i);
    handle.dispose();
  });

  it('caps the chip list at 50 entries (oldest dropped)', () => {
    const deps = makeDeps();
    const c = makeContainer();
    const handle = mountTimeHistory(c, deps as any);
    for (let i = 0; i < 60; i++) {
      deps.clock.advance(1);
      deps.eventLog.append({ type: 'whisper', spiritId: 'p' as any, npcId: 'n' as any });
    }
    expect(c.querySelectorAll('.sg-time-history__chip')).toHaveLength(50);
    const first = c.querySelector('.sg-time-history__chip');
    expect(first!.textContent).toContain('11');
    handle.dispose();
  });

  it('dispose() unsubscribes from the event log', () => {
    const deps = makeDeps();
    const c = makeContainer();
    const handle = mountTimeHistory(c, deps as any);
    handle.dispose();

    deps.clock.advance(10);
    deps.eventLog.append({ type: 'whisper', spiritId: 'p' as any, npcId: 'n' as any });
    expect(c.querySelectorAll('.sg-time-history__chip')).toHaveLength(0);
  });
});
