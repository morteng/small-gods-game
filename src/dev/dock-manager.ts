export type DockState =
  | { kind: 'float'; x: number; y: number }
  | { kind: 'left'; order: number }
  | { kind: 'right'; order: number };

export interface DockManagerOptions {
  container: HTMLElement;
  storageKey?: string;
  edgeThreshold?: number;
  railWidth?: number;
}

export interface DockedPanel {
  id: string;
  element: HTMLElement;
  setOpen(open: boolean): void;
}

export interface DockManager {
  register(panel: DockedPanel): void;
  onDragEnd(id: string, rect: { left: number; top: number; width: number; height: number }): void;
  noteOpen(id: string, open: boolean): void;
  getState(id: string): DockState;
  restore(): void;
  relayout(): void;
  destroy(): void;
}

interface Entry { panel: DockedPanel; dock: DockState; open: boolean; }

export function createDockManager(opts: DockManagerOptions): DockManager {
  const container = opts.container;
  const storageKey = opts.storageKey ?? 'small-gods-dev-layout';
  const edgeThreshold = opts.edgeThreshold ?? 32;
  const railWidth = opts.railWidth ?? 230;

  const entries = new Map<string, Entry>();
  const persisted = readPersisted();

  function readPersisted(): Record<string, { dock: DockState; open: boolean }> {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }
  function persist(): void {
    const out: Record<string, { dock: DockState; open: boolean }> = {};
    for (const [id, e] of entries) out[id] = { dock: e.dock, open: e.open };
    try { localStorage.setItem(storageKey, JSON.stringify(out)); } catch { /* ignore */ }
  }
  function nextOrder(kind: 'left' | 'right'): number {
    let max = -1;
    for (const e of entries.values()) if (e.dock.kind === kind) max = Math.max(max, e.dock.order);
    return max + 1;
  }

  function register(panel: DockedPanel): void {
    const prev = persisted[panel.id];
    const dock: DockState = prev?.dock ?? { kind: 'float', x: 0, y: 0 };
    entries.set(panel.id, { panel, dock, open: prev?.open ?? false });
  }

  function onDragEnd(id: string, rect: { left: number; top: number; width: number; height: number }): void {
    const e = entries.get(id);
    if (!e) return;
    const cb = container.getBoundingClientRect();
    const nearLeft = rect.left - cb.left <= edgeThreshold;
    const nearRight = (cb.left + cb.width) - (rect.left + rect.width) <= edgeThreshold;
    if (nearLeft) e.dock = { kind: 'left', order: nextOrder('left') };
    else if (nearRight) e.dock = { kind: 'right', order: nextOrder('right') };
    else e.dock = { kind: 'float', x: rect.left - cb.left, y: rect.top - cb.top };
    persist();
    relayout();
  }

  function applyOne(e: Entry): void {
    const el = e.panel.element;
    if (e.dock.kind === 'float') {
      el.style.left = `${e.dock.x}px`;
      el.style.top = `${e.dock.y}px`;
      el.style.right = 'auto';
      el.style.width = el.style.width || `${railWidth}px`;
    } else {
      const side = e.dock.kind;
      el.style.width = `${railWidth}px`;
      if (side === 'left') { el.style.left = '0px'; el.style.right = 'auto'; }
      else { el.style.right = '0px'; el.style.left = 'auto'; }
    }
  }

  function relayout(): void {
    // Float panels: place individually. Docked: stack per rail by order.
    for (const e of entries.values()) if (e.dock.kind === 'float') applyOne(e);
    for (const side of ['left', 'right'] as const) {
      const docked = [...entries.values()]
        .filter(e => e.dock.kind === side)
        .sort((a, b) => (a.dock as { order: number }).order - (b.dock as { order: number }).order);
      let top = 8;
      for (const e of docked) {
        applyOne(e);
        e.panel.element.style.top = `${top}px`;
        const h = e.panel.element.getBoundingClientRect().height || 200;
        top += h + 8;
      }
    }
  }

  function noteOpen(id: string, open: boolean): void {
    const e = entries.get(id);
    if (!e) return;
    e.open = open;
    persist();
  }

  function getState(id: string): DockState {
    return entries.get(id)?.dock ?? { kind: 'float', x: 0, y: 0 };
  }

  function restore(): void {
    for (const [id, e] of entries) {
      const prev = persisted[id];
      if (prev) { e.dock = prev.dock; e.open = prev.open; e.panel.setOpen(prev.open); }
    }
    relayout();
  }

  function destroy(): void { entries.clear(); }

  return { register, onDragEnd, noteOpen, getState, restore, relayout, destroy };
}
