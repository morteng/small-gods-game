import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  generateBuildingImage, BUILDING_IMAGE_MODEL,
  BuildingImageError, classifyImageError,
} from '@/llm/openrouter-image-client';

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

  it('classifies an over-spend (HTTP 402) as a FATAL limit error with a help link', async () => {
    mockFetchOnce(402, { error: { message: 'Insufficient credits' } });
    const err = await generateBuildingImage({ apiKey: 'k' },
      { initImageDataUri: PNG_URI, prompt: 'x' }).catch(e => e);
    expect(err).toBeInstanceOf(BuildingImageError);
    expect(err.kind).toBe('limit');
    expect(err.fatal).toBe(true);
    expect(err.helpUrl).toContain('openrouter.ai/settings/credits');
    expect(err.hint.toLowerCase()).toMatch(/credit|limit/);
  });

  it('detects a billing error returned as HTTP 200 with an error body', async () => {
    mockFetchOnce(200, { error: { message: 'You have exceeded your spend limit', code: 402 } });
    const err = await generateBuildingImage({ apiKey: 'k' },
      { initImageDataUri: PNG_URI, prompt: 'x' }).catch(e => e);
    expect(err).toBeInstanceOf(BuildingImageError);
    expect(err.kind).toBe('limit');
    expect(err.fatal).toBe(true);
  });

  it('classifies a bad key (401/403) as a FATAL auth error', async () => {
    mockFetchOnce(401, { error: { message: 'No auth credentials found' } });
    const err = await generateBuildingImage({ apiKey: 'bad' },
      { initImageDataUri: PNG_URI, prompt: 'x' }).catch(e => e);
    expect(err.kind).toBe('auth');
    expect(err.fatal).toBe(true);
    expect(err.helpUrl).toContain('openrouter.ai/settings/keys');
  });

  it('a plain "no image" / rate-limit is NOT fatal (worth a retry)', async () => {
    expect(new BuildingImageError('no-image', 'x').fatal).toBe(false);
    expect(classifyImageError(429, 'slow down').fatal).toBe(false);
    expect(classifyImageError(500, 'server error').kind).toBe('http');
  });
});
