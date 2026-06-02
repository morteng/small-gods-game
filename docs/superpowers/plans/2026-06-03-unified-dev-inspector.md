# Unified Dev Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two overlapping dev inspectors (`InspectorPanel`, `WorldInspector`) with one master-detail Inspector — a navigation tree over the gameobject graph plus a read-rich/edit-basic detail pane — built on a new reusable `FloatingPanel` primitive and one shared dev-scoped stylesheet.

**Architecture:** A single `mountInspector` mounts a `FloatingPanel` containing a navigation tree (left) and a detail pane (right). Canvas right-click and tree-click both call `inspector.select(...)`, converging on one `Selection`. Editing routes through the existing `applyInspectorEdit(hit, key, value)` (unchanged) via synthesized `HitResult`s; rich NPC fields are read-only. `DevModeController` mounts one inspector instead of two panels.

**Tech Stack:** TypeScript ES modules, Vite, Vitest (jsdom for DOM tests), `@/` → `src/`. Dark dev-tool styling via injected `<style>` (mirrors `PanelChrome`'s pattern), NOT the game's `tokens.css`.

**Reference spec:** `docs/superpowers/specs/2026-06-03-unified-dev-inspector-design.md`

---

## File Structure

- `src/dev/dev-styles.ts` — NEW: `injectDevStyles()` + the `.sg-dev-*` class stylesheet.
- `src/dev/FloatingPanel.ts` — NEW: reusable panel primitive wrapping `PanelChrome`.
- `src/dev/inspector/selection.ts` — NEW: `Selection` type + `selectionFromHit`.
- `src/dev/inspector/inspector-tree.ts` — NEW: `buildInspectorTree` + `filterTree`.
- `src/dev/inspector/inspector-detail.ts` — NEW: `renderDetail`.
- `src/dev/inspector/Inspector.ts` — NEW: `mountInspector`.
- `src/dev/PropertyGrid.ts` — MODIFY: extract `renderFields`, restyle to dev classes, export `PropertyField`.
- `src/core/events.ts` — MODIFY: add `EventLog.getById`.
- `src/world/npc-helpers.ts` — MODIFY: implement `getRecentEventDescriptions`.
- `src/game/dev-mode-controller.ts` — MODIFY: mount one inspector; rewire.
- `src/game.ts:352` — MODIFY: `updateWorldInspector()` → `updateInspector()`.
- `src/dev/InspectorPanel.ts`, `src/dev/WorldInspector.ts` — DELETE.
- Tests: `tests/dom/floating-panel.test.ts`, `tests/dom/inspector-tree.test.ts`, `tests/dom/inspector-selection.test.ts`, `tests/dom/inspector-detail.test.ts`, `tests/dom/inspector.test.ts`, `tests/unit/recent-event-descriptions.test.ts`, `tests/unit/eventlog-getbyid.test.ts` — NEW. `tests/dom/dev-mode-controller.test.ts` — MODIFY.

---

### Task 1: Dev-scoped stylesheet (`dev-styles.ts`)

**Files:**
- Create: `src/dev/dev-styles.ts`
- Test: `tests/dom/floating-panel.test.ts` (shared file; assert style injection here too)

- [ ] **Step 1: Write the failing test**

Create `tests/dom/floating-panel.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { injectDevStyles } from '@/dev/dev-styles';

describe('injectDevStyles', () => {
  beforeEach(() => { document.head.querySelectorAll('#sg-dev-styles').forEach(n => n.remove()); });

  it('injects a single <style id="sg-dev-styles"> and is idempotent', () => {
    injectDevStyles();
    injectDevStyles();
    const styles = document.head.querySelectorAll('#sg-dev-styles');
    expect(styles.length).toBe(1);
    expect(styles[0].textContent).toContain('.sg-dev-panel');
    expect(styles[0].textContent).toContain('.sg-dev-tree-node');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/dom/floating-panel.test.ts`
Expected: FAIL — cannot resolve `@/dev/dev-styles`.

- [ ] **Step 3: Implement `dev-styles.ts`**

```ts
/**
 * dev-styles — one injected stylesheet for all dev-mode tooling.
 * Dark, monospace, tool-like (deliberately NOT the game's tokens.css paper
 * theme). Replaces the per-panel inline cssText that used to be duplicated
 * across InspectorPanel / WorldInspector / PropertyGrid.
 */
let injected = false;

const STYLE = `
.sg-dev-panel {
  position: absolute;
  background: rgba(20,20,30,0.95);
  color: #e0e0e0;
  border: 1px solid #555;
  border-radius: 6px;
  font: 12px/1.5 monospace;
  box-sizing: border-box;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.sg-dev-body { flex: 1; display: flex; min-height: 0; }
.sg-dev-muted { color: #888; padding: 16px; text-align: center; }
.sg-dev-section-title { color: #8cf; font-size: 11px; margin: 8px 0 4px; }
.sg-dev-card {
  background: rgba(255,255,255,0.05);
  border: 1px solid #444;
  border-radius: 4px;
  padding: 8px;
  margin-bottom: 6px;
}
.sg-dev-row { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; margin-bottom: 4px; align-items: center; }
.sg-dev-label { color: #999; font-size: 11px; }
.sg-dev-input, .sg-dev-select, .sg-dev-textarea {
  background: rgba(0,0,0,0.3); color: #e0e0e0;
  border: 1px solid #555; border-radius: 3px;
  padding: 2px 4px; font: 11px monospace; box-sizing: border-box;
}
.sg-dev-input { width: 100%; }
.sg-dev-textarea { width: 100%; height: 80px; resize: vertical; font-size: 10px; }
.sg-dev-input--bad, .sg-dev-textarea--bad { border-color: #f44; }
.sg-dev-btn {
  all: unset; cursor: pointer; text-align: center;
  padding: 4px 8px; margin-bottom: 2px;
  background: rgba(255,255,255,0.1); color: #e0e0e0;
  border: 1px solid #555; border-radius: 3px; font: 11px sans-serif;
}
.sg-dev-btn:hover { background: rgba(255,255,255,0.2); }
.sg-dev-btn--danger:hover { background: rgba(255,80,80,0.3); color: #fbb; }
.sg-dev-btn[disabled] { opacity: 0.4; cursor: default; }
.sg-dev-search {
  width: 100%; padding: 4px 8px; box-sizing: border-box;
  background: rgba(0,0,0,0.3); color: #e0e0e0;
  border: 1px solid #555; border-radius: 3px; font: 11px sans-serif;
}
.sg-dev-tree { width: 210px; min-width: 210px; overflow: auto; border-right: 1px solid #444; padding: 6px; }
.sg-dev-detail { flex: 1; overflow: auto; padding: 8px; min-width: 0; }
.sg-dev-tree-node {
  cursor: pointer; padding: 1px 4px; border-radius: 3px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.sg-dev-tree-node:hover { background: rgba(255,255,255,0.08); }
.sg-dev-tree-node--selected { background: rgba(100,150,255,0.25); color: #cfe6ff; }
.sg-dev-tree-toggle { display: inline-block; width: 12px; color: #888; }
.sg-dev-link { color: #8cf; cursor: pointer; text-decoration: underline; }
`;

export function injectDevStyles(): void {
  if (injected) return;
  const el = document.createElement('style');
  el.id = 'sg-dev-styles';
  el.textContent = STYLE;
  document.head.appendChild(el);
  injected = true;
}
```

NOTE: `injected` is a module flag, but the test removes the node and re-imports within one module instance, so guard against a missing node too — make the guard re-check the DOM:

```ts
export function injectDevStyles(): void {
  if (document.getElementById('sg-dev-styles')) { injected = true; return; }
  const el = document.createElement('style');
  el.id = 'sg-dev-styles';
  el.textContent = STYLE;
  document.head.appendChild(el);
  injected = true;
}
```

Use the DOM-checking version (drop the bare `injected` early-return). Keep `let injected = false;` only if referenced; otherwise remove it to avoid an unused var.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/dom/floating-panel.test.ts`
Expected: PASS (the `injectDevStyles` describe block).

- [ ] **Step 5: Commit**

```bash
git add src/dev/dev-styles.ts tests/dom/floating-panel.test.ts
git commit -m "feat(dev): shared dev-scoped stylesheet (injectDevStyles)"
```

---

### Task 2: `FloatingPanel` primitive

**Files:**
- Create: `src/dev/FloatingPanel.ts`
- Test: `tests/dom/floating-panel.test.ts` (append)

- [ ] **Step 1: Write the failing test** (append to `tests/dom/floating-panel.test.ts`)

```ts
import { createFloatingPanel } from '@/dev/FloatingPanel';

describe('createFloatingPanel', () => {
  let container: HTMLElement;
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); });

  it('mounts hidden, with the dev panel class and default z-index 600', () => {
    const p = createFloatingPanel({ container, title: 'Test' });
    expect(p.element.classList.contains('sg-dev-panel')).toBe(true);
    expect(p.element.style.zIndex).toBe('600');
    expect(p.isVisible()).toBe(false);
    expect(p.element.style.display).toBe('none');
  });

  it('show/hide/toggle work and body is a child element', () => {
    const p = createFloatingPanel({ container, title: 'Test' });
    expect(p.body).toBeInstanceOf(HTMLElement);
    expect(p.element.contains(p.body)).toBe(true);
    p.show(); expect(p.isVisible()).toBe(true);
    p.hide(); expect(p.isVisible()).toBe(false);
    p.toggle(); expect(p.isVisible()).toBe(true);
  });

  it('setTitle updates the chrome title text', () => {
    const p = createFloatingPanel({ container, title: 'Before' });
    p.setTitle('After');
    expect(p.element.textContent).toContain('After');
  });

  it('destroy removes the panel from the container', () => {
    const p = createFloatingPanel({ container, title: 'Test' });
    p.destroy();
    expect(container.contains(p.element)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/dom/floating-panel.test.ts`
Expected: FAIL — cannot resolve `@/dev/FloatingPanel`.

- [ ] **Step 3: Implement `FloatingPanel.ts`**

```ts
import { addPanelChrome } from '@/dev/PanelChrome';
import { injectDevStyles } from '@/dev/dev-styles';

/** Dedicated dev-UI stacking band (kept in sync with DevModeController). */
export const DEV_UI_Z = 600;

export interface FloatingPanelOptions {
  container: HTMLElement;
  title: string;
  width?: number;
  anchor?: { top?: string; right?: string; left?: string; bottom?: string };
  zIndex?: number;
}

export interface FloatingPanelHandle {
  element: HTMLElement;
  body: HTMLElement;
  setTitle(title: string): void;
  show(): void;
  hide(): void;
  toggle(): void;
  isVisible(): boolean;
  destroy(): void;
}

export function createFloatingPanel(opts: FloatingPanelOptions): FloatingPanelHandle {
  injectDevStyles();

  const panel = document.createElement('div');
  panel.className = 'sg-dev-panel';
  panel.style.width = `${opts.width ?? 360}px`;
  panel.style.maxHeight = '80vh';
  panel.style.zIndex = String(opts.zIndex ?? DEV_UI_Z);
  panel.style.display = 'none';
  const anchor = opts.anchor ?? { top: '60px', right: '10px' };
  if (anchor.top !== undefined) panel.style.top = anchor.top;
  if (anchor.right !== undefined) panel.style.right = anchor.right;
  if (anchor.left !== undefined) panel.style.left = anchor.left;
  if (anchor.bottom !== undefined) panel.style.bottom = anchor.bottom;

  const body = document.createElement('div');
  body.className = 'sg-dev-body';
  panel.appendChild(body);

  // PanelChrome inserts its bar at panel.firstChild, so it lands above `body`.
  const chrome = addPanelChrome(panel, {
    title: opts.title,
    onClose: () => { panel.style.display = 'none'; },
  });

  opts.container.appendChild(panel);

  return {
    element: panel,
    body,
    setTitle(title: string): void { chrome.setTitle(title); },
    show(): void { panel.style.display = 'flex'; },
    hide(): void { panel.style.display = 'none'; },
    toggle(): void { panel.style.display = panel.style.display === 'none' ? 'flex' : 'none'; },
    isVisible(): boolean { return panel.style.display !== 'none'; },
    destroy(): void { panel.remove(); },
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/dom/floating-panel.test.ts`
Expected: PASS (all blocks).

- [ ] **Step 5: Commit**

```bash
git add src/dev/FloatingPanel.ts tests/dom/floating-panel.test.ts
git commit -m "feat(dev): reusable FloatingPanel primitive (chrome+position+show/hide)"
```

---

### Task 3: `EventLog.getById` + `getRecentEventDescriptions`

**Files:**
- Modify: `src/core/events.ts` (add `getById` to the `EventLog` class)
- Modify: `src/world/npc-helpers.ts:56-63` (implement the stub)
- Test: `tests/unit/eventlog-getbyid.test.ts`, `tests/unit/recent-event-descriptions.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/eventlog-getbyid.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { EventLog } from '@/core/events';
import { SimClock } from '@/core/clock';

describe('EventLog.getById', () => {
  it('returns the appended event by id, or undefined', () => {
    const log = new EventLog(new SimClock());
    const a = log.append({ type: 'whisper', spiritId: 's1', npcId: 'n1' });
    const b = log.append({ type: 'dream', spiritId: 's1', npcId: 'n1' });
    expect(log.getById(a.id)?.event.type).toBe('whisper');
    expect(log.getById(b.id)?.event.type).toBe('dream');
    expect(log.getById(9999)).toBeUndefined();
  });
});
```

Create `tests/unit/recent-event-descriptions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { EventLog } from '@/core/events';
import { SimClock } from '@/core/clock';
import { getRecentEventDescriptions } from '@/world/npc-helpers';
import type { NpcProperties } from '@/core/types';

function baseProps(ids: number[]): NpcProperties {
  return { recentEventIds: ids } as unknown as NpcProperties;
}

describe('getRecentEventDescriptions', () => {
  it('resolves recentEventIds to descriptions, newest first, capped', () => {
    const log = new EventLog(new SimClock());
    const w = log.append({ type: 'whisper', spiritId: 'player', npcId: 'n1' });
    const d = log.append({ type: 'dream', spiritId: 'player', npcId: 'n1' });
    const props = baseProps([w.id, d.id]);
    const out = getRecentEventDescriptions(props, log);
    expect(out.length).toBe(2);
    expect(out[0]).toContain('Dream');     // newest first
    expect(out[1]).toContain('Whisper');
  });

  it('ignores ids with no matching event and returns [] for none', () => {
    const log = new EventLog(new SimClock());
    expect(getRecentEventDescriptions(baseProps([]), log)).toEqual([]);
    expect(getRecentEventDescriptions(baseProps([42]), log)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/eventlog-getbyid.test.ts tests/unit/recent-event-descriptions.test.ts`
Expected: FAIL — `getById` not a function; `getRecentEventDescriptions` returns `[]`.

- [ ] **Step 3a: Add `getById` to `EventLog`**

In `src/core/events.ts`, inside the `EventLog` class (after `since`), add:

```ts
  /** O(n) lookup of a previously appended event by its numeric id. */
  getById(id: number): AppendedEvent | undefined {
    return this.events.find(e => e.id === id);
  }
```

- [ ] **Step 3b: Implement `getRecentEventDescriptions`**

In `src/world/npc-helpers.ts`, replace the stub (currently `function getRecentEventDescriptions(props: NpcProperties): string[] { return []; }`). First ensure the import of `EventLog` exists at the top:

```ts
import type { EventLog, SimEvent } from '@/core/events';
```

Then:

```ts
/** Human label for a sim event as seen from an NPC's perspective. */
function describeSimEvent(event: SimEvent): string {
  switch (event.type) {
    case 'whisper':       return '💬 Whisper received';
    case 'dream':         return '🌙 Dream sent';
    case 'omen':          return '⛈ Omen witnessed';
    case 'miracle':       return '✨ Miracle witnessed';
    case 'answer_prayer': return '🙏 Prayer answered';
    case 'believer_lost': return '💔 Faith lapsed';
    case 'npc_death':     return `💀 Died (${event.cause})`;
    case 'npc_birth':     return '👶 Born';
    case 'belief_cross':  return `📈 Belief ${event.kind} (${Math.round(event.faith * 100)}%)`;
    case 'mood_cross':    return `🙂 Mood ${event.kind}`;
    default:              return event.type;
  }
}

/**
 * Resolve an NPC's recentEventIds against the event log, newest first.
 * Unknown ids are skipped. Cap defaults to the same 8 the writers retain.
 */
export function getRecentEventDescriptions(
  props: NpcProperties,
  eventLog: EventLog,
  cap = 8,
): string[] {
  const out: string[] = [];
  const ids = props.recentEventIds ?? [];
  for (let i = ids.length - 1; i >= 0 && out.length < cap; i--) {
    const found = eventLog.getById(ids[i]);
    if (found) out.push(describeSimEvent(found.event));
  }
  return out;
}
```

If `getRecentEventDescriptions` was previously a non-exported `function`, make it `export function` (the test imports it). Remove the old stub entirely. If `SimEvent` is not already exported from `src/core/events.ts`, export it there (`export type SimEvent = ...`).

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/unit/eventlog-getbyid.test.ts tests/unit/recent-event-descriptions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/events.ts src/world/npc-helpers.ts tests/unit/eventlog-getbyid.test.ts tests/unit/recent-event-descriptions.test.ts
git commit -m "feat(events): EventLog.getById + implement getRecentEventDescriptions"
```

---

### Task 4: `Selection` model

**Files:**
- Create: `src/dev/inspector/selection.ts`
- Test: `tests/dom/inspector-selection.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/dom/inspector-selection.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { selectionFromHit } from '@/dev/inspector/selection';
import type { HitResult } from '@/core/types';

describe('selectionFromHit', () => {
  it('maps entity hits to entity selections', () => {
    const hit = { type: 'entity', tileX: 1, tileY: 2, entity: { id: 'e1' } } as unknown as HitResult;
    expect(selectionFromHit(hit)).toEqual({ type: 'entity', id: 'e1' });
  });
  it('maps npc hits to entity selections (npcs are entities)', () => {
    const hit = { type: 'npc', tileX: 1, tileY: 2, npc: { id: 'n1' } } as unknown as HitResult;
    expect(selectionFromHit(hit)).toEqual({ type: 'entity', id: 'n1' });
  });
  it('maps tile and decoration hits', () => {
    expect(selectionFromHit({ type: 'tile', tileX: 3, tileY: 4 } as HitResult)).toEqual({ type: 'tile', x: 3, y: 4 });
    const dec = { type: 'decoration', tileX: 0, tileY: 0, decoration: { assetId: 'a' } } as unknown as HitResult;
    expect(selectionFromHit(dec)).toEqual({ type: 'decoration', index: -1 }); // resolved later by Inspector
  });
  it('returns null for empty hits', () => {
    expect(selectionFromHit({ type: null, tileX: 0, tileY: 0 } as HitResult)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/dom/inspector-selection.test.ts`
Expected: FAIL — cannot resolve `@/dev/inspector/selection`.

- [ ] **Step 3: Implement `selection.ts`**

```ts
import type { HitResult } from '@/core/types';

/** A unified selection that drives the Inspector detail pane. */
export type Selection =
  | { type: 'entity'; id: string }
  | { type: 'tile'; x: number; y: number }
  | { type: 'decoration'; index: number }
  | { type: 'spirit'; id: string }
  | { type: 'world' }
  | { type: 'lore' }
  | { type: 'poi'; id: string };

/** Map a canvas right-click HitResult into a Selection (or null for empties). */
export function selectionFromHit(hit: HitResult | null): Selection | null {
  if (!hit || hit.type === null) return null;
  switch (hit.type) {
    case 'entity': return hit.entity ? { type: 'entity', id: hit.entity.id } : null;
    case 'npc':    return hit.npc ? { type: 'entity', id: (hit.npc as { id: string }).id } : null;
    case 'tile':   return { type: 'tile', x: hit.tileX, y: hit.tileY };
    // Decoration hits don't carry an index; the Inspector resolves it against
    // state.generatedDecorations. -1 means "unresolved" until then.
    case 'decoration': return { type: 'decoration', index: -1 };
    default: return null;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/dom/inspector-selection.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dev/inspector/selection.ts tests/dom/inspector-selection.test.ts
git commit -m "feat(dev): unified Selection model for the Inspector"
```

---

### Task 5: `inspector-tree` — build + filter the gameobject tree

**Files:**
- Create: `src/dev/inspector/inspector-tree.ts`
- Test: `tests/dom/inspector-tree.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/dom/inspector-tree.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildInspectorTree, filterTree } from '@/dev/inspector/inspector-tree';
import { World } from '@/world/world';
import type { WorldSeed, GameMap, Entity } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';

function tinyWorld(): World {
  const w = new World();
  w.addEntity({ id: 'npc_1', kind: 'npc', x: 1, y: 1, properties: { name: 'Ada', role: 'farmer' }, tags: ['npc'] } as Entity);
  w.addEntity({ id: 'tree_1', kind: 'tree', x: 2, y: 2, properties: {}, tags: ['vegetation'] } as Entity);
  return w;
}
const seed = { name: 'Testlandia', size: { width: 8, height: 8 }, biome: 'temperate', pois: [], connections: [], constraints: [] } as unknown as WorldSeed;
const spirits = new Map<SpiritId, Spirit>([['player', { id: 'player', name: 'You', sigil: '☼', color: '#fff', isPlayer: true, power: 5, manifestation: null } as Spirit]]);

describe('buildInspectorTree', () => {
  it('produces a World root with the expected branches', () => {
    const root = buildInspectorTree(tinyWorld(), null, spirits, [], seed);
    expect(root.label).toContain('Testlandia');
    const ids = (root.children ?? []).map(c => c.id);
    expect(ids).toEqual(expect.arrayContaining(['seed', 'lore', 'pois', 'kinds', 'spirits']));
  });

  it('groups entities by kind with counts and entity leaves', () => {
    const root = buildInspectorTree(tinyWorld(), null, spirits, [], seed);
    const kinds = (root.children ?? []).find(c => c.id === 'kinds');
    const npcGroup = (kinds?.children ?? []).find(c => c.id === 'kind:npc');
    expect(npcGroup?.label).toContain('npc');
    expect(npcGroup?.label).toContain('1');
    const leaf = (npcGroup?.children ?? [])[0];
    expect(leaf.selection).toEqual({ type: 'entity', id: 'npc_1' });
  });

  it('null world yields a single "No world loaded" root', () => {
    const root = buildInspectorTree(null, null, new Map(), [], null);
    expect(root.label).toContain('No world');
    expect(root.children ?? []).toHaveLength(0);
  });
});

describe('filterTree', () => {
  it('keeps nodes whose label or descendant matches; null if none', () => {
    const root = buildInspectorTree(tinyWorld(), null, spirits, [], seed);
    const filtered = filterTree(root, 'npc_1');
    expect(filtered).not.toBeNull();
    const kinds = (filtered!.children ?? []).find(c => c.id === 'kinds');
    expect(kinds).toBeDefined();
    expect(filterTree(root, 'zzzz-no-match')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/dom/inspector-tree.test.ts`
Expected: FAIL — cannot resolve `@/dev/inspector/inspector-tree`.

- [ ] **Step 3: Implement `inspector-tree.ts`**

```ts
import type { World } from '@/world/world';
import type { GameMap, GeneratedDecoration, WorldSeed, Entity } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';
import type { Selection } from './selection';

export interface TreeNode {
  id: string;
  label: string;
  selection?: Selection;
  children?: TreeNode[];
  defaultOpen?: boolean;
}

export function buildInspectorTree(
  world: World | null,
  _map: GameMap | null,
  spirits: Map<SpiritId, Spirit>,
  decorations: GeneratedDecoration[],
  seed: WorldSeed | null,
): TreeNode {
  if (!world) {
    return { id: 'root', label: '∅ No world loaded' };
  }

  const all = world.registry.all();
  const children: TreeNode[] = [];

  // Seed & generation
  children.push({ id: 'seed', label: '⚙ Seed & generation', selection: { type: 'world' } });

  // Lore
  children.push({ id: 'lore', label: '📖 Lore', selection: { type: 'lore' } });

  // POIs
  const pois = seed?.pois ?? [];
  children.push({
    id: 'pois',
    label: `📍 POIs (${pois.length})`,
    children: pois.map(p => ({
      id: `poi:${p.id}`,
      label: p.name ?? p.id,
      selection: { type: 'poi', id: p.id } as Selection,
    })),
  });

  // Entities grouped by kind
  const byKind = new Map<string, Entity[]>();
  for (const e of all) {
    const list = byKind.get(e.kind) ?? [];
    list.push(e);
    byKind.set(e.kind, list);
  }
  const kindNodes: TreeNode[] = Array.from(byKind.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .map(([kind, list]) => ({
      id: `kind:${kind}`,
      label: `${kind} (${list.length})`,
      children: list
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(e => ({
          id: `entity:${e.id}`,
          label: entityLabel(e),
          selection: { type: 'entity', id: e.id } as Selection,
        })),
    }));
  children.push({ id: 'kinds', label: '🧩 Entities by kind', children: kindNodes, defaultOpen: true });

  // Spirits
  children.push({
    id: 'spirits',
    label: `✨ Spirits (${spirits.size})`,
    children: Array.from(spirits.values()).map(s => ({
      id: `spirit:${s.id}`,
      label: `${s.sigil} ${s.name}${s.isPlayer ? ' 👑' : ''}`,
      selection: { type: 'spirit', id: s.id } as Selection,
    })),
  });

  // Decorations (count only; leaves selectable by index)
  children.push({
    id: 'decorations',
    label: `🎨 Decorations (${decorations.length})`,
    children: decorations.map((d, i) => ({
      id: `deco:${i}`,
      label: `${d.assetId} (${d.tileX},${d.tileY})`,
      selection: { type: 'decoration', index: i } as Selection,
    })),
  });

  return {
    id: 'root',
    label: `🌍 World "${seed?.name ?? 'unknown'}"`,
    selection: { type: 'world' },
    defaultOpen: true,
    children,
  };
}

function entityLabel(e: Entity): string {
  const name = (e.properties as { name?: string } | undefined)?.name;
  return name ? `${name} · ${e.id}` : e.id;
}

/**
 * Return a copy of the tree containing only nodes whose label matches `term`
 * (case-insensitive) or which have a matching descendant. Returns null if
 * nothing matches. Empty term returns the tree unchanged.
 */
export function filterTree(node: TreeNode, term: string): TreeNode | null {
  const q = term.trim().toLowerCase();
  if (!q) return node;
  const selfMatch = node.label.toLowerCase().includes(q);
  const keptChildren = (node.children ?? [])
    .map(c => filterTree(c, q))
    .filter((c): c is TreeNode => c !== null);
  if (selfMatch || keptChildren.length > 0) {
    return { ...node, children: keptChildren.length > 0 ? keptChildren : node.children && selfMatch ? [] : keptChildren };
  }
  return null;
}
```

Simplify `filterTree`'s return so a self-matching leaf keeps its (empty) children and a self-matching branch with no child matches drops its children:

```ts
  if (selfMatch) return { ...node, children: keptChildren };
  if (keptChildren.length > 0) return { ...node, children: keptChildren };
  return null;
```

Use that three-line form in place of the single combined return.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/dom/inspector-tree.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dev/inspector/inspector-tree.ts tests/dom/inspector-tree.test.ts
git commit -m "feat(dev): inspector tree model (buildInspectorTree + filterTree)"
```

---

### Task 6: Refactor `PropertyGrid` — extract `renderFields`, restyle to dev classes

**Files:**
- Modify: `src/dev/PropertyGrid.ts`
- Test: `tests/dom/inspector-detail.test.ts` (create now; covers PropertyGrid via renderFields)

**Context:** `renderPropertyGrid(container, hit, onChange)` currently switches on `hit.type` and hand-rolls inline-styled inputs in each `render*Properties`. Extract the input/row creation into a reusable `renderFields`, restyle to `.sg-dev-*`, keep all behavior. Export `PropertyField` and `renderFields`.

- [ ] **Step 1: Write the failing test**

Create `tests/dom/inspector-detail.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderFields, type PropertyField } from '@/dev/PropertyGrid';

describe('renderFields', () => {
  it('renders rows with dev classes and emits onChange for editable fields', () => {
    const host = document.createElement('div');
    const fields: PropertyField[] = [
      { key: 'name', label: 'Name', type: 'string' },
      { key: 'role', label: 'Role', type: 'enum', options: ['farmer', 'priest'] },
      { key: 'kind', label: 'Kind', type: 'string', readonly: true },
    ];
    const rec: Record<string, unknown> = { name: 'Ada', role: 'farmer', kind: 'npc' };
    const onChange = vi.fn();
    renderFields(host, fields, k => rec[k], onChange);

    expect(host.querySelectorAll('.sg-dev-row').length).toBe(3);
    const input = host.querySelector('.sg-dev-input') as HTMLInputElement;
    input.value = 'Bob';
    input.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith('name', 'Bob');

    const select = host.querySelector('.sg-dev-select') as HTMLSelectElement;
    expect(select.disabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/dom/inspector-detail.test.ts`
Expected: FAIL — `renderFields` is not exported.

- [ ] **Step 3: Refactor `PropertyGrid.ts`**

Add the exported helper and route all field rendering through it. Replace the inline-styled row code in `renderTileProperties`/`renderEntityProperties`/`renderNpcProperties`/`renderDecorationProperties` with calls to `renderFields`. Export `PropertyField` (already an interface — add `export` if missing) and add:

```ts
import { injectDevStyles } from '@/dev/dev-styles';

/** Render label+input rows for a list of fields into `container`. */
export function renderFields(
  container: HTMLElement,
  fields: PropertyField[],
  getValue: (key: string) => unknown,
  onChange: (key: string, value: unknown) => void,
): void {
  injectDevStyles();
  for (const field of fields) {
    const row = document.createElement('div');
    row.className = 'sg-dev-row';
    const label = document.createElement('span');
    label.className = 'sg-dev-label';
    label.textContent = field.label;
    row.appendChild(label);
    row.appendChild(createInputForField(field, getValue(field.key), v => onChange(field.key, v)));
    container.appendChild(row);
  }
}
```

Update `createInputForField` to use dev classes instead of inline `cssText`:
- boolean → `<input type=checkbox>` (no class needed; keep `justify-self:start`).
- enum → `select.className = 'sg-dev-select'`.
- number → `input.className = 'sg-dev-input'; input.style.maxWidth = '90px';`.
- string → `input.className = 'sg-dev-input'`.

Rewrite each `render*Properties` to build its `PropertyField[]` (unchanged lists) and call `renderFields(container, fields, key => record[key], onChange)` where `record` is the tile/entity/npc/decoration cast to `Record<string, unknown>` (for entity `kind`, special-case `getValue` to return `entity.kind`). For the entity JSON properties editor, give the textarea `className = 'sg-dev-textarea'`, and on parse error toggle `classList.add('sg-dev-textarea--bad')` instead of setting `style.borderColor`; clear it on focus/success. Keep `renderPropertyGrid`'s `switch` and signatures unchanged.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/dom/inspector-detail.test.ts`
Expected: PASS (renderFields block).

- [ ] **Step 5: Commit**

```bash
git add src/dev/PropertyGrid.ts tests/dom/inspector-detail.test.ts
git commit -m "refactor(dev): PropertyGrid renders via reusable renderFields on dev classes"
```

---

### Task 7: `inspector-detail` — render the detail pane

**Files:**
- Create: `src/dev/inspector/inspector-detail.ts`
- Test: `tests/dom/inspector-detail.test.ts` (append)

**Context:** `renderDetail(host, sel, deps)` clears `host` and renders the selected object. For an NPC entity: editable basics via `renderPropertyGrid` (kind/x/y + JSON, where name/role are editable through `world.setProperty` — emit via a synthesized `HitResult`), plus read-only rich sections built with dev cards, plus actions. Other selection types render their summaries.

- [ ] **Step 1: Write the failing test** (append to `tests/dom/inspector-detail.test.ts`)

```ts
import { renderDetail } from '@/dev/inspector/inspector-detail';
import { World } from '@/world/world';
import { EventLog } from '@/core/events';
import { SimClock } from '@/core/clock';
import type { Entity } from '@/core/types';

function npcEntity(): Entity {
  return {
    id: 'npc_1', kind: 'npc', x: 1, y: 1, tags: ['npc'],
    properties: {
      name: 'Ada', role: 'farmer', recentEventIds: [],
      personality: { assertiveness: 0.5, skepticism: 0.2, piety: 0.8, sociability: 0.6 },
      beliefs: { player: { faith: 0.7, understanding: 0.4, devotion: 0.3 } },
      needs: { safety: 0.6, prosperity: 0.5, community: 0.7, meaning: 0.4 },
      relationships: [], parentIds: [], lineageId: 'npc_1', birthTick: 0,
      mood: 0.5, whisperCooldown: 0, activity: 'idle', activityDuration: 0,
      direction: 'down', frame: 0, frameTimer: 0, homeX: 1, homeY: 1, seed: 1,
    },
  } as unknown as Entity;
}

function deps(world: World) {
  return {
    world, map: null, spirits: new Map(), decorations: [],
    eventLog: new EventLog(new SimClock()), seed: null, devMode: null,
    onEdit: vi.fn(), onDelete: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(),
    onNavigate: vi.fn(), onFocusCamera: vi.fn(),
  };
}

describe('renderDetail', () => {
  it('renders rich read-only NPC sections + editable basics', () => {
    const world = new World();
    world.addEntity(npcEntity());
    const host = document.createElement('div');
    renderDetail(host, { type: 'entity', id: 'npc_1' }, deps(world));
    const text = host.textContent ?? '';
    expect(text).toContain('Beliefs');
    expect(text).toContain('Needs');
    expect(text).toContain('Personality');
    expect(text).toContain('faith');
  });

  it('shows "no longer present" for a missing entity', () => {
    const host = document.createElement('div');
    renderDetail(host, { type: 'entity', id: 'ghost' }, deps(new World()));
    expect(host.textContent).toContain('no longer present');
  });

  it('renders the world summary for a world selection', () => {
    const host = document.createElement('div');
    renderDetail(host, { type: 'world' }, deps(new World()));
    expect(host.textContent).toContain('Generation');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/dom/inspector-detail.test.ts`
Expected: FAIL — cannot resolve `@/dev/inspector/inspector-detail`.

- [ ] **Step 3: Implement `inspector-detail.ts`**

```ts
import type { World } from '@/world/world';
import type {
  GameMap, GeneratedDecoration, WorldSeed, DevModeState, HitResult, Entity,
} from '@/core/types';
import type { EventLog } from '@/core/events';
import type { Spirit, SpiritId } from '@/core/spirit';
import { npcProps, getRecentEventDescriptions } from '@/world/npc-helpers';
import { renderPropertyGrid } from '@/dev/PropertyGrid';
import { injectDevStyles } from '@/dev/dev-styles';
import type { Selection } from './selection';

export interface DetailDeps {
  world: World | null;
  map: GameMap | null;
  spirits: Map<SpiritId, Spirit>;
  decorations: GeneratedDecoration[];
  eventLog: EventLog;
  seed: WorldSeed | null;
  devMode: DevModeState | null;
  onEdit: (hit: HitResult, key: string, value: unknown) => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onNavigate: (sel: Selection) => void;
  onFocusCamera: (x: number, y: number) => void;
}

export function renderDetail(host: HTMLElement, sel: Selection | null, deps: DetailDeps): void {
  injectDevStyles();
  host.innerHTML = '';
  if (!sel) { muted(host, 'Nothing selected.'); return; }

  switch (sel.type) {
    case 'entity': return renderEntity(host, sel.id, deps);
    case 'tile':   return renderTile(host, sel.x, sel.y, deps);
    case 'decoration': return renderDecoration(host, sel.index, deps);
    case 'spirit': return renderSpirit(host, sel.id, deps);
    case 'world':  return renderWorld(host, deps);
    case 'lore':   return renderLore(host, deps);
    case 'poi':    return renderPoi(host, sel.id, deps);
  }
}

// ── helpers ────────────────────────────────────────────────
function muted(host: HTMLElement, text: string): void {
  const d = document.createElement('div');
  d.className = 'sg-dev-muted';
  d.textContent = text;
  host.appendChild(d);
}
function title(host: HTMLElement, text: string): void {
  const d = document.createElement('div');
  d.className = 'sg-dev-section-title';
  d.textContent = text;
  host.appendChild(d);
}
function card(host: HTMLElement, rows: [string, string][]): void {
  const c = document.createElement('div');
  c.className = 'sg-dev-card';
  for (const [k, v] of rows) {
    const row = document.createElement('div');
    row.className = 'sg-dev-row';
    const label = document.createElement('span');
    label.className = 'sg-dev-label';
    label.textContent = k;
    const val = document.createElement('span');
    val.textContent = v;
    row.append(label, val);
    c.appendChild(row);
  }
  host.appendChild(c);
}

function renderEntity(host: HTMLElement, id: string, deps: DetailDeps): void {
  const e = deps.world?.registry.get(id);
  if (!e) { muted(host, 'Selection no longer present.'); return; }

  title(host, `${e.kind} · ${e.id}`);

  const isNpc = e.kind === 'npc' || e.kind === 'remains';
  if (isNpc) renderNpcSections(host, e, deps);

  // Editable basics (kind/x/y + JSON properties). Emit edits as an 'entity' hit
  // so the existing applyInspectorEdit handles them unchanged.
  title(host, 'Edit');
  const editHost = document.createElement('div');
  host.appendChild(editHost);
  const hit: HitResult = { type: 'entity', tileX: Math.floor(e.x), tileY: Math.floor(e.y), entity: e };
  renderPropertyGrid(editHost, hit, (key, value) => deps.onEdit(hit, key, value));

  renderActions(host, e, deps);
}

function renderNpcSections(host: HTMLElement, e: Entity, deps: DetailDeps): void {
  const p = npcProps(e);

  title(host, 'Beliefs');
  const beliefRows: [string, string][] = Object.entries(p.beliefs ?? {}).map(([sid, b]) =>
    [sid, `faith ${pct(b.faith)} · understanding ${pct(b.understanding)} · devotion ${pct(b.devotion)}`]);
  if (beliefRows.length) card(host, beliefRows); else muted(host, 'No beliefs.');

  title(host, 'Needs');
  const n = p.needs;
  card(host, [['safety', pct(n.safety)], ['prosperity', pct(n.prosperity)], ['community', pct(n.community)], ['meaning', pct(n.meaning)]]);

  title(host, 'Personality');
  const pe = p.personality;
  card(host, [['assertiveness', pct(pe.assertiveness)], ['skepticism', pct(pe.skepticism)], ['piety', pct(pe.piety)], ['sociability', pct(pe.sociability)]]);

  title(host, 'Lineage');
  const lineage = document.createElement('div');
  lineage.className = 'sg-dev-card';
  const parents = p.parentIds ?? [];
  if (parents.length === 0) lineage.appendChild(textRow('parents', 'none'));
  for (const pid of parents) lineage.appendChild(linkRow('parent', pid, () => deps.onNavigate({ type: 'entity', id: pid })));
  host.appendChild(lineage);

  title(host, 'Relationships');
  const rels = p.relationships ?? [];
  if (rels.length) card(host, rels.map(r => [r.type, `${r.npcId} (trust ${pct(r.trust)})`])); else muted(host, 'No relationships.');

  title(host, 'Recent events');
  const events = getRecentEventDescriptions(p, deps.eventLog);
  if (events.length) card(host, events.map(ev => ['•', ev])); else muted(host, 'No remembered events.');
}

function textRow(k: string, v: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'sg-dev-row';
  const label = document.createElement('span'); label.className = 'sg-dev-label'; label.textContent = k;
  const val = document.createElement('span'); val.textContent = v;
  row.append(label, val);
  return row;
}
function linkRow(k: string, v: string, onClick: () => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'sg-dev-row';
  const label = document.createElement('span'); label.className = 'sg-dev-label'; label.textContent = k;
  const link = document.createElement('span'); link.className = 'sg-dev-link'; link.textContent = v;
  link.addEventListener('click', onClick);
  row.append(label, link);
  return row;
}

function renderActions(host: HTMLElement, e: Entity, deps: DetailDeps): void {
  title(host, 'Actions');
  host.appendChild(btn('🎯 Focus camera', () => deps.onFocusCamera(e.x, e.y)));
  host.appendChild(btn('🗑 Delete', () => deps.onDelete(), true));
  const undo = btn('↩ Undo', () => deps.onUndo());
  const redo = btn('↪ Redo', () => deps.onRedo());
  undo.toggleAttribute('disabled', (deps.devMode?.undoStack.length ?? 0) === 0);
  redo.toggleAttribute('disabled', (deps.devMode?.redoStack.length ?? 0) === 0);
  host.append(undo, redo);
}
function btn(label: string, onClick: () => void, danger = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = danger ? 'sg-dev-btn sg-dev-btn--danger' : 'sg-dev-btn';
  b.style.display = 'block';
  b.style.width = '100%';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function renderTile(host: HTMLElement, x: number, y: number, deps: DetailDeps): void {
  const tile = deps.map?.tiles[y]?.[x];
  title(host, `Tile (${x}, ${y})`);
  if (!tile) { muted(host, 'No tile.'); return; }
  const hit: HitResult = { type: 'tile', tileX: x, tileY: y, tile };
  renderPropertyGrid(host, hit, (key, value) => deps.onEdit(hit, key, value));
}

function renderDecoration(host: HTMLElement, index: number, deps: DetailDeps): void {
  const dec = index >= 0 ? deps.decorations[index] : undefined;
  title(host, 'Decoration');
  if (!dec) { muted(host, 'Selection no longer present.'); return; }
  const hit: HitResult = { type: 'decoration', tileX: dec.tileX, tileY: dec.tileY, decoration: dec };
  renderPropertyGrid(host, hit, (key, value) => deps.onEdit(hit, key, value));
}

function renderSpirit(host: HTMLElement, id: string, deps: DetailDeps): void {
  const s = deps.spirits.get(id);
  title(host, 'Spirit');
  if (!s) { muted(host, 'Selection no longer present.'); return; }
  card(host, [
    ['name', `${s.sigil} ${s.name}`],
    ['id', s.id],
    ['power', String(Math.round(s.power))],
    ['player', s.isPlayer ? 'yes' : 'no'],
    ['manifestation', s.manifestation ? s.manifestation.kind : 'none'],
  ]);
}

function renderWorld(host: HTMLElement, deps: DetailDeps): void {
  title(host, 'World — Generation');
  const seed = deps.seed;
  const all = deps.world?.registry.all() ?? [];
  card(host, [
    ['name', seed?.name ?? 'unknown'],
    ['size', seed ? `${seed.size.width} × ${seed.size.height}` : '—'],
    ['biome', seed?.biome ?? '—'],
    ['visualTheme', seed?.visualTheme ?? '—'],
    ['constraints', (seed?.constraints ?? []).join(', ') || 'none'],
    ['POIs', String(seed?.pois.length ?? 0)],
    ['entities', String(all.length)],
  ]);
}

function renderLore(host: HTMLElement, deps: DetailDeps): void {
  title(host, 'Lore');
  const lore = deps.seed?.lore;
  if (!lore) { muted(host, 'No lore recorded.'); return; }
  card(host, [
    ['history', lore.history ?? '—'],
    ['factions', Array.isArray(lore.factions) ? lore.factions.join(', ') : (lore.factions ?? '—')],
    ['quests', Array.isArray(lore.quests) ? lore.quests.join(', ') : (lore.quests ?? '—')],
  ]);
}

function renderPoi(host: HTMLElement, id: string, deps: DetailDeps): void {
  const poi = deps.seed?.pois.find(p => p.id === id);
  title(host, 'POI');
  if (!poi) { muted(host, 'Selection no longer present.'); return; }
  card(host, [
    ['name', poi.name ?? poi.id],
    ['type', poi.type],
    ['id', poi.id],
    ['description', poi.description ?? '—'],
  ]);
}

function pct(v: number | undefined): string { return `${Math.round((v ?? 0) * 100)}%`; }
```

If `lore.factions`/`lore.quests` types don't match the array/string handling (check `WorldSeed.lore` in `src/core/types.ts`), adjust the `renderLore` rows to stringify whatever the real shape is (e.g. `JSON.stringify(lore.factions)`). Do not leave a type error.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/dom/inspector-detail.test.ts`
Expected: PASS (all blocks).

- [ ] **Step 5: Commit**

```bash
git add src/dev/inspector/inspector-detail.ts tests/dom/inspector-detail.test.ts
git commit -m "feat(dev): inspector detail pane (rich read-only NPC + edit-basic)"
```

---

### Task 8: `Inspector` — master-detail panel

**Files:**
- Create: `src/dev/inspector/Inspector.ts`
- Test: `tests/dom/inspector.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/dom/inspector.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { mountInspector } from '@/dev/inspector/Inspector';
import { World } from '@/world/world';
import { EventLog } from '@/core/events';
import { SimClock } from '@/core/clock';
import type { Entity, GameState } from '@/core/types';

function state(world: World): GameState {
  return {
    world, map: null, spirits: new Map(), generatedDecorations: [],
    eventLog: new EventLog(new SimClock()), worldSeed: null,
  } as unknown as GameState;
}
function npc(id: string): Entity {
  return { id, kind: 'npc', x: 1, y: 1, tags: ['npc'],
    properties: { name: id, role: 'farmer', recentEventIds: [],
      personality: { assertiveness: .5, skepticism: .5, piety: .5, sociability: .5 },
      beliefs: {}, needs: { safety: .5, prosperity: .5, community: .5, meaning: .5 },
      relationships: [], parentIds: [], lineageId: id, birthTick: 0, mood: .5,
      whisperCooldown: 0, activity: 'idle', activityDuration: 0, direction: 'down',
      frame: 0, frameTimer: 0, homeX: 1, homeY: 1, seed: 1 },
  } as unknown as Entity;
}

describe('mountInspector', () => {
  it('selectHit shows the panel and renders entity detail', () => {
    const world = new World(); world.addEntity(npc('npc_1'));
    const container = document.createElement('div');
    const insp = mountInspector({
      container, getState: () => state(world),
      onEdit: vi.fn(), onDelete: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(), onFocusCamera: vi.fn(),
    });
    insp.update();
    insp.selectHit({ type: 'entity', tileX: 1, tileY: 1, entity: world.registry.get('npc_1') } as any);
    expect(insp.isVisible()).toBe(true);
    expect(insp.element.textContent).toContain('Beliefs');
    insp.destroy();
  });

  it('clicking a tree leaf selects that entity', () => {
    const world = new World(); world.addEntity(npc('npc_1'));
    const container = document.createElement('div');
    const insp = mountInspector({
      container, getState: () => state(world),
      onEdit: vi.fn(), onDelete: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(), onFocusCamera: vi.fn(),
    });
    insp.show(); insp.update();
    const leaf = Array.from(insp.element.querySelectorAll('.sg-dev-tree-node'))
      .find(n => (n.textContent ?? '').includes('npc_1')) as HTMLElement;
    expect(leaf).toBeDefined();
    leaf.click();
    expect(insp.element.textContent).toContain('Personality');
    insp.destroy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/dom/inspector.test.ts`
Expected: FAIL — cannot resolve `@/dev/inspector/Inspector`.

- [ ] **Step 3: Implement `Inspector.ts`**

```ts
import type { GameState, HitResult } from '@/core/types';
import { createFloatingPanel, type FloatingPanelHandle } from '@/dev/FloatingPanel';
import { buildInspectorTree, filterTree, type TreeNode } from './inspector-tree';
import { renderDetail, type DetailDeps } from './inspector-detail';
import { selectionFromHit, type Selection } from './selection';

export interface InspectorDeps {
  container: HTMLElement;
  getState: () => GameState;
  onEdit: (hit: HitResult, key: string, value: unknown) => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onFocusCamera: (x: number, y: number) => void;
}

export interface InspectorHandle {
  element: HTMLElement;
  select(sel: Selection | null): void;
  selectHit(hit: HitResult | null): void;
  update(): void;
  show(): void;
  hide(): void;
  toggle(): void;
  isVisible(): boolean;
  destroy(): void;
}

export function mountInspector(deps: InspectorDeps): InspectorHandle {
  const panel: FloatingPanelHandle = createFloatingPanel({
    container: deps.container, title: '🔍 Inspector', width: 560,
    anchor: { top: '60px', right: '10px' },
  });

  // Search row (above the split)
  const searchWrap = document.createElement('div');
  searchWrap.style.cssText = 'padding:6px; border-bottom:1px solid #444;';
  const search = document.createElement('input');
  search.className = 'sg-dev-search';
  search.placeholder = '🔍 Search…';
  searchWrap.appendChild(search);

  const split = document.createElement('div');
  split.style.cssText = 'display:flex; min-height:0; flex:1;';
  const treeEl = document.createElement('div');
  treeEl.className = 'sg-dev-tree';
  const detailEl = document.createElement('div');
  detailEl.className = 'sg-dev-detail';
  split.append(treeEl, detailEl);

  // panel.body is flex; stack search + split vertically inside it.
  panel.body.style.flexDirection = 'column';
  panel.body.append(searchWrap, split);

  let selection: Selection | null = null;
  const openIds = new Set<string>(['root', 'kinds']);
  let searchTerm = '';

  search.addEventListener('input', () => { searchTerm = search.value; renderTree(); });

  function detailDeps(): DetailDeps {
    const s = deps.getState();
    return {
      world: s.world, map: s.map, spirits: s.spirits, decorations: s.generatedDecorations,
      eventLog: s.eventLog, seed: s.worldSeed, devMode: null,
      onEdit: deps.onEdit, onDelete: deps.onDelete, onUndo: deps.onUndo, onRedo: deps.onRedo,
      onFocusCamera: deps.onFocusCamera, onNavigate: (sel) => select(sel),
    };
  }

  function renderDetailPane(): void { renderDetail(detailEl, selection, detailDeps()); }

  function selectionId(sel: Selection | null): string | null {
    if (!sel) return null;
    switch (sel.type) {
      case 'entity': return `entity:${sel.id}`;
      case 'spirit': return `spirit:${sel.id}`;
      case 'poi': return `poi:${sel.id}`;
      case 'decoration': return `deco:${sel.index}`;
      case 'world': return 'seed';
      case 'lore': return 'lore';
      case 'tile': return `tile:${sel.x},${sel.y}`;
    }
  }

  function renderTree(): void {
    treeEl.innerHTML = '';
    const s = deps.getState();
    const full = buildInspectorTree(s.world, s.map, s.spirits, s.generatedDecorations, s.worldSeed);
    const model = searchTerm.trim() ? filterTree(full, searchTerm) : full;
    if (!model) { const d = document.createElement('div'); d.className = 'sg-dev-muted'; d.textContent = 'No matches.'; treeEl.appendChild(d); return; }
    const selId = selectionId(selection);
    const autoOpen = searchTerm.trim().length > 0;
    renderNode(treeEl, model, 0, selId, autoOpen);
  }

  function renderNode(host: HTMLElement, node: TreeNode, depth: number, selId: string | null, autoOpen: boolean): void {
    const row = document.createElement('div');
    row.className = 'sg-dev-tree-node' + (node.id === selId ? ' sg-dev-tree-node--selected' : '');
    row.style.paddingLeft = `${depth * 12 + 4}px`;
    const hasChildren = !!node.children && node.children.length > 0;
    const open = autoOpen || openIds.has(node.id) || node.defaultOpen === true;
    const toggle = document.createElement('span');
    toggle.className = 'sg-dev-tree-toggle';
    toggle.textContent = hasChildren ? (open ? '▾' : '▸') : '';
    row.appendChild(toggle);
    row.appendChild(document.createTextNode(node.label));
    row.addEventListener('click', () => {
      if (hasChildren) {
        if (openIds.has(node.id)) openIds.delete(node.id); else openIds.add(node.id);
      }
      if (node.selection) select(node.selection);
      else renderTree();
    });
    host.appendChild(row);
    if (hasChildren && open) {
      for (const c of node.children!) renderNode(host, c, depth + 1, selId, autoOpen);
    }
  }

  function select(sel: Selection | null): void {
    selection = sel;
    if (sel) { panel.show(); }
    renderTree();
    renderDetailPane();
  }

  return {
    element: panel.element,
    select,
    selectHit(hit: HitResult | null): void { select(selectionFromHit(hit)); },
    update(): void { renderTree(); renderDetailPane(); },
    show(): void { panel.show(); },
    hide(): void { panel.hide(); },
    toggle(): void { panel.toggle(); },
    isVisible(): boolean { return panel.isVisible(); },
    destroy(): void { panel.destroy(); },
  };
}
```

NOTE on `devMode`: the detail pane shows undo/redo enabled state from `devMode`. `Inspector` doesn't receive `DevModeState` directly; pass `null` here (buttons stay enabled and call back — `applyUndo`/`applyRedo` already no-op on empty stacks). The controller wires the actual callbacks. This keeps Inspector decoupled from `DevModeState`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/dom/inspector.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dev/inspector/Inspector.ts tests/dom/inspector.test.ts
git commit -m "feat(dev): master-detail Inspector (tree + detail in one FloatingPanel)"
```

---

### Task 9: Rewire `DevModeController` to the unified Inspector

**Files:**
- Modify: `src/game/dev-mode-controller.ts`
- Modify: `src/game.ts:352`
- Test: `tests/dom/dev-mode-controller.test.ts`

- [ ] **Step 1: Inspect the existing controller test**

Run: `npx vitest run tests/dom/dev-mode-controller.test.ts`
Expected: PASS currently. Read the file to see what it asserts about `inspector`/`worldInspector` so the rewire keeps it green (it may reference `controller` construction + right-click). Note its expectations before editing.

- [ ] **Step 2: Rewire the controller**

In `src/game/dev-mode-controller.ts`:

- Remove imports of `mountInspectorPanel`/`InspectorPanelHandle` and `mountWorldInspector`/`WorldInspectorHandle`. Add:
  ```ts
  import { mountInspector, type InspectorHandle } from '@/dev/inspector/Inspector';
  import { selectionFromHit } from '@/dev/inspector/selection';
  ```
- Replace the `inspector`/`worldInspector` fields with a single:
  ```ts
  private inspector!: InspectorHandle;
  ```
- Replace the two `mount*` blocks (the `mountInspectorPanel(...)` + `setOnChange` and the `mountWorldInspector(...)` + `setCameraFocusCallback`) with:
  ```ts
  this.inspector = mountInspector({
    container,
    getState: () => this.deps.state,
    onEdit: (hit, key, value) => this.applyInspectorEdit(hit, key, value),
    onDelete: () => this.deleteSelected(),
    onUndo: () => this.undo(),
    onRedo: () => this.redo(),
    onFocusCamera: (x, y) => {
      const cam = this.deps.state.camera;
      const vp = this.deps.getViewport();
      cam.x = x * TILE_SIZE - vp.width / 2;
      cam.y = y * TILE_SIZE - vp.height / 2;
    },
  });
  ```
- In the `DEV_UI_Z` loop, replace the panel list with the panels that still exist:
  ```ts
  this.btn.style.zIndex = String(DEV_UI_Z);
  this.inspector.element.style.zIndex = String(DEV_UI_Z);
  for (const handle of [this.debugOverlay, this.timeDebug, this.mapEditor]) {
    handle.element.style.zIndex = String(DEV_UI_Z);
  }
  ```
- In `toggle()`'s disable branch, the old code called `this.inspector.update(null, this.devMode)`. Replace with `this.inspector.select(null); this.inspector.hide();`.
- In `attachKeyboard`, the Ctrl+Shift+I handler: replace the whole `if (this.worldInspector) {…}` block with:
  ```ts
  if (this.inspector.isVisible()) this.inspector.hide();
  else { this.inspector.show(); this.inspector.update(); }
  ```
- In `handleRightClick`, after `this.devMode.selected = hit;`, replace `this.inspector.update(hit, this.devMode);` with:
  ```ts
  this.inspector.selectHit(hit);
  ```
- In `applyInspectorEdit`'s final refresh line, replace `this.inspector.update(this.devMode.selected, this.devMode);` with `this.inspector.update();`.
- In `deleteSelected`, replace `this.inspector.update(null, this.devMode);` with `this.inspector.select(null);`.
- In `refreshInspectorAfterHistory`, replace the body with `this.inspector.update();`.
- Rename `updateWorldInspector()` → `updateInspector()`:
  ```ts
  updateInspector(): void {
    if (this.inspector.isVisible()) this.inspector.update();
  }
  ```
- In `destroy()`, replace the `inspector`/`worldInspector` disposals with `this.inspector.destroy();`.

In `src/game.ts:352`, change `this.dev.updateWorldInspector();` → `this.dev.updateInspector();`.

- [ ] **Step 3: Update the controller test if needed**

If `tests/dom/dev-mode-controller.test.ts` asserted anything about `mountInspectorPanel`/`worldInspector` internals, update those assertions to the unified inspector (e.g. assert that after `handleRightClick` on an entity, `controller` shows a panel containing the entity id). Add an assertion:

```ts
// after a right-click that hits an entity:
expect(container.querySelector('.sg-dev-panel')).not.toBeNull();
```

Adapt to the test's existing setup (it already constructs a `DevModeController` with a stub state/world).

- [ ] **Step 4: Verify build + tests**

Run: `npx tsc --noEmit`
Expected: no errors (note: `InspectorPanel.ts`/`WorldInspector.ts` are now unreferenced but still present — they compile until Task 10 deletes them).

Run: `npx vitest run tests/dom/dev-mode-controller.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/dev-mode-controller.ts src/game.ts tests/dom/dev-mode-controller.test.ts
git commit -m "refactor(dev): DevModeController mounts one unified Inspector"
```

---

### Task 10: Delete the superseded panels

**Files:**
- Delete: `src/dev/InspectorPanel.ts`, `src/dev/WorldInspector.ts`
- Possibly modify: any leftover importers

- [ ] **Step 1: Confirm no remaining importers**

Run: `grep -rn "InspectorPanel\|WorldInspector\|mountInspectorPanel\|mountWorldInspector" src/ tests/`
Expected: only matches inside the two files about to be deleted (and possibly stale test references). If any other file imports them, fix it (there should be none after Task 9).

- [ ] **Step 2: Delete the files**

```bash
git rm src/dev/InspectorPanel.ts src/dev/WorldInspector.ts
```

If a dedicated test file exists for either (none expected per the audit — only `dev-mode-controller.test.ts`), `git rm` it too.

- [ ] **Step 3: Verify build + full suite**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx vitest run`
Expected: ALL tests pass (the 900 pre-existing minus any deleted, plus the new suites — net higher).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(dev): delete InspectorPanel + WorldInspector (absorbed by Inspector)"
```

---

### Task 11: Manual smoke + final typecheck

**Files:** none (verification only)

- [ ] **Step 1: Typecheck + full tests**

Run: `npm run build`
Expected: TypeScript check passes and Vite build succeeds.

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 2: Manual smoke (dev server)**

Start `npm run dev`, open the game, press 🔧 Dev (or Ctrl+Shift+D), then Ctrl+Shift+I to open the Inspector. Verify:
- Tree shows World → Seed/Lore/POIs/Entities-by-kind/Spirits/Decorations.
- Clicking an NPC leaf shows Beliefs/Needs/Personality/Lineage/Relationships/Recent-events read-only + an Edit grid + Actions.
- Right-clicking an entity on the canvas selects it in the Inspector.
- The panel drags smoothly (Task carried over from the prior drag fix) and renders above game UI.
- Editing x/y or the JSON properties bag mutates the entity; Undo reverts.

- [ ] **Step 3: No commit** (verification task). If smoke reveals a bug, fix it in a focused follow-up commit referencing the spec.

---

## Self-Review

**Spec coverage:**
- Merge two inspectors → one master-detail Inspector — Tasks 8, 9, 10. ✓
- Reusable FloatingPanel primitive — Task 2. ✓
- Shared dev-scoped stylesheet — Task 1 (consumed in Tasks 2,6,7,8). ✓
- Read-rich NPC detail (beliefs/needs/personality/lineage/relationships/recent-events) — Task 7. ✓
- Edit-basic via existing applyInspectorEdit + synthesized HitResult — Task 7 (renderEntity) + Task 9. ✓
- Navigation tree (World→seed/gen-params/lore→POIs→entities-by-kind→entities, spirits, tiles/decorations) — Task 5. ✓
- Unified selection (right-click + tree-click) — Tasks 4, 8, 9. ✓
- Tokenized dev-dark theme (no tokens.css) — Task 1 + restyle in Task 6/7. ✓
- Implement getRecentEventDescriptions — Task 3. ✓
- Delete InspectorPanel/WorldInspector — Task 10. ✓
- Keep 900 tests green — Tasks 9, 10, 11. ✓

**Placeholder scan:** No TBD/TODO; every code step has full code. The two "adjust if the real type differs" notes (renderLore's lore shape; the controller test's existing assertions) are explicit verification instructions, not deferred work — the implementer confirms the shape against `src/core/types.ts` and writes the exact rows.

**Type consistency:** `Selection` (selection.ts) used identically in inspector-tree, inspector-detail, Inspector. `TreeNode` shared. `DetailDeps`/`InspectorDeps` field names match across Tasks 7–9. `renderFields(container, fields, getValue, onChange)` signature consistent between Task 6 (def) and any caller. `FloatingPanelHandle.body`/`element`/`setTitle`/`show`/`hide`/`toggle`/`isVisible`/`destroy` consistent between Task 2 and Task 8. `getRecentEventDescriptions(props, eventLog, cap?)` consistent between Task 3 (def) and Task 7 (call). `updateInspector()` rename consistent between Task 9 controller and `game.ts` caller.
