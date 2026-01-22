# Small Gods - Development Notes

## AI Integration (fal.ai)

### Working Configuration (as of 2025-01-21)

**Model:** FLUX.1 [dev] - Better quality than SDXL, native segmentation support

**Endpoints:**
- `fal-ai/flux-general/image-to-image` - **PRIMARY** - img2img + easycontrols (segmentation, canny)
- `fal-ai/flux/dev/image-to-image` - Fallback img2img only (no ControlNet)

**Recommended Mode:** Pure img2img (segmentation disabled)
- FLUX interprets ADE20K colors too literally, producing colored block artifacts
- img2img at 0.65 strength balances detail preservation vs artistic style
- Higher strength (0.75+) = more artistic but can look blocky/soft
- Lower strength (0.55-) = preserves more detail but less painterly

**Generation Strategy (auto-selected):**
- Maps ≤1024x1024 → Single-pass generation (one API call, no style inconsistency)
- Maps >1024x1024 → Slice-based generation (512px tiles with 64px overlap, outpainting context)

**Control Methods (via easycontrols) - DISABLED BY DEFAULT:**
- `seg` - Segmentation control - causes colored block artifacts with FLUX
- `canny` - Edge detection
- `depth` - Depth map
- `pose` - Pose detection

**UI Controls:**
- Checkboxes in left panel to toggle segmentation/canny controls
- Segmentation checkbox should remain OFF for best results
- Use `updateControlNetConfig()` to sync UI with config

### Code Locations

- `public/js/ai-integration-v2.js` - Main AI integration code
  - `AI_CONFIG` - Configuration object (size: 512, maxSinglePass: 1024)
  - `paintWorldV2()` - Main entry point (auto-routes to single-pass or sliced)
  - `paintMapSinglePass()` - Single-pass for maps ≤1024x1024 (pads to square, crops result)
  - `paintMapSliced()` - Slice-based for large maps (512px tiles, 64px overlap, outpainting)
  - `paintSlice()` - Paint individual slice with outpainting context from adjacent slices
  - `compositeSlices()` - Blend painted slices with alpha gradient on overlaps
  - `buildPrompt()` - Generates prompts from map data

- `public/js/renderer.js` - Rendering and slice management
  - `getMapIsoBounds()` - Calculate exact isometric pixel bounds
  - `getSliceConfig()` - Determine if slicing needed, generate slice positions
  - `renderMapSlice()` - Render a single slice of the base map
  - `renderSegmentationSlice()` - Render a single slice of segmentation map
  - `renderMapFullRes()` - Full resolution rendering for display
  - `stitchSlices()` - Combine painted slices back together

- `server.cjs` - API proxy server
  - Proxies requests to fal.ai with server-side API key
  - Logs requests to `fal-debug.log`

### Smart Generation Routing

The system auto-selects the best generation strategy based on map size:

**Map Size Calculation:**
- Isometric width: `(W + H) * 16` pixels (TILE_WIDTH = 32)
- Isometric height: `(W + H) * 8 + padding` pixels (TILE_HEIGHT = 16)
- Example: 24x18 map = ~672x368 pixels (fits in single pass)
- Example: 48x36 map = ~1344x716 pixels (requires slicing)

**Single-Pass (maps ≤1024x1024) - PREFERRED:**
- Pads map to square (max dimension, centered)
- Single API call = consistent style across entire map
- Crops result back to actual map bounds
- No seams or style inconsistency

**Slice-Based (maps >1024x1024):**
- AI_SIZE = 512 for 1:1 pixel mapping
- 64px overlap between slices
- Outpainting context: adjacent painted regions included in input
- Alpha gradient blending on overlap edges
- Slices painted in order (top-left to bottom-right)

### API Request Format (FLUX)

**Default format (img2img only - recommended):**
```javascript
{
  image_url: "data:image/png;base64,...",  // Base map image (for img2img)
  prompt: "pixel art, 16-bit retro game style...",
  image_size: { width: 512, height: 512 },  // Explicit 512x512 for 1:1 mapping
  num_inference_steps: 28,
  guidance_scale: 3.5,  // FLUX uses lower guidance than SDXL
  strength: 0.75,
  seed: 12345,
  sync_mode: true,
  enable_safety_checker: false
}
```

**With segmentation (NOT recommended - causes artifacts):**
```javascript
{
  // ... same as above, plus:
  easycontrols: [
    {
      control_method_url: "seg",
      image_url: "data:image/png;base64,...",  // Segmentation map
      scale: 1.0
    }
  ]
}
```

### Debugging

Server logs API requests to `/Users/Morten/mcpui/small-gods-game/fal-debug.log`

To see what's being sent:
```bash
cat fal-debug.log
```

### Known Issues

1. **Browser caching** - Use hard refresh (Cmd+Shift+R) after code changes.

2. **Server restart** - After editing server.js, restart with:
   ```bash
   lsof -ti:3000 | xargs kill -9; node server.js
   ```
