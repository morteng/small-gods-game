# Small Gods - Development Notes

## AI Integration (fal.ai)

### Working Configuration (as of 2025-01-20)

**Endpoints:**
- `fal-ai/fast-sdxl/image-to-image` - Base img2img, no ControlNet
- `fal-ai/sdxl-controlnet-union/image-to-image` - img2img with ControlNet support

**ControlNet Parameters (what works):**
- `canny_image_url` - Edge detection ControlNet - **WORKS**
- `canny_preprocess` - Set to `true` to auto-process edges

**ControlNet Parameters (TESTING):**
- `segmentation_image_url` - Previously returned 422 error on image-to-image endpoint
- Now testing with `segmentation_preprocess: true` (was `false`)
- Also have `endpoint_t2i_controlnet: 'fal-ai/sdxl-controlnet-union'` as fallback (text-to-image)

**UI Controls:**
- Checkboxes in left panel to toggle segmentation/canny ControlNets
- Use `updateControlNetConfig()` to sync UI with config

### Code Locations

- `public/js/ai-integration-v2.js` - Main AI integration code
  - `AI_CONFIG` - Configuration object
  - `paintWorldV2()` - Main paint function
  - `buildPrompt()` - Generates prompts from map data

- `server.js` - API proxy server
  - Proxies requests to fal.ai with server-side API key
  - Logs requests to `fal-debug.log`

### API Request Format

```javascript
{
  image_url: "data:image/png;base64,...",  // Base map image
  prompt: "pixel art, 16-bit retro game style...",
  negative_prompt: "blurry, smooth, realistic...",
  image_size: "square_hd",
  num_inference_steps: 30,
  guidance_scale: 7.5,
  strength: 0.65,
  seed: 12345,
  controlnet_conditioning_scale: 0.6,
  canny_image_url: "data:image/png;base64,...",  // Edge map
  canny_preprocess: true
}
```

### Debugging

Server logs API requests to `/Users/Morten/mcpui/small-gods-game/fal-debug.log`

To see what's being sent:
```bash
cat fal-debug.log
```

### Known Issues

1. **Segmentation ControlNet fails** - The `segmentation_image_url` parameter is documented
   in fal.ai docs but returns 422 on the image-to-image endpoint. Use canny instead.

2. **Browser caching** - Use hard refresh (Cmd+Shift+R) after code changes.

3. **Server restart** - After editing server.js, restart with:
   ```bash
   lsof -ti:3000 | xargs kill -9; node server.js
   ```
