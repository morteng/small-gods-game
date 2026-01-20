# Small Gods - AI Asset Generation Plan

## Overview

This document outlines the integration of multiple Replicate AI models for generating game assets, NPCs, and enabling dynamic zoom-in views with intelligent pathfinding.

## Models Summary

| Model | Purpose | Cost | Output |
|-------|---------|------|--------|
| **rd-animation** | Animated NPC sprites | ~$0.0025/gen | GIF or spritesheet |
| **flux-2d-game-assets** | Game items/objects | ~$0.013/gen | PNG/WebP |
| **rd-tile** | Tileable textures | $0.024-0.10/gen | PNG tileset |
| **rd-plus** | High-res scene views | $0.024-0.099/gen | PNG up to 384px |
| **SAM 2** | Scene segmentation | ~$0.012/gen | Masks |

---

## 1. NPC Generation (rd-animation)

### Capabilities
- **4-direction walking animations** (up/down/left/right)
- **Walking + idle** combinations
- **Small sprites** (32x32) with attack, surprise, laying down
- **VFX** effects (fire, explosions, lightning)

### Styles Available
```javascript
const NPC_STYLES = {
  four_angle_walking: { width: 48, height: 48, frames: 4, directions: 4 },
  walking_and_idle: { width: 48, height: 48, frames: 8, directions: 4 },
  small_sprites: { width: 32, height: 32, frames: 6, directions: 4 },
  vfx: { width: '24-96', height: '24-96' }
};
```

### Example Prompts
- "Medieval peasant farmer with pitchfork"
- "Wizard in blue robe with staff"
- "Blacksmith with leather apron"
- "Village merchant with cart"
- "Guard in chainmail armor"

### Output
Returns animated GIF or PNG spritesheet with all frames/directions.

---

## 2. Game Assets (flux-2d-game-assets)

### Capabilities
- Items, weapons, tools
- UI elements
- Environmental objects
- Pixel art style consistency

### Optimal Settings
```javascript
const ASSET_CONFIG = {
  model: 'dev',          // Higher quality
  guidance_scale: 3,
  num_inference_steps: 28,
  lora_scale: 1,
  output_format: 'png'
};
```

### Example Prompts (use "FGAL" trigger word)
- "FGAL wooden chest, game asset, pixel art"
- "FGAL healing potion red bottle, white background"
- "FGAL golden key, fantasy game item"
- "FGAL campfire with logs, pixel art"

---

## 3. Tile Generation (rd-tile)

### Styles
| Style | Purpose | Best For |
|-------|---------|----------|
| `tileset` | Full tilesets | Complete terrain sets |
| `single_tile` | Individual textures | Custom terrain |
| `tile_object` | Small decorations | Flowers, rocks |
| `scene_object` | Large objects | Trees, buildings |

### Integration with Current System
Could replace or augment our procedural segment map with AI-generated tiles for more visual variety.

### Example Prompts
- "grass meadow with flowers" (single_tile)
- "cobblestone road worn" (tileset)
- "dense forest trees" (scene_object)

---

## 4. High-Res Zoom Views (rd-plus)

### The Concept
When player clicks a tile/area on the overview map, generate a detailed "zoomed in" view showing that location at higher resolution.

### Relevant Styles
- `isometric` - Isometric scene view (matches our map style)
- `isometric_asset` - Individual isometric objects
- `environment` - Environmental scenes
- `topdown_map` - Top-down alternative

### Resolution Options
- Small: up to 128x128
- Large: up to 384x384
- Classic: up to 192x192

### Workflow
```
1. User clicks tile at (x, y) on overview map
2. Get tile type and surrounding context
3. Generate prompt based on context:
   - "isometric medieval village square, cobblestone, thatched cottages"
4. Call rd-plus with style='isometric', width/height=384
5. Display zoomed view
6. Run SAM for segmentation (see below)
```

---

## 5. Segment Anything for Pathfinding

### The Concept
Use SAM 2 to analyze the high-res zoomed view and create a walkability mask that NPCs can use for pathfinding.

### Workflow
```
1. Generate high-res view with rd-plus
2. Send to SAM 2 for segmentation
3. Receive individual masks for each region
4. Classify masks by walkability:
   - Walkable: grass, dirt, roads, floor
   - Non-walkable: buildings, water, walls, trees
5. Create collision/pathfinding map from masks
6. NPCs navigate using this dynamic map
```

### SAM 2 Parameters
```javascript
const SAM_CONFIG = {
  points_per_side: 32,      // Grid density
  pred_iou_thresh: 0.88,    // Confidence threshold
  stability_score_thresh: 0.95,
  use_m2m: true
};
```

### Mask Classification Approach
```javascript
// After receiving masks, classify by:
// 1. Color analysis (green = grass, blue = water, brown = road)
// 2. Position (bottom = ground, top = buildings)
// 3. Shape (rectangular = buildings, irregular = terrain)

function classifyMask(mask, originalImage) {
  const avgColor = getAverageColor(mask, originalImage);

  if (isGreenish(avgColor)) return 'walkable';      // Grass
  if (isBrownish(avgColor)) return 'walkable';      // Dirt/road
  if (isGrayish(avgColor)) return 'walkable';       // Stone road
  if (isBluish(avgColor)) return 'water';           // Non-walkable
  if (isBeige(avgColor)) return 'building';         // Non-walkable

  return 'unknown';
}
```

---

## 6. Complete Integration Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    SMALL GODS GAME                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │ MapSystem   │───▶│ Isometric   │───▶│ SDXL Paint  │     │
│  │ (procedural)│    │ Renderer    │    │ (overview)  │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
│         │                                     │             │
│         │ tile click                          │             │
│         ▼                                     ▼             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │ Context     │───▶│ rd-plus     │───▶│ SAM 2       │     │
│  │ Generator   │    │ (hi-res)    │    │ (segment)   │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
│                                              │              │
│                                              ▼              │
│  ┌─────────────┐                      ┌─────────────┐      │
│  │ rd-animation│◀────────────────────│ Pathfinding │      │
│  │ (NPCs)      │                      │ (A* on SAM) │      │
│  └─────────────┘                      └─────────────┘      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Cost Estimation

### Per Session (typical gameplay)
| Action | Calls | Cost/Call | Total |
|--------|-------|-----------|-------|
| Overview map paint | 1 | $0.015 | $0.015 |
| NPC generation (5 NPCs) | 5 | $0.0025 | $0.0125 |
| Zoom views (10 clicks) | 10 | $0.05 | $0.50 |
| SAM segmentation | 10 | $0.012 | $0.12 |
| **Total per session** | | | **~$0.65** |

### Optimization Strategies
1. **Cache generated assets** - Don't regenerate same NPCs/tiles
2. **Pre-generate common views** - Village centers, landmarks
3. **Batch NPC generation** - Generate all NPCs at game start
4. **Tile atlas** - Generate tileset once, reuse

---

## 8. Implementation Priority

### Phase 1: NPC Generation
- [ ] Create NPC generator script
- [ ] Implement spritesheet parsing
- [ ] Add NPCs to map renderer

### Phase 2: Zoom View System
- [ ] Implement click-to-zoom on tiles
- [ ] Create context-aware prompt generator
- [ ] Integrate rd-plus API

### Phase 3: SAM Pathfinding
- [ ] Integrate SAM 2 API
- [ ] Build mask classifier
- [ ] Create pathfinding grid from masks

### Phase 4: Polish
- [ ] Asset caching system
- [ ] Tile generation with rd-tile
- [ ] Additional asset types

---

## Sources

- [SAM 2 Documentation](https://ai.meta.com/sam2/)
- [Roboflow SAM 2 Guide](https://blog.roboflow.com/what-is-segment-anything-2/)
- [Meta SAM 2 GitHub](https://github.com/facebookresearch/sam2)
