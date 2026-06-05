import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  parseCatalog,
  fetchOpenRouterModels,
  clearCatalogCache,
  formatPrice,
  VERIFIED_CHAT_MODELS,
  VERIFIED_CAPABLE_MODELS,
  DEFAULT_CHAT_MODEL,
  DEFAULT_CAPABLE_MODEL,
  DEAD_MODEL_IDS,
} from '@/llm/openrouter-catalog';

function rawModel(id: string, tools: boolean, prompt = '0.0000001', completion = '0.0000004') {
  return {
    id,
    name: id.split('/')[1],
    supported_parameters: tools ? ['tools', 'temperature'] : ['temperature'],
    pricing: { prompt, completion },
  };
}

describe('openrouter-catalog parseCatalog', () => {
  it('keeps only tool-calling models and converts pricing to $/M', () => {
    const out = parseCatalog({
      data: [
        rawModel('a/tools', true, '0.000001', '0.000002'),
        rawModel('b/no-tools', false),
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('a/tools');
    expect(out[0].promptPrice).toBeCloseTo(1.0, 6);
    expect(out[0].completionPrice).toBeCloseTo(2.0, 6);
    expect(out[0].free).toBe(false);
  });

  it('sorts ascending by prompt price', () => {
    const out = parseCatalog({
      data: [
        rawModel('x/pricey', true, '0.00001'),
        rawModel('y/cheap', true, '0.0000001'),
      ],
    });
    expect(out.map(m => m.id)).toEqual(['y/cheap', 'x/pricey']);
  });

  it('flags free models and tolerates missing pricing', () => {
    const out = parseCatalog({
      data: [
        rawModel('f/free', true, '0', '0'),
        { id: 'g/nopricing', supported_parameters: ['tools'] },
      ],
    });
    const free = out.find(m => m.id === 'f/free')!;
    expect(free.free).toBe(true);
    const noprice = out.find(m => m.id === 'g/nopricing')!;
    expect(noprice.promptPrice).toBeNull();
  });

  it('returns [] on a malformed payload', () => {
    expect(parseCatalog(null)).toEqual([]);
    expect(parseCatalog({})).toEqual([]);
    expect(parseCatalog({ data: 'nope' })).toEqual([]);
  });
});

describe('openrouter-catalog verified lists', () => {
  it('defaults are members of their verified lists', () => {
    expect(VERIFIED_CHAT_MODELS.some(m => m.id === DEFAULT_CHAT_MODEL)).toBe(true);
    expect(VERIFIED_CAPABLE_MODELS.some(m => m.id === DEFAULT_CAPABLE_MODEL)).toBe(true);
  });

  it('no verified model id is in the dead set', () => {
    for (const m of [...VERIFIED_CHAT_MODELS, ...VERIFIED_CAPABLE_MODELS]) {
      expect(DEAD_MODEL_IDS.has(m.id)).toBe(false);
    }
  });
});

describe('formatPrice', () => {
  const base = { provider: 'p', description: '', contextLength: null };
  it('renders free, sub-dollar, and dollar+ prices', () => {
    expect(formatPrice({ ...base, id: 'a', name: 'a', promptPrice: 0, completionPrice: 0, free: true })).toBe('free');
    expect(formatPrice({ ...base, id: 'b', name: 'b', promptPrice: 0.1, completionPrice: 0.4, free: false })).toBe('$0.10/M');
    expect(formatPrice({ ...base, id: 'c', name: 'c', promptPrice: 2, completionPrice: 12, free: false })).toBe('$2.0/M');
    expect(formatPrice({ ...base, id: 'd', name: 'd', promptPrice: null, completionPrice: null, free: false })).toBe('');
  });
});

describe('fetchOpenRouterModels', () => {
  beforeEach(() => clearCatalogCache());
  afterEach(() => { vi.unstubAllGlobals(); clearCatalogCache(); });

  it('resolves to [] when the fetch fails (degrade to verified-only, never throw)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(fetchOpenRouterModels()).resolves.toEqual([]);
  });

  it('caches: a second call does not re-fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [rawModel('a/tools', true)] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const first = await fetchOpenRouterModels();
    const second = await fetchOpenRouterModels();
    expect(first).toBe(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
