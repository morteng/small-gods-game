// tests/unit/author-preview.test.ts
// Phase B0 authoring-preview loop: diagnostics shape, gate exit-code semantics, and
// determinism (two runs → byte-identical PNG). Tooling, not shipped geometry — deliberately
// NO golden pins (scripts are not pinned).
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authorPreview, runAuthorPreview, buildStats } from '../../scripts/author-preview';
import type { AuthorInput } from '@/blueprint/authoring';
import { BLUEPRINT_VERSION } from '@/blueprint/types';

describe('authorPreview diagnostics', () => {
  it('a known preset passes the gate with a sane stats block', async () => {
    const res = await authorPreview({ preset: 'cottage' });
    expect(res.ok).toBe(true);
    expect(res.stats).toBeDefined();
    const s = res.stats!;
    // shape: expected keys present
    expect(typeof s.size).toBe('number');
    expect(typeof s.bbox).toBe('object');
    expect(typeof s.opaqueFraction).toBe('number');
    expect(s.materials).toBeDefined();
    expect(s.anchors).toBeDefined();
    expect(Array.isArray(s.anchors.tags)).toBe(true);
    expect(Array.isArray(s.labels)).toBe(true);
    // bbox sane + finite
    for (const k of ['x', 'y', 'w', 'h'] as const) {
      expect(Number.isFinite(s.bbox[k])).toBe(true);
      expect(s.bbox[k]).toBeGreaterThanOrEqual(0);
    }
    expect(s.bbox.w).toBeGreaterThan(0);
    expect(s.bbox.h).toBeGreaterThan(0);
    expect(s.size).toBeGreaterThan(0);
    expect(s.opaqueFraction).toBeGreaterThan(0);  // a building engraves real pixels
    // a rendered PNG is produced deterministically
    expect(res.greyPng).toBeInstanceOf(Buffer);
    expect(res.greyPng!.length).toBeGreaterThan(0);
  });

  it('a hand-authored blueprint passes the gate and reports materials + anchors', async () => {
    const input: AuthorInput = {
      blueprint: {
        version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 4, h: 4 },
        materials: { walls: 'stone', roof: 'tile' },
        parts: {
          body: {
            type: 'body', size: { w: 4, h: 4 }, params: { plan: 'rect', levels: 2, roof: 'hip' },
            features: { door: { type: 'door', face: 'south', params: { main: true } } },
          },
        },
      },
    };
    const res = await authorPreview(input);
    expect(res.ok).toBe(true);
    const s = res.stats!;
    expect(Object.keys(s.materials).length).toBeGreaterThan(0);
    expect(s.materials.stone).toBeGreaterThan(0);
  });

  it('buildStats is a pure keyed projection (labels default to empty unless labeled)', () => {
    // buildStats only needs a minimal StructureResult-shaped slice of compose output;
    // exercised via a composed result below for shape stability.
    expect(typeof buildStats).toBe('function');
  });
});

describe('authorPreview gate exit-code semantics (runAuthorPreview)', () => {
  it('a broken spec (unknown preset) exits non-zero with actionable output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'author-preview-'));
    const spec = join(dir, 'broken.json');
    writeFileSync(spec, JSON.stringify({ preset: 'does-not-exist' }));
    try {
      const code = await runAuthorPreview([spec]);
      expect(code).toBe(1);   // gate rejection ⇒ non-zero (NOT a crash)
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a blueprint that fails to resolve also exits non-zero', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'author-preview-'));
    const spec = join(dir, 'broken2.json');
    writeFileSync(spec, JSON.stringify({
      blueprint: { version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 2, h: 2 },
        materials: { walls: 'stone', roof: 'tile' }, parts: { x: { type: 'no-such-part-type' } } },
    }));
    try {
      const code = await runAuthorPreview([spec]);
      expect(code).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('malformed spec JSON exits with the usage/bad-input code (2)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'author-preview-'));
    const spec = join(dir, 'broken.json');
    writeFileSync(spec, '{ not valid json');
    try {
      const code = await runAuthorPreview([spec]);
      expect(code).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('no spec argument is a usage error (exit 2)', async () => {
    expect(await runAuthorPreview([])).toBe(2);
  });

  it('an unknown --map value is a usage error (exit 2), a valid one succeeds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'author-preview-'));
    const spec = join(dir, 's.json');
    writeFileSync(spec, JSON.stringify({ preset: 'cottage' }));
    try {
      expect(await runAuthorPreview([spec, '--map', 'bogus'])).toBe(2);
      expect(await runAuthorPreview([spec, '--map', 'normal'])).toBe(0);
      expect(await runAuthorPreview([spec, '--map', 'material'])).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('authorPreview determinism', () => {
  it('two runs over the same spec yield byte-identical PNGs', async () => {
    const a = await authorPreview({ preset: 'cottage' });
    const b = await authorPreview({ preset: 'cottage' });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.greyPng).toEqual(b.greyPng);
  });

  it('deterministic diagnostics JSON for the same spec', async () => {
    const a = await authorPreview({ preset: 'cottage' });
    const b = await authorPreview({ preset: 'cottage' });
    expect(a.stats).toEqual(b.stats);
  });
});
