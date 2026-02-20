# Small Gods - Implementation Plan

**Version**: 2.0.0
**Status**: Active
**Last Updated**: 2026-02-20

> **Note:** As of 2026-02-20, the codebase was migrated from global-scope JS (`public/js/`) to TypeScript ES modules (`src/`) bundled by Vite. The isometric + AI rendering pipeline (~4,000 lines) was replaced with a simple top-down colored-rectangle renderer (~200 lines). See `docs/plans/2026-02-20-ts-migration-design.md` for details.

---

## 1. Implementation Phases

### Phase 1: Foundation
**Status**: ✅ Complete (simplified in TS migration)

Core map generation and rendering. Originally isometric + AI-rendered tiles; now simplified to top-down colored rectangles.

| Task | Status | Notes |
|------|--------|-------|
| Autotiler (semantic → visual) | ✅ Done | `src/map/autotiler.ts`, 70+ variants |
| WFC engine | ✅ Done | `src/wfc/`, backtracking solver |
| Map generation | ✅ Done | `src/map/map-generator.ts`, terrain + POI + roads |
| Top-down renderer | ✅ Done | `src/render/renderer.ts`, colored rectangles |
| Camera (pan/zoom) | ✅ Done | `src/render/camera.ts` |
| Minimap | ✅ Done | `src/render/minimap.ts` |
| Game class (embeddable) | ✅ Done | `src/game.ts`, iframe-ready |
| ~~AI tile rendering~~ | Removed | Replaced by colored rectangles |
| ~~Decoration system~~ | Removed | Will revisit when art pipeline matures |
| ~~Isometric renderer~~ | Removed | Replaced by top-down view |

### Phase 2: Chunked Infinite Maps
**Status**: ✅ Core Complete

| Task | Status | Notes |
|------|--------|-------|
| ChunkManager class | ✅ Done | `src/map/chunk-manager.ts` |
| In-memory caching (LRU) | ✅ Done | Configurable max chunks |
| Cross-chunk edge constraints | ✅ Done | Neighbor edge seeding |
| Chunk coordinate system | ✅ Done | World↔Chunk↔Local conversion |
| Viewport-based chunk loading | 🟡 Partial | API ready, needs UI integration |
| IndexedDB persistence | ⬜ Pending | Future enhancement |
| Seamless chunk rendering | 🟡 Partial | Needs TileMapRenderer integration |

### Phase 3: Enhanced POI System
**Status**: ✅ Complete

| Task | Status | Notes |
|------|--------|-------|
| POI data model | ✅ Done | `src/core/schema.ts` |
| POI terrain influence on WFC | ✅ Done | `WFCEngine.applyTerrainZones()` |
| POI visualization on map | ✅ Done | `editor-overlay.js` |
| POI editor panel | ✅ Done | Properties panel in editor |
| POI add/edit/delete UI | ✅ Done | Click to add, Delete key |
| POI move/resize handles | ✅ Done | Drag to move POIs |
| POI search/filter | ⬜ Pending | Low priority |

### Phase 4: Road/Connection System
**Status**: ✅ Complete

| Task | Status | Notes |
|------|--------|-------|
| Connection data model | ✅ Done | `src/core/schema.ts` |
| Multi-waypoint paths | ✅ Done | Ctrl+click to add waypoints |
| Road editor mode | ✅ Done | Mode 5 in toolbar |
| Auto-bridge detection | ✅ Done | `WFCEngine.carveRoad()` |
| Auto-bridge placement | ✅ Done | Crosses water → bridge tile |
| Path editing | ✅ Done | Mode 6, drag waypoints |
| Connection properties | ✅ Done | Type, style, autoBridge toggle |

### Phase 5: Editor Polish
**Status**: 🟡 Partial

| Task | Status | Notes |
|------|--------|-------|
| Keyboard shortcuts | ✅ Done | 1-6 for modes, Del, Esc, Enter |
| Coordinate display | ✅ Done | Shows cursor position |
| Zoom to 1:1 | ✅ Done | 1:1 button in zoom controls |
| Minimap click-to-navigate | ✅ Done | Click minimap to pan |
| Selection highlights | ✅ Done | Visual feedback on hover/select |
| Undo/redo system | ⬜ Pending | Future enhancement |
| Grid overlay toggle | ⬜ Pending | Low priority |

### Phase 6: Persistence
**Status**: ✅ Complete

| Task | Status | Notes |
|------|--------|-------|
| JSON world save/load | ✅ Done | `src/map/world-manager.ts` |
| localStorage persistence | ✅ Done | Auto-saves world seed |
| File download/upload | ✅ Done | Load/Save File buttons |
| IndexedDB for chunks | ⬜ Pending | Future enhancement |
| Auto-save | ✅ Done | On every edit |
| Version migration | ⬜ Pending | Low priority |

### Phase 7: NPC Simulation Layer
**Status**: ⬜ Not Started

Core programmatic simulation that runs every tick without LLM calls.

| Task | Status | Notes |
|------|--------|-------|
| NPC data model | ⬜ Pending | personality, beliefs, needs, mood, relationships |
| NPC generation (per settlement) | ⬜ Pending | Seed-based, role distribution, social graph |
| Tick system (needs + mood) | ⬜ Pending | Update needs from world events, derive mood |
| Belief decay/growth per tick | ⬜ Pending | Event-driven + social pressure + time decay |
| Belief propagation on social graph | ⬜ Pending | Contagion model: assertiveness × trust × faith |
| Activity state machine | ⬜ Pending | Time-of-day schedule, event interrupts |
| Settlement-level event generation | ⬜ Pending | Droughts, festivals, disputes, births, deaths |
| NPC event ring buffer | ⬜ Pending | Last ~10 events per NPC, compact storage |
| Settlement aggregate belief | ⬜ Pending | Dominant religion per settlement |

### Phase 8: Divine Action System
**Status**: ⬜ Not Started

Player powers and the belief economy.

| Task | Status | Notes |
|------|--------|-------|
| Player god state model | ⬜ Pending | Power, domain tags, follower list |
| Power economy (regen from belief) | ⬜ Pending | power = Σ(faith × understanding × devotion) |
| Whisper action | ⬜ Pending | Target 1 NPC, low cost, triggers LLM |
| Omen action | ⬜ Pending | Area effect, medium cost, visual event |
| Answer prayer action | ⬜ Pending | Respond to NPC prayer, low cost |
| Dream action | ⬜ Pending | Visit sleeping NPC, medium cost |
| Miracle action | ⬜ Pending | Settlement-wide, high cost, meets a need |
| Domain tag tracking | ⬜ Pending | Tags accumulate from action types |
| Divine action UI | ⬜ Pending | Player interface for selecting/targeting actions |

### Phase 9: LLM Integration (Backfill System)
**Status**: ⬜ Not Started

On-demand LLM narration that makes the sim feel alive.

| Task | Status | Notes |
|------|--------|-------|
| NPC card prompt builder | ⬜ Pending | Compact NPC state → ~150 token prompt |
| LLM backfill on player focus | ⬜ Pending | Observe NPC/scene → generate narrative |
| Structured output (narrative + state delta) | ⬜ Pending | LLM returns text + JSON state changes |
| State writeback from LLM | ⬜ Pending | Apply belief/mood changes from interactions |
| Interaction memory (compress + store) | ⬜ Pending | Summarize LLM exchanges, store ~5 per NPC |
| LLM provider integration | ⬜ Pending | High-speed inference API (target: <200ms) |
| Conversation UI | ⬜ Pending | Player sees NPC dialogue, scene narration |

### Phase 10: Rival Spirit System
**Status**: ⬜ Not Started

| Task | Status | Notes |
|------|--------|-------|
| Spirit data model | ⬜ Pending | Personality, strategy, power, followers |
| Spirit generation (per world) | ⬜ Pending | Varied tiers: household → established |
| Programmatic spirit actions | ⬜ Pending | Weighted random from personality + situation |
| Spirit-player intersection detection | ⬜ Pending | When rival acts on player's target NPC |
| LLM backfill for rival encounters | ⬜ Pending | Rival speaks through devoted follower |
| Spirit power tracking | ⬜ Pending | Rival power grows/shrinks with their belief |
| Inter-faction conflict | ⬜ Pending | Proselytizing, theological disputes, holy wars |

### Phase 11: DM Agent (Background Director)
**Status**: ⬜ Not Started

Background LLM agent that turns simulation into story. Never interacts with player directly.

| Task | Status | Notes |
|------|--------|-------|
| DM state model | ⬜ Pending | Plot threads, player model, pacing, narrative phase |
| DM cadence system | ⬜ Pending | Trigger: per game-day OR on significant state changes |
| World state summarizer | ⬜ Pending | Compress world state → ~2000 token DM prompt |
| Event injection pipeline | ⬜ Pending | DM output → events applied to sim with timing |
| Plot thread tracker | ⬜ Pending | Setup → active → climax → resolve, Chekhov's gun mgmt |
| Rival spirit coaching | ⬜ Pending | DM directives override rival programmatic weights |
| Player modeling | ⬜ Pending | Track play style, engagement, adapt event preferences |
| Escalation ladder | ⬜ Pending | Game phase detection, difficulty calibration |
| Anti-grinding detection | ⬜ Pending | Detect repetitive strategies, inject complications |
| New NPC injection | ⬜ Pending | DM introduces characters (preacher, skeptic, refugee) |
| World context propagation | ⬜ Pending | DM context lines → NPC backfill prompts |
| Macro narration | ⬜ Pending | World-scale backfill when player zooms out |
| DM provider integration | ⬜ Pending | Larger model (70B/frontier), separate from NPC layer |

---

## 2. Detailed Task Breakdown

### 2.1 ChunkManager Implementation

```javascript
// Location: /public/js/ChunkManager.js

class ChunkManager {
  constructor(options) {
    this.chunkSize = options.chunkSize || 16;
    this.worldSeed = options.worldSeed;
    this.cache = new Map();  // In-memory cache
    this.generating = new Set();  // Currently generating
  }

  // Core methods
  async getChunk(cx, cy);           // Get or generate chunk
  async generateChunk(cx, cy);      // Generate new chunk
  getNeighborConstraints(cx, cy);   // Edge constraints from neighbors
  unloadDistantChunks(viewportCenter, radius);

  // Batch operations
  async preloadArea(cx, cy, radius);
  clearCache();
}
```

**Implementation Steps:**

1. Create ChunkManager class with basic structure
2. Implement single-chunk generation (extract from current code)
3. Add edge constraint extraction from neighbors
4. Implement WFC with pre-seeded edges
5. Add memory cache with LRU eviction
6. Add IndexedDB persistence
7. Integrate with TileMapRenderer

### 2.2 POI Editor Implementation

```javascript
// Location: /public/js/poi-editor.js

// POI Editor State
const poiEditor = {
  mode: 'select',  // 'select', 'add', 'move', 'resize'
  selectedPOI: null,
  dragState: null,
};

// Functions
function enterPOIMode(mode);
function handlePOIClick(x, y, e);
function handlePOIDrag(x, y, e);
function renderPOIOverlay(ctx, map, viewport);
function showPOIProperties(poi);
function savePOIChanges(poi, changes);
function deletePOI(poiId);
function addPOI(type, position);
```

**Implementation Steps:**

1. Add POI editor toolbar button
2. Implement POI rendering on map (icons/markers)
3. Implement click-to-select POI
4. Create POI properties panel
5. Implement add POI flow
6. Implement edit POI flow
7. Implement delete POI
8. Implement drag-to-move
9. Implement radius handle

### 2.3 Road Editor Implementation

```javascript
// Location: /public/js/road-editor.js

// Road Editor State
const roadEditor = {
  mode: 'select',  // 'select', 'add', 'edit'
  selectedConnection: null,
  drawingPath: [],  // Current path being drawn
};

// Functions
function enterRoadMode(mode);
function handleRoadClick(x, y, e);
function previewRoadPath(start, end);
function checkWaterCrossings(path);
function placeAutoBridges(path);
function saveConnection(connection);
function renderRoadOverlay(ctx, map, viewport);
```

**Implementation Steps:**

1. Add road editor toolbar button
2. Implement road visualization on map
3. Implement click-to-start-road
4. Implement waypoint clicking
5. Implement end-road-on-POI
6. Add water crossing detection
7. Add auto-bridge placement
8. Implement road editing (waypoint drag)
9. Implement road deletion

### 2.4 Auto-Bridge Logic

```javascript
// Location: /public/js/auto-bridge.js

function findWaterCrossings(path, map) {
  const crossings = [];
  for (let i = 0; i < path.length - 1; i++) {
    const segment = getSegment(path[i], path[i + 1]);
    for (const point of segment) {
      if (isWater(map, point.x, point.y)) {
        crossings.push({
          start: findWaterEdge(map, point, -1),  // Entry
          end: findWaterEdge(map, point, 1),     // Exit
          width: calculateWaterWidth(map, point, getDirection(path[i], path[i + 1]))
        });
      }
    }
  }
  return crossings;
}

function canPlaceBridge(crossing) {
  return crossing.width <= 3;  // Max bridge span
}

function placeBridge(map, crossing) {
  const direction = crossing.isHorizontal ? 'ew' : 'ns';
  for (let i = 0; i < crossing.width; i++) {
    setTile(map, crossing.tiles[i], `bridge_${direction}`);
  }
}
```

---

## 3. File Structure

```
small-gods-game/
├── docs/
│   ├── TECH_SPEC.md           # Technical specification
│   ├── IMPLEMENTATION.md      # This file
│   └── API.md                 # API documentation (future)
│
├── public/
│   ├── index.html             # Main application
│   ├── css/
│   │   └── *.css              # Modular stylesheets
│   ├── js/
│   │   ├── app.js             # Application entry
│   │   ├── state.js           # Global state management
│   │   ├── ui.js              # UI event handlers
│   │   ├── renderer.js        # Canvas rendering
│   │   ├── ChunkManager.js    # NEW: Chunk management
│   │   ├── poi-editor.js      # NEW: POI editing
│   │   ├── road-editor.js     # NEW: Road editing
│   │   ├── auto-bridge.js     # NEW: Auto-bridge logic
│   │   ├── editor.js          # Editor state/tools
│   │   ├── editor-overlay.js  # Editor overlays
│   │   ├── map-generator.js   # Map generation wrapper
│   │   ├── noise.js           # Perlin noise (legacy)
│   │   ├── ai-constants.js    # AI config constants
│   │   ├── ai-integration-v2.js # AI rendering
│   │   ├── tile-renderer.js   # Dynamic tile rendering
│   │   ├── tile-map-renderer.js # Map rendering
│   │   ├── autotiler.js       # Variant computation
│   │   ├── world-seed-editor.js # World seed modal
│   │   ├── WorldManager.js    # Save/load
│   │   └── decorations/
│   │       ├── DecorationRegistry.js
│   │       ├── DecorationRenderer.js
│   │       └── DecorationPlacer.js
│   │
│   ├── data/
│   │   ├── worlds/
│   │   │   └── default.json   # Default world seed
│   │   └── decorations/
│   │       └── *.json         # Decoration definitions
│   │
│   └── tiles/
│       ├── kenney/            # Base Kenney tiles
│       └── rendered/          # AI-rendered tiles
│           └── {style}/
│               └── {tile}_v{n}.png
│
├── src/
│   ├── wfc/
│   │   ├── WFCEngine.js       # Main WFC orchestrator
│   │   ├── Tile.js            # Tile definitions
│   │   ├── Cell.js            # Grid cell
│   │   ├── Grid.js            # 2D grid
│   │   ├── Propagator.js      # Constraint propagation
│   │   └── Solver.js          # WFC solver
│   │
│   ├── worldseed/
│   │   └── Schema.js          # World seed schema
│   │
│   └── tilegen/
│       └── TileRegistry.js    # Server-side tile gen
│
├── server.cjs                 # Node.js server
├── package.json
├── CLAUDE.md                  # Development notes
└── README.md
```

---

## 4. Migration Notes

### 4.1 Current State → Chunked Maps

**Data Migration:**
- Current maps store all tiles in single array
- New format stores chunks independently
- Migration: Convert existing map to chunk-0,0

**API Changes:**
- `map.tiles[y][x]` → `chunkManager.getTile(x, y)`
- `map.width/height` → Infinite (viewport-based)

### 4.2 POI Schema Enhancement

**Current:**
```json
{
  "id": "village_1",
  "type": "village",
  "position": {"x": 10, "y": 20}
}
```

**Enhanced:**
```json
{
  "id": "village_1",
  "type": "village",
  "name": "Millbrook",
  "description": "A small farming village known for its windmill.",
  "position": {"x": 10, "y": 20},
  "size": "medium",
  "radius": 5,
  "importance": "medium",
  "terrainInfluence": {
    "grass": 1.5,
    "meadow": 1.3,
    "forest": 0.5
  },
  "npcs": [],
  "secrets": {}
}
```

---

## 5. Testing Strategy

### 5.1 Unit Tests (Future)

- WFC solver correctness
- Autotiler variant selection
- Decoration placement rules
- Connection pathfinding

### 5.2 Integration Tests (Future)

- Chunk generation consistency
- Cross-chunk seamlessness
- POI → terrain influence
- Road → bridge placement

### 5.3 Manual Testing Checklist

**Chunk System:**
- [ ] Generate chunk at origin
- [ ] Generate adjacent chunks
- [ ] Verify edge continuity
- [ ] Test viewport scrolling
- [ ] Test memory limits

**POI Editor:**
- [ ] Add POI at click location
- [ ] Edit POI properties
- [ ] Delete POI
- [ ] Move POI by dragging
- [ ] Resize POI radius

**Road Editor:**
- [ ] Draw road between POIs
- [ ] Add waypoints
- [ ] Auto-bridge over water
- [ ] Edit existing road
- [ ] Delete road

---

## 6. Definition of Done

### MVP Milestone Criteria

1. **Chunked Generation**
   - Infinite map navigation works
   - No visible seams between chunks
   - Memory stays under 200MB

2. **POI System**
   - POIs display on map
   - Can add/edit/delete POIs
   - POIs influence nearby terrain

3. **Road System**
   - Can draw roads between POIs
   - Auto-bridges work over water
   - Roads render correctly

4. **Editor**
   - All view modes work
   - Pan/zoom smooth
   - Undo/redo works

5. **Persistence**
   - World saves to JSON
   - World loads from JSON
   - Chunks cached to IndexedDB

---

## 7. Risk Mitigation

| Risk | Mitigation |
|------|------------|
| WFC fails on chunk edges | Pre-seed edges from neighbors, fallback to noise |
| Memory overflow | Aggressive chunk unloading, limit cache size |
| AI rendering slow | Queue system, cache aggressively |
| Complex POI interactions | Keep POI influence simple (radius-based) |
| LLM latency breaks immersion | Use small models (8B) at high-speed inference providers (16k TPS) |
| LLM cost for many NPCs | Only LLM-narrate on player focus; sim handles rest programmatically |
| NPC state consistency after LLM | Structured output with explicit state deltas, validated before applying |
| Belief propagation runaway | Cap propagation rate, diminishing returns on repeated exposure |
| Rival spirits feel mechanical | LLM backfill on player-intersection moments; varied personality seeds |
| DM feels heavy-handed / railroading | DM creates situations not outcomes; amplifies sim trends, doesn't override |
| DM forgets plot threads | Persistent plot thread state with explicit resolution tracking |
| DM events inconsistent with NPC dialogue | DM world_context_lines injected into every NPC backfill prompt |
| DM model cost | Runs infrequently (1x/game-day); can use different provider than NPC layer |

---

## 8. Dependencies

### External

- fal.ai API (FLUX, Birefnet) — map rendering
- High-speed LLM inference API (target: 16k TPS, <200ms latency) — NPC narration
- Kenney tile assets
- Browser APIs (Canvas, IndexedDB)

### Internal

- WFC engine must be stable before chunking
- Autotiler must handle all edge cases
- Decoration system must be complete
- NPC sim layer (Phase 7) must be stable before LLM integration (Phase 9)
- Divine action system (Phase 8) must exist before rival spirits (Phase 10)

---

## 9. Next Steps

**Map system (Phases 1-6):** ~90% complete. Remaining: chunk rendering integration, undo/redo.

**Gameplay (Phases 7-10):** Not started. This is the core game.

1. **Phase 7**: NPC simulation layer — data models, tick system, belief propagation
2. **Phase 8**: Divine action system — player powers, power economy, UI
3. **Phase 9**: LLM integration — backfill system, structured output, conversation UI
4. **Phase 10**: Rival spirits — competing gods, inter-faction dynamics
5. **Phase 11**: DM agent — background director, pacing, plot threads, player modeling
