# Live Parametric Building Sprites — Design

**Status:** Approved design (2026-06-08). Next: implementation plan.

## Goal

Render the new manifold parametric building generator **in-game, in the browser**, by
generating each building's sprite at runtime from its `BuildingDescriptor` (cached),
then drawing it through the existing iso sprite path. A dev selector chooses the
building render source so the new generator can be compared against the baked
PixelLab assets and the legacy massing.

## Decisions (locked during brainstorming)

1. **Generate-to-sprite, cached** — NOT per-frame facet rasterization. The game camera
   is fixed-angle 2D (no rotation, no dynamic lighting), so per-frame CSG/raster buys
   nothing. We run the generator once per unique descriptor, off the frame path,
   memoized; steady-state cost per frame is a single cached blit.
2. **`generator` is an explicit opt-in mode** — `auto` keeps today's behavior
   (asset sprite → else legacy massing) unchanged. The selector makes the new
   generator a comparison tool, not a silent change to default rendering.
3. **Fold the just-merged boolean** `forceParametricBuildings` into a 3-way
   `buildingRenderMode` enum (no dead flag shipped).

## Why this is cheap

- The assetgen projection (`src/assetgen/render/projection.ts`, 2:1 dimetric, camera
  at (1,1,1)) is the **same 2:1 family** as the in-game iso `worldToScreen`
  (`src/render/iso/iso-projection.ts`). That is exactly why baked assetgen-style
  sprites already drop onto the iso grid. A generated sprite lands identically.
- `composeStructure` already returns a **sprite-shaped artifact**: a grey (albedo)
  RGBA buffer + opaque `bbox` + normalized anchors. The per-pixel z-buffer lives
  *inside* the assetgen rasterizer — the game's Canvas2D never needs a depth buffer.
- The entire `descriptorToSpec → composeStructure → grey buffer` pipeline is reused
  untouched. New code is small and well-bounded.

## Architecture & data flow

```
entity.properties.descriptor : BuildingDescriptor
   │  descriptorToSpec(desc)                 ← NEW pure mapping (Node-testable)
   ▼
StructureSpec { parts:[{ prim:'building', wings, wallMat, roofMat, roofStyle, features }] }
   │  composeStructure(spec)                 ← REUSED unchanged (manifold CSG → z-buffer raster)
   ▼
{ grey: Uint8ClampedArray, size, bbox, anchors }
   │  greyToSpriteCanvas(grey, size, bbox)   ← NEW: crop opaque bbox → HTMLCanvasElement
   ▼
ParametricBuildingSource  (peek / warm cache, keyed by descriptor hash)   ← NEW, mirrors ArtResolver
   │  rc.resolveParametricBuildingArt(entity)
   ▼
drawIsoBuildingSpriteCore(dc, src, w, h, x, y, footprint, anchor)         ← shared draw core (small refactor)
```

Generation is async + memoized per descriptor. Distinct building types number in the
dozens, so the bitmap cache is small.

## Components (four units + one small refactor)

### A. Browser wasm plumbing — `src/assetgen/geometry/manifold-runtime.ts` (+ one browser-only module)

`manifold-runtime.ts` stays Node-default (the Emscripten module locates `manifold.wasm`
on the filesystem). Add:

```ts
let locate: (() => string) | undefined;
/** Browser only: point the Emscripten kernel at the Vite-served wasm URL. Must be
 *  called before the first getManifold(). No-op path for Node/vitest. */
export function setManifoldWasmUrl(url: string): void { locate = () => url; }
```

and pass `locateFile` to `Module()` only when set:

```ts
cached = Module(locate ? { locateFile: locate } : {}).then((wasm) => { ... });
```

A **browser-only** module performs the `?url` import (which only Vite understands) and
calls the setter — Node/vitest never import it, so tests are unchanged:

```ts
// src/assetgen/geometry/manifold-wasm-browser.ts
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { setManifoldWasmUrl } from './manifold-runtime';
export function initManifoldWasm(): void { setManifoldWasmUrl(wasmUrl); }
```

`initManifoldWasm()` is called once from the game bootstrap (`src/main.ts` or
`src/game/bootstrap-world.ts`) before any building generation. `manifold-3d` is not
`three`, so the `no-three-in-bundle` guard stays green.

### B. `descriptorToSpec(desc)` — `src/render/iso/building-spec.ts` (NEW, pure)

Maps `BuildingDescriptor` → `StructureSpec`. Reference: `building-massing-model.ts`.
Returns `null` for plans the generator cannot express, so the caller falls back to
legacy massing.

**Plans (v1):**
- `rect` → one wing `{ x:0, y:0, w, h }`.
- `cross` → nave + transept (centered), e.g. `[{ x:0, y:round(h/4), w, h:round(h/2) },
  { x:round(w/4), y:0, w:round(w/2), h }]`.
- `L` → bottom bar + side arm, e.g. `[{ x:0, y:0, w, h:round(h/2) },
  { x:0, y:0, w:round(w/2), h }]`.
- `round`, `stepped` → **return `null`** (dome/ziggurat are not rectilinear-wing
  shapes; legacy massing draws them). YAGNI for v1.

`storeys = max(1, desc.levels)`. `ridge`/`jetty` use generator defaults (descriptor has
no jetty field today).

**Materials** (`WallMat`/`RoofMat` → assetgen `Mat`; unknown → neutral, never throws):

| WallMat | Mat | | RoofMat | Mat |
|---|---|---|---|---|
| mud, wattle, hide | plaster | | thatch, hide | thatch |
| timber, log | timber | | wood | timber |
| brick | brick | | tile | tile |
| stone, marble | stone | | slate | stone |
| | | | none | tile |

**Roof** (`Roof` (16) → per-wing `RoofKind` (4)); building-wide `roofStyle='gable'`:

| RoofKind | in-game Roof members |
|---|---|
| gable | gable, gambrel, mansard, saltbox, jerkinhead, cross_gable, lean_to |
| hip | hip |
| pyramidal | pyramidal, conical, spire, tented, onion, domed |
| flat | flat, stepped |

**Features:** `desc.door {x,y}` → `features.doors:[{ face, cell:[x,y], main:true }]`,
`face` = the footprint edge the cell lies on (`y===h-1`→south, `x===w-1`→east,
`y===0`→north, `x===0`→west; default south). `desc.vents[]` →
`features.vents:[{ wing:0, t:0.5, kind, placement:'ridge' }]` (one per vent).

`size` is derived from the footprint so the sprite is ~1:1 with the on-screen tile
block (long-axis tiles × iso tile width, rounded up); tuned in the plan.

### C. `ParametricBuildingSource` — `src/render/parametric-building-source.ts` (NEW)

Runtime cache mirroring `ArtResolver`'s peek/warm contract:

```ts
peek(entity): CanvasImageSource | null       // cached sprite or null
warm(entity): void                           // fire-and-forget async build, then store
```

`warm` runs `descriptorToSpec → composeStructure → greyToSpriteCanvas` and stores the
cropped canvas + its base anchor. Cache key = stable JSON hash of the descriptor.
`descriptorToSpec` returning `null`, a wasm load failure, or any `composeStructure`
throw → the entry stays `null` (logged once per key) so the renderer falls back to
massing. Never throws on the frame path.

`greyToSpriteCanvas(grey, size, bbox)`: `putImageData(grey)` into a `size×size` canvas,
then `drawImage(srcCanvas, bbox.x, bbox.y, bbox.w, bbox.h, 0, 0, bbox.w, bbox.h)` into a
tight `bbox.w×bbox.h` canvas. Because the crop is the opaque content, the base anchor is
trivially `{ centerX: bbox.w/2, bottom: bbox.h }` — no per-frame alpha rescan.

### D. Render-mode enum + wiring

- **`src/core/types.ts`** — replace `forceParametricBuildings?: boolean` with
  `buildingRenderMode?: 'auto' | 'generator' | 'massing'` on `DevModeState`
  (`undefined`/`'auto'` = today's behavior).
- **`src/game/render-context.ts`** — add `resolveParametricBuildingArt(entity)`
  (peek → else warm → null), built from a `ParametricBuildingSource` constructed
  alongside the existing resolvers in `RenderContextDeps`.
- **`src/render/iso/iso-renderer.ts`** — the building dispatch reads the mode:
  - `massing` → `drawIsoBuildingMassing`.
  - `generator` → `resolveParametricBuildingArt` → sprite, else massing.
  - `auto`/unset → `resolveBuildingArt` (PixelLab) → sprite, else massing.
- **`src/dev/DebugOverlayPanel.ts`** — the Building Render section's checkbox becomes a
  3-option `<select>` (Auto / Generator / Massing), wired into `update()` and the reset
  button (reset → `'auto'`).

### Refactor — shared building-sprite draw core (`src/render/iso/iso-building.ts`)

Factor `drawIsoBuildingSprite` into a core that accepts an explicit `SpriteAnchor` and a
`CanvasImageSource`:

```ts
drawIsoBuildingSpriteCore(dc, src: CanvasImageSource, w, h, x, y, footprint, anchor: SpriteAnchor)
```

- PixelLab path: existing `drawIsoBuildingSprite(dc, img, ...)` keeps computing its
  anchor via `opaqueAnchor(img)` (margined frames) and delegates to the core.
- Generator path: supplies the trivial `{ centerX: w/2, bottom: h }` anchor from the
  cropped canvas — avoids `opaqueAnchor`'s per-frame rescan (it caches by `img.src`,
  which a canvas lacks).

This keeps one placement implementation while letting each source provide its anchor.

## Error handling

- Wasm fails to load → `getManifold()` rejects → `warm` catches, logs once, entry null →
  renderer falls back to massing. The game never blocks on or crashes from generation.
- `descriptorToSpec` returns `null` (round/stepped) → null entry → massing. Not an error.
- All generation is off the frame path; the frame loop only ever reads `peek`.

## Testing

- **`building-spec.test.ts`** (Node) — `descriptorToSpec`: rect/L/cross wing layouts;
  material + roof mapping tables; door face derivation; round/stepped → `null`.
- **`parametric-building-source.test.ts`** (Node — manifold runs in Node) —
  peek-before-warm is `null`; after `warm` resolves, peek returns a canvas of the
  expected size; a descriptor whose spec is `null` stays `null`; a forced compose error
  stays `null` and is logged once.
- **`manifold-runtime`** — `setManifoldWasmUrl` causes `locateFile` to be passed
  (unit-level seam test; no real browser wasm load in jsdom).
- **Manual** — in-game dev selector: Auto vs Generator vs Massing on the same world;
  confirm generator buildings land on-grid (pixel-perfect) and varieties render.

## Out of scope (v1)

- Round/stepped plans through the generator (fall back to massing).
- Wiring door/vent anchors into gameplay (smoke spawn, NPC pathing) — the source
  produces them but v1 only uses the sprite.
- Normal-buffer / relight use (that is Track-R; the generator already emits a normal
  buffer for it later).
- Per-frame facet rasterization / camera rotation.

## File structure

| File | Change |
|---|---|
| `src/assetgen/geometry/manifold-runtime.ts` | + `setManifoldWasmUrl`, conditional `locateFile` |
| `src/assetgen/geometry/manifold-wasm-browser.ts` | NEW — `?url` import + `initManifoldWasm()` |
| `src/render/iso/building-spec.ts` | NEW — `descriptorToSpec` (pure) |
| `src/render/parametric-building-source.ts` | NEW — peek/warm cache + `greyToSpriteCanvas` |
| `src/render/iso/iso-building.ts` | refactor: shared `drawIsoBuildingSpriteCore` |
| `src/core/types.ts` | `forceParametricBuildings` → `buildingRenderMode` enum |
| `src/game/render-context.ts` | + `resolveParametricBuildingArt`, construct source |
| `src/render/iso/iso-renderer.ts` | mode-aware building dispatch |
| `src/dev/DebugOverlayPanel.ts` | checkbox → 3-way `<select>` |
| `src/main.ts` or `src/game/bootstrap-world.ts` | call `initManifoldWasm()` once |
| `vite.config.ts` | verify `manifold.wasm` is served/emitted (assetsInclude if needed) |
