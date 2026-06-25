import { describe, it, expect } from 'vitest';
import { LlmCueComposer, NullCueComposer } from '@/presentation/composer/composer-service';
import { loadComposedCues } from '@/presentation/composer/load-cues';
import type { LLMProvider, LLMResponse } from '@/llm/llm-client';

const CUE = { id: 'bed_x', role: 'bed', bpm: 60, bars: 1, loop: true, notes: [{ voice: 'pad', midi: 60, atBeat: 0, durBeats: 1, vel: 30 }] };

/** A fake provider returning a fixed payload (or unavailable / throwing). */
function fakeProvider(opts: { available?: boolean; content?: string; parsed?: Record<string, unknown>; throws?: boolean }): LLMProvider {
  return {
    name: () => 'fake',
    isAvailable: () => opts.available ?? true,
    async generate(): Promise<LLMResponse> {
      if (opts.throws) throw new Error('boom');
      return { content: opts.content ?? '', parsed: opts.parsed, latencyMs: 1 };
    },
  };
}

describe('LlmCueComposer.composeLibrary', () => {
  it('returns validated cues whose ids were requested', async () => {
    const c = new LlmCueComposer(fakeProvider({ parsed: { cues: [CUE] } }));
    const out = await c.composeLibrary([{ id: 'bed_x', role: 'bed', intent: 'x' }]);
    expect(out.map((x) => x.id)).toEqual(['bed_x']);
  });

  it('drops cues whose ids were NOT requested (anti-hallucination)', async () => {
    const c = new LlmCueComposer(fakeProvider({ parsed: { cues: [{ ...CUE, id: 'sneaky' }] } }));
    const out = await c.composeLibrary([{ id: 'bed_x', role: 'bed', intent: 'x' }]);
    expect(out).toHaveLength(0);
  });

  it('parses JSON out of prose/markdown-fenced content', async () => {
    const content = 'Here you go!\n```json\n' + JSON.stringify({ cues: [CUE] }) + '\n```';
    const c = new LlmCueComposer(fakeProvider({ content }));
    const out = await c.composeLibrary([{ id: 'bed_x', role: 'bed', intent: 'x' }]);
    expect(out).toHaveLength(1);
  });

  it('returns [] when the provider is unavailable or throws', async () => {
    expect(await new LlmCueComposer(fakeProvider({ available: false })).composeLibrary([{ id: 'a', role: 'bed', intent: 'x' }])).toEqual([]);
    expect(await new LlmCueComposer(fakeProvider({ throws: true })).composeLibrary([{ id: 'a', role: 'bed', intent: 'x' }])).toEqual([]);
  });
});

describe('LlmCueComposer.composeLeitmotif', () => {
  it('forces the leitmotif id/role/themeKey even if the model mislabels', async () => {
    const motif = { id: 'wrong', role: 'bed', bpm: 100, bars: 1, loop: true, notes: [{ voice: 'lead', midi: 72, atBeat: 0, durBeats: 0.5, vel: 50 }] };
    const c = new LlmCueComposer(fakeProvider({ parsed: { cues: [{ ...motif, id: 'leitmotif:hero' }] } }));
    const cue = await c.composeLeitmotif('hero');
    expect(cue).not.toBeNull();
    expect(cue!.id).toBe('leitmotif:hero');
    expect(cue!.role).toBe('leitmotif');
    expect(cue!.themeKey).toBe('hero');
  });

  it('returns null when nothing valid comes back', async () => {
    expect(await new LlmCueComposer(fakeProvider({ content: 'no json here' })).composeLeitmotif('hero')).toBeNull();
  });
});

describe('NullCueComposer', () => {
  it('always declines', async () => {
    const c = new NullCueComposer();
    expect(await c.composeLibrary([])).toEqual([]);
    expect(await c.composeLeitmotif('x')).toBeNull();
  });
});

describe('loadComposedCues', () => {
  const ok = (body: unknown): typeof fetch => (async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch;

  it('loads + validates a committed pack', async () => {
    const cues = await loadComposedCues({ baseUrl: '/', fetchImpl: ok({ cues: [CUE] }) });
    expect(cues.map((c) => c.id)).toEqual(['bed_x']);
  });

  it('returns [] on a non-ok response, a throw, or no fetch', async () => {
    const notOk = (async () => ({ ok: false })) as unknown as typeof fetch;
    const throws = (async () => { throw new Error('net'); }) as unknown as typeof fetch;
    expect(await loadComposedCues({ fetchImpl: notOk })).toEqual([]);
    expect(await loadComposedCues({ fetchImpl: throws })).toEqual([]);
    expect(await loadComposedCues({ fetchImpl: undefined as unknown as typeof fetch })).toEqual([]);
  });
});
