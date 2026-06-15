/**
 * FPS HUD — a tiny always-on-top readout of the live render cost.
 *
 * Read this in a REAL browser: Playwright/CDP throttles the rAF loop, so its
 * absolute FPS numbers are meaningless (a ¼-area canvas measured identical FPS,
 * proving the cap was environmental, not fill-rate). The HUD lets you eyeball
 * the true number in Chrome while you pan/zoom. Shows median FPS, frame
 * interval, render() cost, and p95 render (the hitch indicator).
 *
 * Scoped to the game container (no document.body assumptions, embed-safe).
 */

import type { FpsStats } from '@/dev/profile';

export interface FpsHudHandle {
  update(stats: FpsStats): void;
  setVisible(visible: boolean): void;
  toggle(): boolean;
  isVisible(): boolean;
  destroy(): void;
}

const STYLE = `
.sg-fps {
  position: absolute;
  top: 8px; left: 8px;
  z-index: 200;
  padding: 6px 9px;
  border-radius: 6px;
  background: rgba(8, 10, 14, 0.78);
  color: #cfe8b8;
  font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.02em;
  white-space: pre;
  pointer-events: none;
  user-select: none;
  text-shadow: 0 1px 1px rgba(0,0,0,0.6);
}
.sg-fps--hidden { display: none; }
.sg-fps__big { color: #eafbd6; font-weight: 700; }
.sg-fps__warn { color: #f3c66b; }
.sg-fps__idle { color: #8b8f9a; }
`;

export function createFpsHud(container: HTMLElement): FpsHudHandle {
  if (!document.querySelector('#sg-fps-styles')) {
    const style = document.createElement('style');
    style.id = 'sg-fps-styles';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  const el = document.createElement('div');
  el.className = 'sg-fps sg-fps--hidden';
  el.textContent = 'fps —';
  container.appendChild(el);

  let visible = false;

  return {
    update(s: FpsStats): void {
      if (!visible) return;
      if (s.idle) {
        el.innerHTML = `<span class="sg-fps__idle">idle (render-on-demand)</span>`;
        return;
      }
      const slow = s.fps < 55;
      const cls = slow ? 'sg-fps__warn' : 'sg-fps__big';
      el.innerHTML =
        `<span class="${cls}">${s.fps.toFixed(0)} fps</span>  ${s.frameMs.toFixed(1)}ms\n` +
        `render ${s.renderMs.toFixed(1)}ms  p95 ${s.renderP95Ms.toFixed(1)}ms`;
    },
    setVisible(v: boolean): void {
      visible = v;
      el.classList.toggle('sg-fps--hidden', !v);
    },
    toggle(): boolean {
      this.setVisible(!visible);
      return visible;
    },
    isVisible(): boolean { return visible; },
    destroy(): void { el.remove(); },
  };
}
