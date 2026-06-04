import { describe, it, expect } from 'vitest';
import type { LLMToolCall } from '@/llm/llm-client';
import { FATE_TOOLS, parseFateToolCalls } from '@/game/fate/fate-tools';

function call(args: Record<string, unknown>): LLMToolCall {
  return { id: 'c0', name: 'arm_staged_beat', arguments: args };
}
const ctx = () => ({ validPoiIds: new Set(['poi1', 'poi2']), now: 100 });

describe('FATE_TOOLS', () => {
  it('exposes exactly one tool named arm_staged_beat', () => {
    expect(FATE_TOOLS).toHaveLength(1);
    expect(FATE_TOOLS[0].name).toBe('arm_staged_beat');
  });
});

describe('parseFateToolCalls', () => {
  it('builds an inject_npc discovery beat for a valid subject', () => {
    const beats = parseFateToolCalls(
      [call({ subjectPoiId: 'poi1', threadId: 7, hard: 'inject_npc', role: 'preacher', soft: 'A stranger lingers.' })],
      ctx(),
    );
    expect(beats).toHaveLength(1);
    const b = beats[0];
    expect(b.subject).toEqual({ kind: 'settlement', poiId: 'poi1' });
    expect(b.trigger).toEqual({ kind: 'discovery' });
    expect(b.threadId).toBe(7);
    expect(b.stagedTick).toBe(100);
    expect(b.hard).toHaveLength(1);
    expect(b.hard[0]).toMatchObject({
      verb: 'inject_npc', source: 'fate', target: { kind: 'settlement', poiId: 'poi1' }, payload: { role: 'preacher' },
    });
    expect(b.soft).toEqual({ kind: 'location_vibe', text: 'A stranger lingers.' });
  });

  it('hard:"none" yields a soft-only beat (empty hard)', () => {
    const beats = parseFateToolCalls([call({ subjectPoiId: 'poi2', hard: 'none', soft: 'Unease settles.' })], ctx());
    expect(beats[0].hard).toEqual([]);
    expect(beats[0].soft?.text).toBe('Unease settles.');
  });

  it('drops a call whose subjectPoiId is not a valid subject', () => {
    expect(parseFateToolCalls([call({ subjectPoiId: 'ghost', hard: 'inject_npc' })], ctx())).toHaveLength(0);
  });

  it('defaults an inject_npc with a missing/invalid role to refugee', () => {
    const beats = parseFateToolCalls([call({ subjectPoiId: 'poi1', hard: 'inject_npc' })], ctx());
    expect(beats[0].hard[0].payload).toMatchObject({ role: 'refugee' });
  });

  it('ignores tool calls that are not arm_staged_beat', () => {
    expect(parseFateToolCalls([{ id: 'x', name: 'something_else', arguments: {} }], ctx())).toHaveLength(0);
  });

  it('tolerates undefined calls', () => {
    expect(parseFateToolCalls(undefined, ctx())).toEqual([]);
  });
});
