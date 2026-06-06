# Prompt Generation System — Implementation Plan (Slice 1: Buildings)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (or direct TDD). Steps use checkbox syntax.

**Goal:** Build the Brief→Compiler prompt-generation framework and prove it on buildings: one `AssetBrief` → human description + pixflux request, with door-aligned geometry guidance and pixel-perfect native-size rendering.

**Architecture:** Pure producers (`buildingBrief`) emit a pipeline-agnostic `AssetBrief`; `describeForHuman` and `PixfluxCompiler` are two renderings of it; a versioned view/size registry pins recipes + native pixel sizes. New files under `src/assetgen/`.

**Tech Stack:** TypeScript, Vitest. No new deps.

**`nativeSize` decision (resolves the spec's fuzzy point):** for `(building, iso-3q)`, native pixel size at base zoom (zoom=1) is the footprint's iso bounding box plus vertical rise, capped to keep gen cost sane:
- `width  = clamp((w + h) * (ISO_TILE_W/2), 64, 256)`            // iso diamond width
- `riseUnits = levels * heightPerLevel + ROOF_RISE[roof]`
- `height = clamp((w + h) * (ISO_TILE_H/2) + riseUnits * ISO_TILE_H, 64, 256)`
- Both rounded to the nearest multiple of 16 (clean pixel grid). Documented: the crisp 1:1 tier is zoom=1; other zooms integer-scale.

---

### Task 1: AssetBrief + view types

**Files:** Create `src/assetgen/asset-brief.ts`; Test `tests/unit/asset-brief-types.test.ts`

- [ ] Define `AssetView = 'iso-3q' | 'front-portrait' | 'topdown' | 'side'`, `DoorFace = 'n'|'e'|'s'|'w'`, and the `AssetBrief` interface (per spec). Re-export `AssetKind`, `Era` from core.
- [ ] Trivial test: a literal `AssetBrief` for a building type-checks and round-trips through `JSON.stringify` (guards the shape).
- [ ] Commit `feat(assetgen): AssetBrief — canonical pipeline-agnostic asset description`.

### Task 2: View/size registry

**Files:** Create `src/assetgen/view-registry.ts`; Test `tests/unit/view-registry.test.ts`

- [ ] `interface ViewRecipe { recipeVersion; outline; shading; detail; lightDirection: 'top-left'; nativeSize(brief): {width;height} }`.
- [ ] `VIEW_RECIPES: Record<AssetView, ViewRecipe>`. `iso-3q` uses the frozen recipe (`single color black outline`/`basic shading`/`medium detail`, version `v1`) and the `nativeSize` formula above (import `ISO_TILE_W/H` from `@/render/iso/iso-constants`, `ROOF_RISE` — export it from `building-massing-model.ts`).
- [ ] Tests: `nativeSize` for a 2×2 single-storey gable building and a 5×2 longhouse return expected clamped/rounded dims; `recipeVersion === 'v1'` for iso-3q.
- [ ] Commit `feat(assetgen): versioned view/size registry with pixel-perfect native sizes`.

### Task 3: buildingBrief producer

**Files:** Create `src/assetgen/producers/building-producer.ts`; Test `tests/unit/building-producer.test.ts`

- [ ] `buildingBrief(d: BuildingDescriptor, instanceSeed: number): AssetBrief`.
  - `subject` = humanized preset (`temple_small` → "temple"); `era` = d.era; `footprint`, `seed=instanceSeed`.
  - `materials` from `walls`/`roofMat`/`groundMaterial` via `WALL_COLORS`/`ROOF_COLORS`/`GROUND_COLORS` (`{part:'walls',material:'wattle',color:'#b29162'}`, etc.).
  - `paletteAnchors` = the material colours, deduped.
  - `traits` from plan/levels/roof/material adjectives + 1 seeded detail (e.g. weathering) chosen deterministically from `instanceSeed`.
  - `view='iso-3q'`, `guidance={source:'massing',strength:500}`, `negatives=['blurry','flat front view']`.
  - `door` = `{...d.door, face: doorFace(d.footprint, d.door)}` where `doorFace` maps an edge cell to n/e/s/w (south = max y, etc.; corner → pick the dominant edge).
- [ ] Tests: cottage brief has wattle walls + thatch roof in materials & paletteAnchors; door.face computed correctly for a south door and an east door; deterministic for fixed seed; differs across seeds in the detail trait only.
- [ ] Commit `feat(assetgen): buildingBrief producer — descriptor → AssetBrief`.

### Task 4: describeForHuman + tri-alignment

**Files:** Create `src/assetgen/describe.ts`; Test `tests/unit/describe-human.test.ts`

- [ ] `describeForHuman(brief): string` — readable sentence naming subject, key material traits, roof, and door face.
- [ ] Tests: building description contains subject + wall material + roof + door face. **Tri-alignment test:** the set of {subject, wall material, roof material, door face} tokens appears in BOTH `describeForHuman(brief)` and `PixfluxCompiler.compile(brief).prompt` (import compiler from Task 5 — order Task 5 before this test, or assert only describe here and add the cross-check in Task 5).
- [ ] Commit `feat(assetgen): describeForHuman — human lore rendering of an AssetBrief`.

### Task 5: PixfluxCompiler

**Files:** Create `src/assetgen/compilers/pixflux-compiler.ts`; Test `tests/unit/pixflux-compiler.test.ts`

- [ ] `class PixfluxCompiler implements PromptCompiler { id='pixellab.pixflux'; compile(brief): PixelLabGenerateOpts }`.
  - prompt: `"isometric, 3/4 top-down view"` for iso-3q + subject + material adjectives + `"door on the <face> side"` + traits; negatives appended.
  - `width/height` from `VIEW_RECIPES[brief.view].nativeSize(brief)`.
  - recipe fields + `recipeVersion` from the view recipe.
  - `paletteAnchors` → a `colorImage` opts field (compiler returns the anchors; the palette-PNG synthesis stays in pixellab.ts — pass anchors through `PixelLabGenerateOpts.paletteAnchors?`).
  - when `brief.guidance?.source==='massing'`: set `initImageStrength = brief.guidance.strength` and leave an `initImage` slot for the caller to fill with the rendered massing (compiler is pure/canvas-free; it declares the intent).
- [ ] Tests: prompt contains iso phrasing + subject + door face + a material word; size matches registry; recipeVersion set; initImageStrength set when guidance is massing, absent otherwise. Add the tri-alignment cross-check from Task 4.
- [ ] Commit `feat(assetgen): PixfluxCompiler — AssetBrief → pixflux request`.

### Task 6: pixellab.ts — init_image + palette-anchor plumbing

**Files:** Modify `src/services/pixellab.ts`, `src/core/types.ts` (PixelLabGenerateOpts); Test extend `tests/unit/pixellab*.test.ts`

- [ ] Add optional `initImage?: string` (base64 png), `initImageStrength?: number`, `paletteAnchors?: string[]` to `PixelLabGenerateOpts`.
- [ ] `buildRequestBody`: when `initImage` present, add `init_image` + `init_image_strength`; when `paletteAnchors` present, synthesize the `color_image` PNG from anchors instead of the static LPC anchor (a small canvas of swatches) else keep current behaviour.
- [ ] `buildCacheKeyInput`: include `initImageStrength` + a hash of `paletteAnchors` + presence of `initImage` so guided ≠ unguided keys.
- [ ] Tests: body carries `init_image`/`init_image_strength` when set; cache key differs guided vs unguided; default path unchanged (existing tests still pass).
- [ ] Commit `feat(pixellab): init_image + palette-anchor support in request + cache key`.

### Task 7: renderMassingToImage (door-aligned guidance)

**Files:** Create `src/assetgen/massing-guidance.ts`; Test `tests/unit/massing-guidance.test.ts`

- [ ] `renderMassingToImage(d: BuildingDescriptor, size:{width;height}): string` — draw `drawIsoBuildingMassing` (+ a door marker on `door` cell/face) to an offscreen `OffscreenCanvas`/`canvas` sized `size`, return base64 PNG. Centre the massing in the canvas.
- [ ] Tests (jsdom/canvas mock): returns a non-empty base64 string of a canvas of `size`; invokes the massing draw; door marker drawn at the door-face position (assert via a spy on the draw calls or a pixel probe).
- [ ] Commit `feat(assetgen): renderMassingToImage — door-aligned massing init image`.

### Task 8: pixel-perfect building sprite draw

**Files:** Modify `src/render/iso/iso-building.ts` (`drawIsoBuildingSprite`); Test extend `tests/unit/iso-building-sprite.test.ts`

- [ ] Rewrite `drawIsoBuildingSprite(dc, img, tileX, tileY, footprint, nativeW, nativeH)` to blit the image at its native pixel size (`nativeW×nativeH`) anchored bottom-centre on the footprint, NO fractional scaling at base zoom; `imageSmoothingEnabled=false`. Remove the `(w+h)·0.55` heuristic.
- [ ] Caller (`iso-renderer.ts`) passes the asset's native `width/height` (from the library record / image). 
- [ ] Tests: drawImage called with dest width === native width (no scale at zoom 1); smoothing off.
- [ ] Commit `feat(iso): pixel-perfect 1:1 building sprite draw (native size, no stretch)`.

### Task 9: regenerate + reseed building art through the compiler

**Files:** Modify `scripts/seed-base-library.mjs` or add `scripts/gen-buildings.mjs`

- [ ] A script that, per preset: `buildingBrief` → `PixfluxCompiler.compile` → `renderMassingToImage` → pixflux call → write PNG at native size; then seed with native width/height + the compiled prompt + recipeVersion. (Run is manual/online; do NOT run in CI.)
- [ ] Log dropped/failed gens (no silent caps).
- [ ] Commit script only (regeneration is a manual follow-up step the user runs with the key).

### Task 10: full suite + manual playtest note

- [ ] `npm test` green.
- [ ] Note manual steps: regenerate via Task 9 script, reseed, `npm run dev` → buildings render door-aligned, pixel-perfect at zoom 1, human descriptions match art.

---

## Self-review

- **Spec coverage:** brief (T1), registry/native-size (T2), producer (T3), human render + tri-alignment (T4), compiler (T5), pixellab init_image/palette (T6), door-aligned guidance (T7), pixel-perfect draw (T8), regeneration (T9), suite (T10). All spec components mapped.
- **Type consistency:** `AssetBrief.door.face: DoorFace`; `nativeSize(brief)→{width,height}` used in T2/T5/T7/T8; `PixelLabGenerateOpts` extended in T6 used by T5 output. `ROOF_RISE` exported from building-massing-model for T2.
- **Ordering:** T5 before T4's cross-check (note in T4). T6 before T9. T7+T8 independent of T3-T5.
- **WIP guard:** never stage `src/ui/*`.
- **No silent caps:** T9 logs dropped gens.
