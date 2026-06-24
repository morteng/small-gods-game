import { describe, it, expect } from 'vitest';
import { generateWithNoise } from '@/map/map-generator';
import type { WorldSeed } from '@/core/types';
import { clearHydrologyCache } from '@/world/hydrology-store';
import { heightField } from '@/render/gpu/terrain-field';
import {
  buildRiverChannelGeometry, channelAt, SEG_STRIDE, clearRiverChannelGeometryCache,
} from '@/render/gpu/river-channel-geometry';

const seed: WorldSeed = {
  name: 'test', size: { width: 128, height: 128 }, biome: 'temperate',
  pois: [], connections: [], constraints: [],
};

async function world() {
  clearHydrologyCache();
  clearRiverChannelGeometryCache();
  const { map } = await generateWithNoise(128, 128, 7, seed);
  return map;
}

/** Midpoint of segment `i` in tile coords. */
function segMid(segments: Float32Array, i: number): { x: number; y: number } {
  const o = i * SEG_STRIDE;
  return { x: (segments[o] + segments[o + 2]) / 2, y: (segments[o + 1] + segments[o + 3]) / 2 };
}

describe('river-channel-geometry — connectome → analytic SDF geometry (S1)', () => {
  it('emits segments + a CSR bucket index for a world with rivers', async () => {
    const geo = buildRiverChannelGeometry(await world());
    expect(geo.segCount).toBeGreaterThan(0);
    expect(geo.segments.length).toBe(geo.segCount * SEG_STRIDE);
    // CSR offsets are monotonic and end at the flattened length.
    expect(geo.bucketOffset.length).toBe(geo.nbx * geo.nby + 1);
    for (let i = 0; i + 1 < geo.bucketOffset.length; i++) {
      expect(geo.bucketOffset[i + 1]).toBeGreaterThanOrEqual(geo.bucketOffset[i]);
    }
    expect(geo.bucketOffset[geo.bucketOffset.length - 1]).toBe(geo.bucketSegs.length);
  });

  it('a point ON the centreline is inside the channel (sd < 0)', async () => {
    const geo = buildRiverChannelGeometry(await world());
    const mid = segMid(geo.segments, 0);
    const q = channelAt(geo, mid.x, mid.y);
    expect(q).not.toBeNull();
    expect(q!.dist).toBeLessThan(q!.half);   // within half-width
    expect(q!.sd).toBeLessThan(0);
  });

  it('the fill surface sits above the bed at a channel point', async () => {
    const map = await world();
    const geo = buildRiverChannelGeometry(map);
    const h = heightField(map);
    const mid = segMid(geo.segments, 0);
    const q = channelAt(geo, mid.x, mid.y)!;
    const bed = h[Math.round(mid.y) * map.width + Math.round(mid.x)];
    expect(q.surf).toBeGreaterThan(bed);
  });

  it('a point far from every segment reads dry (null or sd > 0)', async () => {
    const geo = buildRiverChannelGeometry(await world());
    // scan the map for a bucket-empty cell — the analytic gate
    let foundDry = false;
    for (let y = 0; y < 128 && !foundDry; y += 4) {
      for (let x = 0; x < 128; x += 4) {
        const q = channelAt(geo, x + 0.5, y + 0.5);
        if (q === null || q.sd > 0) { foundDry = true; break; }
      }
    }
    expect(foundDry).toBe(true);
  });

  it('is deterministic — same world ⇒ identical segments + buckets', async () => {
    const a = buildRiverChannelGeometry(await world());
    const b = buildRiverChannelGeometry(await world());
    expect(Array.from(a.segments)).toEqual(Array.from(b.segments));
    expect(Array.from(a.bucketSegs)).toEqual(Array.from(b.bucketSegs));
    expect(Array.from(a.bucketOffset)).toEqual(Array.from(b.bucketOffset));
  });
});
