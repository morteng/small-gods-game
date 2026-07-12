import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateBuildingImageAuto, isReplicateImageModel, BUILDING_IMAGE_MODEL,
} from '@/llm/building-image';
import { generateBuildingImage } from '@/llm/openrouter-image-client';
import { generateBuildingImageReplicate } from '@/llm/replicate-image-client';

// Mock ONLY the generate functions; everything else (types, BuildingImageError,
// which replicate-image-client itself imports from the openrouter module) stays real.
vi.mock('@/llm/openrouter-image-client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/llm/openrouter-image-client')>();
  return { ...mod, generateBuildingImage: vi.fn(async () => ({ blob: new Blob(['or']), costUsd: 0.014 })) };
});
vi.mock('@/llm/replicate-image-client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/llm/replicate-image-client')>();
  return { ...mod, generateBuildingImageReplicate: vi.fn(async () => ({ blob: new Blob(['rep']), costUsd: 0.03 })) };
});

const PNG_URI = 'data:image/png;base64,AAAA';
const CFG = {
  openrouter: { apiKey: 'or-key', baseUrl: '/api/llm/openrouter/api/v1' },
  replicate: { baseUrl: '/api/img/replicate', deliveryBaseUrl: '/api/img/replicate-delivery' },
};

beforeEach(() => vi.clearAllMocks());

describe('BUILDING_IMAGE_MODEL / isReplicateImageModel', () => {
  it('defaults to qwen-image-edit-2511 (a Replicate model)', () => {
    expect(BUILDING_IMAGE_MODEL).toBe('qwen/qwen-image-edit-2511');
    expect(isReplicateImageModel(BUILDING_IMAGE_MODEL)).toBe(true);
  });
  it('classifies by the qwen/ prefix only', () => {
    expect(isReplicateImageModel('qwen/qwen-image-edit-2511')).toBe(true);
    expect(isReplicateImageModel('google/gemini-2.5-flash-image')).toBe(false);
    expect(isReplicateImageModel('black-forest-labs/flux.2-klein-4b')).toBe(false);
  });
});

describe('generateBuildingImageAuto routing', () => {
  it('routes the default model (opts.model omitted) to the Replicate client with the replicate cfg', async () => {
    const res = await generateBuildingImageAuto(CFG, { initImageDataUri: PNG_URI, prompt: 'p' });
    expect(res.costUsd).toBeCloseTo(0.03);
    expect(generateBuildingImageReplicate).toHaveBeenCalledOnce();
    expect(generateBuildingImage).not.toHaveBeenCalled();
    const [cfg, opts] = vi.mocked(generateBuildingImageReplicate).mock.calls[0];
    expect(cfg).toBe(CFG.replicate);
    expect(opts).toEqual({ initImageDataUri: PNG_URI, prompt: 'p', model: BUILDING_IMAGE_MODEL, signal: undefined });
  });

  it('routes an explicit qwen model to Replicate even with a missing replicate cfg (defaults to {})', async () => {
    await generateBuildingImageAuto({ openrouter: CFG.openrouter },
      { initImageDataUri: PNG_URI, prompt: 'p', model: 'qwen/qwen-image-edit-2511' });
    expect(generateBuildingImageReplicate).toHaveBeenCalledOnce();
    expect(vi.mocked(generateBuildingImageReplicate).mock.calls[0][0]).toEqual({});
  });

  it('routes non-qwen model ids (studio A/B, gemini) to the OpenRouter client with the model preserved', async () => {
    const res = await generateBuildingImageAuto(CFG,
      { initImageDataUri: PNG_URI, prompt: 'p', model: 'google/gemini-2.5-flash-image' });
    expect(res.costUsd).toBeCloseTo(0.014);
    expect(generateBuildingImage).toHaveBeenCalledOnce();
    expect(generateBuildingImageReplicate).not.toHaveBeenCalled();
    const [cfg, opts] = vi.mocked(generateBuildingImage).mock.calls[0];
    expect(cfg).toBe(CFG.openrouter);
    expect(opts.model).toBe('google/gemini-2.5-flash-image');
  });
});
