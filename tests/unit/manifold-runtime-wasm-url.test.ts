import { describe, it, expect, beforeEach } from 'vitest';
import { manifoldModuleOptions, setManifoldWasmUrl, __resetManifoldWasmUrlForTest } from '@/assetgen/geometry/manifold-runtime';

describe('manifold wasm url seam', () => {
  beforeEach(() => __resetManifoldWasmUrlForTest());

  it('returns empty options before a url is set (Node default path)', () => {
    expect(manifoldModuleOptions()).toEqual({});
  });

  it('returns a locateFile that yields the set url after setManifoldWasmUrl', () => {
    setManifoldWasmUrl('/assets/manifold.abc123.wasm');
    const opts = manifoldModuleOptions() as { locateFile?: (p: string) => string };
    expect(typeof opts.locateFile).toBe('function');
    expect(opts.locateFile!('manifold.wasm')).toBe('/assets/manifold.abc123.wasm');
  });
});
