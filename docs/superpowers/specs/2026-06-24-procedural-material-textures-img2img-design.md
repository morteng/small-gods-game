# Procedural Material Textures (img2img-ready) — Brainstorm / Design

**Status:** brainstorm (2026-06-24). No code yet.
**Origin:** user direction — *"we want to texture terrain and also roads"*; *"our goal is to run the
procedural textures through img2img pipeline later"*; *"like for buildings, trees etc we want to
prebuild and allow runtime generation of all img2img stuff. so, both."*
**Relationship to shipped work:** extends the terrain material composite from
`2026-06-18-terrain-water-shader-system-research.md` (T-A/T-B/T-C, BUILT) and reuses the img2img
pattern proven by the building pipeline (`project-img2img-building-sprites`). Aligns the road
texture path with the *stated* direction of `2026-06-24-roads-as-carved-terrain-design.md`
("a road is a thing the terrain *is*, not a thing we draw").

---

## Thesis

Today terrain colour is **fully analytic** — the fragment shader (`terrain-wgsl.ts`) composites
rock/snow/sand/mud over a flat per-biome base via height-blend, with zero texture sampling. That is
a good *stylized* base, but it has **nothing to hand to img2img**: img2img needs a raster image as
its init (exactly as the building pipeline feeds a grey massing render). So the headline move is:

> Introduce a small library of **tileable material exemplars** — one seamless tile per material
> (grass, dirt, rock, sand, snow, mud; road surfaces: packed-dirt, gravel, cobble). The live shader
> samples them (anti-repetition via hex-tiling); and the *same tile* is the **grey-init** for an
> img2img pass that upgrades it to richer pixel-art later.

The exemplar tile plays the role the grey massing render plays for buildings. Everything else is the
building pipeline with one swapped concern (see §3).

This is **purely a texturing/appearance layer**. It must not feed the `Math.random`-free sim — all
procedural noise and all generated art is cosmetic. (Enforced by the existing sim-randomness guard;
generated textures are static assets anyway.)

---

## Current reality (verified against code, 2026-06-24)

| Surface | How it's textured today | File |
|---|---|---|
| **Terrain** | Analytic material composite (rock/snow/sand/mud height-blend over flat biome base). **No texture sampling.** Banded/cel lighting. | `render/gpu/wgsl/terrain-wgsl.ts`, `terrain-field.ts` |
| **Terrain climate drivers** | per-cell `moisture`/`temperature` scalar buffers feed material weights | `terrain-field.ts`, `world/heightfield.ts` |
| **Roads (shape)** | carved into the heightfield (`'level'` corridor deformation) | `world/road-deformation.ts` |
| **Roads (coarse colour)** | `roadSurface` pavedness scalar → terrain shader ramps earth→cobble *into the ground albedo* | `world/road-surface.ts` → terrain-wgsl (binding 6) |
| **Roads (fine detail)** | **STILL a swept ribbon mesh** sampling a procedural atlas (dirt/cobble/plank + normals) | `render/ribbon/road-ribbon-field.ts`, `ribbon-wgsl.ts`, `render/gpu/road-material-atlas.ts` |
| **Buildings / trees** | parametric/3D geometry → grey init → img2img → register → IDB cache | `generated-building-art-source.ts` etc. |

**Two findings that shape this epic:**

1. **The ribbon is not retired.** Rivers were moved off ribbons (now the per-cell water pass); roads
   still render as carve + terrain-tint + **ribbon overlay**. The road-research design intent was
   "no ribbons", so the ribbon is a known gap, not the destination.
2. **The road atlas already is a tileable procedural material generator** (`road-material-atlas.ts`:
   `buildDirt`/`buildCobble`/`buildPlank`, seamless 64×64, baked normals). It is the closest thing
   we have to the exemplar layer — we generalize *it*, we don't start from scratch.

---

## Where img2img hooks in — and the one genuinely new risk

The building img2img pipeline is:
`parametric geometry → grey/structured init → OpenRouter img2img → chroma-key → quality-gate (IoU) →
register onto geometry → IDB cache (recipeVersion:model:hash) → spend-capped, frozen now`.

The texture pipeline is the **same shape**, two swaps:

| Building pipeline | Texture pipeline |
|---|---|
| grey massing render = init | **procedural exemplar tile = init** |
| chroma-key magenta → alpha | **skip** — textures are opaque, full-bleed |
| silhouette IoU gate | **tileability gate** — seam-wrap error must stay low |
| register onto geometry grid | register as a sampler tile in the material atlas |
| `ART_RECIPE_VERSION` + model in cache key | same (`TEXTURE_RECIPE_VERSION` + model) |
| per-session spend cap, on-view, frozen | same |

### The load-bearing new problem: diffusion breaks tileability

A building sprite is generated once and never tiled, so the building pipeline never worried about
edges. A material tile is **repeated across the whole map**; a vanilla img2img pass returns an image
whose edges don't wrap → a visible grid seam on every tile. This is the one thing the building
pipeline does not teach us. Mitigations, cheapest first:

- **Generate big, crop interior** (preferred default): img2img a 3×3 super-tile, keep the centre cell
  (fully surrounded by context). Effectively seamless, one call, simplest to reason about.
- **Offset-and-inpaint** (model-agnostic fallback): img2img the tile, roll it 50% (`fract(uv+0.5)`)
  so seams move to centre, inpaint just the seam cross. Robust, two calls.
- **Runtime hex-tiling + Laplacian blend** (the safety net regardless): even an imperfectly-wrapping
  exemplar reads fine when sampled with hex-tiling, which also kills *repetition*. This belongs in
  the live shader independent of img2img.

**Tileability gate** = wrap-edge L2 / FFT-periodicity error below a threshold; bad gens get one retry
then fall back to the procedural tile (mirrors the building IoU gate + negative-cache discipline).

---

## Roads: target the unified material layer, retire the ribbon

Given the stated direction ("roads are terrain"), road *texture* should come from the **same per-cell
material exemplar layer** as terrain — the `roadSurface` pavedness signal already lives alongside
`moisture`/`temperature`, so the terrain shader can sample a road exemplar (dirt→gravel→cobble) by
that signal. The `road-material-atlas` generators are **repurposed as exemplar tiles** for this layer
rather than as ribbon textures.

This is what finally lets the **ribbon retire** (the road-research design's R2): once the carved
terrain carries the full road surface material, the swept overlay has no job. Sequencing:

- **This epic** moves road surface texture onto the terrain material layer (and makes it img2img-able).
- **Ribbon retirement is a separate, later cleanup** — do not couple a render-path rewrite to the
  texture work. Until then the ribbon can stay as a no-op-or-thin overlay; the texture seam is the
  terrain layer either way.

`voro-noise` (one parameter morphing noise↔Voronoi) is the elegant procedural generator here: one
shader grades **packed-dirt → gravel → cobble** by a single weight tied to road **tier / `usedness`**
(the per-edge traffic / `residentsByPoi` weathering already shipped 2026-06-24). Important roads
cobble up and stay clean; abandoned ones go to mud/ruts/moss.

---

## What the live procedural layer gains (independent of img2img)

From the June-2026 SOTA sweep, on top of what T-A/T-B/T-C already shipped (height-blend, jittered
thresholds, wet-sand shore, cel lighting) — all WGSL-cheap, integrated-GPU-safe, $0, and gated to the
fragments that need them since the renderer is quad/fill-bound:

- **Analytic value-noise derivative normals** (IQ "morenoise") — value+gradient in one eval vs 4-tap;
  the biggest per-pixel win.
- **Curvature / Laplacian AO** darkening creases & valleys — cheapest "tactile" charm lever
  (Townscaper/Dorfromantik).
- **Hex-tiling (Mikkelsen) + Laplacian blend (Wronski)** — anti-repetition; the prerequisite that
  makes any tiled exemplar (procedural *or* img2img'd) not read as wallpaper. Zero precompute.
- **voro-noise road materials** driven by the traffic scalar (above).

AI note: runtime neural materials / NTC are **not WebGPU-reachable in 2026** (no cooperative-matrix
in stable WebGPU) — ignore. The only freeze-compatible AI branch is exactly this plan: img2img of
small tiles via OpenRouter BYOK, cached, spend-capped. FLUX.2 Klein 4B (~$0.014/MP, already
`BUILDING_IMAGE_MODEL`) is the cheap fit; gemini-nano-banana is the better "redraw this material as…"
editor (per-model prompts, per `feedback-img2img-prompts-per-model`).

---

## Both prebuild and runtime (like buildings/trees)

- **Prebuild / author-time:** a `seed-material-textures.ts` script (mirrors `seed-building-art.ts`)
  img2img's the dozen-ish exemplars once and writes `public/asset-library/material-textures/` so
  keyless players get art. Far fewer assets than buildings (materials, not thousands of variants), so
  baking is cheap and high-value.
- **Runtime / on-view:** a `GeneratedTextureSource` (mirrors `GeneratedBuildingArtSource`) generates
  per (material, climate/biome variant) on demand, caches to IDB, spend-capped per session,
  validate-before-persist, procedural fallback while generating / on failure.
- **Both default OFF and frozen** until a funded reseed — in-game terrain/roads render *richer
  procedural* now; img2img is a drop-in quality lift into the same slot.

---

## Non-goals / guardrails

- **No sim coupling.** Cosmetic only.
- **No road-render rewrite in this epic.** Ribbon retirement is deferred & separate.
- **No spend now.** Procedural-live only until a funded reseed; img2img paths land OFF.
- **Hands off anchor-points code** — another session owns `feat/site-anchors` / `sg-anchors`. If a
  texture exemplar ever needs anchor metadata, coordinate; don't edit those files.
- **WebGPU-only**; integrated-GPU budget is real (quad/fill bound) → gate procedural ops to the
  fragments that need them, bound noise octaves, analytic derivatives over multi-tap.

---

## Open questions for spec time

1. Exemplar tile resolution (64² like the road atlas? 128²/256² for img2img headroom?) and whether
   normals are generated procedurally or harvested from the img2img'd albedo.
2. One exemplar per material, or per (material × climate variant) — drives cache-key cardinality and
   prebuild count.
3. Sampling strategy in the terrain shader: replace the analytic albedo, or composite the sampled
   exemplar *over* it (keep analytic as the procedural fallback path).
