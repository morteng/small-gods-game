# LPC Sprites: Terrain Sheets + Building Sprites

**Date:** 2026-02-22

## Goal

Replace color-placeholder terrain tiles and building boxes with real LPC pixel art.
Architecture stays extensible: adding a new terrain type or building = drop a PNG + add one data entry.

## Constraints

- LPC assets from OpenGameArt (bluecarrot16 packs), CC-BY-SA
- Minimal first — get existing terrain groups and building templates working
- No renderer code changes required to add new content later
- Graceful fallback (Kenney tiles / colored boxes) if an asset file is missing

---

## Terrain Sheets

**Pattern:** One PNG per terrain group at `public/sprites/terrain/{group}.png`

Expected sheet format (per LPC blob autotile standard):
- 6 columns × 8 rows of 32×32 tiles = 192×256 px per sheet
- Blob index 0–46 maps to `col = idx % 6`, `row = floor(idx / 6)`

**Initial terrain groups (matching `TERRAIN_GROUPS` in blob-autotiler.ts):**
```
public/sprites/terrain/
  grass.png
  dirt.png
  sand.png
  water.png
  stone.png
  rocky.png
```

**RenderContext change:**
```typescript
// Before
terrainAtlas: HTMLImageElement | null

// After
terrainSheets: Map<string, HTMLImageElement>   // key = terrain group name
```

**Rendering logic (drawTerrain):**
```typescript
const sheet = rc.terrainSheets.get(blob.terrainGroup);
if (sheet) {
  const col = blob.blobIndex % 6;
  const row = Math.floor(blob.blobIndex / 6);
  ctx.drawImage(sheet, col*32, row*32, 32, 32, px, py, TILE_SIZE, TILE_SIZE);
} else {
  // fall through to Kenney or TILE_COLORS
}
```

**Extensibility:** Adding `snow` terrain later = drop `public/sprites/terrain/snow.png` + add `snow: 'snow'` to `TERRAIN_GROUPS` in blob-autotiler.ts. Zero renderer changes.

---

## Building Sprites

**Pattern:** One PNG per building template ID at `public/sprites/buildings/{templateId}.png`

Each PNG shows the full building in LPC oblique 3/4 view, sized to `template.spriteSize` pixels.

**Initial building sprites:**
```
public/sprites/buildings/
  cottage.png          (96×128 px)
  temple_small.png     (128×160 px)
  farm_barn.png        (96×96 px)
  market_stall.png     (64×80 px)
  tavern.png           (96×128 px)
  tower.png            (64×160 px)
  castle_keep.png      (128×192 px)
  dock.png             (64×96 px)
```

**RenderContext addition:**
```typescript
buildingSprites: Map<string, HTMLImageElement>   // key = templateId
```

**Rendering logic (drawYSortedEntities, buildings section):**
```typescript
const sprite = rc.buildingSprites.get(building.templateId);
if (sprite) {
  const dx = building.tileX * TILE_SIZE + template.spriteOffset.x;
  const dy = building.tileY * TILE_SIZE + template.spriteOffset.y;
  ctx.drawImage(sprite, 0, 0, template.spriteSize.w, template.spriteSize.h,
                dx, dy, template.spriteSize.w, template.spriteSize.h);
} else {
  // fallback: current colored rectangle + name label
}
```

**Extensibility:** Adding `blacksmith` building = add `blacksmith.png` + add template entry to `building-templates.ts`. Zero renderer changes.

---

## Code Changes

| File | Change |
|------|--------|
| `src/core/types.ts` | Replace `terrainAtlas: HTMLImageElement \| null` with `terrainSheets: Map<string, HTMLImageElement>`; add `buildingSprites: Map<string, HTMLImageElement>` |
| `src/render/terrain-atlas.ts` | Simplify: export a pure function `getTerrainSpriteCoords(blobIndex)` → `{sx, sy, sw, sh}` only (no more row offset logic — caller provides the per-group image) |
| `src/render/renderer.ts` | Update `drawTerrain` to use `terrainSheets`; update building drawing to use `buildingSprites` |
| `src/game.ts` | Load `terrainSheets` (one per terrain group, skip missing); load `buildingSprites` (one per template ID, skip missing); pass both in RenderContext |
| `docs/ASSETS_SETUP.md` | Download guide: exact URLs, filenames, where to put each file |

---

## Asset Download Guide (docs/ASSETS_SETUP.md)

### LPC Terrains (terrain sheets)

**Source:** https://opengameart.org/content/lpc-terrains
**Author:** bluecarrot16
**License:** CC-BY-SA 3.0/4.0

Download the pack. Inside, find sheets for each terrain type (grass, water, dirt, sand, stone, rocky). Each should be a 192×256 px (6×8 tiles) PNG. Rename and place:
```
public/sprites/terrain/grass.png
public/sprites/terrain/water.png
public/sprites/terrain/dirt.png
public/sprites/terrain/sand.png
public/sprites/terrain/stone.png
public/sprites/terrain/rocky.png
```

### LPC Buildings (building sprites)

**Source:** https://opengameart.org/content/lpc-thatched-roof-cottage
**Author:** bluecarrot16
**License:** CC-BY-SA 3.0

Download the pack. Find pre-composed building PNGs. Rename and place:
```
public/sprites/buildings/cottage.png
public/sprites/buildings/farm_barn.png
public/sprites/buildings/tavern.png
public/sprites/buildings/tower.png
public/sprites/buildings/castle_keep.png
public/sprites/buildings/temple_small.png
public/sprites/buildings/market_stall.png
public/sprites/buildings/dock.png
```

---

## Future Extensibility Notes

- **New terrain:** 1 PNG + 1 line in `TERRAIN_GROUPS` (blob-autotiler.ts)
- **New building:** 1 PNG + 1 entry in `BUILDING_TEMPLATES` (building-templates.ts)
- **New tree variant:** 1 PNG + 1 string in the variants array (game.ts loadTreeSheets)
- **LLM DM integration:** terrain groups, building template IDs, and tree variants are all string-keyed maps — easy to reference by name in prompts or tool responses
- **Animals / NPCs:** same pattern — `public/sprites/animals/{type}.png`, loaded into a Map
