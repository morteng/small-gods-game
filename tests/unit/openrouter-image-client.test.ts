import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateBuildingImage, BUILDING_IMAGE_MODEL } from '@/llm/openrouter-image-client';

const PNG_URI = 'data:image/png;base64,AAAA';
const OUT_URI = 'data:image/png;base64,BBBB';

function mockFetchOnce(status: number, json: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: status >= 200 && status < 300, status,
    json: async () => json, text: async () => JSON.stringify(json),
  } as unknown as Response);
}
afterEach(() => vi.restoreAllMocks());

describe('generateBuildingImage', () => {
  it('builds an image chat-completions request and parses the returned image', async () => {
    const fetchSpy = mockFetchOnce(200, {
      choices: [{ message: { images: [{ image_url: { url: OUT_URI } }] } }],
      usage: { cost: 0.039 },
    });
    const res = await generateBuildingImage(
      { apiKey: 'k', baseUrl: '/api/llm/openrouter/api/v1' },
      { initImageDataUri: PNG_URI, prompt: 'draw a cottage' },
    );
    expect(res.costUsd).toBeCloseTo(0.039);
    expect(res.blob).toBeInstanceOf(Blob);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/llm/openrouter/api/v1/chat/completions');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(BUILDING_IMAGE_MODEL);
    expect(body.modalities).toEqual(['image', 'text']);
    const parts = body.messages[0].content;
    expect(parts[0]).toEqual({ type: 'text', text: 'draw a cottage' });
    expect(parts[1]).toEqual({ type: 'image_url', image_url: { url: PNG_URI } });
  });

  it('throws when the response carries no image', async () => {
    mockFetchOnce(200, { choices: [{ message: { content: 'nope' } }], usage: {} });
    await expect(generateBuildingImage({ apiKey: 'k' },
      { initImageDataUri: PNG_URI, prompt: 'x' })).rejects.toThrow(/no image/i);
  });

  it('throws on non-200', async () => {
    mockFetchOnce(429, { error: { message: 'rate limited' } });
    await expect(generateBuildingImage({ apiKey: 'k' },
      { initImageDataUri: PNG_URI, prompt: 'x' })).rejects.toThrow(/429|rate limited/i);
  });
});
