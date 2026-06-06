# Building Sprite Proof — Design

**Date:** 2026-06-06
**Status:** Approved (proof scope)

## Goal

Render real generated building sprites in the iso scene, replacing the parametric
massing where a sprite matches and falling back to massing otherwise. Evaluate
whether front-on pixel-art buildings read acceptably in the isometric scene at the
multi-tile scale, before committing to a full building-art slice.

This is the building analogue of the decoration slice (`feat/generated-asset-library`),
reusing the same two-tier `AssetLibrary` + `ArtResolver` + score>0-gated bind pattern.

## Scope (proof)

**In:**
- Three generated building sprites at 128×128 (already produced via PixelLab into
  `tmp/pixellab-probe/`): `cottage`, `temple_small`, `castle_keep`.
- Seed them into the vendored base library with `kind:'building'`.
- A building-kind binding path: generalize `ArtResolver` to take an `assetKind`,
  add a building resolver instance + a `resolveBuildingArt` hook on `RenderContext`.
- Iso render: prefer the sprite over massing when one resolves; else massing.

**Out (Slice-2 if the proof looks good):**
- Topdown building art (topdown stays parametric — consistent with the deco slice).
- Era-overlay / category-aware selection beyond `tagsAny:[preset]`.
- Replacing the parametric massing system itself (it stays as the fallback + topdown path).
- More than three building kinds; a full base library of buildings.
- Footprint-perfect perspective matching (we judge the pragmatic billboard first).

## Architecture

Buildings are `World` entities whose `kind` is the **preset name**
(`cottage`, `temple_small`, `castle_keep`, `yurt`, …; `building-descriptor.ts`
sets `kind: d.preset ?? 'building'`). The descriptor (with `footprint{w,h}`) lives
in `e.properties.descriptor`. The iso renderer collects buildings into
`buildingById` and draws each at `iso-renderer.ts:124-126` via `drawIsoBuildingMassing`.

The bind mirrors decorations: `ArtResolver.pick({ kind:'building', style:'pixel-art',
tagsAny:[entity.kind /* = preset */], seed })`, gated on `score > 0` so a building
only binds to a genuinely-tagged sprite. The seeded assets carry the preset name in
their tags, so `cottage`→cottage sprite, etc.; unmatched buildings fall back to massing.

### Components

1. **Seed** (`scripts/seed-base-library.mjs`) — three `kind:'building'` rows
   (width/height 128, `tags:[preset]`, era affinity). The script already keys each
   row through the same `buildCacheKeyInput` field order as `pixellab.ts`, so an
   in-game regen of the same prompt+size+recipe dedupes onto the base record.

2. **ArtResolver** (`src/render/art-resolver.ts`) — new constructor param
   `assetKind: AssetKind = 'decoration'`; `resolve()` requests that kind instead of
   the hardcoded `'decoration'`. Default keeps the existing decoration resolver
   behaviour byte-for-byte.

3. **Wiring** (`src/game.ts`, `src/game/render-context.ts`) — a second resolver
   `buildingArtResolver = new ArtResolver(assetLibrary, 'pixel-art', 'building')`,
   cleared alongside `artResolver` on world reset; a `RenderContext.resolveBuildingArt?:
   (e: Entity) => HTMLImageElement | null` that does sync `peek` + fire-and-forget
   `warm` (identical shape to `resolveEntityArt`).

4. **Render** (`src/render/iso/iso-renderer.ts`, `src/render/iso/iso-building.ts`) —
   at the building dispatch, if `rc.resolveBuildingArt?.(b.e)` returns an image, draw
   it via a new `drawIsoBuildingSprite(dc, img, tileX, tileY, footprint)`; else
   `drawIsoBuildingMassing`. The sprite is a footprint-anchored upright billboard.

### Sprite placement (the proof's tunable)

`drawIsoBuildingSprite` anchors the sprite bottom-center over the footprint center
and scales its width to the footprint's iso width:

- center = `worldToScreen(tileX + w/2, tileY + h/2, 0, originX, originY)`
- displayW = `(w + h) * (ISO_TILE_W / 2) * SPRITE_FOOTPRINT_FACTOR` (start 0.55)
- displayH = displayW (square 128² source)
- soft contact-shadow ellipse at center; `imageSmoothingEnabled = false`
- draw at `(center.sx - displayW/2, center.sy - displayH)`

`SPRITE_FOOTPRINT_FACTOR` is the single knob we tune by eye during the proof.

## Error handling

- No matching sprite (the common case) → `resolveBuildingArt` returns null →
  parametric massing draws, exactly as today.
- Library/IndexedDB degraded → `AssetLibrary.query` already degrades to base-only
  (try/catch shipped in the deco slice); resolver memoizes null, no per-frame retry.
- Render-only: the resolver never mutates entities, so sim + replay are untouched.

## Testing

- `ArtResolver` honours `assetKind` (requests `kind:'building'`); default stays `'decoration'`.
- Iso building dispatch prefers the sprite when `resolveBuildingArt` returns an image,
  falls back to massing when it returns null.
- Seed manifest: building rows present with `kind:'building'`, 128², preset tags, and
  a key equal to `buildCacheKeyInput` for the recorded prompt+size+recipe.

## Provenance

Generated prompts (recipe = `single color black outline` / `basic shading` /
`medium detail`, 128², seed 0):
- cottage: "a small medieval cottage house with thatched roof and wooden walls, front view"
- temple_small: "a small ancient stone temple with columns and a pediment roof, front view"
- castle_keep: "a tall stone castle keep tower with battlements and a wooden door, front view"
