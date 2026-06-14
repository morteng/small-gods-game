// src/studio/stage-dock.ts
// Docked pipeline-stage strip. Moved out of studio.ts (pure refactor).
import type { SpriteCanvas } from '@/render/iso/sprite-canvas';
import type { Stage } from './types';

// ── docked pipeline-stage strip ──────────────────────────────────────────────
export function buildDock(dock: HTMLElement): {
  render: (header: string, tiles: Stage[], onClick: (s: Stage) => void) => void;
  message: (m: string) => void;
} {
  dock.style.display = 'flex';
  dock.style.flexDirection = 'column';
  const head = document.createElement('div');
  head.textContent = '🔬 Pipeline stages';
  head.style.cssText = 'color:#ffd35a;font:11px monospace;padding:6px 10px 4px';
  const strip = document.createElement('div');
  strip.style.cssText = 'flex:1 1 auto;display:flex;gap:8px;overflow-x:auto;align-items:center;padding:0 10px 8px';
  dock.append(head, strip);

  const checker = (c: CanvasRenderingContext2D, w: number, h: number) => {
    for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) {
      c.fillStyle = ((x + y) / 8) % 2 ? '#2a2a3a' : '#1c1c28';
      c.fillRect(x, y, 8, 8);
    }
  };
  // Smaller thumbnails (cap by both axes, the dock height drives the visual size).
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

  function message(m: string): void { head.textContent = `🔬 Pipeline stages — ${m}`; strip.innerHTML = ''; }

  function render(header: string, tiles: Stage[], onClick: (s: Stage) => void): void {
    head.textContent = `🔬 Pipeline stages — ${header}  ·  click a stage to inspect`;
    strip.innerHTML = '';
    for (const t of tiles) {
      const cell = document.createElement('div');
      cell.style.cssText = 'flex:0 0 auto;text-align:center;cursor:pointer';
      const cap = document.createElement('div');
      cap.textContent = t.sub ? `${t.label}  ·  ${t.sub}` : t.label;
      cap.style.cssText = 'margin-top:3px;opacity:0.8;white-space:nowrap;font:10px monospace;color:#cfe';
      if (t.canvas) {
        const thumb = tileFor(t.canvas, 64);
        thumb.style.cssText = 'border:1px solid #3a3a52;image-rendering:pixelated;background:#11111a;vertical-align:middle';
        cell.append(thumb, cap);
        cell.onclick = () => onClick(t);
      } else {
        const ph = document.createElement('div');
        ph.style.cssText = 'width:64px;height:48px;border:1px dashed #3a3a52;display:flex;align-items:center;justify-content:center;opacity:0.5;color:#cfe';
        ph.textContent = '—';
        cell.append(ph, cap);
      }
      strip.appendChild(cell);
    }
  }

  return { render, message };
}
