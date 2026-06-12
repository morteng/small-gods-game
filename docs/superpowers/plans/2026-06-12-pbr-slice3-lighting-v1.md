# PBR Slice 3 — Lighting shader v1 (ambient + sun, banded)

**Date:** 2026-06-12 · **Branch:** `feat/pbr-lighting-v1` · **Epic:** PBR sprite stack
(spec `2026-06-09-pbr-sprite-stack-design.md`; follows Slice 2 `2026-06-12-pbr-slice2-pixi-entity-scene.md`)

## Goal

Buildings rendered through the PixiJS WebGL entity layer are **lit**: per-pixel
`lit = albedo × (ambient + sunColor × band(N·L)) × AO`, with the diffuse term
quantized into N bands so the crisp pixel-art look survives. One global
directional sun (canonical upper-left, see `src/render/lighting.ts`) + ambient.
Day/night driving comes in Slice 4; point lights in Slice 5.

## What already exists (no generation/reseeding needed)

- Every generated building persists **co-registered companion maps** alongside the
  albedo: `normal` (screen-space, R=right G=up B=toward-camera, `(v·0.5+0.5)·255`),
  `material` (R=depth G=AO B=rough A=metal), `emissive`. Present in BOTH the IDB
  cache (`GeneratedArtRecord`) and the vendored v5 base library (manifest entries
  carry the map filenames). Same crop as the albedo → UV-aligned by construction.
- The parametric source's `composeStructure` returns the same buffers live.
- The Slice-2 layer renders every entity from the neutral draw list.

## Design

1. **`SpritePack`** (`sprite-canvas.ts`): `{ albedo, normal?, material? }`
   (all `SpriteCanvas`). Both building sources cache packs instead of bare
   canvases; resolvers on `RenderContext` return packs. Emissive decode deferred
   to Slice 5 (the blobs stay persisted).
   - Generated source: decode `normal`/`material` blobs on IDB/base-library hits
     (base fetch extended to pull the companion files named in the manifest);
     after a fresh paid generation, decode the just-encoded blobs.
   - Parametric source: crop `r.normal` / `r.material` with the same bbox as the grey.
2. **Draw list**: image items gain optional `maps?: { normal?, material? }` —
   set only by the building-pack emitter (`buildingSpriteItemFromPack`).
   Canvas2D executor ignores them (lighting is a WebGL-only enhancement;
   Canvas2D stays the unlit parity fallback).
3. **`LightingState`** (`src/render/lighting-state.ts`): `{ enabled, ambient,
   sunDir (screen-space, toward the light, normalized), sunColor, bands }` +
   `DEFAULT_LIGHTING` (gentle: the albedo already bakes form shading, so v1 sun
   is low-contrast re-shading, ambient ≈ 0.72, sun ≈ 0.38, 4 bands).
   Plumbed `render-context` → `RenderContext.lighting` → layer view.
   Dev toggle `devMode.lighting: 'banded' | 'off'` in DebugOverlayPanel.
4. **Lit mesh path** (`src/render/pixi/lit-shader.ts` + `PixiEntityLayer`):
   items with `maps.normal` + lighting enabled render as a pooled quad
   **Mesh with a custom GL shader** (NOT a Filter — filter input frames clip at
   the viewport edge, which breaks companion-map UV mapping; a mesh's UVs are
   honest 0..1). Vertex shader follows pixi v8 mesh conventions
   (`uProjectionMatrix/uWorldTransformMatrix` group 100, `uTransformMatrix`
   group 101 — assigned by MeshPipe). Fragment: sample albedo/normal/material
   at `vUV` (nearest), decode normal, `band(max(dot(n, sunDir), 0))`,
   `light = ambient + sunColor·banded`, `× AO` (material.G, alpha-masked to 1
   outside the geometry silhouette — negotiation-band pixels the LLM painted
   beyond geometry get neutral light via the same alpha mask on the normal).
   Output stays premultiplied (albedo uploads premultiplied; rgb × scalar).
5. Items without maps (NPCs, trees, decos, PixelLab assets, flat blocks) keep
   the plain Sprite/Graphics path — unlit, exactly as Slice 2.

## Tests

- `lighting-state`: defaults sane (sun normalized, upper-left: x<0, y>0, z>0).
- `lit-shader`: uniform values derived from a LightingState; GLSL strings carry
  the contract markers (band(), uSunDir, mesh-convention uniforms).
- Sources: pack assembly from cache hits with/without map blobs (seam-faked decode).
- Draw list/emitters: `maps` attached for packs, absent otherwise.
- Pixi layer (fake pixi extended with Mesh/MeshGeometry/Shader.from): lit items
  become meshes with the right resources + uniforms; sprite path untouched;
  pools reuse; lighting off / maps absent → plain sprite.
- In-browser: eyeball WebGL vs Canvas2D (lit vs unlit), dev toggle, FPS.

## Out of scope

Day/night & weather (Slice 4), point lights + emissive windows (Slice 5),
rough/metal response (Slice 6), terrain lighting (separate track).
