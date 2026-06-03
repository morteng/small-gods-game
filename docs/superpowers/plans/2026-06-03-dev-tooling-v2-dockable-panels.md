# Dev Tooling v2 — Dockable Panels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** All dev panels share one `FloatingPanel`, snap-dock to left/right rails with persisted layout, are presented via a dev toolbar (every function button-reachable), and the conflicting `Ctrl+Shift+I` render-toggle shortcut is replaced by a toolbar button.

**Architecture:** A `dock-manager` owns left/right rails + free-float positions + localStorage persistence; `FloatingPanel` reports drag-end to it and notes open/close. A `dev-toolbar` toggles panels and triggers render/undo/redo. `DevModeController` wires it all; `TimeDebug`/`MapEditor`/`DebugOverlay` migrate onto `FloatingPanel`.

**Tech Stack:** TypeScript ES modules, Vite, Vitest (jsdom). `@/` → `src/`.

**Reference spec:** `docs/superpowers/specs/2026-06-03-dev-tooling-v2-dockable-panels-design.md`

**Context the implementer needs:**
- `FloatingPanel` (`src/dev/FloatingPanel.ts`) exports `createFloatingPanel({container,title,width?,anchor?,zIndex?})` → `{element, body, setTitle, show, hide, toggle, isVisible, destroy}`, and `DEV_UI_Z=600`. `PanelChrome.addPanelChrome(panel,{title,onClose?,onMinimize?,onDragEnd?})` returns `{element,setTitle,setMinimized}` and calls `onDragEnd(x,y)` (viewport coords) on drag release.
- `src/render/select-renderer.ts` exports `readRenderMode(): 'iso'|'topdown'` and `toggleRenderMode()` (flips localStorage + reloads).
- Dev panels mount into the game `container` which is forced `position:relative` (so absolute children are container-relative). jsdom `getBoundingClientRect()` returns zeros — tests must pass synthetic rects and stub container bounds.

---

## File Structure

- `src/dev/dev-styles.ts` — MODIFY: add toolbar + dock classes.
- `src/dev/dock-manager.ts` — CREATE: rails, snap, persistence.
- `src/dev/FloatingPanel.ts` — MODIFY: `id` + `dock` integration.
- `src/dev/dev-toolbar.ts` — CREATE.
- `src/dev/TimeDebugPanel.ts`, `MapEditorPanel.ts`, `DebugOverlayPanel.ts` — MODIFY: migrate shell to FloatingPanel.
- `src/game/dev-mode-controller.ts` — MODIFY: dock manager + toolbar + register + restore.
- `src/game.ts` — MODIFY: remove `attachRenderToggleKey`.
- Tests: `tests/dom/dock-manager.test.ts`, `tests/dom/dev-toolbar.test.ts`, `tests/dom/floating-panel.test.ts` (append) — CREATE/append; adapt panel + controller tests.

---

### Task 1: Dev-styles — toolbar + dock classes

**Files:** Modify `src/dev/dev-styles.ts`; Test: `tests/dom/dev-toolbar.test.ts` (created in Task 4 will assert these — for now add a minimal assertion here).

- [ ] **Step 1: Write the failing test** — append to the existing `tests/dom/floating-panel.test.ts` `injectDevStyles` block a new assertion in a fresh `it`:

```ts
import { injectDevStyles as injectDevStyles2 } from '@/dev/dev-styles';
it('includes toolbar + dock classes', () => {
  injectDevStyles2();
  const css = document.getElementById('sg-dev-styles')?.textContent ?? '';
  expect(css).toContain('.sg-dev-toolbar');
  expect(css).toContain('.sg-dev-toolbar__btn');
  expect(css).toContain('.sg-dev-rail-hint');
});
```
(If re-importing the same symbol name clashes, reuse the existing `injectDevStyles` import already in that file and drop the alias.)

- [ ] **Step 2: Run** `npx vitest run tests/dom/floating-panel.test.ts` → FAIL (classes absent).

- [ ] **Step 3: Append to the `STYLE` template in `src/dev/dev-styles.ts`:**

```
.sg-dev-toolbar {
  position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
  display: flex; gap: 4px; align-items: center;
  padding: 4px 6px; background: rgba(20,20,30,0.95);
  border: 1px solid #555; border-radius: 6px; font: 11px sans-serif;
}
.sg-dev-toolbar__btn {
  all: unset; cursor: pointer; padding: 4px 8px; border-radius: 3px;
  color: #cfe0f0; background: rgba(255,255,255,0.06); border: 1px solid #555;
}
.sg-dev-toolbar__btn:hover { background: rgba(255,255,255,0.14); }
.sg-dev-toolbar__btn--active { background: rgba(100,150,255,0.30); color: #eaf3ff; border-color: #88a; }
.sg-dev-rail-hint {
  position: absolute; top: 0; bottom: 0; width: 4px;
  background: rgba(100,150,255,0.5); pointer-events: none; display: none;
}
```

- [ ] **Step 4: Run** the test → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dev/dev-styles.ts tests/dom/floating-panel.test.ts
git commit -m "feat(dev): toolbar + dock-rail styles in dev-styles"
```

---

### Task 2: `dock-manager.ts`

**Files:** Create `src/dev/dock-manager.ts`; Test: `tests/dom/dock-manager.test.ts`.

- [ ] **Step 1: Write the failing test** — `tests/dom/dock-manager.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDockManager } from '@/dev/dock-manager';

function fakePanel(id: string) {
  const element = document.createElement('div');
  let open = false;
  return { id, element, setOpen: (o: boolean) => { open = o; }, get open() { return open; } };
}
function stubBounds(el: HTMLElement, r: { left: number; top: number; right: number; bottom: number }) {
  el.getBoundingClientRect = () => ({ ...r, width: r.right - r.left, height: r.bottom - r.top, x: r.left, y: r.top, toJSON() {} }) as DOMRect;
}

describe('dock-manager', () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    stubBounds(container, { left: 0, top: 0, right: 1000, bottom: 800 });
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  it('docks left when dropped near the left edge, right near the right edge, floats in the middle', () => {
    const dm = createDockManager({ container, edgeThreshold: 32 });
    const a = fakePanel('a'), b = fakePanel('b'), c = fakePanel('c');
    dm.register(a); dm.register(b); dm.register(c);
    dm.onDragEnd('a', { left: 5, top: 100, width: 200, height: 150 });   // near left
    dm.onDragEnd('b', { left: 790, top: 100, width: 200, height: 150 }); // right edge: 990 within 32 of 1000
    dm.onDragEnd('c', { left: 400, top: 300, width: 200, height: 150 }); // middle → float
    expect(dm.getState('a').kind).toBe('left');
    expect(dm.getState('b').kind).toBe('right');
    expect(dm.getState('c')).toEqual({ kind: 'float', x: 400, y: 300 });
  });

  it('stacks two left-docked panels with increasing order and distinct tops', () => {
    const dm = createDockManager({ container });
    const a = fakePanel('a'), b = fakePanel('b');
    dm.register(a); dm.register(b);
    dm.onDragEnd('a', { left: 2, top: 100, width: 200, height: 150 });
    dm.onDragEnd('b', { left: 2, top: 100, width: 200, height: 150 });
    expect((dm.getState('a') as any).order).toBe(0);
    expect((dm.getState('b') as any).order).toBe(1);
    dm.relayout();
    expect(a.element.style.top).not.toBe(b.element.style.top);
    expect(a.element.style.left).toBe('0px');
  });

  it('persists and restores layout via localStorage', () => {
    const dm = createDockManager({ container, storageKey: 'test-layout' });
    const a = fakePanel('a'); dm.register(a);
    dm.onDragEnd('a', { left: 2, top: 100, width: 200, height: 150 }); // dock left
    // New manager + panel, same key → restore
    const dm2 = createDockManager({ container, storageKey: 'test-layout' });
    const a2 = fakePanel('a'); dm2.register(a2); dm2.restore();
    expect(dm2.getState('a').kind).toBe('left');
  });

  it('ignores an unknown persisted id on restore', () => {
    try { localStorage.setItem('k', JSON.stringify({ ghost: { dock: { kind: 'left', order: 0 }, open: true } })); } catch { /* ignore */ }
    const dm = createDockManager({ container, storageKey: 'k' });
    expect(() => dm.restore()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/dom/dock-manager.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `src/dev/dock-manager.ts`:**

```ts
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
```

- [ ] **Step 4: Run** the test → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dev/dock-manager.ts tests/dom/dock-manager.test.ts
git commit -m "feat(dev): dock-manager — snap-to-side rails + layout persistence"
```

---

### Task 3: `FloatingPanel` — `id` + dock integration

**Files:** Modify `src/dev/FloatingPanel.ts`; Test: append to `tests/dom/floating-panel.test.ts`.

- [ ] **Step 1: Write the failing test** (append):

```ts
import { createFloatingPanel as cfp2 } from '@/dev/FloatingPanel';

describe('FloatingPanel dock integration', () => {
  it('registers with the dock manager and notes open/close', () => {
    const container = document.createElement('div'); document.body.appendChild(container);
    const calls: string[] = [];
    const dock = {
      register: (p: any) => calls.push(`register:${p.id}`),
      onDragEnd: (id: string) => calls.push(`drag:${id}`),
      noteOpen: (id: string, open: boolean) => calls.push(`open:${id}:${open}`),
      getState: () => ({ kind: 'float', x: 0, y: 0 }), restore() {}, relayout() {}, destroy() {},
    } as any;
    const p = cfp2({ container, title: 'T', id: 'panel-x', dock });
    expect(calls).toContain('register:panel-x');
    p.show(); p.hide();
    expect(calls).toContain('open:panel-x:true');
    expect(calls).toContain('open:panel-x:false');
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/dom/floating-panel.test.ts` → FAIL (`id` not accepted / no register call).

- [ ] **Step 3: Modify `FloatingPanel.ts`:**
  - Add to `FloatingPanelOptions`: `id?: string;` and `dock?: import('./dock-manager').DockManager;` (or import the type at top: `import type { DockManager } from './dock-manager';` then `dock?: DockManager;`).
  - When building the chrome, pass `onDragEnd`:
    ```ts
    const chrome = addPanelChrome(panel, {
      title: opts.title,
      onClose: () => hide(),
      onDragEnd: () => { if (opts.dock && opts.id) opts.dock.onDragEnd(opts.id, panel.getBoundingClientRect()); },
    });
    ```
  - Refactor `show`/`hide` into named functions so `onClose` can call `hide`, and have them notify the dock:
    ```ts
    function show(): void { panel.style.display = 'flex'; if (opts.dock && opts.id) opts.dock.noteOpen(opts.id, true); }
    function hide(): void { panel.style.display = 'none'; if (opts.dock && opts.id) opts.dock.noteOpen(opts.id, false); }
    function toggle(): void { panel.style.display === 'none' ? show() : hide(); }
    ```
    Return these in the handle (replace the inline arrow versions).
  - After `opts.container.appendChild(panel)`, register: `if (opts.dock && opts.id) opts.dock.register({ id: opts.id, element: panel, setOpen: (o) => { o ? show() : hide(); } });`
    NOTE: `setOpen` must NOT recurse into `noteOpen` infinitely — `show`/`hide` call `noteOpen`, which only persists; fine (no loop). But `restore()` calls `setOpen` which calls show/hide which calls noteOpen→persist; acceptable (idempotent write). To avoid redundant persists during restore, gate `noteOpen` is unnecessary — leave as is.
  - Existing tests (no `id`/`dock`) must still pass: all dock calls are guarded by `opts.dock && opts.id`.

- [ ] **Step 4: Run** `npx vitest run tests/dom/floating-panel.test.ts` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dev/FloatingPanel.ts tests/dom/floating-panel.test.ts
git commit -m "feat(dev): FloatingPanel integrates with dock-manager (id, drag, open/close)"
```

---

### Task 4: `dev-toolbar.ts`

**Files:** Create `src/dev/dev-toolbar.ts`; Test: `tests/dom/dev-toolbar.test.ts`.

- [ ] **Step 1: Write the failing test** — `tests/dom/dev-toolbar.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { mountDevToolbar } from '@/dev/dev-toolbar';

describe('mountDevToolbar', () => {
  it('renders one button per spec, toggles active class on refresh, fires onClick', () => {
    const container = document.createElement('div');
    let inspectorOpen = false;
    const onClick = vi.fn(() => { inspectorOpen = true; });
    const tb = mountDevToolbar(container, [
      { id: 'inspector', label: '🔍 Inspector', isActive: () => inspectorOpen, onClick },
      { id: 'render', label: '◈ Iso', onClick: vi.fn() },
    ]);
    const btns = tb.element.querySelectorAll('.sg-dev-toolbar__btn');
    expect(btns.length).toBe(2);
    (btns[0] as HTMLElement).click();
    expect(onClick).toHaveBeenCalled();
    tb.refresh();
    expect((btns[0] as HTMLElement).classList.contains('sg-dev-toolbar__btn--active')).toBe(true);
    tb.hide(); expect(tb.element.style.display).toBe('none');
    tb.show(); expect(tb.element.style.display).not.toBe('none');
    tb.destroy(); expect(container.contains(tb.element)).toBe(false);
  });
});
```

- [ ] **Step 2: Run** → FAIL (module missing).

- [ ] **Step 3: Implement `src/dev/dev-toolbar.ts`:**

```ts
import { injectDevStyles } from '@/dev/dev-styles';
import { DEV_UI_Z } from '@/dev/FloatingPanel';

export interface ToolbarButton {
  id: string;
  label: string;
  isActive?: () => boolean;
  onClick: () => void;
}
export interface DevToolbarHandle {
  element: HTMLElement;
  refresh(): void;
  show(): void;
  hide(): void;
  destroy(): void;
}

export function mountDevToolbar(container: HTMLElement, buttons: ToolbarButton[]): DevToolbarHandle {
  injectDevStyles();
  const bar = document.createElement('div');
  bar.className = 'sg-dev-toolbar';
  bar.style.zIndex = String(DEV_UI_Z);
  bar.style.display = 'none';

  const els: { spec: ToolbarButton; el: HTMLButtonElement }[] = [];
  for (const spec of buttons) {
    const b = document.createElement('button');
    b.className = 'sg-dev-toolbar__btn';
    b.type = 'button';
    b.textContent = spec.label;
    b.addEventListener('click', () => { spec.onClick(); refresh(); });
    bar.appendChild(b);
    els.push({ spec, el: b });
  }
  container.appendChild(bar);

  function refresh(): void {
    for (const { spec, el } of els) {
      if (spec.isActive) el.classList.toggle('sg-dev-toolbar__btn--active', spec.isActive());
    }
  }
  refresh();

  return {
    element: bar,
    refresh,
    show(): void { bar.style.display = 'flex'; refresh(); },
    hide(): void { bar.style.display = 'none'; },
    destroy(): void { bar.remove(); },
  };
}
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dev/dev-toolbar.ts tests/dom/dev-toolbar.test.ts
git commit -m "feat(dev): dev-toolbar (per-panel toggles + actions)"
```

---

### Task 5: Migrate `TimeDebugPanel` onto `FloatingPanel`

**Files:** Modify `src/dev/TimeDebugPanel.ts`.

**Recipe (read the whole file first):** Replace the manual shell with a FloatingPanel and host content in its `.body`.

- [ ] **Step 1:** READ `src/dev/TimeDebugPanel.ts` fully. Note the `panel` div creation (cssText with `position:absolute; top:60px; left:280px; width:280px; …; z-index:100; display:none`) and the `addPanelChrome(panel, …)` call, and all `panel.appendChild(...)`/content built into `panel`.

- [ ] **Step 2:** Apply the transform:
  - Add imports: `import { createFloatingPanel } from '@/dev/FloatingPanel'; import type { DockManager } from '@/dev/dock-manager';`
  - Change the signature to accept dock + id: `mountTimeDebugPanel(container, deps: { clock; scheduler; eventLog; dock?: DockManager })`.
  - Replace the `panel` div + its cssText + the `addPanelChrome(...)` call with:
    ```ts
    const fp = createFloatingPanel({ container, id: 'time', title: '⏱ Time Debug', dock: deps.dock, width: 280, anchor: { top: '60px', left: '280px' } });
    const body = fp.body;
    ```
  - Replace every `panel.appendChild(x)` with `body.appendChild(x)` (and any `panel.querySelector`/content refs → `body`). Leave the inner element inline styles AS-IS (dark theme already matches; restyling inner controls is out of scope).
  - Update the `TimeDebugPanelHandle` interface and the returned handle to:
    ```ts
    export interface TimeDebugPanelHandle {
      element: HTMLElement;
      update(clock: SimClock, scheduler: Scheduler, eventLog: EventLog): void;
      show(): void; hide(): void; toggle(): void; isVisible(): boolean;
      destroy(): void;
    }
    // return:
    return {
      element: fp.element,
      update(clock, scheduler, eventLog) { /* unchanged body, now writing into `body` */ },
      show: fp.show, hide: fp.hide, toggle: fp.toggle, isVisible: fp.isVisible,
      destroy: () => fp.destroy(),
    };
    ```
  - Remove the now-unused `addPanelChrome` import. Keep `makeStubButton` and its content.

- [ ] **Step 3:** Run `npx tsc --noEmit` → clean. If a `TimeDebugPanel` test exists, run it; otherwise verify by `npx vitest run tests/unit/dev-mode-controller.test.ts` (it constructs the controller which mounts this panel) after Task 8 — for now just ensure tsc is clean and the file builds.

- [ ] **Step 4:** Commit

```bash
git add src/dev/TimeDebugPanel.ts
git commit -m "refactor(dev): TimeDebugPanel renders in a FloatingPanel (dockable)"
```

---

### Task 6: Migrate `MapEditorPanel` onto `FloatingPanel`

**Files:** Modify `src/dev/MapEditorPanel.ts`.

- [ ] **Step 1:** READ the file. Same shell pattern (`top:60px; left:560px; width:280px`).

- [ ] **Step 2:** Apply the SAME transform as Task 5:
  - imports for `createFloatingPanel` + `DockManager`; signature `mountMapEditorPanel(container, deps: MapEditorDeps & { dock?: DockManager } = {})`.
  - Replace shell + `addPanelChrome` with `const fp = createFloatingPanel({ container, id: 'map', title: '🗺️ Map Editor', dock: deps.dock, width: 280, anchor: { top: '60px', left: '560px' } }); const body = fp.body;`
  - All content `panel.appendChild` → `body.appendChild`.
  - Handle gains `show/hide/toggle/isVisible`; `element: fp.element`; `destroy: () => fp.destroy()`. Keep `update(map, selectedTile)` logic, writing into `body`.
  - Remove unused `addPanelChrome` import.

- [ ] **Step 3:** `npx tsc --noEmit` → clean.

- [ ] **Step 4:** Commit

```bash
git add src/dev/MapEditorPanel.ts
git commit -m "refactor(dev): MapEditorPanel renders in a FloatingPanel (dockable)"
```

---

### Task 7: Migrate `DebugOverlayPanel` onto `FloatingPanel`

**Files:** Modify `src/dev/DebugOverlayPanel.ts`.

- [ ] **Step 1:** READ the file. Shell pattern (`top:60px; left:10px; width:260px`), content built into `panel` (checkboxArea/sliderArea/spiritArea).

- [ ] **Step 2:** SAME transform:
  - imports; signature `mountDebugOverlayPanel(container, deps: { dock?: DockManager } = {})`.
  - `const fp = createFloatingPanel({ container, id: 'overlay', title: '🎨 Debug Overlays', dock: deps.dock, width: 260, anchor: { top: '60px', left: '10px' } }); const body = fp.body;`
  - `panel.appendChild(...)` → `body.appendChild(...)` for checkboxArea/sliderArea/spiritArea and within.
  - Handle gains `show/hide/toggle/isVisible`; `element: fp.element`; `destroy: () => fp.destroy()`. Keep `update(devMode)`.
  - Remove unused `addPanelChrome` import.

- [ ] **Step 3:** `npx tsc --noEmit` → clean.

- [ ] **Step 4:** Commit

```bash
git add src/dev/DebugOverlayPanel.ts
git commit -m "refactor(dev): DebugOverlayPanel renders in a FloatingPanel (dockable)"
```

---

### Task 8: Wire `DevModeController` + remove the render shortcut

**Files:** Modify `src/game/dev-mode-controller.ts`, `src/game.ts`; Test: `tests/unit/dev-mode-controller.test.ts`.

- [ ] **Step 1:** READ the current `src/game/dev-mode-controller.ts` and `tests/unit/dev-mode-controller.test.ts`.

- [ ] **Step 2:** In `dev-mode-controller.ts`:
  - Imports: `import { createDockManager, type DockManager } from '@/dev/dock-manager'; import { mountDevToolbar, type DevToolbarHandle } from '@/dev/dev-toolbar'; import { readRenderMode, toggleRenderMode } from '@/render/select-renderer';`
  - Fields: `private dock!: DockManager; private toolbar!: DevToolbarHandle;`
  - In the constructor, BEFORE mounting panels: `this.dock = createDockManager({ container });`
  - Pass `dock: this.dock` (and the existing ids are set inside each panel mount: inspector uses id `inspector` — update `mountInspector` to pass `id`+`dock`; see below) to each panel mount:
    - `mountInspector` currently takes `{container, getState, onEdit, …}`. Add `dock: this.dock` to its deps, and inside `Inspector.ts` pass `id: 'inspector', dock` to its `createFloatingPanel` call. (Modify `InspectorDeps` to accept `dock?: DockManager` and thread it.)
    - `mountTimeDebugPanel(container, { …, dock: this.dock })`
    - `mountMapEditorPanel(container, { onPaintTile, dock: this.dock })`
    - `mountDebugOverlayPanel(container, { dock: this.dock })`
  - After all panels mounted: `this.dock.restore();`
  - Mount the toolbar:
    ```ts
    this.toolbar = mountDevToolbar(container, [
      { id: 'inspector', label: '🔍 Inspector', isActive: () => this.inspector.isVisible(), onClick: () => this.inspector.toggle() },
      { id: 'time', label: '⏱ Time', isActive: () => this.timeDebug.isVisible(), onClick: () => this.timeDebug.toggle() },
      { id: 'map', label: '🗺️ Map', isActive: () => this.mapEditor.isVisible(), onClick: () => this.mapEditor.toggle() },
      { id: 'overlay', label: '🎨 Overlay', isActive: () => this.debugOverlay.isVisible(), onClick: () => this.debugOverlay.toggle() },
      { id: 'render', label: renderLabel(), onClick: () => toggleRenderMode() },
      { id: 'undo', label: '↩ Undo', onClick: () => this.undo() },
      { id: 'redo', label: '↪ Redo', onClick: () => this.redo() },
    ]);
    ```
    where `function renderLabel() { return readRenderMode() === 'iso' ? '◈ Iso' : '⬛ Topdown'; }` (a small module-level helper or inline).
    NOTE: the panel handles (`timeDebug`/`mapEditor`/`debugOverlay`) now have `toggle()`/`isVisible()` from the migration — confirm.
  - `toggle()` enable branch: replace the inspector show/update lines with: `this.toolbar.show(); this.inspector.show(); this.inspector.update(); this.toolbar.refresh();` (keep the button styling + overlay-options init). disable branch: `this.toolbar.hide(); this.inspector.hide(); this.timeDebug.hide(); this.mapEditor.hide(); this.debugOverlay.hide();` plus the existing `this.devMode.selected = null; this.inspector.select(null); this.debugOverlay.update(this.devMode);`
  - Remove the manual `DEV_UI_Z` per-panel loop's panel entries that FloatingPanel now sets itself — keep `this.btn.style.zIndex = String(DEV_UI_Z);` only (FloatingPanel applies the band to each panel; the toolbar applies it itself). (Leaving the loop is harmless but redundant; simplify to just the button.)
  - `destroy()`: add `this.toolbar.destroy(); this.dock.destroy();` alongside the panel disposals.

- [ ] **Step 3:** In `src/game.ts`:
  - Remove the `this.cleanupRenderToggle = this.attachRenderToggleKey();` line and the `attachRenderToggleKey()` method, and the `cleanupRenderToggle` field + any `this.cleanupRenderToggle?.()` in `destroy()`. Keep the `import { selectRenderer, toggleRenderMode, type RenderFn }` only as needed — if `toggleRenderMode` is no longer used in game.ts (now used in the controller), drop it from the import to avoid an unused-symbol error; keep `selectRenderer`.

- [ ] **Step 4:** Update `tests/unit/dev-mode-controller.test.ts` if needed: after enabling dev mode, assert a `.sg-dev-toolbar` exists in the container and is shown. Keep all assertions green. Run `npx vitest run tests/unit/dev-mode-controller.test.ts` and `npx tsc --noEmit`.

- [ ] **Step 5:** Commit

```bash
git add src/game/dev-mode-controller.ts src/game.ts src/dev/inspector/Inspector.ts tests/unit/dev-mode-controller.test.ts
git commit -m "feat(dev): dev toolbar + dock manager wired; render toggle is a button (drop Ctrl+Shift+I)"
```

---

### Task 9: Inspector dock id (if not already done in Task 8)

**Files:** `src/dev/inspector/Inspector.ts` (only if Task 8 didn't already thread it).

- [ ] **Step 1:** Ensure `InspectorDeps` accepts `dock?: DockManager` and the internal `createFloatingPanel({...})` call passes `id: 'inspector', dock: deps.dock`. Add `import type { DockManager } from '@/dev/dock-manager';`.
- [ ] **Step 2:** `npx vitest run tests/dom/inspector.test.ts` → still PASS (dock optional; existing tests omit it). `npx tsc --noEmit` clean.
- [ ] **Step 3:** Commit (if separate from Task 8):

```bash
git add src/dev/inspector/Inspector.ts
git commit -m "feat(dev): Inspector registers with the dock manager (id inspector)"
```

---

### Task 10: Final verification

- [ ] **Step 1:** `npm run build` → TypeScript + Vite build succeed.
- [ ] **Step 2:** `npx vitest run` → entire suite green (924 + new suites).
- [ ] **Step 3:** Manual smoke (`npm run dev`): enable dev mode → toolbar appears, Inspector opens; toggle Time/Map/Overlay from the toolbar; drag a panel to the left edge → it docks; drag to the middle → it floats; reload → layout restored; click the Render button → renderer flips (page reloads to the other mode); confirm no `Ctrl+Shift+I` behavior remains and the keyboard accelerators still work (Space pauses, Ctrl+Z undoes).
- [ ] **Step 4:** No commit (verification). Fix any smoke regressions in a focused follow-up.

---

## Self-Review

**Spec coverage:** snap-dock rails + persistence — Task 2; FloatingPanel integration — Task 3; toolbar — Task 4; migrate 3 panels — Tasks 5-7; dev-enable shows toolbar + restores, render button, undo/redo — Task 8; remove Ctrl+Shift+I — Task 8; inspector dock id — Tasks 8/9; styles — Task 1; keyboard policy (keep accelerators) — nothing else removed, satisfied by only deleting `attachRenderToggleKey`. ✓

**Placeholder scan:** New files (Tasks 1-4) have full code. Migration Tasks 5-7 are mechanical refactors with an exact recipe + the precise FloatingPanel API and ids — the implementer reads the live file and applies the shown transform (not a logic placeholder). Task 8 lists every exact edit. ✓

**Type consistency:** `DockManager`/`DockState`/`DockedPanel` consistent across dock-manager, FloatingPanel, toolbar wiring. Panel handles uniformly gain `show/hide/toggle/isVisible` (Tasks 5-7) which Task 8's toolbar relies on. `createFloatingPanel` `{id, dock}` options match Task 3's additions. `readRenderMode`/`toggleRenderMode` signatures match `select-renderer.ts`. ✓
