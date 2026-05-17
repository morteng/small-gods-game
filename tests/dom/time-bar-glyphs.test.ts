/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { mountTimeBar } from '@/ui/panels/time-bar';
import type { AppendedEvent } from '@/core/events';

function makeDeps(events: AppendedEvent[]) {
  return {
    timeline: { isScrubbed:false, currentTick:1200, maxTick:1200, jumpTo:vi.fn(), returnToLive:vi.fn(), commit:vi.fn(), onAfterLiveTick:()=>{} },
    scheduler: { setRate: vi.fn(), getRate: () => 1 },
    eventLog: {
      subscribe: () => () => {},
      since: () => events,
      size: () => events.length,
    },
    clock: { now: () => 1200 },
    onDismiss: vi.fn(),
  } as unknown as Parameters<typeof mountTimeBar>[1];
}

describe('TimeBar event glyphs', () => {
  it('renders glyphs for whisper, belief_cross, region_realized', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const events: AppendedEvent[] = [
      { id: 1, t: 100,  event: { type: 'whisper',         spiritId: 'player' as any, npcId: 'n1' as any } },
      { id: 2, t: 700,  event: { type: 'belief_cross',    spiritId: 'player' as any, npcId: 'n1' as any, kind: 'high', faith: 0.4 } },
      { id: 3, t: 1000, event: { type: 'region_realized', region: {} as any, cause: 'belief_spread' } },
    ];
    mountTimeBar(container, makeDeps(events));
    const glyphs = container.querySelectorAll('.sg-time-bar__glyph');
    expect(glyphs.length).toBe(3);
    expect(glyphs[0].getAttribute('data-glyph-type')).toBe('whisper');
    expect(glyphs[1].getAttribute('data-glyph-type')).toBe('beliefRise');
    expect(glyphs[2].getAttribute('data-glyph-type')).toBe('realize');
  });

  it('appended events trigger a glyph re-render via subscribe', () => {
    let subFn: ((e: AppendedEvent) => void) | null = null;
    const events: AppendedEvent[] = [
      { id: 1, t: 100, event: { type: 'whisper', spiritId: 'player' as any, npcId: 'n1' as any } },
    ];
    const deps = {
      timeline: { isScrubbed:false, currentTick:1200, maxTick:1200, jumpTo:vi.fn(), returnToLive:vi.fn(), commit:vi.fn(), onAfterLiveTick:()=>{} },
      scheduler: { setRate: vi.fn(), getRate: () => 1 },
      eventLog: {
        subscribe: (fn: (e: AppendedEvent) => void) => { subFn = fn; return () => {}; },
        since: () => events,
        size: () => events.length,
      },
      clock: { now: () => 1200 },
      onDismiss: vi.fn(),
    } as unknown as Parameters<typeof mountTimeBar>[1];

    const container = document.createElement('div');
    document.body.appendChild(container);
    mountTimeBar(container, deps);
    expect(container.querySelectorAll('.sg-time-bar__glyph').length).toBe(1);

    events.push({ id: 2, t: 500, event: { type: 'whisper', spiritId: 'player' as any, npcId: 'n1' as any } });
    subFn!(events[1]);
    expect(container.querySelectorAll('.sg-time-bar__glyph').length).toBe(2);
  });
});
