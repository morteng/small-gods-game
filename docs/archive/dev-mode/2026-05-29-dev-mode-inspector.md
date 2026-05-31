# Developer Mode & World Inspector — Implementation Plan

**Date**: 2026-05-29
**Status**: Planning — implementation in fresh session
**Goal**: Right-click any world object → contextual info, editable properties, manipulation tools

---

## 1. Current Codebase State (Read Before Implementing)

### Key Files & Their Roles

| File | Role |
|------|------|
| `src/game.ts` | Game class, owns canvas, state, mount point |
| `src/ui/controls.ts` | Mouse/canvas events, already has `contextmenu` listener (line 134) |
| `src/render/renderer.ts` | Main renderer, `RenderContext` interface |
| `src/core/types.ts` | All type definitions (Tile, Entity, NpcInstance, RenderContext…) |
| `src/core/state.ts` | `GameState` — has `world: World \| null` |
| `src/world/world.ts` | World class — `query()`, `addEntity()`, `removeEntity()` |
| `src/world/entity-registry.ts` | Low-level entity store + spatial index |
| `src/sim/pathfinding.ts` | `isWalkable()` — now entity-aware (Phase 1 done) |
| `src/map/building-templates.ts` | `BuildingTemplate` with floors, palette, genHints |

### What Already Exists

- `controls.ts` line 134: `canvas.addEventListener('contextmenu', onContextMenu);`
- `RenderContext` interface (in `types.ts`) — extendable for dev mode
- `World.query({ region })` — spatial query for hit-testing
- `BuildingTemplate` — already has `palette`, `genHints`, `floors[]`

### What Does NOT Exist Yet

- `src/dev/` directory — needs to be created
- No selection state management
- No property grid / inspector UI
- No undo/redo stack

---

## 2. Architecture Overview

```
User right-clicks canvas
        ↓
controls.ts catches contextmenu event
        ↓
Convert screen coords → world coords (use camera zoom + pan)
        ↓
HitTest(rc, worldX, worldY) → HitResult
        ↓
Populate DevModeState.selected
        ↓
RenderContext passes devMode state → renderer draws highlight
        ↓
InspectorPanel reads DevModeState.selected → shows property grid
        ↓
User edits property → calls world.updateEntity() → re-render
```

### Core Types (Add to `src/core/types.ts` or new `src/dev/types.ts`)

```typescript
// ─── Hit Test Result ────────────────────────────────────────────────

export interface HitResult {
  type: 'tile' | 'entity' | 'npc' | 'decoration' | null;
  tileX: number;
  tileY: number;
  tile?: Tile;
  entity?: Entity;
  npc?: NpcInstance;
  decoration?: GeneratedDecoration;
}

// ─── Dev Mode State ─────────────────────────────────────────────────

export interface DevModeState {
  enabled: boolean;
  selected: HitResult | null;
  clipboard: Entity | null;
  undoStack: UndoAction[];
  redoStack: UndoAction[];
  activeTool: 'select' | 'paint' | 'erase' | 'place';
  brushType?: string;           // tile type or entity kind
  showGrid?: boolean;
  showCoords?: boolean;
}

export interface UndoAction {
  type: 'entity_update' | 'tile_update' | 'entity_delete' | 'entity_create';
  target: { tileX: number; tileY: number; entityId?: string };
  before: unknown;
  after: unknown;
}
```

---

## 3. Implementation Phases

### Phase 1: Selection + Basic Info Display *(2-3 hours)*

**Create new files:**

#### `src/dev/DevMode.ts`
```typescript
import type { DevModeState } from '@/core/types';

export function createDevMode(): DevModeState {
  return {
    enabled: false,
    selected: null,
    clipboard: null,
    undoStack: [],
    redoStack: [],
    activeTool: 'select',
  };
}

export function toggleDevMode(state: DevModeState): boolean {
  state.enabled = !state.enabled;
  return state.enabled;
}
```

#### `src/dev/hit-tester.ts`
```typescript
import type { RenderContext, HitResult, Tile, Entity, NpcInstance } from '@/core/types';
import { TILE_SIZE } from '@/core/constants';

export function hitTest(rc: RenderContext, canvasX: number, canvasY: number): HitResult {
  const worldX = (canvasX / rc.camera.zoom) + rc.camera.x;
  const worldY = (canvasY / rc.camera.zoom) + rc.camera.y;

  const tileX = Math.floor(worldX / TILE_SIZE);
  const tileY = Math.floor(worldY / TILE_SIZE);

  const nullResult = { type: null as const, tileX, tileY };

  // 1. Check NPCs (render on top)
  for (const npc of rc.npcs) {
    if (Math.floor(npc.tileX) === tileX && Math.floor(npc.tileY) === tileY) {
      return { type: 'npc' as const, npc, tileX, tileY };
    }
  }

  // 2. Check entities (buildings, trees, rocks)
  const entities = rc.world.query({ region: { x: tileX, y: tileY, w: 1, h: 1 } });
  if (entities.length > 0) {
    // Sort by y-sort to get topmost
    entities.sort((a, b) => getEntitySortY(b) - getEntitySortY(a));
    return { type: 'entity' as const, entity: entities[0], tileX, tileY };
  }

  // 3. Check decorations
  for (const d of rc.generatedDecorations ?? []) {
    if (d.tileX === tileX && d.tileY === tileY) {
      return { type: 'decoration' as const, decoration: d, tileX, tileY };
    }
  }

  // 4. Return tile
  const tile = rc.map.tiles[tileY]?.[tileX];
  return { type: 'tile' as const, tile, tileX, tileY };
}

function getEntitySortY(e: Entity): number {
  // (same logic as renderer's getEntitySortY)
}
```

#### `src/dev/InspectorPanel.ts` — Read-only info display
- Creates a floating `<div>` positioned near selection
- Shows: type, coordinates, key properties
- Three info layouts: TileInfo, EntityInfo, NpcInfo

**Modify existing files:**

| File | Change |
|------|--------|
| `src/ui/controls.ts` | Add F12 toggle; wire `contextmenu` event to `hitTest()` + show inspector |
| `src/game.ts` | Add `devMode: DevModeState` field; pass to render context |
| `src/render/renderer.ts` | Extend `RenderContext` with `devMode?`; draw selection highlight box |

---

### Phase 2: Editable Property Grid *(3-4 hours)*

#### `src/dev/PropertyGrid.ts`
Generic property editor — auto-generates form fields from object:

```typescript
interface PropertyField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'enum' | 'json';
  options?: string[];  // for enum
  min?: number;
  max?: number;
}

export function renderPropertyGrid(
  container: HTMLElement,
  obj: Record<string, unknown>,
  onChange: (key: string, value: unknown) => void,
): void {
  // Renders <label> + <input> per field
  // For Entity: kind (readonly), x/y (number), properties (json textarea)
  // For Tile: type (enum dropdown), walkable (checkbox), state (enum)
  // For NPC: name, role (enum), needs (sliders 0-1)
}
```

#### `src/dev/EntityEditor.ts`
- Entity-specific editing: floors[], materials, palette
- Special handling for BuildingTemplate fields

**Modify:**
- `src/dev/InspectorPanel.ts` — wire up `PropertyGrid`, call `world.updateEntity()` on change
- `src/world/world.ts` — ensure `updateEntity()` exists (it does — `registry.update()`)

---

### Phase 3: Context Menu + Actions *(2-3 hours)*

#### `src/dev/ContextMenu.ts`
Floating menu that appears at right-click position:

```typescript
interface ContextMenuItem {
  label: string;
  icon?: string;
  action: () => void;
  disabled?: boolean;
  separator?: boolean;
}

export function showContextMenu(
  x: number, y: number,
  items: ContextMenuItem[],
  container: HTMLElement,
): void {
  // Create floating <div> with menu items
  // Auto-close on click outside
}
```

#### Action Sets by Object Type

**Tile Actions:**
- Copy coordinates to clipboard
- Set tile type → submenu (all types from `TILE_COLORS`)
- Toggle walkable
- Paint tool (click-drag to paint)

**Entity Actions:**
- Delete entity (calls `world.removeEntity()`)
- Move to... (click to reposition — temporary drag mode)
- Copy entity (to devMode.clipboard)
- Regenerate (for AI-generated sprites)

**NPC Actions:**
- Teleport to... (click position)
- Edit beliefs dialog
- Kill / Revive
- Add memory event

**Background Click (no object):**
- Regenerate biome at position
- Place new entity → submenu (building, tree, rock, etc.)
- Fill area with terrain type

---

### Phase 4: Advanced Manipulation Tools *(4-5 hours)*

#### `src/dev/UndoStack.ts`
```typescript
export function pushUndo(state: DevModeState, action: UndoAction): void {
  state.undoStack.push(action);
  state.redoStack = []; // clear redo on new action
}

export function undo(state: DevModeState, world: World): void {
  const action = state.undoStack.pop();
  if (!action) return;
  // reverse the action
  applyAction(world, action.type, action.target, action.before);
  state.redoStack.push(action);
}

export function redo(state: DevModeState, world: World): void { /* similar */ }
```

#### `src/dev/BrushTool.ts`
- Terrain painting: click-drag to set tile types
- Entity stamp: click to place tree, rock, building
- Eraser: click to delete entities

#### `src/dev/WorldClipboard.ts`
- `Ctrl+C` / `Ctrl+V` for entities
- Generates new ID on paste (append timestamp)

---

### Phase 5: Partial Re-generation *(2-3 hours)*

#### `src/dev/RegenControls.ts`
- "Regenerate from here" button:
  - Re-runs biome brush at selected position
  - Re-places buildings in a settlement (calls `placeSettlement()`)
  - Re-generates NPCs for a POI
- Seed manipulation UI:
  - Show current seed
  - Change seed → regenerate world
  - "Export edited world" → save to JSON

---

## 4. Integration Points (Exact Code Locations)

### Extend RenderContext (`src/core/types.ts` ~line 130)

```typescript
export interface RenderContext {
  // ... existing fields ...

  // Dev mode (add these)
  devMode?: DevModeState;
  onRightClick?: (result: HitResult) => void;
}
```

### Modify controls.ts (`src/ui/controls.ts`)

Find the `onContextMenu` function (around line 125) — currently it prevents default.
Extend it to:

```typescript
function onContextMenu(e: MouseEvent) {
  e.preventDefault();
  if (!state.devMode?.enabled) return; // ← add this guard

  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;

  const hit = hitTest(renderContext, sx, sy);
  state.devMode.selected = hit;
  showInspectorPanel(hit, container);
}
```

### Modify game.ts (`src/game.ts`)

Add to `Game` class constructor or init:

```typescript
this.state.devMode = createDevMode();

// In render loop, pass to context:
const rc: RenderContext = {
  // ... existing ...
  devMode: this.state.devMode,
};
```

---

## 5. Visual Design

### Inspector Panel Layout

```
┌─────────────────────────────┐
│  🔧 Dev Mode — Inspector       │
├─────────────────────────────┤
│ Type: Tile (grass)            │
│ Tile: (45, 23)               │
├─────────────────────────────┤
│ Properties:                   │
│  type:    [grass      ▼]   │
│  walkable: [✓]              │
│  state:   [realized  ▼]   │
│  height:  [0.45        ]   │
├─────────────────────────────┤
│ Actions:                      │
│  [Copy Coords] [Set Type]   │
│  [Paint] [Regenerate]        │
└─────────────────────────────┘
```

### Selection Highlight

- Bounding box: 2px dashed yellow line around selected object
- For buildings: use footprint dimensions (template.footprint)
- For entities: single tile or sprite bounds
- For NPCs: tile + name label

---

## 6. Implementation Order (Recommended)

1. **Phase 1** — Selection + info display *(start here)*
   - Create `src/dev/` directory
   - Implement `DevMode.ts`, `hit-tester.ts`, basic `InspectorPanel.ts`
   - Modify `controls.ts` to wire right-click
   - Test: F12 → click objects → see info

2. **Phase 2** — Editable inspector
   - Implement `PropertyGrid.ts`
   - Wire edits to `world.updateEntity()`
   - Test: edit tile type → see it change

3. **Phase 3** — Context menus
   - Implement `ContextMenu.ts`, `actions.ts`
   - Add delete, move, regenerate actions
   - Test: right-click entity → delete it

4. **Phase 4** — Advanced tools
   - Implement undo/redo, brush tool
   - Test: Ctrl+Z after deleting entity

5. **Phase 5** — Re-generation
   - Implement partial world regen
   - Test: regenerate biome at position

---

## 7. Key API Calls to Use

```typescript
// World queries (for hit-testing)
const entities = world.query({ region: { x, y, w: 1, h: 1 } });

// Entity updates
world.registry.update(entityId, { x: newX, y: newY });
world.removeEntity(entityId);

// Tile updates
const tile = map.tiles[tileY][tileX];
tile.type = 'forest';
tile.walkable = true;

// Building placement (for "place entity" action)
import { placeSettlement } from '@/world/building-placer';
import { getBuildingTemplate } from '@/map/building-templates';

// Regenerate biome at position
import { applyBrush } from '@/world/brushes';
world.applyBrush('forest', { x: 10, y: 10, w: 20, h: 20 }, seed);
```

---

## 8. Open Questions to Resolve in Implementation Session

1. **Iframe embed mode** — Should dev mode work inside iframe? (Recommend: secret key combo like Ctrl+Shift+D)
2. **Performance** — Large worlds with 1000+ entities — hit-test needs optimization? (We have spatial index — should be fine)
3. **Persistence** — Should edits save to world seed JSON? (Phase 5 — "Export edited world")
4. **Multi-select** — Shift+click to select multiple? (Phase 4 — advanced tool)

---

## 9. Estimated Time

| Phase | Time | Cumulative |
|-------|------|------------|
| 1. Selection + Info | 2-3h | 2-3h |
| 2. Editable Inspector | 3-4h | 5-7h |
| 3. Context Menus | 2-3h | 7-10h |
| 4. Advanced Tools | 4-5h | 11-15h |
| 5. Re-generation | 2-3h | 13-18h |

**Total: 13-18 hours for complete Dev Mode + Inspector**

---

---

## 10. Critical Implementation Notes for Fresh Session

### Key Code Snippets to Use

**Camera Transform (screen → world coords):**
```typescript
// From controls.ts - convert screen pixels to tile coords
const rect = canvas.getBoundingClientRect();
const sx = e.clientX - rect.left;
const sy = e.clientY - rect.top;
const worldX = (sx / camera.zoom) + camera.x;
const worldY = (sy / camera.zoom) + camera.y;
const tileX = Math.floor(worldX / TILE_SIZE);
const tileY = Math.floor(worldY / TILE_SIZE);
```

**Get RenderContext (for hit-testing):**
```typescript
// In game.ts, build the context that renderer uses:
const rc: RenderContext = {
  map: this.state.map!,
  camera: this.state.camera,
  canvasWidth: this.canvas.width,
  canvasHeight: this.canvas.height,
  npcs: this.getRenderNpcs(),
  npcSheets: this.sheets,
  world: this.state.world!,
  // ... other fields
  devMode: this.state.devMode,  // ADD THIS
};
```

**Show/Hide Inspector Panel:**
```typescript
// Create once, toggle visibility
const inspector = document.createElement('div');
inspector.style.cssText = `
  position: absolute;
  top: 60px;
  right: 10px;
  width: 280px;
  background: rgba(20, 20, 30, 0.92);
  color: #e0e0e0;
  border: 1px solid #555;
  border-radius: 6px;
  padding: 12px;
  font: 12px monospace;
  z-index: 100;
  display: none;  /* toggle via devMode.selected */
`;
container.appendChild(inspector);
```

**Entity Sort Y (for z-order hit-testing):**
```typescript
// From renderer.ts - use same logic
function getEntitySortY(e: Entity): number {
  const def = tryGetEntityKindDef(e.kind);
  if (!def) return e.y;
  if (def.category === 'building') {
    const tpl = getBuildingTemplate((e.properties?.templateId as string) ?? e.kind);
    if (tpl) return e.y + tpl.sortYOffset;
  }
  return e.y + (def.yOffsetForSort ?? 0);
}
```

### Testing Checklist (Per Phase)

- [ ] F12 toggles dev mode (visual indicator appears)
- [ ] Right-click tile → shows tile type + coords
- [ ] Right-click building → shows building template + properties
- [ ] Right-click tree → shows entity kind, offsetX/Y
- [ ] Right-click NPC → shows name, role, needs
- [ ] Change tile type in inspector → terrain redraws
- [ ] Change entity x/y → entity moves
- [ ] Delete entity → removed from world + not rendered
- [ ] Ctrl+Z → undo last action
- [ ] Brush tool → paints tiles on drag

### Common Pitfalls

1. **Camera transform** — Don't forget zoom AND pan offset
2. **Tile vs Entity selection** — Entities render ON tiles, handle both
3. **Entity sorting** — Buildings sort by footprint bottom, not their y
4. **World state sync** — After `registry.update()`, call `world.indexExisting(e)` if needed
5. **Render trigger** — After state change, call `callbacks.onRedraw()` to update canvas
