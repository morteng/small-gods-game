# Terrain & Water Shader System — Research + Unified Design

> **Status:** research synthesis + design brainstorm (no code yet). 2026-06-18.
> Deep-research sweep (June 2026 sources) across four axes — terrain texturing,
> water rendering, dynamic LOD, pixel-perfect rendering — mapped onto our actual
> WebGPU/WGSL renderer. Companion to the water S0–S6 epic and the coastal-relief
> epic. Supersedes the "material layers arrive in T3" stub in `terrain-wgsl.ts`.

## 0. The ask (designer intent)

One coherent terrain+water shader system that:

1. Renders the **full surface gradient in one pass**: deep water → shallow water →
   wet sand/shore → mud → earth/grass → rock → snow.
2. Is **pixel-perfect** — crisp deliberate pixel-art at a chosen pixel scale,
   **decoupled from the underlying 2 m sim tile grid**.
3. Works with **roads, rivers, lakes, shores** and everything else, **in one pass**.
4. **Mountains only modify terrain HEIGHT** (a heightmap stamp). The **biome layer**
   then does all texturing, vegetation placement, rocks/boulders, snow — driven by
   the resulting height/slope/moisture, so placement is *consistent* with texture.
5. Has **dynamic LOD** so we can zoom from whole-island overview to near-tile detail.

## 1. The one idea that unifies all of it

**A single per-cell "terrain field" is the source of truth, and everything is a
projection of it.** This is the same philosophy as our "one renderer = projection
of one connectome graph" decree, pushed down to the surface shader.

Today `terrain-field.ts` packs two buffers: `heights` (normalised elevation, =
base ⊕ deformations) and `colors` (per-tile-type hex). The redesign **widens this
into a richer per-cell field** that *both* the terrain shader and the water shader
read, and that a *scatter* compute pass reads to place rocks/trees/snow:

```
per-cell terrain field (storage buffers, row-major width*height)
  height      : f32   normalised elevation  (base ⊕ deformations) — ALREADY EXISTS
  moisture    : f32   0..1  (rainfall/river-proximity/biome) — NEW
  temperature : f32   0..1  (latitude/altitude) — NEW (or derive temp = f(height,lat))
  flags/biomeId: u32  discrete biome / road / special — NEW (replaces raw color)
  + water buffers (surfaceW, wtype, flow, shallowC, deepC, clarity) — ALREADY EXIST
```

The **mountain = heightmap stamp** principle falls straight out: mountains,
roads, rivers, earthworks are all just **producers that write the `height`
buffer** (the existing "shared terrain deformation channel"). They do **not**
write color. Texturing is computed *downstream* in the fragment shader from
`height` + analytic `slope` (already computed as the normal!) + `moisture` +
`temperature`. Raise a mountain and snow/rock appear automatically because the
slope got steep and the altitude crossed the snowline — no producer has to paint
anything.

`slope` is **free**: the terrain vertex shader already computes the central-
difference normal (`terrain-wgsl.ts:80-87`). `slope = 1 - normal.y`. The cliff
texture, the rock-scatter probability, and the "no snow on steep faces" gate all
read the *same* slope value, so they agree to the pixel.

## 2. Terrain texturing — water→mud→earth→snow in one fragment shader

Current state: `fsMain` unpacks one per-cell biome color and bands the diffuse.
That's it. The redesign replaces the flat color lookup with a **material gradient
composited from the shared field**. Techniques (all sourced, all WGSL-ready):

### 2a. Base color = 2D biome LUT (moisture × elevation) — *recommended*
A small authored image, X = moisture, Y = elevation/temperature, painted with
biome colors (Whittaker diagram). `base = textureSample(biomeLUT, vec2(moisture,
elevation))`. **NEAREST + clamp + no mips** for crisp stylized cells (LINEAR if we
want soft borders). One dependent fetch; a designer edits the whole world palette
in an image editor. Zero-texture fallbacks: IQ cosine palette `a+b·cos(τ(c·t+d))`,
or Red Blob's discrete `biome(e,m)` branch table.
- Source: Red Blob *Polygonal Map Generation* / *Terrain from Noise*
  (redblobgames.com/maps/terrain-from-noise/); Whittaker diagram (PCG wiki); IQ
  Palettes (iquilezles.org/articles/palettes/).

### 2b. Material composite = HEIGHT-BLEND, not linear alpha — *the crispness keystone*
For the discrete material bands (sand/mud/rock/snow over the biome base), do NOT
cross-fade by weight (produces 50/50 mush). Each material carries a grayscale
"height"; keep whoever pokes above a transition band:
```wgsl
let ma = max(hSand + wSand, max(hRock + wRock, hSnow + wSnow)) - depthBand;
let bSand = max(hSand + wSand - ma, 0.0);
let bRock = max(hRock + wRock - ma, 0.0);
let bSnow = max(hSnow + wSnow - ma, 0.0);
let col = (cSand*bSand + cRock*bRock + cSnow*bSnow) / max(bSand+bRock+bSnow, 1e-4);
```
"Sand fills the cracks between stones" — crisp by construction, ideal for pixel-art,
essentially free given material weights. Add fbm into each weight so even flat-
height materials interlock.
- Source: Mishkinis *Advanced Terrain Texture Splatting*
  (gamedeveloper.com/programming/advanced-terrain-texture-splatting); Shaderic
  Heightmap Blending.

### 2c. Slope/altitude rules with JITTERED thresholds
```wgsl
let slope    = 1.0 - n.y;                                   // free from the normal
let snowJit  = fbm(grid * 0.04) ;                           // 2-octave
let wRock    = smoothstep(0.35, 0.7, slope);                // steep = rock
var wSnow    = smoothstep(snowline-0.05+snowJit*0.06, snowline+0.05+snowJit*0.06, height);
wSnow       *= smoothstep(0.55, 0.75, n.y);                 // snow only settles on flats
```
Jittering the threshold (and lightly domain-warping the biome-LUT lookup) kills the
flat contour ring / square biome borders that betray procedural terrain.
- Source: IQ *Terrain Marching*; NoisePosti.ng *Fast Biome Blending Without
  Squareness* (noiseposti.ng/posts/2021-03-13-...).

### 2d. Wet-sand / mud band at the shore — *coordinates with water in the SAME field*
Because terrain owns the height buffer and water owns `surfaceW`, the terrain
fragment can compute **analytic depth-to-water** without any depth-texture trick:
`wet = smoothstep(waterLevel + band, waterLevel, height)`; darken + slightly
saturate the albedo by `wet` (Lagarde wet-surface model: `albedo *= mix(1, 0.55,
wet)`). Scroll `band` with the swash so the wet line breathes. This is the terrain
half of the shoreline; the water half (foam/depth-fade) is §3. They read **one
shared `waterLevel`/`surfaceW`** so the seam is pixel-aligned.
- Source: Lagarde *Physically based wet surfaces*; Unity Coding *Beach Sand*.

### 2e. Cel/posterize finish (already half-done)
We already band `n·sun`. Extend to posterize the *albedo* (luminance-preserving)
and optionally Bayer-dither the depth/snow ramps (§5). Gives the Dorfromantik/Bad
North storybook-pixel look and matches the existing banded lighting.

### 2f. Triplanar for cliffs ONLY (defer)
If/when we add real material textures (not flat colors), gate triplanar (biplanar +
Whiteout normals) on `slope > threshold` so only cliff faces pay 2-3× fetches;
flats keep the single top-down projection. Not needed while materials are flat
colors. Source: Ben Golus *Normal Mapping for a Triplanar Shader*.

## 3. Water shader — upgrades on top of what we already ship

We already have (in `water-wgsl.ts`): analytic `depth = surfaceW - terrainH`,
flow-advected directional ripples, shoreline foam, summed-sine caustics, and
rapids on steep beds. The single-pass blended architecture is **correct and
should stay** (the only thing it can't do is true scene refraction/planar
reflection, and the fakes are visually sufficient). Verified upgrades, in
priority order:

1. **Two-phase flow crossfade** (Valve/Portal2). Our ripples still single-sample
   along flow; add a second phase-offset sample crossfaded by the triangle weight
   `1-|1-2p|` (+ per-pixel noise phase) to kill the reset-flash/stretch on fast
   rivers. ⚠ Don't mix conventions: *additive* uses `1-|1-2p|`; *lerp* uses
   `|2p-1|`. ~2 extra taps. (Vlachos SIGGRAPH 2010; Catlike *Texture Distortion*.)
2. **Per-channel Beer–Lambert depth tint** — replace the single-channel
   shallow→deep `mix` with `exp(-extinction.rgb * depthM)`, `ext.r>ext.g>ext.b`,
   for the natural blue-green deep shift for free. (Catlike *Looking Through Water*.)
3. **Animated scrolling foam lines + swash** on top of the static shore foam:
   `smoothstep(e1,e2, cos((grad - t*speed + noise)*waveCount*τ))`, `8π`→4 lines,
   faded so deep water stays clean. Highest readability-per-cost upgrade. (Roystan;
   Alisavakis; Cyanilux *Shoreline*.)
4. **`min()` two-sample sharpen + proper fades on caustics** — sample the net twice
   (different scale/offset/speed), `min()` them to crisp filaments; gate by
   `saturate(1-depthM/maxDepth) * clarity * max(0,dot(sunDir,up))`. (Zucconi
   *Believable Caustics*; Hoskins MdlXz8.)
5. **Thresholded sun-glitter** off the existing ripple normal:
   `step(0.98+k, max(0,dot(sunDir, reflect(-V,N))))` → free traveling sparkles
   (+ a touch of bloom). (Unity *sun-glitter*.)
6. **Procedural sky-gradient reflection** masked by Fresnel: `mix(waterColor,
   mix(horizon,zenith, saturate(R.y)), fresnel)`, zero texture binds. On a fixed
   iso camera this reads as lively normal-driven shimmer. Note Fresnel is weak at
   top-down view — exaggerate the exponent. (IQ *Simple Water*; Unity *sky
   reflections*.)
7. **Toon-band the depth ramp + hard `smoothstep` foam edges** for a stronger
   Genshin/Zelda identity that matches the pixel-perfect direction.
8. **Foam accumulation** — augment rapids with slow-pocket
   `saturate((slowThresh-flowMag)/slowThresh)` + convergence `saturate(-div*k)`
   terms (combine via `max`), so foam also piles in eddies / behind obstacles.

Architecture notes (verified): keep **premultiplied alpha** (`one /
one-minus-src-alpha`) — unifies additive sparkle with solid foam; **depthCompare
`less-equal`, no depth write**, drawn after terrain; **never sample the depth
target** — our analytic `surfaceW - terrainH` is exact, portable (avoids the
`depth24plus`-not-sampleable Metal trap), and free.

## 4. Dynamic LOD — opinionated: ZOOM-LOD, not distance-LOD

**The single most important research finding for us:** under an **orthographic**
camera there is no perspective divide, so projected scale is constant at all
depths — classic per-tile *distance*-LOD (clipmap rings, CDLOD distance shells)
**buys almost nothing**. The real variable is **zoom** (pixels-per-world-unit).
Maya literally substitutes orthographic width for camera distance in its LOD
formula; RTS strategic zoom swaps by zoom level. So:

1. **Drive `subsample` from the zoom rung**, not a fixed quad cap. Target ≈ 1
   vertex per 1–2 device pixels. Whole-island overview → coarse; near-tile → fine.
   The whole visible field switches density together, so **there are no internal
   LOD seams to stitch** (cracks only occur *between* different LODs within a
   frame — which we never have). This is almost free: our zoom ladder is already
   discrete 1/n rungs, so map each rung → a subsample factor. `terrainGrid()` in
   `terrain-field.ts` already picks subsample; just key it on zoom.
2. **Borrow exactly two ideas** from the LOD literature:
   - **CDLOD-style vertex morph across rungs** (anti-pop): as zoom approaches a
     rung boundary, morph the current grid's heights toward the next-coarser grid
     — the §2 morph math with *zoom* substituted for distance.
   - **Vertex snap-to-grid** (anti-swim): snap sampled world positions to the
     active subsample step so heights don't oscillate while panning.
3. **Do NOT pursue** mesh-shader/Nanite terrain (impossible in shippable WebGPU —
   no mesh shaders, no 64-bit atomics), hardware tessellation (absent), virtual
   texturing (no sparse textures; a bounded island doesn't need it — texture
   clipmaps if we ever stream surface detail).
4. **When would real GPU-driven LOD be justified?** Only if we add a perspective/
   tilted camera, grow past one heightfield buffer, or hit a vertex wall at finest
   zoom. The clean upgrade then is **CDLOD quadtree + compute frustum-cull →
   `drawIndexedIndirect`** (fully WebGPU-portable, reuses our storage buffers).
   Premature today.

- Sources: Strugar *CDLOD* (aggrobird.com/files/cdlod_latest.pdf); Losasso/Hoppe
  *Geometry Clipmaps* (hhoppe.com/geomclipmap.pdf); Maya ortho-LOD docs; gpuweb
  #3015 (no mesh shaders), #455 (no sparse), #445 (no tessellation).

## 5. Pixel-perfect — HYBRID: low-res target + in-shader analytic AA

Designer intent: crisp pixels **decoupled from the 2 m tile grid**, prefer
multiple native sizes over fractional scaling. Two grids exist and must not be
conflated: the **sim tile grid** (1 tile = 2 m) and the **art-pixel grid** (one
chunky pixel of the look). Recommended pipeline (backbone = render-to-low-res):

1. **Render terrain + water + entities into a fixed low-res internal target**
   `W×H` (e.g. 480×270), **1 art-pixel larger** each dimension (for the offset
   trick). This is where art-pixel size is *defined* — fully independent of tile
   size. Ortho iso camera. Any pixel-thickness effect (1px outline, AO/lighting
   bands, dither dot) MUST be computed here, pre-upscale, or it scales with zoom.
2. **Stylize entirely in this pass:** banded lighting on snapped normals →
   posterize/nearest-palette (compile-time WGSL `const` palette) → **8×8 Bayer
   dither between the two nearest palette colors** for the water-depth/snow/biome
   ramps, **indexed by `@builtin(position).xy`** (screen space, or it swims).
3. **AA the procedural water/terrain bands in-shader:** replace `step`/`frac`
   cuts (foam, caustics, depth bands, snowline) with
   `smoothstep(e-fwidth(x), e+fwidth(x), x)`. **This is the key anti-moiré move for
   animated water** — the one thing the low-res buffer alone won't fix. Sample any
   snapped-UV textures with `textureSampleGrad` (pre-snap derivatives) to keep
   mips honest.
4. **Stability under pan/zoom = snap-then-offset (t3ssel8r):** each *sim tick*,
   snap the iso camera to the view-aligned art-pixel grid (`floor`), keep the
   fractional remainder, render at the snapped position, and apply
   `screen_offset = -fract(cam)*scale` as a **single screen-space blit-offset
   uniform** in the upscale pass. Crucially this needs **no per-entity re-pack** —
   which **also fixes the logged JERKY-ZOOM bug** (gpu-scene re-packs all instances
   every frame). Pair with pushing the view transform into a shader uniform.
5. **Upscale:** `nearest` for integer rungs (the preferred path, matches "native
   sizes over fractional scaling"); fwidth **sharp-bilinear** only for non-integer
   window fitting. Keep the existing **1/n zoom ladder** (fractional rungs forbidden
   — uneven fat pixels).
6. **Snap sprite/entity positions AFTER the iso projection**, not in world space
   (the dimetric transform mixes both world axes into both screen axes).

- Sources: tanalin *Integer Scaling*; miximum.fr *Godot pixel-art texture*
  (UV-snap + `textureGrad`); Cole Cecil / IQ / d7samurai (fwidth seam-clamp);
  yal.cc + voithos (snap-then-offset); Wikipedia *Ordered Dithering* (Bayer); GM
  Shaders *Anti-aliasing* (smoothstep band AA).

## 6. Scatter — rocks/boulders/trees/snow from the SAME field

Placement must be consistent with texturing → drive it from the shared field with
the *identical* smoothstep edges, so a rock lands exactly on a cell the cliff
shades:

- **Probabilistic acceptance via deterministic hash** (no `Math.random` — honors
  the sim guard): `pRock = smoothstep(0.35,0.7,slope)`, `pSnow =
  smoothstep(snowline±,height)*step(0.5,valueNoise)`, `placed = hash21(cell+seed) <
  pType`. (Szwajka *GPU Run-time Procedural Placement*.)
- **Two tiers:** *fragment speckle* (pebbles via Voronoi F1, snow flecks, grass
  grain) drawn **in the terrain shader** gated by the field — free, automatically
  consistent, best for LOD-far; *real instances* (rocks/bushes/trees) via a
  **compute pass → instance buffer → `drawIndexedIndirect`** feeding the existing
  y-sorted `entity-draw-list`. WebGPU caveat: **no multi-draw-indirect**, so N
  sprite types = N indirect draws.
- Distribution: jittered grid (cheapest) or a baked tileable **blue-noise**
  threshold for clump-free variable density. (Red Blob *Jittered Grid*.)

## 7. Proposed slicing (parity-first, each independently shippable)

Ordered so each slice is visible, testable, and low-risk. Heightfield/water
buffers already exist; most of this is fragment-shader + one new buffer.

- **T-A — Shared field widening.** Add `moisture`/`temperature` (or derive) +
  `biomeId` to `terrain-field.ts`; keep the current flat-color path working
  (biomeId → existing hex) so nothing regresses. Unit-test the packers.
- **T-B — Material gradient fragment shader.** Replace `fsMain` color lookup with
  2D biome LUT + height-blend material composite (sand/mud/rock/snow) + jittered
  slope/altitude rules. **The water→mud→earth→snow headline.** Golden-image the
  output; pin a hash like `assetgen-golden`.
- **T-C — Shore coordination.** Wet-sand band in terrain (`§2d`) + water depth-fade
  alpha + animated foam lines (`§3.3`), both off shared `surfaceW`. Kills the
  shoreline seam properly (supersedes the color-match hack).
- **W-D — Water polish.** Two-phase flow + Beer-Lambert + caustic `min`-sharpen +
  sun-glitter + sky reflection (`§3.1,2,4,5,6`).
- **P-E — Pixel-perfect pipeline.** Low-res target + nearest upscale + snap-then-
  offset (also closes JERKY-ZOOM) + in-shader band AA + Bayer dither (`§5`).
- **L-F — Zoom-LOD.** Subsample keyed to zoom rung + vertex snap + CDLOD morph
  across rungs (`§4`). Depends on the view-transform-as-uniform from P-E.
- **S-G — Scatter.** Fragment speckle first (free), then compute-indirect instances
  (`§6`). Feeds flora epic Slice 2.

MVP for "the whole system working" = **T-A + T-B + T-C + P-E**. W-D and L-F and
S-G are high-value follow-ons.

## 8. Cross-cutting verified gotchas (carry into implementation)

- Flow-blend triangle wave has **two complementary conventions** — additive
  `1-|1-2p|` vs lerp `|2p-1|`; do not cross them.
- GPU Gems Gerstner closed-form `Normal.y` includes a leading `1-Σ(...)` a popular
  gist drops — use the Catlike cross-product form. (We don't displace geometry
  anyway — compute wave normals analytically on flat water.)
- Snapped UVs zero their derivatives → mip 0 aliasing; pass pre-snap derivatives to
  `textureSampleGrad`.
- Bayer/dither **indexed in screen space** and done in the **low-res pass**, or it
  swims / becomes sub-art-pixel.
- WebGPU has no `saturate` — define `fn sat(x:f32)->f32{return clamp(x,0,1);}`.
- WebGPU: no mesh/geometry/tessellation shaders, no 64-bit atomics, no sparse
  textures, multi-draw-indirect is Chrome-flag-only. Single `drawIndexedIndirect`
  is the reliable GPU-driven primitive.

## 9b. Evaluated additions — frustum culling, SSR, weather skydome

Three follow-on questions were deep-researched (June 2026 sources) and grounded against
the codebase. Verdicts:

### Frustum culling — **mostly NOT worth it; the real win is the jerky-zoom fix**
For an **orthographic** camera the frustum collapses to a world/iso-space AABB (no
perspective planes). The codebase **already has the inverse transform**
(`iso/iso-projection.ts` `screenToTile()` + `visibleTileBounds()`), and the entity
draw list **already culls** to the visible tile region (`entity-draw-list.ts`). For a
192×136–256² bounded island, terrain/water **chunk** culling saves only ~0.2 ms (a
clipmap author measured exactly this and dropped it; Cesium: "not worth 2 ms to shave a
few draws") and at min-zoom the whole island is on-screen so a cull rejects nothing.
So: **don't build terrain/water chunk culling now.** What *is* worth it (and is mislabeled
as culling) is the **JERKY-ZOOM fix**: push camera+zoom into the `globalsBuf` uniform,
upload entity instances **once** into a persistent storage buffer + partial-update moved
ones (stop the per-frame `packInstances()`+`writeBuffer` of every batch), and
**rAF-coalesce** wheel/pinch input. Also widen `visibleTileBounds()`'s 1-tile margin to a
height-derived value (`ceil(maxSpriteOrReliefPx/(TILE_H/2))`) so tall sprites/relief don't
pop at edges. The full GPU-driven `compute-cull → drawIndexedIndirect` path (with per-chunk
AABB+min/max-height, args consolidated into one buffer to dodge the ~300× indirect-validation
tax, no multi-draw-indirect) is documented for **later**, gated behind a >512² map or a
profile showing vertex/submission-bound — neither true today. → folds into task L-F as the
**zoom-LOD + instance-pipeline** slice, not a culling slice.

### SSR for water/ice/snow — **NO. Use procedural fakes.**
SSR breaks under orthographic cameras in every stock engine (Godot #79002: reflections
rotate wrongly; same root cause as Unity's ortho SSAO), needs a sampleable G-buffer
(color+depth32float+normals) we don't produce, and **structurally cannot reflect the sky
or off-screen content — which is the bulk of what near-horizontal iso water reflects.**
Multiple pixel-art practitioners (David Holland, Blightbound) abandoned SSR for exactly
this look. Verdict per surface:
- **Water → procedural sky-gradient reflection masked by Schlick/dot Fresnel + ripple-normal
  UV shimmer**, blended against tinted refraction. At a near-top-down angle Fresnel keeps
  reflection low, so water reads as tinted transparency, not a mirror — a cheap procedural
  sky is indistinguishable from "real." This is already W-D item 6. If a hero lake ever needs
  scene-object reflection, use a **mirror-flip frame re-sample at the low-res tier**, not SSR/planar.
- **Ice → a frozen-water variant of the water pass:** clarity→1, flatten the ripple normal,
  keep Fresnel + sky reflection + sharp specular, add a **parallax crack layer** + blue
  interior SSS-tint. Reuses the water pass; no new machinery.
- **Snow → sparkle, NOT reflection:** thresholded high-frequency **un-mipped** noise normals
  + half-vector specular, view-perturbed to twinkle, over a white→blue cavity-driven SSS tint.
  (Our no-mip low-res target keeps the sparkle sharp — a natural fit.) Optional anisotropic
  sastrugi later. → new optional slice **S-Ice/Snow** under W-D.

### Weather skydome — **NO dome mesh; promote `src/studio/solar.ts` to a runtime `deriveSkyState`**
In an iso game the sky is *felt as lighting* and *seen as a reflection*, so the whole thing
is a few scalars + a color ramp feeding shaders we already have — skip analytic sky models
(Hosek-Wilkie is ~30% slower for marginal gain), skydome meshes, volumetric clouds.
**Key find: `src/studio/solar.ts` already exists** (`solarPosition(hour,yearFrac,lat)` +
`solarLight(el)→{ambient,sunColor}` with day/dusk/night ramps) but is **unwired** — it's
a half-built MVP. Architecture: a deterministic sim `WeatherSystem` (1 Hz, seeded
`ctx.rng`, per-season Markov, snapshot-able like `activeEvents`) writes `World.activeWeather`;
a **pure** `deriveSkyState(tick, season, weather)` → `SkyState` feeds `LightingState` +
terrain cloud-shadows + the water reflection term (+ optional backdrop gradient). MVP slices:
1. **Promote solar.ts → `deriveSkyState`** driving `LightingState.{ambient,sunColor,sunDir}`
   from clock+season (the planned day/night sweep — immediately visible) + rotate
   `TERRAIN_SUN_DIR` from the same azimuth.
2. **Cloud shadows on terrain** = a scrolling-FBM subtract in the terrain fragment (~15 lines,
   no new pass, disproportionately atmospheric in iso).
3. **Sky reflection + sun/moon glint in water** (extend `WGlobals` with sky uniforms; ties W-D
   item 6 to time-of-day) — build the **star reflection in water** before any star *field*,
   since water is where night sky is actually seen.
4. **`WeatherSystem`** (clear/overcast/rain/storm/fog/snow), exponential-decay blended, linked
   to the existing `drought` settlement event.
Defer: rendered celestial discs/star fields/milky way, moon-phase rendering, analytic sky,
volumetric clouds, precip particles. → new epic-adjacent track **SKY-A..D** (depends on P-E's
low-res pipeline for the dither/posterize finish; W-D item 6 is the natural first hook).

## 9. Source index (primary)

Terrain: Red Blob (terrain-from-noise, polygon map, jittered grid); IQ (terrain
marching, palettes, voronoi, fbm, texture repetition); Mishkinis (height-blend
splatting); NoisePosti.ng (biome blending without squareness); Frostbite Ch.5
(procedural splatting); Ben Golus (triplanar); Lagarde (wet surfaces). Water:
Vlachos SIGGRAPH 2010 (flow maps); Catlike Coding (flow / waves / looking-through-
water); IQ (simple water); Zucconi + Hoskins MdlXz8 (caustics); Roystan / Cyanilux
/ Alisavakis (toon water, shoreline, waterfalls); Acerola (how games fake water).
LOD: Strugar CDLOD; Losasso/Hoppe geometry clipmaps; Maya ortho-LOD; gpuweb issues
#3015/#455/#445. Pixel-perfect: tanalin (integer scaling); miximum.fr (UV-snap +
textureGrad); Cole Cecil / IQ / d7samurai / bumbershoot (fwidth seam-clamp); yal.cc
/ voithos / code-disaster (snap-then-offset); GM Shaders (band AA); Wikipedia /
Ronja / Acerola (Bayer vs blue noise); Dylan Ebert *Texel Splatting* (2026, SOTA
context).
