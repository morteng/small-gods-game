// src/studio/stage-dock.ts
// Pipeline-stage strip — lives in the bottom dock's "Pipeline" tab. The tab
// already names it, so the head is just the per-asset summary ("cottage · canvas
// N² · crop W×H"). Each retained compose / generation buffer is a clickable thumb.
import type { SpriteCanvas } from '@/render/iso/sprite-canvas';
import type { Stage } from './types';
import { h } from './theme';

export function buildDock(dock: HTMLElement): {
  render: (header: string, tiles: Stage[], onClick: (s: Stage) => void) => void;
  message: (m: string) => void;
} {
  dock.style.cssText += ';display:flex;flex-direction:column;min-height:0';
  const head = h('div', { class: 'sg-muted', style: 'font-size:10px;padding:6px 11px 4px' });
  const strip = h('div', { style: 'flex:1 1 auto;display:flex;gap:10px;overflow-x:auto;align-items:center;padding:0 11px 8px' });
  dock.append(head, strip);

  const checker = (c: CanvasRenderingContext2D, w: number, hh: number) => {
    for (let y = 0; y < hh; y += 8) for (let x = 0; x < w; x += 8) {
      c.fillStyle = ((x + y) / 8) % 2 ? '#181a21' : '#121319';
      c.fillRect(x, y, 8, 8);
    }
  };
  const tileFor = (src: SpriteCanvas, max: number): HTMLCanvasElement => {
    const s = Math.max(0.05, Math.min(max / src.width, max / src.height));
    const tw = Math.max(1, Math.round(src.width * s)), th = Math.max(1, Math.round(src.height * s));
    const cv = document.createElement('canvas'); cv.width = tw; cv.height = th;
    const cx = cv.getContext('2d')!;
    checker(cx, tw, th);
    cx.imageSmoothingEnabled = false;
    cx.drawImage(src as CanvasImageSource, 0, 0, tw, th);
    return cv;
  };

  function message(m: string): void { head.textContent = m; strip.innerHTML = ''; }

  function render(header: string, tiles: Stage[], onClick: (s: Stage) => void): void {
    head.textContent = `${header}  ·  click a stage to inspect`;
    strip.innerHTML = '';
    for (const t of tiles) {
      const cap = h('div', { class: 'sg-muted', style: 'margin-top:4px;white-space:nowrap;font-size:10px', text: t.sub ? `${t.label}  ·  ${t.sub}` : t.label });
      if (t.canvas) {
        const thumb = tileFor(t.canvas, 64);
        thumb.style.cssText = 'border:1px solid var(--line-2);border-radius:4px;image-rendering:pixelated;background:var(--bg-0);vertical-align:middle;transition:border-color .12s';
        const cell = h('div', { style: 'flex:0 0 auto;text-align:center;cursor:pointer', on: { click: () => onClick(t), mouseenter: () => { thumb.style.borderColor = 'var(--accent-dim)'; }, mouseleave: () => { thumb.style.borderColor = 'var(--line-2)'; } } }, thumb, cap);
        strip.appendChild(cell);
      } else {
        const ph = h('div', { class: 'sg-muted', style: 'width:64px;height:48px;border:1px dashed var(--line-2);border-radius:4px;display:flex;align-items:center;justify-content:center', text: '—' });
        strip.appendChild(h('div', { style: 'flex:0 0 auto;text-align:center' }, ph, cap));
      }
    }
  }

  return { render, message };
}
