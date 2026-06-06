import { describe, it, expect } from 'vitest';
import { parseManifest, baseBlobUrl, type BaseLibraryRecord } from '@/services/base-library-loader';

const valid = JSON.stringify({
  key: 'a1', kind: 'decoration', style: 'pixel-art', provider: 'pixellab', model: 'pixflux',
  recipeVersion: 'v1', prompt: 'a bush', width: 64, height: 64, tags: ['bush'],
  affinity: { biome: ['grassland'] }, blob: 'blobs/decoration-a1.png', generatedAt: 1,
});

describe('parseManifest', () => {
  it('parses valid NDJSON lines', () => {
    const recs = parseManifest(valid + '\n');
    expect(recs).toHaveLength(1);
    expect(recs[0].key).toBe('a1');
    expect(recs[0].tags).toEqual(['bush']);
  });
  it('skips blank and malformed lines without throwing', () => {
    const recs = parseManifest(`${valid}\n\nnot-json\n{"missing":"fields"}\n`);
    expect(recs).toHaveLength(1); // only the fully-valid record
    expect(recs[0].key).toBe('a1');
  });
});

describe('baseBlobUrl', () => {
  it('joins the library path with the relative blob path', () => {
    const rec = { blob: 'blobs/decoration-a1.png' } as BaseLibraryRecord;
    // BASE_URL is '/' in tests, so the URL is rooted there.
    expect(baseBlobUrl(rec)).toBe('/asset-library/blobs/decoration-a1.png');
  });
});
