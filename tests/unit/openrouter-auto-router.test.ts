import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenRouterProvider } from '@/llm/llm-client';

interface RecordedCall { url: string; init: RequestInit }
function fakeResponse(body: unknown): Response {
  return {
    ok: true, status: 200,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}
const OK = { choices: [{ message: { content: '{}' } }], usage: { total_tokens: 5 }, model: 'google/gemini-2.5-flash' };

describe('OpenRouterProvider auto-router', () => {
  let calls: RecordedCall[];
  beforeEach(() => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return fakeResponse(OK); }));
  });

  function bodyOf(i = 0): Record<string, unknown> {
    return JSON.parse(calls[i].init.body as string);
  }

  it('emits the auto-router plugin with the config tradeoff', async () => {
    const p = new OpenRouterProvider({ apiKey: 'k', model: 'openrouter/auto', costQualityTradeoff: 3 });
    await p.generate([{ role: 'user', content: 'hi' }]);
    expect(bodyOf().plugins).toEqual([{ id: 'auto-router', cost_quality_tradeoff: 3 }]);
  });

  it('opts.costQualityTradeoff overrides the config value', async () => {
    const p = new OpenRouterProvider({ apiKey: 'k', model: 'openrouter/auto', costQualityTradeoff: 3 });
    await p.generate([{ role: 'user', content: 'hi' }], { costQualityTradeoff: 9 });
    expect((bodyOf().plugins as Array<Record<string, unknown>>)[0].cost_quality_tradeoff).toBe(9);
  });

  it('includes allowed_models when supplied', async () => {
    const p = new OpenRouterProvider({ apiKey: 'k', model: 'openrouter/auto' });
    await p.generate([{ role: 'user', content: 'hi' }], { allowedModels: ['google/*'] });
    expect((bodyOf().plugins as Array<Record<string, unknown>>)[0].allowed_models).toEqual(['google/*']);
  });

  it('omits the plugins key for non-auto models', async () => {
    const p = new OpenRouterProvider({ apiKey: 'k', model: 'deepseek/deepseek-v4-flash' });
    await p.generate([{ role: 'user', content: 'hi' }]);
    expect(bodyOf().plugins).toBeUndefined();
  });

  it('surfaces the router-selected model from the response', async () => {
    const p = new OpenRouterProvider({ apiKey: 'k', model: 'openrouter/auto' });
    const res = await p.generate([{ role: 'user', content: 'hi' }]);
    expect(res.model).toBe('google/gemini-2.5-flash');
  });
});
