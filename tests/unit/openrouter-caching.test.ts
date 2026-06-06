import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenRouterProvider } from '@/llm/llm-client';

interface RecordedCall { url: string; init: RequestInit }

function fakeResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function stubFetch(calls: RecordedCall[], body: unknown, headers: Record<string, string> = {}): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return fakeResponse(body, headers);
  }));
}

const OK_BODY = {
  choices: [{ message: { content: '{"ok":true}' } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  model: 'deepseek/deepseek-v4-flash',
};

describe('OpenRouterProvider response caching', () => {
  let calls: RecordedCall[];
  beforeEach(() => { calls = []; stubFetch(calls, OK_BODY); });

  it('sends cache headers when cache requested with ttl', async () => {
    const p = new OpenRouterProvider({ apiKey: 'k', model: 'deepseek/deepseek-v4-flash' });
    await p.generate([{ role: 'user', content: 'hi' }], { cache: { ttlSeconds: 600 } });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['X-OpenRouter-Cache']).toBe('true');
    expect(headers['X-OpenRouter-Cache-TTL']).toBe('600');
  });

  it('sends clear header when cache.clear is set', async () => {
    const p = new OpenRouterProvider({ apiKey: 'k' });
    await p.generate([{ role: 'user', content: 'hi' }], { cache: { clear: true } });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['X-OpenRouter-Cache-Clear']).toBe('true');
  });

  it('omits cache headers when cache not requested', async () => {
    const p = new OpenRouterProvider({ apiKey: 'k' });
    await p.generate([{ role: 'user', content: 'hi' }]);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['X-OpenRouter-Cache']).toBeUndefined();
  });

  it('omits cache headers when cacheEnabled is false even if cache requested', async () => {
    const p = new OpenRouterProvider({ apiKey: 'k', cacheEnabled: false });
    await p.generate([{ role: 'user', content: 'hi' }], { cache: true });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['X-OpenRouter-Cache']).toBeUndefined();
  });

  it('infers HIT from zero total_tokens on a cache-eligible call', async () => {
    calls = [];
    stubFetch(calls, { choices: [{ message: { content: '{}' } }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
    const p = new OpenRouterProvider({ apiKey: 'k' });
    const res = await p.generate([{ role: 'user', content: 'hi' }], { cache: true });
    expect(res.cacheStatus).toBe('HIT');
  });

  it('prefers the cache-status header when present', async () => {
    calls = [];
    stubFetch(calls, { choices: [{ message: { content: '{}' } }], usage: { total_tokens: 15 } }, { 'x-openrouter-cache-status': 'MISS' });
    const p = new OpenRouterProvider({ apiKey: 'k' });
    const res = await p.generate([{ role: 'user', content: 'hi' }], { cache: true });
    expect(res.cacheStatus).toBe('MISS');
  });

  it('leaves cacheStatus undefined when caching not requested', async () => {
    const p = new OpenRouterProvider({ apiKey: 'k' });
    const res = await p.generate([{ role: 'user', content: 'hi' }]);
    expect(res.cacheStatus).toBeUndefined();
  });
});
