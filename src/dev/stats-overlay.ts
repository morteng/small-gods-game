// src/dev/stats-overlay.ts
//
// A lightweight always-on dev HUD for the renderer: frames-per-second, average
// frame time, JS heap usage, and the active render backend. Mounts a single
// fixed-position DOM node into the game container (scoped — never document.body,
// per the embed/CSP contract) and updates its text a few times a second so it
// costs ~nothing per frame.
//
// FPS is measured from the rAF timestamps the game loop already has, so the
// number reflects real presented frames (GPU or Canvas2D) rather than a
// synthetic timer.

/** What the overlay can display beyond the per-frame metrics it samples itself. */
export interface StatsOverlayInfo {
  /** Active render backend label, e.g. 'webgpu' / 'canvas2d' / 'iso'. */
  backend?: string;
}

/** How often the DOM text is refreshed (ms). Sampling continues every frame. */
const UPDATE_INTERVAL_MS = 250;

export class StatsOverlay {
  private readonly el: HTMLDivElement;
  private info: StatsOverlayInfo;

  // Rolling accumulators since the last text refresh.
  private frames = 0;
  private accMs = 0;
  private windowStart = -1;

  // Last computed values (exposed for tests / external reads).
  private fps = 0;
  private frameMs = 0;

  constructor(container: HTMLElement, info: StatsOverlayInfo = {}) {
    this.info = info;
    this.el = document.createElement('div');
    this.el.className = 'sg-stats-overlay';
    Object.assign(this.el.style, {
      position: 'absolute',
      top: '8px',
      right: '8px',
      zIndex: '60',
      font: '11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace',
      color: '#bfe3ff',
      background: 'rgba(8, 12, 18, 0.72)',
      padding: '5px 8px',
      borderRadius: '6px',
      border: '1px solid rgba(120, 170, 220, 0.25)',
      whiteSpace: 'pre',
      letterSpacing: '0.02em',
      pointerEvents: 'none',
      userSelect: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    this.el.textContent = '— fps';
    container.appendChild(this.el);
  }

  /** Update the backend label (e.g. once the renderer resolves which path won). */
  setBackend(backend: string): void {
    this.info.backend = backend;
    this.draw();
  }

  /**
   * Call once per animation frame with the rAF timestamp and the frame delta.
   * Accumulates frames and refreshes the visible text every UPDATE_INTERVAL_MS.
   */
  sample(now: number, deltaMs: number): void {
    if (this.windowStart < 0) this.windowStart = now;
    this.frames += 1;
    this.accMs += deltaMs;

    const elapsed = now - this.windowStart;
    if (elapsed >= UPDATE_INTERVAL_MS) {
      this.fps = (this.frames * 1000) / elapsed;
      this.frameMs = this.accMs / this.frames;
      this.frames = 0;
      this.accMs = 0;
      this.windowStart = now;
      this.draw();
    }
  }

  /** Last computed FPS (for tests). */
  get currentFps(): number {
    return this.fps;
  }

  /** Current heap usage in MB, or null where `performance.memory` is absent. */
  static heapMB(): { used: number; total: number; limit: number } | null {
    const mem = (performance as unknown as {
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
    }).memory;
    if (!mem) return null;
    const MB = 1048576;
    return {
      used: mem.usedJSHeapSize / MB,
      total: mem.totalJSHeapSize / MB,
      limit: mem.jsHeapSizeLimit / MB,
    };
  }

  private draw(): void {
    const lines: string[] = [
      `${this.fps.toFixed(0).padStart(3)} fps   ${this.frameMs.toFixed(1).padStart(4)} ms`,
    ];
    const heap = StatsOverlay.heapMB();
    if (heap) {
      lines.push(`heap ${heap.used.toFixed(0)} / ${heap.total.toFixed(0)} MB`);
    }
    if (this.info.backend) {
      lines.push(`gpu  ${this.info.backend}`);
    }
    this.el.textContent = lines.join('\n');
  }

  destroy(): void {
    this.el.remove();
  }
}
