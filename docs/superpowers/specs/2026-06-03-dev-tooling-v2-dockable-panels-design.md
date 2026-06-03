# Dev Tooling v2 — Dockable Panels, Dev Toolbar, Keyboard Cleanup — Design

**Date:** 2026-06-03
**Status:** Approved (design); proceed to plan + subagent-driven build
**Builds on:** the unified Inspector (`2026-06-03-unified-dev-inspector-design.md`, merged `346e48a`) and its `FloatingPanel` + `dev-styles` primitives.

## Goal

Make all dev-mode panels one consistent, **movable + snap-dockable** system that **persists** layout, presented through a **dev toolbar** so every function is reachable by button (nothing shortcut-only), and remove the surprising/conflicting keyboard shortcuts (chiefly the `Ctrl+Shift+I` render toggle that reloads the page) while keeping the *proper* conventional accelerators (Space=pause, undo/redo, Delete, modal Esc, focused-slider arrows).

## Decisions (from brainstorm)

1. **Docking model:** *snap-to-side rail.* Panels float and drag freely; dragging a title bar within a threshold of the left/right container edge snaps the panel into that rail, where panels stack vertically without overlapping; dragging away un-docks (floats again).
2. **Persistence:** yes — per-panel dock side / float position / open state persisted to `localStorage` and restored on load.
3. **Keyboard:** keep proper conventional accelerators; ensure nothing is reachable *only* by keyboard; remove the surprising/conflicting global shortcut(s).
4. **DRY scope:** migrate the remaining hand-rolled panels (TimeDebug, MapEditor, DebugOverlay) onto `FloatingPanel`; EntitySpawner stays a full-screen modal.

## Architecture

```
src/dev/
  FloatingPanel.ts      MODIFY — accept a stable `id`, integrate with the dock
                        manager on drag-end, expose open/close persistence hooks.
  dock-manager.ts       NEW — owns left/right rails + free-float positions,
                        snap-on-drag-end logic, vertical stacking, and
                        localStorage persistence of the layout.
  dev-toolbar.ts        NEW — the dev toolbar: per-panel toggle buttons + render
                        toggle + undo/redo; shown while dev mode is on.
  TimeDebugPanel.ts     MODIFY — render content into a FloatingPanel body.
  MapEditorPanel.ts     MODIFY — same.
  DebugOverlayPanel.ts  MODIFY — same.
  dev-styles.ts         MODIFY — add `.sg-dev-toolbar`, `.sg-dev-toolbar__btn`,
                        `.sg-dev-toolbar__btn--active`, dock-rail affordance styles.
src/game/
  dev-mode-controller.ts MODIFY — construct the dock manager + toolbar; register
                        all panels; dev-enable shows toolbar + restores layout;
                        dev-disable hides + persists.
  ../game.ts            MODIFY — remove attachRenderToggleKey (render toggle moves
                        to the toolbar button).
src/render/select-renderer.ts  (unchanged — toolbar calls its toggleRenderMode/readRenderMode)
```

### `dock-manager.ts`

```ts
export type DockState =
  | { kind: 'float'; x: number; y: number }
  | { kind: 'left'; order: number }
  | { kind: 'right'; order: number };

export interface DockManagerOptions {
  container: HTMLElement;
  storageKey?: string;       // default 'small-gods-dev-layout'
  edgeThreshold?: number;    // default 32 (px from edge to snap)
  railWidth?: number;        // default 230
}

export interface DockedPanel {
  id: string;
  element: HTMLElement;       // the FloatingPanel root
  setOpen(open: boolean): void;
}

export interface DockManager {
  register(panel: DockedPanel): void;
  /** Called by a FloatingPanel when its drag ends, with the panel's viewport rect. */
  onDragEnd(id: string, rect: { left: number; top: number; width: number; height: number }): void;
  /** Persist current open/dock state of a panel (called on show/hide). */
  noteOpen(id: string, open: boolean): void;
  /** Apply the persisted layout to all registered panels (call after all registered). */
  restore(): void;
  /** Re-lay-out both rails (e.g. after a panel opens/closes/docks). */
  relayout(): void;
  destroy(): void;
}

export function createDockManager(opts: DockManagerOptions): DockManager;
```

Behavior:
- **Snap on drag-end:** if `rect.left` is within `edgeThreshold` of the container's left edge → dock left; if `rect.right` within threshold of the right edge → dock right; else float at the dropped `{x,y}` (container-relative).
- **Rails:** docked panels in a rail are positioned `position:absolute` at the rail's x (left rail: `left:0`; right rail: `right:0`), width `railWidth`, stacked top-to-bottom by `order` with a small gap, each panel's natural height. New docks append to the end (max order + 1). Re-layout recomputes `top` offsets in order.
- **Persistence:** the full map `{ [id]: { dock: DockState; open: boolean } }` is written to `localStorage[storageKey]` on every change (dock, float-move, open/close). `restore()` reads it and applies dock/float + open to each registered panel; unknown/missing ids fall back to the panel's default (passed at register time via the panel's initial anchor + closed).
- **Resilience:** all `localStorage` access wrapped in try/catch (iframe storage may be disabled) — same pattern as `select-renderer.ts`.

### `FloatingPanel.ts` changes

- `FloatingPanelOptions` gains `id: string` and optional `dock?: DockManager`.
- When `dock` is provided, FloatingPanel passes an `onDragEnd(x, y)` to `addPanelChrome` that calls `dock.onDragEnd(id, panel.getBoundingClientRect())`; and `show()`/`hide()` call `dock.noteOpen(id, open)`.
- FloatingPanel registers itself: `dock.register({ id, element: panel, setOpen })`. (Registration happens in `createFloatingPanel` when `dock` is set.)
- No behavior change when `dock` is omitted (the Inspector and others always pass it in practice, but tests can omit it).
- Keep the existing drag (offsetParent-relative) and `DEV_UI_Z`.

### `dev-toolbar.ts`

```ts
export interface ToolbarButton {
  id: string;
  label: string;            // e.g. '🔍 Inspector'
  isActive?: () => boolean; // for toggle buttons (panel open?)
  onClick: () => void;
}
export interface DevToolbarHandle {
  element: HTMLElement;
  refresh(): void;          // re-evaluate active states
  show(): void; hide(): void; destroy(): void;
}
export function mountDevToolbar(container: HTMLElement, buttons: ToolbarButton[]): DevToolbarHandle;
```

- A horizontal bar anchored top-centre (`top:8px; left:50%; transform:translateX(-50%)`), `z-index: DEV_UI_Z`, styled with `.sg-dev-toolbar`. Each button uses `.sg-dev-toolbar__btn`; toggle buttons add `--active` when `isActive()` is true. `refresh()` recomputes the active classes (called after any panel show/hide).
- Hidden unless dev mode is on.

### `DevModeController` wiring

- Construct `const dock = createDockManager({ container })`.
- Mount each panel via its `FloatingPanel` with a stable `id` and `dock`: `inspector` (id `inspector`, default docked-left+open), `timeDebug` (`time`), `mapEditor` (`map`), `debugOverlay` (`overlay`) — defaults closed.
- After all are registered, call `dock.restore()`.
- Mount `mountDevToolbar(container, [...])` with toggle buttons that call each panel's `toggle()` then `toolbar.refresh()`, plus:
  - **Render** button: label from `readRenderMode()` (`◈ Iso` / `⬛ Topdown`), `onClick: toggleRenderMode` (reloads).
  - **Undo** / **Redo**: call `this.undo()` / `this.redo()`.
- `toggle()` (dev enable): `toolbar.show()`, restore/open the persisted-open panels (at minimum the inspector), `toolbar.refresh()`. (dev disable): hide toolbar + all panels (state already persisted), keep current behavior of clearing selection.
- Remove the `DEV_UI_Z` manual loop's now-redundant per-panel assignment if FloatingPanel sets it (FloatingPanel already applies `DEV_UI_Z`); keep the toggle button + toolbar in the band.
- Panels that migrate to FloatingPanel expose the same `update/show/hide/isVisible/destroy`; the controller's existing `updateInspector()` and `updateTimeDebug()` keep working.

### Keyboard cleanup (the policy)

**Principle:** every function is reachable by a button or is on by default; conventional accelerators may remain as *secondary* shortcuts; nothing surprising/conflicting/global-and-hidden remains.

- **Remove:** `game.ts` `attachRenderToggleKey` (`Ctrl+Shift+I` → render toggle + reload). The render toggle becomes the toolbar **Render** button. (This is the shortcut that conflicted with the now-removed inspector binding and silently reloaded the page.)
- **Keep (proper, and now also have buttons):** `Ctrl+Shift+D` (dev toggle — also the 🔧 Dev button), `Ctrl+Z`/`Ctrl+Shift+Z`/`Ctrl+Y` (undo/redo — also toolbar + inspector buttons), `Delete`/`Backspace` (delete selected — also the inspector Delete button).
- **Keep (proper conventions):** `Space` = pause/resume (Time bar buttons exist too), the Time bar summon, modal `Esc`-to-close (`decoration-placement-modal`, tutorial), tutorial `Enter`, and the focused time-slider `Arrow`/`Home`/`End` (these only fire when the slider is focused — standard widget accessibility).

No other global keyboard handlers exist (verified by audit).

## Data flow

```
drag title bar ─► PanelChrome onDragEnd(x,y) ─► FloatingPanel ─► dock.onDragEnd(id, rect)
                                                                   ├─ near edge → dock L/R, relayout rail
                                                                   └─ else → float at (x,y)
                                                                   └─ persist layout
toolbar button ─► panel.toggle() ─► FloatingPanel show/hide ─► dock.noteOpen(id, open) ─► persist
                                                              └─ toolbar.refresh() (active state)
dev enable ─► toolbar.show() + dock.restore() ─► panels appear where you left them
page load (dev was on) ─► same restore path
```

## Error handling

- `localStorage` unavailable → dock manager degrades to in-memory layout (try/catch), panels still float/dock for the session.
- A persisted id no longer registered → ignored on restore.
- A docked panel whose rail would overflow the viewport height → it still stacks (rail scrolls or panels clip via their own `max-height:80vh`); no crash. (Out of scope: rail scrolling polish.)

## Testing (vitest / jsdom)

1. **dock-manager:** `onDragEnd` near left edge → panel state `left`; near right → `right`; middle → `float` with the dropped coords. Two left-docked panels get `order` 0,1 and distinct `top` after `relayout`. Layout persists to and restores from a fake `localStorage` (inject a storage object or use jsdom's). Unknown id on restore is ignored.
2. **FloatingPanel + dock:** creating a panel with `{id, dock}` registers it; calling `show()`/`hide()` calls `dock.noteOpen`; a simulated drag-end forwards the rect to `dock.onDragEnd`. (jsdom `getBoundingClientRect` returns zeros — assert the *call* happens and the manager classifies a synthetic rect passed directly, rather than relying on real layout.)
3. **dev-toolbar:** renders one button per spec entry; a toggle button gains `--active` when `isActive()` returns true after `refresh()`; `onClick` fires the callback; `show/hide/destroy` work.
4. **migrated panels:** TimeDebug/MapEditor/DebugOverlay each still expose `element/update/show/hide/isVisible/destroy` and their root carries `.sg-dev-panel`; their existing content still renders (keep/adapt their current tests).
5. **DevModeController:** enabling dev mode shows the toolbar and the inspector; the render button label reflects `readRenderMode()`; the controller no longer registers a `Ctrl+Shift+I` handler. Keep `dev-mode-controller.test.ts` green.
6. **game.ts:** `attachRenderToggleKey` removed — no `Ctrl+Shift+I` listener remains (assert via a small unit if practical, else covered by manual smoke).
7. Keep the full suite green (924 → higher with new suites).

## Out of scope

- Tabbed dock zones / splitter-resizable regions (the heavier model we rejected).
- Rail scroll/overflow polish, drag-to-reorder within a rail (append-only ordering for now).
- Migrating EntitySpawner (stays a modal).
- Touch/mobile drag.
- Changing the game's non-dev UI (HUD, time bar) beyond removing the render shortcut.
