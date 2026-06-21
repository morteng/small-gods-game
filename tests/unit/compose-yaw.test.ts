// @vitest-environment node
// Turntable yaw (studio model rotation): a yaw of 0 must be a perfect no-op (so the
// golden G-buffer hashes stay pinned), and a non-zero yaw must deterministically
// produce a DIFFERENT bake (the model actually rotated).
import { describe, it, expect } from 'vitest';
import { composeStructure, type StructureResult } from '@/assetgen/compose';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { synthesizeBlueprint } from '@/blueprint/presets';

function djb2hex(buf: Uint8ClampedArray): string {
  let h = 5381;
  for (let i = 0; i < buf.length; i++) h = ((h << 5) + h + buf[i]) | 0;
  return (h >>> 0).toString(16);
}
const greyHash = (r: StructureResult): string => djb2hex(r.grey);

describe('composeStructure turntable yaw', () => {
  it('yaw 0 / undefined is a no-op (golden-safe)', async () => {
    const geo = toGeometry(synthesizeBlueprint('cottage')!);
    const base = await composeStructure(geo);
    const zero = await composeStructure(geo, undefined, { yaw: 0 });
    expect(greyHash(zero)).toBe(greyHash(base));
    expect(zero.size).toBe(base.size);
  }, 20_000);   // two full cottage bakes — generous timeout for loaded CI

  it('a non-zero yaw rotates the model (different, deterministic bake)', async () => {
    const geo = toGeometry(synthesizeBlueprint('cottage')!);
    const base = await composeStructure(geo);
    const a = await composeStructure(geo, undefined, { yaw: Math.PI / 2 });
    const b = await composeStructure(geo, undefined, { yaw: Math.PI / 2 });
    expect(greyHash(a)).not.toBe(greyHash(base));   // it moved
    expect(greyHash(a)).toBe(greyHash(b));          // but it's deterministic
  }, 20_000);

  it('a full turn (2π) returns to the canonical view', async () => {
    const geo = toGeometry(synthesizeBlueprint('cottage')!);
    const base = await composeStructure(geo);
    const full = await composeStructure(geo, undefined, { yaw: Math.PI * 2 });
    expect(greyHash(full)).toBe(greyHash(base));
  }, 20_000);
});
