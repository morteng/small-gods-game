// Boot fires getOrGenerateSheet for every NPC at once. The cache must (a) share
// one promise per unique spec, (b) run only a few compositions concurrently,
// (c) release the underlying decoded item images once the queue drains.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const renderCalls: Array<() => void> = [];
vi.mock('@/render/lpc/canvas/renderer.js', () => ({
  renderCharacter: vi.fn(() => new Promise<void>((resolve) => { renderCalls.push(resolve); })),
}));
vi.mock('@/render/lpc/canvas/load-image.js', () => ({
  clearImageCache: vi.fn(),
}));

import { getOrGenerateSheet, clearSheetCache } from '@/render/lpc/spritesheet-cache';
import { renderCharacter } from '@/render/lpc/canvas/renderer.js';
import { clearImageCache } from '@/render/lpc/canvas/load-image.js';
import type { CharacterSpec } from '@/render/lpc/character-builder';

const spec = (hair: string): CharacterSpec => ({
  sex: 'male', bodyType: 'male',
  items: { hair: { itemId: hair, variant: 'black' } },
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('lpc spritesheet cache', () => {
  beforeEach(() => {
    clearSheetCache();
    renderCalls.length = 0;
    vi.mocked(renderCharacter).mockClear();
    vi.mocked(clearImageCache).mockClear();
  });

  it('same spec shares one generation', async () => {
    const p1 = getOrGenerateSheet(spec('hair_plain'));
    const p2 = getOrGenerateSheet(spec('hair_plain'));
    await flush();
    expect(renderCharacter).toHaveBeenCalledTimes(1);
    renderCalls[0]();
    const [a, b] = await Promise.all([p1, p2]);
    expect(a).not.toBeNull();
    expect(b).toBe(a);
  });

  it('at most 3 compositions run concurrently; the rest queue FIFO', async () => {
    const specs = ['a', 'b', 'c', 'd', 'e'].map(spec);
    const ps = specs.map((s) => getOrGenerateSheet(s));
    await flush();
    expect(renderCharacter).toHaveBeenCalledTimes(3);  // 2 queued
    renderCalls[0]();
    await flush();
    expect(renderCharacter).toHaveBeenCalledTimes(4);
    renderCalls[1](); renderCalls[2](); renderCalls[3]();
    await flush();
    expect(renderCharacter).toHaveBeenCalledTimes(5);
    renderCalls[4]();
    const sheets = await Promise.all(ps);
    expect(sheets.every((s) => s !== null)).toBe(true);
  });

  it('releases the decoded item-image cache when the queue drains (and not before)', async () => {
    const p1 = getOrGenerateSheet(spec('x'));
    const p2 = getOrGenerateSheet(spec('y'));
    await flush();
    renderCalls[0]();
    await p1;
    expect(clearImageCache).not.toHaveBeenCalled(); // y still in flight
    renderCalls[1]();
    await p2;
    expect(clearImageCache).toHaveBeenCalledTimes(1);
  });

  it('a failed generation caches null and still counts toward the drain', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(renderCharacter).mockRejectedValueOnce(new Error('render boom'));
    const sheet = await getOrGenerateSheet(spec('bad'));
    expect(sheet).toBeNull();
    expect(clearImageCache).toHaveBeenCalledTimes(1);
    // settled failure is cached — no retry
    await getOrGenerateSheet(spec('bad'));
    expect(renderCharacter).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
