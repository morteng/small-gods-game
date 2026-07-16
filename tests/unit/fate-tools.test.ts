import { describe, it, expect } from 'vitest';
import type { LLMToolCall } from '@/llm/llm-client';
import { FATE_TOOLS, parseFateToolCalls } from '@/game/fate/fate-tools';

function armCall(args: Record<string, unknown>): LLMToolCall {
  return { id: 'c0', name: 'arm_staged_beat', arguments: args };
}
const ctx = () => ({ validPoiIds: new Set(['poi1', 'poi2']), validRivalIds: new Set(['rival-1']), now: 100 });

describe('FATE_TOOLS', () => {
  it('exposes the staged + immediate + rival-coaching + authoring + arc + portent tools', () => {
    const names = FATE_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual([
      'abandon_arc', 'arm_staged_beat', 'author_building', 'force_next_event',
      'nudge_event_severity', 'plant_portent', 'seed_arc', 'set_rival_stance',
    ]);
  });
});

describe('parseFateToolCalls — staged beats', () => {
  it('builds an inject_npc discovery beat for a valid subject', () => {
    const { beats } = parseFateToolCalls(
      [armCall({ subjectPoiId: 'poi1', threadId: 7, hard: 'inject_npc', role: 'preacher', soft: 'A stranger lingers.' })],
      ctx(),
    );
    expect(beats).toHaveLength(1);
    expect(beats[0].subject).toEqual({ kind: 'settlement', poiId: 'poi1' });
    expect(beats[0].hard[0]).toMatchObject({ verb: 'inject_npc', source: 'fate', payload: { role: 'preacher' } });
  });

  it('drops a beat whose subjectPoiId is not valid', () => {
    const { beats } = parseFateToolCalls([armCall({ subjectPoiId: 'ghost', hard: 'inject_npc' })], ctx());
    expect(beats).toHaveLength(0);
  });

  it('tolerates undefined calls', () => {
    expect(parseFateToolCalls(undefined, ctx())).toEqual({
      beats: [], commands: [], authoringRejections: [], arcSeeds: [], arcAbandons: [],
      arcPortents: [], portentRejections: [],
    });
  });

  it('W-I: arms a SOFT-only site beat for a causal subjectPoiId, dropping any inject_npc', () => {
    const siteCtx = { validPoiIds: new Set(['causal:flood:0003']), now: 50 };
    const { beats } = parseFateToolCalls(
      [armCall({ subjectPoiId: 'causal:flood:0003', hard: 'inject_npc', role: 'refugee', soft: 'The drowned reeds whisper.' })],
      siteCtx,
    );
    expect(beats).toHaveLength(1);
    expect(beats[0].subject).toEqual({ kind: 'site', siteId: 'causal:flood:0003' });
    expect(beats[0].hard).toHaveLength(0);                 // no inject into a transient site
    expect(beats[0].soft).toMatchObject({ text: 'The drowned reeds whisper.' });
  });

  it('attaches a storylet ref when it is in the validStoryletIds drift-guard set', () => {
    const { beats } = parseFateToolCalls(
      [armCall({ subjectPoiId: 'poi1', hard: 'none', storylet: 'parched-prayer' })],
      { validPoiIds: new Set(['poi1']), now: 0, validStoryletIds: new Set(['parched-prayer']) },
    );
    expect(beats).toHaveLength(1);
    expect(beats[0].storylet).toBe('parched-prayer');
  });

  it('drops an unrecognized storylet ref but still arms the beat', () => {
    const { beats } = parseFateToolCalls(
      [armCall({ subjectPoiId: 'poi1', hard: 'none', storylet: 'made-up-id' })],
      { validPoiIds: new Set(['poi1']), now: 0, validStoryletIds: new Set(['parched-prayer']) },
    );
    expect(beats).toHaveLength(1);
    expect(beats[0].storylet).toBeUndefined();
  });

  it('drops any storylet ref when the ctx carries no validStoryletIds set at all', () => {
    const { beats } = parseFateToolCalls(
      [armCall({ subjectPoiId: 'poi1', hard: 'none', storylet: 'parched-prayer' })],
      ctx(),   // no validStoryletIds field
    );
    expect(beats).toHaveLength(1);
    expect(beats[0].storylet).toBeUndefined();
  });
});

describe('parseFateToolCalls — immediate commands', () => {
  it('builds a nudge_severity command from nudge_event_severity tool', () => {
    const { commands } = parseFateToolCalls(
      [{ id: 'c1', name: 'nudge_event_severity', arguments: { subjectPoiId: 'poi1', delta: 0.3 } }],
      ctx(),
    );
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      verb: 'nudge_severity', source: 'fate', target: { kind: 'settlement', poiId: 'poi1' }, payload: { delta: 0.3 },
    });
  });

  it('caps an oversized delta to ±0.5', () => {
    const { commands } = parseFateToolCalls(
      [{ id: 'c1', name: 'nudge_event_severity', arguments: { subjectPoiId: 'poi1', delta: 9 } }],
      ctx(),
    );
    expect(commands[0].payload).toEqual({ delta: 0.5 });
  });

  it('builds a bias_event command from force_next_event', () => {
    const { commands } = parseFateToolCalls(
      [{ id: 'c1', name: 'force_next_event', arguments: { subjectPoiId: 'poi2', eventType: 'plague' } }],
      ctx(),
    );
    expect(commands[0]).toMatchObject({
      verb: 'bias_event', source: 'fate', target: { kind: 'settlement', poiId: 'poi2' }, payload: { eventType: 'plague' },
    });
  });

  it('drops immediate calls with an ungrounded poiId, bad eventType, or non-finite delta', () => {
    const { commands } = parseFateToolCalls([
      { id: 'a', name: 'nudge_event_severity', arguments: { subjectPoiId: 'ghost', delta: 0.2 } },
      { id: 'b', name: 'nudge_event_severity', arguments: { subjectPoiId: 'poi1', delta: 'lots' } },
      { id: 'c', name: 'force_next_event', arguments: { subjectPoiId: 'poi1', eventType: 'banana' } },
    ], ctx());
    expect(commands).toHaveLength(0);
  });

  it('W-I: rejects settlement-event verbs aimed at a causal site (it has no active event)', () => {
    const siteCtx = { validPoiIds: new Set(['causal:flood:0003']), now: 0 };
    const { commands } = parseFateToolCalls([
      { id: 'a', name: 'nudge_event_severity', arguments: { subjectPoiId: 'causal:flood:0003', delta: 0.3 } },
      { id: 'b', name: 'force_next_event', arguments: { subjectPoiId: 'causal:flood:0003', eventType: 'plague' } },
    ], siteCtx);
    expect(commands).toHaveLength(0);
  });
});

describe('parseFateToolCalls — set_rival_stance', () => {
  const stance = (args: Record<string, unknown>): LLMToolCall => ({ id: 's0', name: 'set_rival_stance', arguments: args });

  it('builds a set_rival_stance command for a valid rival, capping each delta to ±0.2', () => {
    const { commands } = parseFateToolCalls([stance({ rivalId: 'rival-1', aggression: 0.9, territoriality: -0.05 })], ctx());
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ verb: 'set_rival_stance', source: 'fate', target: { kind: 'none' } });
    expect(commands[0].payload).toEqual({ rivalId: 'rival-1', aggression: 0.2, territoriality: -0.05 });
  });

  it('drops a stance aimed at an unknown / ungrounded rivalId', () => {
    const { commands } = parseFateToolCalls([stance({ rivalId: 'ghost', aggression: 0.1 })], ctx());
    expect(commands).toHaveLength(0);
  });

  it('drops a stance carrying no finite deltas', () => {
    const { commands } = parseFateToolCalls([stance({ rivalId: 'rival-1', aggression: 'lots' })], ctx());
    expect(commands).toHaveLength(0);
  });

  it('drops every stance when the ctx supplies no validRivalIds set', () => {
    const noRivals = { validPoiIds: new Set(['poi1']), now: 5 };
    const { commands } = parseFateToolCalls([stance({ rivalId: 'rival-1', aggression: 0.1 })], noRivals);
    expect(commands).toHaveLength(0);
  });
});
