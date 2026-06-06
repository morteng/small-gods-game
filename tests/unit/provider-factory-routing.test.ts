import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createProvider } from '@/llm/provider-factory';

interface RecordedCall { init: RequestInit }
function fakeResponse(body: unknown): Response {
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}
const OK = { choices: [{ message: { content: '{}' } }], usage: { total_tokens: 5 } };

describe('createProvider OpenRouter routing/caching mapping', () => {
  let calls: RecordedCall[];
  beforeEach(() => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { calls.push({ init }); return fakeResponse(OK); }));
  });

  it('maps openrouterCostQualityTradeoff into auto-router requests', async () => {
    const p = createProvider({ type: 'openrouter', openrouterApiKey: 'k', openrouterModel: 'openrouter/auto', openrouterCostQualityTradeoff: 4 });
    await p.generate([{ role: 'user', content: 'x' }]);
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.plugins[0].cost_quality_tradeoff).toBe(4);
  });

  it('maps cacheEnabled:false so cache headers are suppressed', async () => {
    const p = createProvider({ type: 'openrouter', openrouterApiKey: 'k', cacheEnabled: false });
    await p.generate([{ role: 'user', content: 'x' }], { cache: true });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['X-OpenRouter-Cache']).toBeUndefined();
  });
});
