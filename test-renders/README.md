# AI Map Rendering Test Guide

## Overview
This folder contains test images and prompts for finding the best AI model/LoRA combination for rendering game maps.

## Test Images
The segmentation maps use ADE20K color codes that ControlNet models understand:
- `segmentation_512x512.png` - Standard size
- `segmentation_768x768.png` - Medium size
- `segmentation_1024x1024.png` - High resolution
- `game_colors_512x512.png` - Original game colors (for comparison)

## Color Legend (ADE20K)
| Terrain | Color | Hex |
|---------|-------|-----|
| Tree/Forest | Bright Green | #04C803 |
| Grass/Meadow | Light Green | #04FA07 |
| Water/River | Cyan | #3DE6FA |
| Deep Water/Sea | Blue | #0907E6 |
| Mountain | Light Green-Gray | #8FFF8C |
| Sand/Beach | Olive | #A09614 |
| Road/Path | Gray | #8C8C8C |
| Building | Brown-Pink | #B47878 |
| Earth/Dirt | Brown-Gray | #787846 |
| Rock | Red-Orange | #FF290A |

---

## Recommended Models to Test

### 1. SDXL with img2img (Best for style transfer)
**Model:** `stability-ai/sdxl` on Replicate
**Approach:** Use segmentation map as input image

```
prompt_strength: 0.5-0.7 (lower = more structure preserved)
```

### 2. ControlNet Canny/Scribble
**Models:**
- `jagilley/controlnet-scribble`
- `black-forest-labs/flux-canny-pro`

**Approach:** Convert segmentation to edge map first, use as control

### 3. Specialized Game Art Models
Look for LoRAs trained on:
- Isometric game assets
- Top-down RPG maps
- Pixel art tilesets
- Fantasy cartography

**Civitai LoRAs to search:**
- "isometric"
- "top down game"
- "pixel art tileset"
- "fantasy map"
- "game asset"

---

## Prompts to Test

### Style A: Pixel Art
```
Prompt: top-down pixel art game map, 16-bit retro style, fantasy RPG tileset,
lush green grass, dense forest trees, crystal blue water, sandy beaches,
cobblestone paths, medieval village buildings, detailed textures,
vibrant colors, sharp pixels, no anti-aliasing

Negative: blurry, smooth, 3d render, realistic, photo, watermark, text
```

### Style B: Painterly Fantasy
```
Prompt: top-down fantasy game map, hand-painted style, lush meadows with
wildflowers, mysterious dark forest, sparkling lake, cozy medieval cottages,
winding dirt paths, rolling hills, game art style, vibrant saturated colors,
soft lighting, Studio Ghibli inspired

Negative: realistic photo, 3d render, blurry, ugly, distorted, watermark
```

### Style C: Isometric Game Art
```
Prompt: isometric fantasy game world, detailed terrain textures, grass fields,
pine forest, blue water lake, stone village buildings, dirt roads,
game asset style, clean edges, consistent lighting from top-left,
professional game art, Age of Empires style

Negative: flat, 2d, blurry, bad perspective, distorted, watermark
```

### Style D: Stylized Cartoon
```
Prompt: top-down cartoon game map, bold colors, thick outlines,
whimsical fantasy world, bright green grass, blue pond, cute trees,
tiny houses, adventure game style, clean vector-like art,
Legend of Zelda Link's Awakening style

Negative: realistic, photo, 3d, complex details, blurry
```

### Style E: Detailed Realistic
```
Prompt: aerial view of fantasy landscape, photorealistic terrain,
lush green valleys, dense woodland, pristine lake, rustic village,
country roads, rolling hills, cinematic lighting,
high detail satellite view style, National Geographic

Negative: cartoon, anime, pixel art, low quality, blurry
```

---

## Testing Parameters

### For SDXL img2img:
| Parameter | Conservative | Balanced | Creative |
|-----------|--------------|----------|----------|
| prompt_strength | 0.4 | 0.6 | 0.8 |
| guidance_scale | 5 | 7.5 | 12 |
| steps | 20 | 30 | 50 |

### For ControlNet:
| Parameter | Recommended |
|-----------|-------------|
| control_strength | 0.7-1.0 |
| guidance_scale | 7-9 |
| steps | 25-35 |

---

## Workflow Recommendation

1. **Test SDXL first** with the segmentation map at prompt_strength 0.5-0.6
2. **If structure is lost**, reduce prompt_strength to 0.3-0.4
3. **If too similar to input**, increase to 0.7-0.8
4. **Try ControlNet Canny** if SDXL doesn't preserve edges well
5. **Look for specialized LoRAs** on Civitai for game map styles

## Best Platforms to Test
1. **Replicate.com** - Easy API, many models
2. **ComfyUI** - Full control, LoRA support
3. **Civitai.com** - Try models with their generator
4. **RunPod/vast.ai** - Run your own with custom LoRAs

---

## What We're Looking For
The ideal output should:
- [ ] Preserve the terrain layout from the segmentation
- [ ] Have consistent art style across all terrain types
- [ ] Look like professional game art
- [ ] Have crisp, clean edges (especially for pixel art style)
- [ ] Water should look like water, grass like grass, etc.
- [ ] Buildings should be recognizable structures
- [ ] Roads should connect properly
