# Archived — TECH_SPEC.md generation/rendering/editor/API sections (never built)

**Archived**: 2026-07-04
**Why**: A promises-vs-reality documentation audit found these `TECH_SPEC.md`
sections describe an architecture that was drafted (2026-05-29) but **never
implemented** — zero references anywhere in `src/` to `fal.ai`, Birefnet,
ADE20K, a REST `/api/*` server, or a POI/Road editor with drag handles. The
game shipped a completely different, since-superseded architecture instead:

- **Rendering**: WebGPU-only (`render/gpu/`), not a Kenney-tile + FLUX/Birefnet
  AI-rendering pipeline. See `CLAUDE.md` § Rendering.
- **World generation**: noise-based terrain (`terrain/terrain-generator.ts`) +
  connectome/settlement-driven layout, generated whole (not per-chunk
  on-demand). WFC (`src/wfc/`) primitives are retained but **dormant**
  (`generateWithWFC` is bypassed).
- **Buildings**: parametric blueprint → manifold geometry → OpenRouter img2img
  pipeline (`src/assetgen/`), not Kenney tiles + a FLUX/Birefnet tile-render
  loop.
- **No server, no REST API** — this is a client-only Vite/TypeScript app.
  Out-of-process control (dev-only) goes through the `GameBus`
  WebSocket bridge + stdio MCP server (`tools/mcp-server.ts`), not a REST API.
- **World/POI editing** lives in the dev **Studio** (`?studio=world`):
  `src/studio/world-node-edits.ts` exposes move/add/remove/retune POI edits
  that fold back into regeneration — no live drag-handle POI/Road editor with
  waypoint dragging as described below.

The text below is preserved verbatim as a historical record of the original
design intent; it is **not** current or planned architecture. `TECH_SPEC.md`
now points here instead of describing this flow.

---

## 3. System Architecture (original, as drafted 2026-05-29)

```
┌─────────────────────────────────────────────────────────────────────┐
│                           User Interface                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │ Map Viewer  │  │ Map Editor  │  │ POI Editor  │  │ Road Editor │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘ │
└─────────┼────────────────┼────────────────┼────────────────┼────────┘
          │                │                │                │
          ▼                ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Rendering Pipeline                           │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ View Modes: Base │ Base+Decos │ Segmap │ Rendered              ││
│  └─────────────────────────────────────────────────────────────────┘│
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │  Autotiler  │→ │TileRenderer │→ │DecoRenderer │→ │ Compositor  │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        AI Rendering Pipeline                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │ Base Image  │+ │ Decorations │+ │   Segmap    │→ │  FLUX AI    │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └──────┬──────┘ │
│                                                            │        │
│                                      ┌─────────────┐       │        │
│                                      │  Birefnet   │←──────┘        │
│                                      │ (BG Remove) │                │
│                                      └──────┬──────┘                │
│                                             ▼                       │
│                                    Transparent Tile PNG             │
└─────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Generation Engine                             │
│         ┌─────────────┐    ┌─────────────┐    ┌─────────────┐       │
│         │ WFC Engine  │ →  │ POI Placer  │ →  │ Road Carver │       │
│         └─────────────┘    └─────────────┘    └─────────────┘       │
└─────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Data Layer                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │ WorldSeed   │  │   Chunks    │  │    POIs     │  │ Connections │ │
│  │   (JSON)    │  │  (Cached)   │  │  (Indexed)  │  │  (Indexed)  │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

## 4. Generation Pipeline (original, as drafted 2026-05-29)

### 4.1 Chunk Generation Flow

```
1. Request chunk at (cx, cy)
           │
           ▼
2. Check if chunk exists in cache
           │
    ┌──────┴──────┐
    │ Yes         │ No
    ▼             ▼
3. Return    4. Get neighboring chunks (for edge constraints)
   cached           │
                    ▼
           5. Initialize WFC grid with:
              - Edge constraints from neighbors
              - POI terrain influence
              - Biome weights
                    │
                    ▼
           6. Run WFC solver
                    │
                    ▼
           7. Apply POI-specific tiles
              (buildings on village POIs, etc.)
                    │
                    ▼
           8. Carve roads/rivers through chunk
              (using Connection data)
                    │
                    ▼
           9. Place decorations
              (respecting placement rules)
                    │
                    ▼
          10. Cache chunk
                    │
                    ▼
          11. Return chunk
```

### 4.2 WFC Constraint System

```typescript
interface TileConstraint {
  tile: string;

  // Adjacency rules (which tiles can be neighbors)
  north: string[];
  south: string[];
  east: string[];
  west: string[];

  // Weight modifiers
  baseWeight: number;            // Default probability
  biomeWeights: Record<BiomeType, number>;
  poiInfluence: Record<POIType, number>;
}
```

### 4.3 Road Auto-Bridge Logic

When a road crosses water:

1. Detect water tile intersection during road carving
2. Check if bridge is possible (water width ≤ 3 tiles)
3. Place bridge tiles with correct orientation (NS or EW)
4. If water too wide, route around or fail with warning

---

## 5. Rendering Pipeline (original, as drafted 2026-05-29)

### 5.1 View Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| Base | Kenney tiles only | Debug, tile inspection |
| Base + Decos | Kenney + decoration sprites | Full preview |
| Segmap | ADE20K segmentation colors | AI input preview |
| Rendered | AI-generated tiles | Final quality |

### 5.2 AI Tile Generation Flow

```
1. Prepare base canvas (512x512, transparent)
           │
           ▼
2. Draw Kenney tile centered at (256, 333)
           │
           ▼
3. Draw decorations on top (using DecorationRenderer)
           │
           ▼
4. Prepare segmap canvas (512x512, ADE20K sea background)
           │
           ▼
5. Draw tile segmentation diamond
           │
           ▼
6. Draw decoration segmentation shapes
           │
           ▼
7. Build prompt from:
   - Tile type description
   - Decoration descriptions
   - World biome/style
           │
           ▼
8. Send to FLUX API:
   - image_url: base canvas
   - easycontrols[0]: segmap (optional)
   - prompt: generated prompt
           │
           ▼
9. Receive AI result image
           │
           ▼
10. Send to Birefnet for background removal
           │
           ▼
11. Save transparent PNG to cache
           │
           ▼
12. Update renderedTileCache
```

### 5.3 Tile Caching Strategy

```typescript
interface TileCache {
  // In-memory cache (LRU)
  memory: Map<string, ImageBitmap>;  // key: `${layer}:${tileId}_v${variant}`
  maxMemorySize: number;             // Default: 500 tiles

  // Disk cache (persistent)
  diskPath: string;                  // /tiles/rendered/{style}/
  format: 'png';

  // Cache key format
  getKey(style: string, tileId: string, variant: number): string;
}
```

---

## 6. Editor Features (original, as drafted 2026-05-29)

### 6.1 Map Navigation

- **Pan**: Drag to pan, scroll wheel
- **Zoom**: +/- buttons, pinch gesture, scroll + modifier
- **Minimap**: Click to jump, viewport indicator

### 6.2 Tile Selection

- Click tile to select
- Show tile info panel:
  - Position (x, y)
  - Type (semantic + visual variant)
  - Decorations list
  - POI reference (if any)
  - AI render status

### 6.3 POI Editor

- **Add POI**: Click location, select type, fill details
- **Edit POI**: Select POI marker, edit in panel
- **Delete POI**: Select + delete key
- **Move POI**: Drag POI marker
- **Resize POI**: Drag radius handle

### 6.4 Road Editor

- **Add Road**:
  1. Enter road mode
  2. Click start point (POI or coordinate)
  3. Click waypoints (optional)
  4. Click end point
  5. Configure style, width, auto-bridge

- **Edit Road**:
  - Select road to show waypoints
  - Drag waypoints to adjust
  - Add/remove waypoints

- **Auto-Bridge**: Toggle per-road, visual indicator on water crossings

### 6.5 Decoration Editor (Future)

- Manual decoration placement
- Decoration brush for area filling
- Clear decorations from selection

---

## 9. API Endpoints (original, as drafted 2026-05-29)

### 9.1 Server Endpoints

```
GET  /api/tiles/available       # List available tile types
POST /api/tiles/save-rendered   # Save AI-rendered tile
GET  /tiles/kenney/{id}.png     # Kenney tile images
GET  /tiles/rendered/{style}/{id}_v{n}.png  # Rendered tiles

POST /api/fal/{endpoint}        # Proxy to fal.ai
  - fal-ai/flux-general/image-to-image
  - fal-ai/birefnet
```

### 9.2 Future Endpoints

```
POST /api/worlds                # Create world
GET  /api/worlds/{id}           # Get world
PUT  /api/worlds/{id}           # Update world
DELETE /api/worlds/{id}         # Delete world

GET  /api/worlds/{id}/chunks/{cx},{cy}  # Get generated chunk
```
