import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateBuildingImageReplicate, classifyReplicateImageError,
  ReplicateImageError, QWEN_EDIT_COST_USD,
} from '@/llm/replicate-image-client';
import { BuildingImageError } from '@/llm/openrouter-image-client';

const PNG_URI = 'data:image/png;base64,AAAA';
const MODEL = 'qwen/qwen-image-edit-2511';

// The client paces prediction creates 11s apart by default (low-credit account
// throttle) via module-level state that would leak 11s waits across tests —
// the env override is read per call, so zeroing it here disables pacing.
beforeEach(() => { process.env.REPLICATE_CREATE_SPACING_MS = '0'; });
afterEach(() => {
  delete process.env.REPLICATE_CREATE_SPACING_MS;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

type MockResponse = {
  ok: boolean; status: number;
  json?: unknown; text?: string; blobBytes?: string;
};
/** Queue-driven fetch mock: each call consumes the next scripted response. */
function mockFetchQueue(responses: MockResponse[]) {
  let i = 0;
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    const r = responses[Math.min(i++, responses.length - 1)];
    return {
      ok: r.ok, status: r.status,
      json: async () => r.json,
      text: async () => r.text ?? JSON.stringify(r.json ?? {}),
      blob: async () => new Blob([r.blobBytes ?? 'png'], { type: 'image/png' }),
    } as unknown as Response;
  });
}

describe('generateBuildingImageReplicate', () => {
  it('creates on the official-model endpoint with Prefer: wait and the qwen input shape', async () => {
    const fetchSpy = mockFetchQueue([
      { ok: true, status: 201, json: { status: 'succeeded', output: ['https://replicate.delivery/pbxt/out.png'] } },
      { ok: true, status: 200, blobBytes: 'image-bytes' },
    ]);
    const res = await generateBuildingImageReplicate(
      { apiToken: 'tok' },
      { initImageDataUri: PNG_URI, prompt: 'paint a cottage', model: MODEL },
    );
    expect(res.blob).toBeInstanceOf(Blob);
    expect(res.costUsd).toBe(QWEN_EDIT_COST_USD);   // Replicate reports no cost — documented estimate

    const [createUrl, createInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(createUrl).toBe(`https://api.replicate.com/v1/models/${MODEL}/predictions`);
    const headers = createInit.headers as Record<string, string>;
    expect(headers['Prefer']).toBe('wait=60');
    expect(headers['Authorization']).toBe('Bearer tok');
    const body = JSON.parse(createInit.body as string);
    expect(body.input).toEqual({
      prompt: 'paint a cottage',
      image: [PNG_URI],
      aspect_ratio: 'match_input_image',
      output_format: 'png',
      disable_safety_checker: true,
    });
    // Second call fetched the delivery URL directly (no proxy configured).
    expect(fetchSpy.mock.calls[1][0]).toBe('https://replicate.delivery/pbxt/out.png');
  });

  it('polls urls.get to a terminal state when the sync hold returns a pending prediction', async () => {
    vi.useFakeTimers();
    const fetchSpy = mockFetchQueue([
      { ok: true, status: 201, json: { status: 'processing', urls: { get: 'https://api.replicate.com/v1/predictions/p1' } } },
      { ok: true, status: 200, json: { status: 'succeeded', output: ['https://replicate.delivery/pbxt/out.png'] } },
      { ok: true, status: 200, blobBytes: 'image-bytes' },
    ]);
    const p = generateBuildingImageReplicate({ apiToken: 'tok' }, { initImageDataUri: PNG_URI, prompt: 'x', model: MODEL });
    await vi.advanceTimersByTimeAsync(4_000);   // one 3s poll tick
    const res = await p;
    expect(res.costUsd).toBe(QWEN_EDIT_COST_USD);
    expect(fetchSpy.mock.calls[1][0]).toBe('https://api.replicate.com/v1/predictions/p1');
  });

  it('honours retry_after on a 429 create, then succeeds', async () => {
    vi.useFakeTimers();
    const fetchSpy = mockFetchQueue([
      { ok: false, status: 429, json: { retry_after: 0 } },
      { ok: true, status: 201, json: { status: 'succeeded', output: ['https://replicate.delivery/pbxt/out.png'] } },
      { ok: true, status: 200, blobBytes: 'image-bytes' },
    ]);
    const p = generateBuildingImageReplicate({ apiToken: 'tok' }, { initImageDataUri: PNG_URI, prompt: 'x', model: MODEL });
    await vi.advanceTimersByTimeAsync(2_000);   // the (retry_after + 1)s back-off
    const res = await p;
    expect(res.blob).toBeInstanceOf(Blob);
    // Two creates hit the same endpoint (retry), then the delivery fetch.
    expect(fetchSpy.mock.calls[0][0]).toBe(fetchSpy.mock.calls[1][0]);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('classifies HTTP 402 as a FATAL limit error pointing at Replicate billing', async () => {
    mockFetchQueue([{ ok: false, status: 402, text: 'Insufficient credit' }]);
    const err = await generateBuildingImageReplicate({ apiToken: 'tok' },
      { initImageDataUri: PNG_URI, prompt: 'x', model: MODEL }).catch(e => e);
    expect(err).toBeInstanceOf(ReplicateImageError);
    expect(err).toBeInstanceOf(BuildingImageError);   // seeder/studio catch this base class
    expect(err.kind).toBe('limit');
    expect(err.fatal).toBe(true);
    expect(err.helpUrl).toContain('replicate.com');
  });

  it('rewrites the absolute poll + delivery URLs onto configured proxy bases (browser same-origin)', async () => {
    vi.useFakeTimers();
    const fetchSpy = mockFetchQueue([
      { ok: true, status: 201, json: { status: 'processing', urls: { get: 'https://api.replicate.com/v1/predictions/p2' } } },
      { ok: true, status: 200, json: { status: 'succeeded', output: ['https://replicate.delivery/pbxt/out.png'] } },
      { ok: true, status: 200, blobBytes: 'image-bytes' },
    ]);
    // No apiToken: the browser sends none — the dev proxy injects it.
    const p = generateBuildingImageReplicate(
      { baseUrl: '/api/img/replicate', deliveryBaseUrl: '/api/img/replicate-delivery' },
      { initImageDataUri: PNG_URI, prompt: 'x', model: MODEL },
    );
    await vi.advanceTimersByTimeAsync(4_000);
    await p;
    expect(fetchSpy.mock.calls[0][0]).toBe(`/api/img/replicate/v1/models/${MODEL}/predictions`);
    expect(fetchSpy.mock.calls[1][0]).toBe('/api/img/replicate/v1/predictions/p2');
    expect(fetchSpy.mock.calls[2][0]).toBe('/api/img/replicate-delivery/pbxt/out.png');
    const createHeaders = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(createHeaders['Authorization']).toBeUndefined();
  });

  it('maps a failed prediction to a retryable no-image error', async () => {
    mockFetchQueue([{ ok: true, status: 201, json: { status: 'failed', error: 'NSFW detected' } }]);
    const err = await generateBuildingImageReplicate({ apiToken: 'tok' },
      { initImageDataUri: PNG_URI, prompt: 'x', model: MODEL }).catch(e => e);
    expect(err.kind).toBe('no-image');
    expect(err.fatal).toBe(false);
  });

  it('classifyReplicateImageError maps 401/403 → auth (fatal), 429 → rate (retryable)', () => {
    expect(classifyReplicateImageError(401, 'bad token').kind).toBe('auth');
    expect(classifyReplicateImageError(401, 'bad token').fatal).toBe(true);
    expect(classifyReplicateImageError(403, 'forbidden').kind).toBe('auth');
    expect(classifyReplicateImageError(429, 'slow down').kind).toBe('rate');
    expect(classifyReplicateImageError(429, 'slow down').fatal).toBe(false);
    expect(classifyReplicateImageError(400, 'payment required to run this model').kind).toBe('limit');
    expect(classifyReplicateImageError(500, 'boom').kind).toBe('http');
  });
});
