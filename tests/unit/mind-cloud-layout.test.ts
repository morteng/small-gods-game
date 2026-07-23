import { describe, it, expect } from 'vitest';
import { layoutMindCloud, type CloudBox, type CloudMeasure } from '@/render/ui/mind-cloud-layout';
import type { CloudToken } from '@/story/uispec';

// A deterministic fake text metric: width ∝ chars × size, height ∝ size. Enough to
// exercise packing without a WebGPU device.
const M: CloudMeasure = {
  base: 12,
  measure: (t, fs) => t.length * fs * 0.55,
  lineHeight: (fs) => fs * 1.2,
};

const BOX: CloudBox = { x: 0, y: 0, w: 600, h: 320 };

function tok(text: string, weight: number, tone: CloudToken['tone'] = 'memory'): CloudToken {
  return { text, weight, tone };
}

function overlap(a: { x: number; y: number; w: number; h: number }, b: typeof a): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

const SAMPLE: CloudToken[] = [
  tok('STORM YOU TURNED', 0.92), tok('PROSPERITY', 0.82, 'need'), tok('STORM', 0.8, 'divine'),
  tok('CORA', 0.9, 'person'), tok('FATHERS GRAVE', 0.7, 'memory'), tok('MEANING', 0.6, 'need'),
  tok('OLD TAM', 0.58, 'person'), tok('LEAN WINTER', 0.5, 'memory'), tok('COMMUNITY', 0.4, 'need'),
  tok('GOOD HARVEST', 0.38, 'memory'), tok('THE REEVE', 0.34, 'person'), tok('IDLE CHATTER', 0.1, 'memory'),
];

describe('layoutMindCloud', () => {
  it('places words without overlapping, inside the box', () => {
    const words = layoutMindCloud(SAMPLE, BOX, M);
    expect(words.length).toBeGreaterThan(6);
    for (const w of words) {
      const wd = M.measure(w.text, w.fs), ht = M.lineHeight(w.fs);
      expect(w.x).toBeGreaterThanOrEqual(BOX.x);
      expect(w.y).toBeGreaterThanOrEqual(BOX.y);
      expect(w.x + wd).toBeLessThanOrEqual(BOX.x + BOX.w + 0.5);
      expect(w.y + ht).toBeLessThanOrEqual(BOX.y + BOX.h + 0.5);
    }
    for (let i = 0; i < words.length; i++) {
      for (let j = i + 1; j < words.length; j++) {
        const a = { x: words[i].x, y: words[i].y, w: M.measure(words[i].text, words[i].fs), h: M.lineHeight(words[i].fs) };
        const b = { x: words[j].x, y: words[j].y, w: M.measure(words[j].text, words[j].fs), h: M.lineHeight(words[j].fs) };
        expect(overlap(a, b)).toBe(false);
      }
    }
  });

  it('sizes are banded (exactly four native tiers), never continuous', () => {
    const words = layoutMindCloud(SAMPLE, BOX, M);
    const tiers = new Set(words.map(w => +(w.fs / M.base).toFixed(3)));
    expect([...tiers].every(t => [2.3, 1.65, 1.2, 0.92].includes(t))).toBe(true);
  });

  it('the loudest word sits nearest the box centre', () => {
    const words = layoutMindCloud(SAMPLE, BOX, M);
    const cx = BOX.x + BOX.w / 2, cy = BOX.y + BOX.h / 2;
    const dist = (w: (typeof words)[number]) => {
      const mx = w.x + M.measure(w.text, w.fs) / 2, my = w.y + M.lineHeight(w.fs) / 2;
      return Math.hypot(mx - cx, my - cy);
    };
    const loudest = words.find(w => w.text === 'STORM YOU TURNED')!;
    const dLoud = dist(loudest);
    // it should be closer to centre than the median word
    const dists = words.map(dist).sort((a, b) => a - b);
    expect(dLoud).toBeLessThanOrEqual(dists[Math.floor(dists.length / 2)]);
  });

  it('is deterministic — same tokens, same layout', () => {
    const a = layoutMindCloud(SAMPLE, BOX, M);
    const b = layoutMindCloud(SAMPLE, BOX, M);
    expect(a).toEqual(b);
  });

  it('louder words read brighter (higher alpha)', () => {
    const words = layoutMindCloud(SAMPLE, BOX, M);
    const loud = words.find(w => w.text === 'STORM YOU TURNED')!;
    const faint = words.find(w => w.text === 'IDLE CHATTER');
    if (faint) expect(loud.alpha).toBeGreaterThan(faint.alpha);
  });

  it('drops words that cannot fit rather than shrinking them', () => {
    const tiny: CloudBox = { x: 0, y: 0, w: 60, h: 40 };
    const words = layoutMindCloud(SAMPLE, tiny, M);
    // only the shortest few can seat; a long phrase is dropped, not squeezed
    expect(words.length).toBeLessThan(SAMPLE.length);
    expect(words.some(w => w.text === 'STORM YOU TURNED')).toBe(false);
  });
});
