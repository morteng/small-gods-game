// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  readGeneratedNpcArt, writeGeneratedNpcArt, clearGeneratedNpcArt, _resetGeneratedNpcArtDbForTesting,
  generatedNpcArtKey, isGeneratedNpcArtFailed, writeGeneratedNpcArtFailure,
} from '@/render/generated-npc-art-cache';
import { NPC_ART_RECIPE_VERSION } from '@/core/content-version';
import { IDB_TIMEOUT_MS } from '@/services/idb-guard';

beforeEach(async () => { _resetGeneratedNpcArtDbForTesting(); await clearGeneratedNpcArt(); });

describe('generated-npc-art-cache', () => {
  it('round-trips a blob + frame layout', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    await writeGeneratedNpcArt('k1', blob, { model: 'm', prompt: 'p', frameCount: 3, cellW: 64, cellH: 64 });
    const got = await readGeneratedNpcArt('k1');
    expect(got?.frameCount).toBe(3);
    expect(got?.cellW).toBe(64);
    expect(got?.cellH).toBe(64);
    expect(await got!.blob.arrayBuffer()).toEqual(await blob.arrayBuffer());
  });

  it('returns null on miss', async () => {
    expect(await readGeneratedNpcArt('absent')).toBeNull();
  });

  it('persists a negative marker; isGeneratedNpcArtFailed reports it, read returns null', async () => {
    expect(await isGeneratedNpcArtFailed('bad')).toBe(false);   // miss
    await writeGeneratedNpcArtFailure('bad', 'm');
    expect(await isGeneratedNpcArtFailed('bad')).toBe(true);     // recorded
    expect(await readGeneratedNpcArt('bad')).toBeNull();         // never served as art
  });

  it('a real art record is not reported as failed', async () => {
    const blob = new Blob([new Uint8Array([9])], { type: 'image/png' });
    await writeGeneratedNpcArt('ok', blob, { model: 'm', prompt: 'p', frameCount: 1, cellW: 64, cellH: 64 });
    expect(await isGeneratedNpcArtFailed('ok')).toBe(false);
    expect((await readGeneratedNpcArt('ok'))?.frameCount).toBe(1);
  });
});

describe('generatedNpcArtKey', () => {
  it('embeds the recipe version by default', () => {
    expect(generatedNpcArtKey('march', 'left', 'h1', 'm')).toContain(NPC_ART_RECIPE_VERSION);
  });

  it('changes when the recipe version changes', () => {
    const a = generatedNpcArtKey('march', 'left', 'h1', 'm', 'n1');
    const b = generatedNpcArtKey('march', 'left', 'h1', 'm', 'n2');
    expect(a).not.toBe(b);
  });

  it('changes when the clip changes', () => {
    expect(generatedNpcArtKey('march', 'left', 'h1', 'm'))
      .not.toBe(generatedNpcArtKey('walk', 'left', 'h1', 'm'));
  });

  it('changes when the facing changes', () => {
    expect(generatedNpcArtKey('march', 'left', 'h1', 'm'))
      .not.toBe(generatedNpcArtKey('march', 'right', 'h1', 'm'));
  });

  it('changes when the wardrobe layer-set identity changes', () => {
    expect(generatedNpcArtKey('march', 'left', 'h1', 'm'))
      .not.toBe(generatedNpcArtKey('march', 'left', 'h2', 'm'));
  });

  it('changes when the model changes', () => {
    expect(generatedNpcArtKey('march', 'left', 'h1', 'm1'))
      .not.toBe(generatedNpcArtKey('march', 'left', 'h1', 'm2'));
  });

  it('is otherwise stable', () => {
    expect(generatedNpcArtKey('march', 'left', 'h1', 'm')).toBe(generatedNpcArtKey('march', 'left', 'h1', 'm'));
  });
});

describe('generated-npc-art-cache under a wedged IndexedDB', () => {
  it('readGeneratedNpcArt degrades to null instead of hanging (every op races withIdbTimeout)', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // An open() that NEVER fires success/error/blocked — the observed Chrome
    // failure mode idb-guard.ts exists to guard against.
    vi.stubGlobal('indexedDB', { open: () => ({ /* no callbacks ever fire */ }) });
    _resetGeneratedNpcArtDbForTesting();
    const p = readGeneratedNpcArt('any-key');
    await vi.advanceTimersByTimeAsync(IDB_TIMEOUT_MS + 1);
    await expect(p).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith('[generated-npc-art-cache] read failed:', expect.objectContaining({
      message: expect.stringContaining('timed out'),
    }));
    vi.unstubAllGlobals();
    warn.mockRestore();
    vi.useRealTimers();
  });
});
