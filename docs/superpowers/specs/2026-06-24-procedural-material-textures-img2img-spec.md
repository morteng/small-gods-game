# Procedural Material Textures (img2img-ready) — Spec

**Status:** spec (2026-06-24). No code yet. Companion to
`2026-06-24-procedural-material-textures-img2img-design.md` (read first for thesis & rationale).
**One-liner:** a tileable material-exemplar layer for terrain + roads that (a) renders richer
*procedural* texturing live now, and (b) is the **grey-init** for an img2img upgrade — prebuild
(author-time bake) **and** runtime (on-view, cached), default OFF / frozen until a funded reseed.

---

## Architecture at a glance

```
material exemplars (procedural, seamless tiles)        ← the "grey-init"
   │   buildGrass/buildDirt/buildRock/buildSand/
   │   buildSnow/buildMud  +  road: buildDirt/Gravel/Cobble
   ├──────────────► live shader samples them (hex-tiling + Laplacian blend)   [Slice 1,2]
   │
   └── img2img seam (building-pipeline-shaped)                                 [Slice 3,4]
         exemplar tile → OpenRouter img2img (3×3 super-tile, crop interior)
            → tileability gate (wrap-edge error) → register → IDB cache
            → prebuild bake to public/asset-library/  AND  runtime on-view
            → procedural fallback; spend-capped; default OFF / frozen
```

`TEXTURE_RECIPE_VERSION` (new, mirrors `ART_RECIPE_VERSION`) gates cache invalidation; cache key =
`${TEXTURE_RECIPE_VERSION}:${model}:${materialId}:${variantHash}`.

---

## Slices

### Slice 0 — Exemplar substrate (foundation, no shader change yet)
Generalize `render/gpu/road-material-atlas.ts` into a **material-exemplar module** producing seamless
tiles + baked normals for terrain materials (grass, dirt, rock, sand, snow, mud) *and* road surfaces
(packed-dirt, gravel, cobble), keyed by a `MaterialId`. Pure, deterministic, memoized, Node+browser.
- Reuse `buildDirt/buildCobble/buildPlank`; add terrain generators (fBm grass/dirt/rock/sand/snow/mud;
  voro-noise cobble already exists).
- **Tests:** determinism (same id ⇒ identical bytes); seamlessness (wrap-edge L2 below threshold) —
  this test *also* defines the img2img tileability gate in Slice 3.
- No render wiring yet → zero visual change, fully testable.

### Slice 1 — Terrain samples exemplars (the headline live change)
Terrain fragment shader composites the **sampled exemplar albedo** into the existing material stack
(`terrain-wgsl.ts`), selected by the same material weights it already computes (rock/snow/sand/mud +
biome base). UV from `vGrid` at a metric scale (`METRES_PER_TILE`).
- **Anti-repetition:** hex-tiling sample (Mikkelsen) + Laplacian blend (Wronski, rides mipchain, zero
  precompute). Gate to fragments that actually need a given material.
- Keep the analytic albedo as the **fallback path** (composite-over, toggleable) so a missing exemplar
  degrades gracefully — and so the procedural look survives the freeze.
- Bind exemplar atlas as a `texture_2d_array` (one layer per material) in `gpu-scene.ts` /
  `gpu-pipelines.ts`.
- **Verify:** browser grab — grass/rock/sand read as textured, not flat; no tiling seams; banded
  lighting preserved; iGPU frame-time within budget (adaptive-resolution HUD).

### Slice 2 — Roads via the material layer + live procedural polish
Road surface texture comes from the exemplar layer driven by the existing `roadSurface` pavedness
signal (`road-surface.ts`), **voro-noise grading dirt→gravel→cobble** by road tier / `usedness`
(per-edge traffic / `residentsByPoi`). Adds the live-polish items: analytic-derivative normals,
curvature/Laplacian AO in creases, rut-darkening + grassy-crown as a function of cross-section `t`.
- This puts the full road surface on the terrain mesh → **ribbon becomes redundant** (retirement is a
  separate later cleanup; do not rewrite the render path here).
- **Verify:** important road = clean cobble; abandoned road = mud/ruts/moss; no ribbon double-draw
  artifacts.

### Slice 3 — img2img seam: `GeneratedTextureSource` (runtime, OFF by default)
Mirror `GeneratedBuildingArtSource`:
- exemplar tile → **3×3 super-tile img2img** (OpenRouter, model-aware prompt per
  `feedback-img2img-prompts-per-model`) → **crop interior** → **tileability gate** → register into
  the exemplar atlas → IDB cache (key above) → procedural fallback on miss/failure.
- Validate-BEFORE-persist; one retry then session-null negative-cache (no IDB poisoning); ≤2 concurrent
  paid calls; per-session `SESSION_CAP_USD`; **default OFF**, behind the live-art toggle.
- Offset-and-inpaint is the fallback tiler if crop-interior under-delivers on a model.
- IDB store guarded by `withIdbTimeout` (per the standing IDB rule).
- **Verify (one funded smoke-test only, when unfrozen):** a grass exemplar returns a seamless
  pixel-art grass tile; gate rejects a deliberately non-tiling gen.

### Slice 4 — Prebuild bake (author-time, keyless players get art)
`scripts/seed-material-textures.ts` (mirrors `seed-building-art.ts`): `--plan` dry-run; with a key,
img2img's each exemplar (× chosen variants) once, runs the tileability gate, writes
`public/asset-library/material-textures/`. Runtime source checks **IDB → baked library → paid gen**
(same precedence as buildings). Keys match worldgen exactly (deterministic exemplar ids).
- **Verify:** `--plan` lists the exemplar set; a real bake (when unfrozen) populates the library and a
  keyless reload renders the baked tiles.

---

## MVP

**Slice 0 + Slice 1 + Slice 2** — richer procedural terrain & road texturing, live, $0, freeze-safe,
img2img seam *in place but dormant*. Slices 3 & 4 light up with a funded reseed; they should require
**no rearchitecting**, only flipping the source on + running the bake.

---

## Test plan (per the codebase's empirical-verification preference)

- Pure/unit: exemplar determinism + seamlessness (Slice 0); hex-tiling UV math; tileability-gate
  metric; cache-key construction (model + version + material + variant).
- Golden: pin exemplar tile hashes (like `assetgen-golden`); intentional generator changes bump
  `TEXTURE_RECIPE_VERSION`.
- Integration: terrain/road render produces sampled (not flat) albedo; missing-exemplar falls back to
  analytic; IDB-timeout degrades to procedural.
- Visual: browser `__debug.grab()` captures (NOT page.screenshot) at a textured biome boundary + a
  cobbled vs abandoned road — a render catches tiling/seam bugs no assertion will.
- Perf: adaptive-resolution HUD stays ≥30fps on the iGPU baseline with Slice 1+2 on; procedural ops
  gated to needed fragments.

## Guardrails (carried from design)

No sim coupling (cosmetic only) · no road-render rewrite (ribbon retirement deferred) · no spend now
(paths land OFF, frozen) · WebGPU-only · hands off `feat/site-anchors` code · IDB via `withIdbTimeout`.
