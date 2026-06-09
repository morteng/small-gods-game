/**
 * Render Bench — a dev panel listing every building kind as a button. Clicking
 * one snaps the live camera to the first instance of that kind in the world
 * (via the debug focus verb), so you can eyeball any building's geometry in one
 * click. Pairs with `window.__debug` (see src/dev/debug-api.ts) and DEV_LOOP.md.
 */
import { createFloatingPanel, type FloatingPanelHandle } from './FloatingPanel';
import { entityKinds } from '@/world/entity-kinds';
import type { DockManager } from './dock-manager';

export interface RenderBenchOptions {
  container: HTMLElement;
  /** Snap the camera to the first entity of `kind`; returns false if none exist. */
  onFocusKind: (kind: string, zoom: number) => boolean;
  dock?: DockManager;
}

export interface RenderBenchHandle {
  toggle(): void;
  show(): void;
  hide(): void;
  isVisible(): boolean;
  destroy(): void;
}

const ZOOM = 4;

export function buildingKinds(): string[] {
  return [...entityKinds.values()].filter(d => d.category === 'building').map(d => d.id);
}

export function createRenderBenchPanel(opts: RenderBenchOptions): RenderBenchHandle {
  const panel: FloatingPanelHandle = createFloatingPanel({
    container: opts.container,
    title: '🏚 Render Bench',
    width: 240,
    anchor: { top: '60px', left: '10px' },
    id: 'render-bench',
    dock: opts.dock,
  });

  const note = document.createElement('div');
  note.textContent = 'Click a kind to snap the camera to it.';
  note.style.cssText = 'font-size:11px;color:var(--ink-3,#888);margin-bottom:8px;';
  panel.body.appendChild(note);

  const status = document.createElement('div');
  status.style.cssText = 'font-size:11px;color:var(--time,#c90);min-height:14px;margin-bottom:8px;';

  const grid = document.createElement('div');
  grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
  for (const kind of buildingKinds()) {
    const btn = document.createElement('button');
    btn.className = 'sg-btn sg-btn--ghost';
    btn.textContent = kind;
    btn.style.cssText = 'font-size:11px;padding:3px 8px;';
    btn.addEventListener('click', () => {
      const ok = opts.onFocusKind(kind, ZOOM);
      status.textContent = ok ? `→ ${kind}` : `no ${kind} in this world`;
    });
    grid.appendChild(btn);
  }

  panel.body.appendChild(status);
  panel.body.appendChild(grid);

  return {
    toggle: () => panel.toggle(),
    show: () => panel.show(),
    hide: () => panel.hide(),
    isVisible: () => panel.isVisible(),
    destroy: () => panel.destroy(),
  };
}
