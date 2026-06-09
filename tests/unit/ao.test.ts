import { describe, it, expect } from 'vitest';
import { computeAO } from '@/assetgen/render/ao';

describe('computeAO', () => {
  it('darkens pixels beside a nearer occluder, leaves flat areas open', () => {
    const size = 5;
    const depth = new Float32Array(size * size).fill(0);
    for (let y = 0; y < size; y++) depth[y * size + 2] = 5; // near ridge at column 2
    const occluded = new Float32Array(size * size);
    occluded.fill(1);
    const ao = computeAO(depth, occluded, size, 1, 1.5);
    const beside = ao[2 * size + 1];
    const farFlat = ao[2 * size + 4];
    expect(beside).toBeLessThan(farFlat);
    expect(farFlat).toBeGreaterThan(200);
  });
});
