# Unified Dev Inspector — Design

**Date:** 2026-06-03
**Status:** Approved (design); ready for implementation plan
**Author:** brainstormed with Morten

## Goal

Replace the two overlapping dev-mode inspector panels (`InspectorPanel`,
`WorldInspector`) with a **single master-detail Inspector** that lets the
developer navigate the entire gameobject tree — from the World root (seed &
generation parameters, lore, LLM-generated descriptions) down through POIs,
entities-by-kind, individual entities, spirits and tiles — and inspect/edit a
selected object in a detail pane. Along the way, unify and DRY the dev-panel
infrastructure behind one reusable `FloatingPanel` primitive and one shared
dev-scoped stylesheet.

## Why

Current state (all dev-mode, all on `PanelChrome`, all dark-monospace + `innerHTML`,
none on the design system):

- **`InspectorPanel`** — right-click → single selected hit: read-only info +
  editable `PropertyGrid` + actions + undo/redo. Uses **module-level callback
  globals** (`onChangeCallback` etc.) — a singleton smell. Anchored
  `top:60px right:10px`.
- **`WorldInspector`** — Ctrl+Shift+I → tabbed read-only browser
  (World/NPCs/Entities/Tiles/Spirits/Decorations) + search + export JSON +
  camera-focus. **Also anchored `top:60px right:10px`** — so the two panels
  literally overlap. Flat tabs, not a tree; no gen-params; no LLM lore.
- **`PropertyGrid`** — the editable-field engine. Hardcoded shallow NPC fields
  (name/role/tileX/tileY/direction/frame) — does not surface beliefs, needs,
  personality, lineage, relationships, or remembered events. Inline styles.

The two inspectors are redundant and collide. They should be **one** thing.

## Decisions (locked at brainstorm)

1. **DRY scope:** Merge the two inspectors into one master-detail Inspector, and
   extract a reusable `FloatingPanel` primitive it uses. Leave the other dev
   panels (TimeDebug, MapEditor, DebugOverlay, EntitySpawner) as-is for now —
   they *can* adopt `FloatingPanel` later. (YAGNI.)
2. **Editing depth:** *Read-rich, edit-basic.* Surface the full NPC inner life
   (beliefs faith/understanding/devotion, needs, personality, lineage,
   relationships, remembered events) **read-only**; keep the existing editable
   scalars (x/y/kind/role/tile type/walkable + JSON properties bag). Derived
   fields (age, weathering) stay read-only so sim invariants are not corrupted.
3. **Styling:** *Tokenized dev-dark theme.* Dev tools stay visually distinct
   from the game (dark, monospace, tool-like), but the hand-rolled inline styles
   are replaced by one small shared dev-scoped stylesheet — unified and DRY among
   the dev tools themselves, NOT adopting the game's paper/ink `tokens.css`.
4. **Layout:** *Side-by-side* (master-detail) — ~560px wide panel, navigation
   tree on the left (~210px, scrolls independently), detail pane on the right.

## Architecture

```
src/dev/
  dev-styles.ts          NEW — one injected <style> of dev-scoped classes.
  FloatingPanel.ts       NEW — reusable panel primitive (wraps PanelChrome).
  inspector/
    Inspector.ts         NEW — mountInspector(container, deps) → handle.
    inspector-tree.ts    NEW — builds the tree model from world/map/seed/spirits.
    inspector-detail.ts  NEW — renders the detail pane for a Selection.
    selection.ts         NEW — unified Selection type + helpers.
  PropertyGrid.ts        EXTEND — schema-driven sections; dev-tokenized inputs;
                         NPC read-only sections (beliefs/needs/personality/
                         lineage/relationships/recent-events).
  InspectorPanel.ts      DELETE
  WorldInspector.ts      DELETE
  PanelChrome.ts         KEEP (wrapped by FloatingPanel)
  EntitySpawner.ts       KEEP (unchanged)
  dev-mode-controller.ts REWIRE — mounts one Inspector instead of two panels.
src/world/
  npc-helpers.ts         IMPLEMENT getRecentEventDescriptions (currently a stub).
```

### `dev-styles.ts`

Exports `injectDevStyles(): void` (idempotent, mirrors `PanelChrome`'s
`styleInjected` pattern) that appends a single `<style id="sg-dev-styles">` to
`document.head`. Class set (dark, monospace, tool-like):

- `.sg-dev-panel` — panel surface (bg `rgba(20,20,30,0.95)`, border
  `1px solid #555`, radius 6px, `color:#e0e0e0`, `font:12px/1.5 monospace`).
- `.sg-dev-row` — label + control grid row.
- `.sg-dev-label` — muted field label (`#999`).
- `.sg-dev-input`, `.sg-dev-select`, `.sg-dev-textarea` — form controls
  (`background:rgba(0,0,0,0.3)`, border `#555`, `color:#e0e0e0`).
- `.sg-dev-btn`, `.sg-dev-btn--danger` — buttons.
- `.sg-dev-card` — sub-section card.
- `.sg-dev-section-title` — accent heading (`#8cf`).
- `.sg-dev-muted` — `#888` empty-state text.
- `.sg-dev-tree`, `.sg-dev-tree-node`, `.sg-dev-tree-node--selected`,
  `.sg-dev-tree-toggle`, `.sg-dev-tree-leaf` — tree styling, indent by depth.

`PropertyGrid`, `FloatingPanel`, and the Inspector all consume these classes
instead of inline `cssText`. This is the substance of "unified & DRY".

### `FloatingPanel.ts`

```ts
export interface FloatingPanelOptions {
  container: HTMLElement;
  title: string;
  width?: number;        // px; default 360
  anchor?: { top?: string; right?: string; left?: string; bottom?: string };
  zIndex?: number;       // default DEV_UI_Z (600)
}
export interface FloatingPanelHandle {
  element: HTMLElement;  // the panel root (absolute-positioned)
  body: HTMLElement;     // content host (below the chrome bar)
  setTitle(title: string): void;
  show(): void;
  hide(): void;
  toggle(): void;
  isVisible(): boolean;
  destroy(): void;
}
export function createFloatingPanel(opts: FloatingPanelOptions): FloatingPanelHandle;
```

Responsibilities: create the absolute-positioned root with `.sg-dev-panel`,
apply width/anchor/z-index, call `injectDevStyles()`, add `PanelChrome`
(title/close/minimize/drag — close → `hide()`), expose a `body` element for
content, and own `show/hide/toggle/isVisible/destroy`. The `DEV_UI_Z` band and
the drag fix already live in `PanelChrome`/`DevModeController` and carry over.

### `selection.ts`

```ts
// A unified selection feeding the detail pane. Wraps the existing HitResult
// shapes plus richer world-level nodes the tree can surface.
export type Selection =
  | { type: 'entity'; id: string }     // any world entity (incl. npc/remains/building/tree)
  | { type: 'tile'; x: number; y: number }
  | { type: 'decoration'; index: number }
  | { type: 'spirit'; id: string }
  | { type: 'world' }                  // root: seed & generation summary
  | { type: 'lore' }                   // seed lore + LLM world text
  | { type: 'poi'; id: string };
export function selectionFromHit(hit: HitResult): Selection | null;
```

`selectionFromHit` maps a canvas right-click `HitResult` into a `Selection` so
right-click and tree-click converge on one model.

### `inspector-tree.ts`

```ts
export interface TreeNode {
  id: string;            // stable key, e.g. 'world', 'kind:npc', 'entity:npc_3'
  label: string;
  selection?: Selection; // leaf/selectable nodes carry one
  children?: TreeNode[];
  defaultOpen?: boolean;
}
export function buildInspectorTree(
  world: World | null, map: GameMap | null,
  spirits: Map<SpiritId, Spirit>, decorations: GeneratedDecoration[],
): TreeNode;
```

Tree shape:

```
World "<seed name>"                       selection: {type:'world'}
├─ Seed & generation                      selection: {type:'world'}
├─ Lore                                    selection: {type:'lore'}
├─ POIs (N)
│   └─ <poi name>                          selection: {type:'poi', id}
│       └─ <co-located entities>           selection: {type:'entity', id}
├─ Entities by kind
│   ├─ npc (N) → <entity rows>             selection: {type:'entity', id}
│   ├─ building (N) → …
│   └─ tree (N) → …
├─ Spirits (N) → <spirit rows>             selection: {type:'spirit', id}
└─ Tiles → type histogram (read-only summary)
```

`null` world/map ⇒ a single "No world loaded" root. The renderer (in
`Inspector.ts`) draws this model with collapse/expand, indentation by depth,
selection highlight, and a search box that filters node labels (a node is shown
if it or any descendant matches).

### `inspector-detail.ts`

```ts
export interface DetailDeps {
  world: World | null; map: GameMap | null;
  spirits: Map<SpiritId, Spirit>; decorations: GeneratedDecoration[];
  eventLog: EventLog; seed: WorldSeed | null; devMode: DevModeState | null;
  onEdit: (hit: HitResult, key: string, value: unknown) => void;
  onDelete: () => void; onUndo: () => void; onRedo: () => void;
  onNavigate: (sel: Selection) => void;   // lineage/relationship links
  onFocusCamera: (x: number, y: number) => void;
}
export function renderDetail(host: HTMLElement, sel: Selection | null, deps: DetailDeps): void;
```

- `entity` of kind `npc`/`remains`: rich read-only sections — **Beliefs**
  (per-spirit faith/understanding/devotion), **Needs**, **Personality**,
  **Lineage** (parents/children → clickable `onNavigate`), **Relationships**,
  **Recent events** (via `getRecentEventDescriptions`) — plus the editable
  `PropertyGrid` (name/role/x/y/kind + JSON properties) and actions
  (focus-camera / delete / undo / redo).
- `entity` of other kinds: editable `PropertyGrid` + actions.
- `tile`/`decoration`: existing editable fields via `PropertyGrid`.
- `spirit`: read-only summary (name, sigil, power, isPlayer, manifestation).
- `world`: seed & generation summary (name, size, biome, visualTheme,
  constraints, tileWeights, entity counts).
- `lore`: `seed.lore` (history/factions/quests) + any LLM-generated world text.
- A `Selection` whose entity no longer exists ⇒ "Selection no longer present";
  detail clears.

### `Inspector.ts`

```ts
export interface InspectorDeps {
  container: HTMLElement;
  getState: () => GameState;            // world/map/spirits/decorations/eventLog/seed
  onEdit: (hit: HitResult, key: string, value: unknown) => void;
  onDelete: () => void; onUndo: () => void; onRedo: () => void;
  onFocusCamera: (x: number, y: number) => void;
}
export interface InspectorHandle {
  element: HTMLElement;
  select(sel: Selection | null): void;  // tree-click & right-click both call this
  selectHit(hit: HitResult | null): void; // convenience wrapper using selectionFromHit
  update(): void;                       // rebuild tree + re-render detail from state
  show(): void; hide(): void; toggle(): void; isVisible(): boolean;
  destroy(): void;
}
export function mountInspector(deps: InspectorDeps): InspectorHandle;
```

Layout (side-by-side, inside one `FloatingPanel`, width 560, anchor
`top:60px right:10px`):

```
┌─ 🔍 Inspector ───────────────── ─ □ × ┐   (PanelChrome)
│ [ search… ]                            │
├──────────────┬─────────────────────────┤
│ tree (≈210px)│ detail pane (flex)       │
│  scrolls     │  scrolls                 │
└──────────────┴─────────────────────────┘
```

Owns the current `Selection`. `select()` updates the detail pane and the tree
selection highlight. `update()` rebuilds the tree model (preserving open/closed
+ selection by node id) and re-renders the detail. Search state persists across
updates.

### `PropertyGrid.ts` (extend)

- Introduce a `PropertySection { title?: string; fields: PropertyField[]; readonly?: boolean }`
  concept; `renderPropertyGrid` renders sections. Existing per-type field lists
  become the editable section; new NPC read-only sections are added.
- Swap inline `cssText` for the `.sg-dev-*` classes from `dev-styles.ts`.
- Behavior preserved: enum/number/boolean/string/json inputs; bad JSON ⇒ red
  border, no commit; readonly fields disabled.

### `npc-helpers.ts` — implement `getRecentEventDescriptions`

Currently returns `[]` (stub). Implement: read `recentEventIds: number[]` from
NPC properties, resolve each against the `EventLog`, return the matched events'
human descriptions (most-recent-first, capped at ~8). If the event log lookup
isn't id-addressable, resolve by scanning the log's entries for matching ids.

### `dev-mode-controller.ts` (rewire)

- Remove `mountInspectorPanel` + `mountWorldInspector`; mount one
  `mountInspector(...)`. Keep the `DEV_UI_Z` band assignment (now applied to the
  Inspector element + remaining panels + the toggle button).
- Right-click hit → `inspector.selectHit(hit)` + `inspector.show()`.
- Ctrl+Shift+I → `inspector.toggle()`.
- Per-frame `updateWorldInspector()` becomes `updateInspector()` → calls
  `inspector.update()` only while visible (throttled by the existing cadence).
- `onEdit` → existing `applyInspectorEdit`; `onDelete`/`onUndo`/`onRedo` →
  existing methods; `onFocusCamera` → existing camera math.
- `destroy()` disposes the single inspector.

## Data flow

```
canvas right-click ─┐
                     ├─► inspector.select(Selection) ─► detail pane + tree highlight
tree node click  ───┘
edit in detail ─► onEdit(hit,key,val) ─► applyInspectorEdit ─► world.updateEntity/setProperty
                                                            └─► undo stack ─► inspector.update()
frame loop (dev on & visible) ─► inspector.update() (throttled) ─► rebuild tree + re-render detail
```

## Error handling

- `null` world/map ⇒ tree shows "No world loaded"; detail shows empty state.
- Selection of a removed/dead entity ⇒ "Selection no longer present", detail clears.
- Bad JSON in properties editor ⇒ red border, value not committed.
- Editing is confined to safe scalar/enum/boolean/JSON fields; derived fields
  (age/weathering) and rich sim aggregates are read-only.

## Testing (vitest / jsdom)

1. **FloatingPanel:** show/hide/toggle/isVisible/destroy; root carries
   `.sg-dev-panel`; z-index defaults to 600; `setTitle` updates the chrome title;
   close button hides.
2. **inspector-tree:** given a small hand-built `World` + seed, `buildInspectorTree`
   yields a root with branches World/Seed/Lore/POIs/Entities-by-kind/Spirits/Tiles;
   entity kinds are grouped with correct counts; search filtering keeps matching
   nodes and their ancestors.
3. **selection:** `selectionFromHit` maps entity/tile/decoration hits correctly.
4. **inspector-detail / PropertyGrid:** NPC selection renders read-only
   Beliefs/Needs/Personality sections; an editable scalar (e.g. `role`) fires
   `onEdit`; a removed entity selection shows the "no longer present" state; bad
   JSON does not commit.
5. **getRecentEventDescriptions:** resolves `recentEventIds` against an EventLog
   and returns descriptions newest-first, capped.
6. **Inspector integration:** `selectHit(hit)` and selecting a tree leaf both
   update the detail host; `update()` preserves selection + open nodes by id.
7. **DevModeController rewire:** right-click selects in the inspector; Ctrl+Shift+I
   toggles; edit path still reaches `applyInspectorEdit`/undo.
8. Replace the deleted `InspectorPanel`/`WorldInspector` tests; **keep all 900
   existing tests green** (net count rises with the new suites).

## Out of scope

- Migrating TimeDebug/MapEditor/DebugOverlay/EntitySpawner onto `FloatingPanel`
  (deferred; the primitive is built so they can later).
- Persisting panel position/open-state across reloads.
- Player-facing NPC mind/whisper/conversation UI (separate Track-2 feature).
- Resizable/dockable panels, multi-select, drag-reorder.
