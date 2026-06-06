# Prompt Generation System — Design (Slice 1: Buildings End-to-End)

**Date:** 2026-06-06
**Status:** Draft for review

## Goal

A specialist system that turns structured game data into provider-specific image-generation
requests, organized by *image need* (building, NPC sprite, portrait, icon, …) and *pipeline*
(PixelLab pixflux/bitforge now; Replicate/fal later). Slice 1 proves the whole architecture
on **buildings**, the kind whose structured data (`BuildingDescriptor`) we understand best.

## Core principle — one canonical source, three aligned artifacts

Every asset is described once, as an `AssetBrief`. From that single source we derive:
1. **Human-facing description** (inspector / lore / flavour the player reads),
2. **Generation prompt** (provider request),
3. and the **image** is the prompt's faithful output.

Because all three derive from one brief, **description ↔ prompt ↔ image cannot drift**. Briefs
are unique and detailed per instance (not per-preset boilerplate).

## Architecture — two-stage compiler

```
game data ──producer──▶ AssetBrief ──┬── describeForHuman() ─▶ human lore text
                                      └── PromptCompiler.compile() ─▶ provider request ─▶ image
```

### AssetBrief (pipeline-agnostic)

```ts
interface AssetBrief {
  kind: AssetKind;                 // 'building' (slice 1); npc-sprite/portrait/icon later
  subject: string;                 // "tavern"
  traits: string[];                // ["timber-framed","two storeys","hanging sign","moss-streaked roof"]
  materials: { part: string; material: string; color: string }[]; // walls/roof/door/ground…
  view: AssetView;                 // 'iso-3q' | 'front-portrait' | 'topdown' | 'side'
  era: Era;
  footprint?: { w: number; h: number };
  door?: { x: number; y: number; face: 'n'|'e'|'s'|'w' }; // functional door cell + which face it shows on
  paletteAnchors: string[];        // hexes that MUST appear (from materials)
  guidance?: { source: 'massing' | 'lpc-base' | 'none'; strength: number };
  negatives: string[];
  /** stable per-instance seed so re-gen of the same brief is identical */
  seed: number;
}
```

The brief is the alignment point: `materials` feed both `traits` (language) and `paletteAnchors`
(guidance colour); `footprint`+`door` feed both the prompt wording and the geometry guidance image.

### Producers — game data → brief

Slice 1 ships `buildingBrief(descriptor, instanceSeed)`:
- `subject` = preset name (humanized), `era` = descriptor.era, `footprint`/`door` from descriptor.
- `materials` derived from `walls`/`roofMat`/`groundMaterial` via the existing `WALL_COLORS`/
  `ROOF_COLORS`/`GROUND_COLORS` tables (the colour bridge already exists in `building-descriptor.ts`).
- `traits` assembled from `plan`/`levels`/`roof`/material adjectives, plus optional per-instance
  detail (weathering, signage) seeded by `instanceSeed` for uniqueness.
- `view` = `'iso-3q'`, `guidance = { source:'massing', strength: 500 }`.
- `door.face` computed from the door cell's position on the footprint edge.

### describeForHuman(brief) — the human renderer

A pure function rendering the brief to a readable sentence/paragraph for the inspector:
> "A timber-framed two-storey tavern with a tiled hip roof and a hanging sign; its door faces
> the road on the south side."

This is the SAME content the prompt encodes — that is the tri-alignment guarantee.

### PromptCompiler — brief → provider request

```ts
interface PromptCompiler {
  id: string;                                  // 'pixellab.pixflux'
  compile(brief: AssetBrief): PixelLabGenerateOpts;
}
```

`PixfluxCompiler` owns pixflux lore:
- iso views phrase as `"isometric, 3/4 top-down view"` (front-view produced flat stickers — proven).
- door named explicitly (`"door on the south face"`) so the visible door matches the functional cell.
- `materials`→adjective phrases; `paletteAnchors`→a per-asset `color_image` (overriding the generic
  LPC anchor) so guidance colours are authoritative.
- size from the **view/size registry** (see below), not hardcoded.
- when `guidance.source==='massing'`, attach `init_image` (the rendered massing PNG) +
  `init_image_strength` (from `guidance.strength`).
- `negatives` appended.

### View/size registry (versioned)

Named recipes per `(kind, view)`, generalizing the frozen `STYLE_RECIPE` (= recipe `v1`):
```ts
interface ViewRecipe {
  recipeVersion: string;          // feeds buildCacheKeyInput → stable cache keys
  outline: string; shading: string; detail: string;
  nativeSize(brief): { width: number; height: number }; // PIXEL-PERFECT native size
  lightDirection: 'top-left';     // baked, consistent (see Lighting)
}
```

For `(building, iso-3q)`, `nativeSize` returns the building's silhouette bounding box in pixels
at base zoom — derived from footprint + height, NOT a fixed 128² square. This is what makes the
sprite blit **1:1** onto its footprint (see Pixel-Perfect).

## Geometry-guided generation (door-aligned)

`renderMassingToImage(descriptor)` draws the parametric massing (`drawIsoBuildingMassing`) to an
offscreen canvas at the brief's native size, **with the door rendered on the correct face**, and
returns it as a PNG. That image is the pixflux `init_image`. Result: generated art that respects
iso projection, exact footprint, AND door placement — the three things text-only generation got
wrong. The massing's material colours equal `paletteAnchors`, reinforcing colour alignment.

## Pixel-perfect rendering

- Building sprites are generated at their **native** footprint-fitted pixel size (non-square as
  needed) and blitted **1:1** at base zoom; only integer scale factors at other zoom steps.
- This **replaces** `drawIsoBuildingSprite`'s `(w+h)·ISO_TILE_W/2·0.55` square-stretch heuristic
  with a footprint-anchored 1:1 draw using the asset's own native dimensions (carried in the
  library record: `width`/`height`).
- Variety comes from more authored assets, never from stretching one (the deterministic `pick`
  already selects among variants).
- Continuous-zoom reconciliation (stepped zoom / LOD tiers) is acknowledged but **deferred** —
  Slice 1 targets crispness at base zoom and documents the non-1:1 zoom levels rather than solving
  them. (Ties to [[project-rendering-direction]].)

## Lighting

The view recipe pins a canonical **top-left sun** baked consistently into every generated asset
(a light-direction token in the recipe). Dynamic/normal-mapped lighting is out of scope (PixelLab
emits no normals; a GPU-era feature).

## Integration with existing code

- `pixellab.ts`: extend `PixelLabGenerateOpts` + `buildRequestBody` with optional `init_image` +
  `init_image_strength` and a per-call `color_image` override. `buildCacheKeyInput` already keys on
  prompt + recipe; add init_image presence/strength to the key so guided ≠ unguided dedupe cleanly.
- `AssetLibrary`/seed: building records already carry `width`/`height`; the renderer reads native
  size from there.
- Render: `drawIsoBuildingSprite` rewritten to a 1:1 footprint-anchored draw using native size.

## Error handling

- No massing/guidance available → compiler omits `init_image`, falls back to text-only prompt.
- Generation failure or no library match → existing parametric massing fallback (unchanged).
- `describeForHuman` and producers are pure/total — unknown materials fall back to neutral
  (the colour tables already do this), never throw.

## Testing

- `buildingBrief`: materials/colours/door-face/footprint derived correctly from a descriptor;
  deterministic for a given instanceSeed.
- `describeForHuman` ↔ prompt alignment: both mention the same subject, materials, roof, door face
  (a shared-tokens assertion proving tri-alignment).
- `PixfluxCompiler`: iso phrasing present; door face named; `color_image` set from paletteAnchors;
  size from registry; `init_image`/strength attached when guidance is massing; recipeVersion in key.
- `renderMassingToImage`: produces a canvas of the brief's native size; door rendered on the
  expected face (pixel probe or massing-call assertion).
- Pixel-perfect draw: building sprite drawn at native `width`/`height` with no fractional scale at
  base zoom; `imageSmoothingEnabled=false`.

## Out of scope (this slice)

NPC sprite/portrait/icon producers · the LLM producer (hybrid creative path) · Replicate/fal
compilers · market-street/1×1 layout ([[project-building-variety-deferred]], period-correct) ·
continuous-zoom LOD/stepped-zoom · dynamic/normal-mapped lighting.

## Provenance / decisions

User-agreed 2026-06-06: Brief→Compiler architecture; hybrid-LLM (deterministic core); door-placement
mandatory; pixel-perfect 1:1 with multiple native sizes; tri-alignment description↔prompt↔image,
unique+detailed; period-correct; top-left sun now. See [[project-prompt-generation-system]],
[[reference-pixellab-api]], [[feedback-pixel-perfect-rendering]].
