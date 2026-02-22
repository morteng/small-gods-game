# Art Assets Setup

All art assets use CC-BY-SA 3.0/4.0 from OpenGameArt.org (bluecarrot16).
Download once and place in the correct paths. The game gracefully falls back
to Kenney tiles / colored boxes for any missing files.

---

## Terrain Sheets

**Source:** https://opengameart.org/content/lpc-terrains
**Author:** bluecarrot16 | **License:** CC-BY-SA 3.0/4.0

Each terrain sheet: 192x256 px (6 cols x 8 rows of 32x32 tiles, 47 blob variants).

**IMPORTANT:** Verify the downloaded sheets match this layout (6 columns, 8 rows).
The blob index maps to col = index % 6, row = floor(index / 6). If the actual pack
uses a different arrangement, update `getTerrainSpriteCoords()` in `terrain-atlas.ts`.

| File | Terrain Group | Notes |
|------|--------------|-------|
| `public/sprites/terrain/grass.png` | grass | Primary ground |
| `public/sprites/terrain/water.png` | water | Lakes, rivers |
| `public/sprites/terrain/dirt.png`  | dirt  | Paths, earth |
| `public/sprites/terrain/sand.png`  | sand  | Beaches, desert |
| `public/sprites/terrain/stone.png` | stone | Stone roads, castle floors |
| `public/sprites/terrain/rocky.png` | rocky | Mountains, quarry |

**To add a new terrain type:**
1. Drop `public/sprites/terrain/{group}.png` (192x256 px, 6x8 blob tiles)
2. Add one entry to `TERRAIN_GROUPS` in `src/map/blob-autotiler.ts`
3. Add the group name to the `groups` array in `game.ts loadTerrainSheets()`

---

## Building Sprites

**Source:** https://opengameart.org/content/lpc-thatched-roof-cottage
**Author:** bluecarrot16 | **License:** CC-BY-SA 3.0

Each building is a pre-composed LPC oblique 3/4-view PNG.
Size must match `spriteSize` in `src/map/building-templates.ts`.

**NOTE:** The spriteSize values below are estimates. After downloading actual
LPC building PNGs, measure the real dimensions and update `spriteSize` and
`spriteOffset` in `building-templates.ts` to match.

| File | Template ID | Expected Size | Category |
|------|------------|---------------|----------|
| `public/sprites/buildings/cottage.png`      | cottage      | 96x128 px  | residential |
| `public/sprites/buildings/temple_small.png` | temple_small | 128x160 px | religious |
| `public/sprites/buildings/farm_barn.png`    | farm_barn    | 96x96 px   | farm |
| `public/sprites/buildings/market_stall.png` | market_stall | 64x80 px   | commercial |
| `public/sprites/buildings/tavern.png`       | tavern       | 96x128 px  | commercial |
| `public/sprites/buildings/tower.png`        | tower        | 64x160 px  | military |
| `public/sprites/buildings/castle_keep.png`  | castle_keep  | 128x192 px | military |
| `public/sprites/buildings/dock.png`         | dock         | 64x96 px   | special |

**To add a new building type:**
1. Drop `public/sprites/buildings/{templateId}.png`
2. Add one entry to `BUILDING_TEMPLATES` in `src/map/building-templates.ts`
3. No renderer changes needed.

---

## Tree Sprites (already installed)

| File | Variant |
|------|---------|
| `public/sprites/trees/trees-green.png`  | green  |
| `public/sprites/trees/trees-orange.png` | orange |
| `public/sprites/trees/trees-dead.png`   | dead   |
| `public/sprites/trees/trees-pale.png`   | pale   |
| `public/sprites/trees/trees-brown.png`  | brown  |

---

## Fallback Behavior

If any file is missing, the game falls back gracefully:
- Terrain sheet missing → Kenney Tiny Town tile → TILE_COLORS flat color
- Building sprite missing → colored rectangle with building name label
- Tree variant missing → that variant silently skipped

---

## Attribution

All CC-BY-SA assets require attribution in distributed builds.
See `CREDITS.md` for full credit chains.
