# Building Generation System — Deep Dive (2026-08-01)

A full internal anatomy of the building art pipeline: how a worldgen seed becomes a drawn,
PBR-lit building sprite, and where the img2img arm slots in. Read as a companion to the
[img2img structure-adherence research](2026-07-11-img2img-structure-adherence-research.md)
and the metric-scale standard (2026-06-09). Every claim below was read from the code at
`main` on 2026-08-01; file paths are relative to the repo root.

> **AUDITED AND CORRECTED 2026-08-02.** ~92 checkable claims were re-opened against source:
> 85 confirmed, 5 wrong, 2 unverifiable. The wrong ones are fixed in place — `fixedFit` scale
> (64, not 32), the `roof` enum count (20, not 21), the catalogue coverage test's actual
> assertion, the seeding cost math (56/494/$1.68/$14.82, re-measured offline), and the claim
> that the parametric cache is session-local (it is not — §12 finding 3 is **retracted**).
> §12 finding 4 was rewritten: the vendored library is stale at `v31`, so painted art still
> reaches the screen via a bare-preset fallback. A hardcoded `ART_RECIPE_VERSION` was stripped.
>
> **Trust this document as a map, not as a datasheet.** Its structural anatomy — the compiler,
> solids, rasterizer, surface engine, prompt system, guardrails — checked out almost entirely.
> Its *numbers* had drifted within a day of being written. Re-derive any figure you intend to
> act on, and prefer reading a constant over quoting this file.

**The pipeline in one line:**

```
worldgen seed → preset/catalogue type → ResolvedBlueprint (descriptors + stage + connectome patches)
  → toGeometry (StructureSpec) → manifold-3D solids → facets → [yaw] → fixedFit (metric scale)
  → 2:1 dimetric projection → z-buffered rasterize (+ analytic surface engine) → depth → AO
  → weathering → ground shadow → anchors
  → [img2img arm] magenta init → geometry-true prompt → qwen-edit-2511 on Replicate → chroma-key
  → quality gates (border keyed ≥0.6, silhouette IoU ≥0.9) → registerAlbedo (alpha negotiation)
  → Oklab k-means (64) + Bayer4 dither → IDB / vendored library / paid
  → pickBuildingSource (asset → generated → parametric → flat) → SpritePack → GPU lit draw
```

---

## 1. The scale contract — everything derives from metres

`src/render/scale-contract.ts` is the single source of truth. Master anchor: **one ground
tile = 2 m** (`METRES_PER_TILE = 2`).

- `PX_PER_METRE = 32` (64 px/tile ÷ 2 m), `HEIGHT_UNIT_PX = ISO_TILE_H = 64`, `ISO_TILE_W` from
  `iso/iso-constants.ts`.
- `STOREY_TILES = mToTiles(2.7 m) = 1.35` — one storey, one cube-unit of height.
- Doors: `DOOR_HEIGHT_M 2.0` → 1.0 tiles × `0.45` wide. Humans 1.7 m → 54 px.
- **1:1 pixel rule**: sprites blit/derive only at whole pixels (`snapPx`).

The **projection** (`src/assetgen/render/projection.ts`) is the 2:1 dimetric (camera at
(1,1,1)):

```
RIGHT = [0.7071, −0.7071, 0]      screen-x
DOWN  = [0.4082,  0.4082, −0.8165] screen-y
VIEW  = [0.5774,  0.5774,  0.5774] toward camera (view depth; larger = nearer)
x = (p₀ − p₁)·scale + ox
y = (p₀ + p₁)·(scale/2) − p₂·scale + oy
```

`fixedFit` (`render/fit.ts`) locks `scale = ISO_TILE_W/2 = 64` px per world cube-unit and
sizes the canvas to the projected content + 4 px padding — so a tall keep yields a *taller
sprite*; heights stay mutually metric, never squashed to a fixed box (`computeFit` +
`fillFrac 0.88` is the legacy fit-to-box path, used only when `spec.size` is pinned).

## 2. The blueprint layer — what a building *is*

### 2.1 Presets (`src/blueprint/presets/index.ts`, 846 lines)

Hand-authored `Blueprint`s, e.g.:

- **cottage** — `wattle` walls / `thatch` roof / `limewash` palette, `GEN_FORM_TAG` +
  `GEN_OPENINGS_TAG` (massing + openings are *derived*); ridge smoke *louvre*, no chimney
  (period default for commoners).
- **tavern** — `timber`/`tile`, two **stone hearth chimneys** (one wall stack on the west
  gable, one ridge stack, `side:'back'`), jettied upper storey, `perStorey` windows denser
  upstairs.
- Plus landforms (sea_arch, cliff_face, cave_mouth, hoodoo), civic props (class `'prop'`),
  plants (class `'plant'`, L-system `branch_plant`), barriers.

### 2.2 The fact catalogue (`src/catalogue/`, medieval-europe pack)

Each building type is a *fact*: `topology` (tripartite-linear, church-axial…), `roomProgram`
(room types × count × bays), `hearthRule`, `entrance`, `sizeBays` range, `defaultMaterials`,
`lod` (L0/L1/L2 narrative tiers for briefs). The coverage test asserts a *minimum* of 14
`buildingType` entries and, separately and in the INVERSE direction, that every
building-class preset resolves to a catalogue entry — no id ordering is pinned
(`tests/unit/catalogue-medieval-pack.test.ts:19,39-46`). Trailing entries are facts-only —
primed for future geometry slices.

### 2.3 The connectome (`src/blueprint/connectome/`, 12 modules)

The "layer above" that resolves DOWN into the blueprint:

- **`form.ts` (L2)** derives *massing from program + structure*, opt-in via `GEN_FORM_TAG`:
  - Storeys: a `vertical-stack` building is as tall as its stacked zones; a hall stacks a
    second storey only when the frame bears it (`jettyMax > 0 && rooms ≥ 2`) and never
    out-builds `structure.maxStoreys`.
  - Jetty only for a jetty-capable box frame that stacks a storey; sacred halls get
    `storeyM 4.5`; stone **undercroft base-course** only when the frame can carry masonry
    AND a storey stacks above (the burgage townhouse read).
  - **L2b per-instance plan length**: `sizeBays` range → seeded bay count → `bays+1` tiles,
    clamped to the authored lot, floor 2 — so two cottages on a street are a short single-bay
    cot and a longer two-bay one, while settlement layout stays byte-stable.
- **`to-blueprint.ts`**: **the hearth literally determines the vent** — the smoke egress is
  positioned at the hearth zone's centre (`hearthT`, cumulative bays); the church's west tower
  snaps to the *entrance* gable (`entranceGableT` → t≈0.12/0.88).
- Other modules: `openings` (gen-openings), `smoke`, `cellar`, `complex`, `site`,
  `structure`, `grammar`.

### 2.4 Descriptors (`src/blueprint/descriptors.ts`)

Closed vocabularies: `WEALTH_LEVELS = destitute…opulent`, `QUALITY_LEVELS = crude…ornate`,
`CONDITION_LEVELS = pristine…dilapidated`. `descriptorPatch`:
- Wealth shifts each material role along its ranked ladder (`roleLadders` from the
  catalogue): destitute −2 … opulent +3; off-ladder materials untouched.
- `WEALTH_LIGHTS` subdivides glazing: destitute 1×1 … opulent 3×3 leaded lights.
- Crude unglazes; ornate → `style:'arched'`; opulent adds a storey.
- `descriptorPhrase` feeds the img2img prompt so the painted art matches the geometry bias.

### 2.5 Lifecycle (`src/blueprint/lifecycle.ts`)

- Plants: sapling → young → mature (no-op) → dying → fallen → stub (`plantStagePatch` scales
  `heightM`/`trunkR`, drops crown for end-of-life).
- Buildings: cleared → construction → complete (no-op) → fire_damaged → ruin → burnt →
  old_ruin. Each stage is a patch: drop the roof (`roof:'flat'` = "no roof"), collapse a
  storey (`levelDelta`), set a condition descriptor, and carry a prompt phrase — *"a
  burnt-out, charred ruin of"*. The canonical stage is byte-identical to the stageless
  asset, so the seeded library stays valid.

### 2.6 Part/feature registry (`src/blueprint/registry.ts`)

Two self-describing registries; adding a part/feature = one registration, no consumer edits.
`PartType`: `resolve` (seed-fill) / `toPrims` (assetgen geometry) / `toCollision` / `toAnchors`
/ `toBrief` (generative phrase). `FeatureType`: opening features implement `aperture` (carve
box) + `filler` (added-back leaf/pane). `paramSchema` is the agent capability catalogue. The
`body` part schema: `plan` enum (rect/round/L/cross/stepped), `levels 1–8`, `jetty 0–0.3`,
`roofPitch` (−1 = steep 1.5), `baseCourse`, `frame` (half-timbering), `buttress`, `parapet`,
20-value `roof` enum, `interior`/`cutaway`.

## 3. The geometry compiler (`src/blueprint/compile/to-geometry.ts`)

- Wing-bearing parts merge into **one `prim:'building'`**; round/stepped bodies and
  tower/porch/chimney append as standalone prims.
- Openings compile to **carve box + flush filler**: the wall is CSG-carved (recess), and a
  filler prim (door leaf with hardware, window sill/lintel/mullion grid/pane) is added back as
  separate geometry — uniform across rect/round/stepped.
- `expandStoreyOpenings` **ranks `perStorey` windows up the floors** with shrinking lights
  (`UPPER_STOREY_LIGHT_SHRINK 0.8` height, `0.92` half-width per floor) so uppers sit clear of
  the eave lip; `fitHeightUnderEave` clamps breaches with an `eave-breach` diagnostic.
- **Vents are never synthesized from blueprints** — empty list = no smoke (period-correct for
  barns/temples; `resolveFeatures` seeds a default chimney only for raw assetgen specs).
- `wall-geometry.ts` details: `APERTURE_EPS 0.02` pokes the cut past the wall plane (boolean
  robustness); `outerCoord` snaps openings to the FRONTMOST wing on L/cross plans (no floating
  over re-entrant notches); round bodies ride the cylinder bulge (`√(r²−off²)`); and
  `storeyJettyOffset` shifts openings outward when an upper storey oversails — the fix for the
  visible "window never shows on jettied taverns" bug.
- Opt-in `skirt`: a wall-hugging ~30 cm apron (default margin 0.15 tiles, one skirt prim per
  footprint rect so an L-plan's concave notch isn't filled), material mapped from
  `materials.ground`.
- `pickIds` / `featureStates` are strictly opt-in studio seams — a param would land in
  `canonicalJson(rb)` and bust every cached pack's key.

## 4. The solids engine (`src/assetgen/geometry/solids.ts`, 1173 lines)

- **Walls + roof = two unioned manifolds.** Roof pitches: `GABLE_PITCH 1.5`, `HIP_PITCH 1.35`,
  `SHED_SLOPE 0.5` (rise per unit of half-span / full run). Overhang per roof material:
  thatch 0.30 eave / 0.15 verge … stone 0.10 / **flush verge 0**.
- **Sprocketed eaves**: the pitch re-flattens over the overhang (`sprocketFor`), so the ridge
  keeps its flush height while the eave lands at `wallTop − min(pitch·eave, MAX_EAVE_DROP 0.3)`
  — the medieval solution to deep overhangs sweeping below door heads.
- Every roof is **real sloped boards** (`ROOF_SLAB_T 0.14`), not a solid wedge:
  - gable = 2 thick slabs + recessed tympana (`TYMPANUM_RECESS 0.92` kills the raking-edge
    z-fight stipple);
  - half_hip = gablet-clipped slabs + end hip pair + short gablet wall (~45% of wall rise);
  - hip = two prism intersections **shelled** by subtracting an inset copy (board thickness);
  - saltbox = asymmetric ridge at `SALTBOX_RIDGE_T 0.35` with **per-side sprocket drops** (the
    catslide must not inherit the steep side's eave drop);
  - gambrel / mansard = two-pitch with break knots (`GAMBREL_BREAK {u:0.4, z:0.72}`,
    `MANSARD_BREAK {u:0.28, z:0.8}`, `MANSARD_RISE_K 1.1`);
  - cross_gable = perpendicular bay crossing the ridge, only when length ≥ 1.6 × span;
  - flat = a 0.25 slab.
- **Vents** (`ventProfile`): chimney 0.30 × 0.55 brick; pipe 0.16 × 0.9 metal; smokehole
  0.35 × 0.35 timber; **spire 0.6 × 2.4 stone** — a sacred ridge-crown, sized to the building:
  a long nave gets a grounded west tower (≤55% of the gable), a small cell a slim flèche. Every
  ridge vent is **offset beside the ridge beam** (real stacks clear the purlin). `hollowChimneyTop`
  (v31): crown lip 1.2× + flue recess 0.52×, 0.15 deep — the G-buffer shows an *open flue mouth*
  that img2img paints as one.
- `roundSegments(radius)` tessellates by radius (chord ≈ 0.12 tiles) — towers/domes/wells stop
  reading polygonal.

## 5. Rasterize → AO → ground shadow (`src/assetgen/render/`)

- **`rasterize.ts`**: scanline fill with a **per-pixel z-buffer** and an *affine depth plane
  per facet* (valid because orthographic ⇒ a planar world facet's view-depth is affine in
  screen space). No global facet sort (mis-orders small-near vs large-far). Material channel
  packing: **R = depth (normalised later), G = AO, B = roughness, A = metallic**. Optional
  pick channel (Uint16 index into interned facet `src` strings, same z-test).
- **`ao.ts`**: screen-space depth occlusion, radius 2, strength 1.0 — neighbours that are
  NEARER (higher depth) occlude; crevices read as AO.
- **`ground-shadow.ts`**: projects the SAME 3D facets onto z=0 along the sun ray (default
  `[−0.5, 0.65, 0.58]`, damp 0.8) and rasterizes the union as a coverage mask — the object's
  *true* shadow shape (not a skewed 2D sprite, which distorts tall/round forms), baked once,
  co-registered via the same fit, blitted cheaply at runtime.
- **`weathering.ts`**: grime pools ground-ward (v²) and gathers in AO crevices
  (`0.40·v² + 0.60·crev`), rain-streaks via per-column noise strengthening downward, rust
  blooms only on `metallic > 0.4` and **de-metals + roughens** the material channel (oxide is
  dielectric). Pure integer-hash noise, seeded per asset — two cottages never streak
  identically. Weathering is baked into the ALBEDO because the banded-PBR shader ignores the
  roughness channel.

## 6. The surface engine — K0d (`src/assetgen/render/material-surface.ts`, 697 lines)

The $0 texture pass that killed flat grey massing. One pure function
`(material, finish, worldPos, normal) → {albedo, perturbed normal, roughness, ao}` sampled
**analytically at world position** — so a stone course runs unbroken across adjacent facets
with no seams and no tiling (a swatch-per-facet would seam at every edge).

- **Works** (bond/coursing within a family): stone → ashlar / coursed_rubble / random_rubble /
  cobble / dry_stone / flint; brick → running / flemish; timber → plank / plank_v / stave /
  board_batten. Defaults: `stone=coursed_rubble, brick=running, timber=plank`.
- **Finishes** (orthogonal paint layer): limewash / whitewash / ochre / redearth / tar /
  polychrome / gilt / mossed / soot — each a recolour + roughness modifier; gilt mixes by
  relief height, mossed builds in the lows only, polychrome saturates toward a tint
  (default temple blue).
- Per-pixel micro-relief tilts the normal (`NORMAL_BUMP 0.6`, finite-difference `EPS 0.01`)
  and nudges AO (`0.85 + 0.15·height`); cylindrical unwrap for round bodies (u = θ·radius).
- Deterministic end to end: `hash2`/`vnoise` integer-lattice noise, no `Math.random`.
- **This is also the grey-init an img2img reseed repaints into** — a funded upgrade is a
  quality lift, not a rewrite.
- PBR data (`material-pbr.ts`): all non-metal `metallic: 0`; `metal` 0.35/1; `glass` carries a
  warm emissive `[255,196,120]` so lit windows glow at night (`emissive·nightFactor`).

## 7. The img2img arm

### 7.1 The prompt (`src/assetgen/building-image-prompt.ts`, 483 lines)

Deterministic, geometry-TRUE, model-aware. Every clause is earned from the compiled spec —
no fixed preamble, no "masterpiece" filler. Guarded by `building-image-prompt-truth.test.ts`
(see §11).

- Subject-first; edit verb per model family (flux/qwen repaint, gemini redraw).
- **Material legend bound to hexes** — "only these are present: `grey #… = stone`, …" from
  `presentMaterials(toGeometry(rb))`.
- `FLAT_ALBEDO`: demand even ambient, shadeless paint — the engine re-lights from the
  geometry normals; a painted sun gets shaded twice.
- **Scale anchoring**: scale-class word (cottage/house/hall/keep), bay count, and the real
  metre footprint — kills the "model draws a guildhall for a bakehouse" drift.
- **Visible-face-only**: never describe features on hidden rear walls (the model invents
  extra windows on the faces it can see).
- Chroma-background contract stated positively (FLUX ignores negatives).
- qwen family: material-earned texture hints (dense combed thatch, true-scale tiles) + the
  pilot-validated adherence clause as the FINAL sentence (verbatim, pinned by test):
  *"Repaint surfaces only: keep the exact silhouette, roof pitch, eave lines and outline of
  the input image unchanged, and keep the background pure magenta."*
- Agent customisation (`palette`/`notes`) weaves into the prompt AND the cache identity (a
  `slate` roof override changes "thatch roof" → "stone roof" in the prompt and gets its own
  sprite).

### 7.2 The pilot that chose the model (`docs/superpowers/2026-07-11-…`)

FLUX.2 Klein's edit paradigm on OpenRouter has **no structural knobs** (no strength, no seed,
no control image — architectural, not a provider gap), capping silhouette IoU at 0.80 with
`registerAlbedo` papering over the disagreement ("the maroon smear"). The 2026-07-11 pilot on
Replicate measured:

| preset | flux-cn IoU | qwen-edit IoU |
|--------|------------|---------------|
| tavern | 0.898 | **0.994** |
| bakehouse | 0.880 | **0.993** |
| smithy | 0.988 | **0.994** |
| cottage | 0.897 | **0.974** |

→ adopted `qwen/qwen-image-edit-2511`, gate 0.7 → **0.9**. Eyeball notes became prompt
clauses: the bakehouse domed oven ("clay/stone bread oven with dark arched mouth, no glass"),
sparse thatch ("dense, tightly combed straw courses"), tile-scale drift.

### 7.3 The clients (`src/llm/`)

- `building-image.ts`: single dispatch seam. `BUILDING_IMAGE_MODEL = 'qwen/qwen-image-edit-2511'`;
  `qwen/…` → Replicate, everything else → OpenRouter chat-completions. Both return
  `{blob, costUsd}` + the typed `BuildingImageError` vocabulary.
- **Replicate client**: official-model endpoint with `Prefer: wait=60` (one round trip when
  possible), **proactive create pacing** (11 s — low-credit accounts get 6 creates/min,
  `REPLICATE_CREATE_SPACING_MS` override), 8 bounded 429 retries honouring `retry_after`,
  3 s poll / 300 s timeout. **Cost is a documented estimate** (`QWEN_EDIT_COST_USD = 0.03` —
  Replicate reports no per-call cost). Input shape: `aspect_ratio: 'match_input_image'`,
  `output_format: 'png'`, `disable_safety_checker: true`.
- `BuildingImageError.fatal = limit|auth` — the seeder aborts the batch on those instead of
  burning quota; provider-specific help/hint URLs for the abort message.

## 8. Cache identity — the substrate of everything

`src/render/generated-art-cache.ts`:

```
generatedArtKey(rbJson, model, footprint) = `${ART_RECIPE_VERSION}:${model}:${W}x${H}:${djb2(rbJson)}`
```

- `canonicalJson` = deterministic JSON with **recursively sorted object keys** — a refactor
  reordering blueprint fields must not invalidate (or re-bill) the art library.
- Footprint in clear text as a collision discriminator (djb2 is 32-bit).
- This key is the ONE primary key shared by the seeder (writes), worldgen + runtime
  (reads), and Fate — `variant-plan.ts` computes it in exactly one place.
- IDB records carry `recipeVersion`; reads reject stale-version rows. **Negative markers**:
  a generation that failed the quality gate is persisted as `failed: true` so reloads skip
  instead of re-paying; self-invalidates on recipe/model bump (the key changes).
- Every IDB open/txn races `withIdbTimeout` (4 s) — a wedged store degrades to the vendored
  library / grey fallback, never stalls boot.

## 9. Runtime flow & boot

- **Source dispatch** (`src/render/iso/iso-building.ts`): `pickBuildingSource` =
  `asset` (PixelLab) → `generated` (img2img) → `parametric` → `flat` (last-resort extruded
  box when manifold wasm failed). A `'fallback'` render mode forces the parametric 3D-model
  path. The sprite anchor is opaque-content-tight centre/bottom; the baked ground shadow
  offsets are stored relative to the crop's bottom-centre so any co-footed sprite can borrow
  a geometry shadow.
- **The two art sources**:
  - `ParametricBuildingSource`: `composeStructure(..., { surfaceTexture: true, yaw })`
    through the worker pool, **persisted write-behind to IDB, content-addressed with
    `ART_RECIPE_VERSION` baked into the key** (`parametric-building-source.ts:99-102,180-214`;
    `parametric-sprite-cache.ts:130-134`), plus a **vendored parametric bundle tier**
    (`vendored-sprite-bundle.ts:63`). ⚠️ The in-code comment at
    `parametric-building-source.ts:120-122` calls this cache session-local; it is stale and
    **contradicts its own file twenty lines above**. Do not trust it.
  - `GeneratedBuildingArtSource`: IDB → vendored base library (exact key, then bare-preset
    fallback tagged `preset-fallback`) → paid gen (gated by `enabled()` + `canSpend()`,
    **max 2 concurrent**, **2 attempts**, quality-gate failures recorded as negative
    markers) → null (grey) cached per session. `warm()` never gates free art on `enabled()`
    — the shipped vendored sprites must load with paid gen off.
- **Boot** (`src/game/boot-sequence.ts` + `src/game/art-settle-gate.ts`): on world-ready the
  boot prewarms EVERY building through all three sources and every barrier, then
  `holdLoadingUntilArtSettled` holds the loading screen until (a) compose-queue depth AND all
  sources' `pending()` reach zero and (b) the summed art revision has been quiet for 600 ms
  (poll 200 ms). **Deliberately no wall-clock cap** — "the player never sees grey boxes";
  wedge-proofing lives in the signals (every warm drains via `finally`, IDB is timeboxed).
  `maxWaitMs` exists only for tests/embedders.
- **Compose CPU** (`compose-scheduler.ts` + `compose-offthread.ts`): the scheduler yields a
  macrotask between budgeted time-slices (a cold boot once fused into a **175-second
  main-thread block**), with a **front lane** (player-facing buildings) drained before the
  back lane (wall chunks, plants). The worker pool (`hardwareConcurrency − 2`, cap 4) runs
  `composeStructure` + `payloadFromResult` off-thread and returns zero-copy transferables;
  any worker error → **permanent inline fallback** (`failPool`), no retry storm. The
  compose→payload seam (`compose-payload.ts`) is deliberately worker-safe AND Node-safe.

## 10. Author-time seeding & the variant matrix

`scripts/seed-building-art.ts` runs the SAME pipeline (geometry init → img2img → chroma-key →
validate → register → quantize) and writes
`public/asset-library/building-sprites/{manifest.json, <key>.png + normal/material/emissive}`.

- `REPLICATE_API_TOKEN=… npx tsx scripts/seed-building-art.ts [preset…]`; `--plan` prints
  key + prompt per preset ($0); `--matrix` seeds the variant DB; `--relink` rebuilds manifest
  rows from PNGs already on disk (salvages runs that crashed before the manifest write —
  the old end-of-run write orphaned every PNG when one gen threw); `--force` regenerates.
- Crash-safe incremental manifest writes behind a promise chain (at most one in flight, each
  a complete snapshot). Fatal `BuildingImageError` aborts the batch with the right billing
  URL. `SEED_CONCURRENCY` — Replicate defaults to 1 (the pacer serializes anyway), OpenRouter
  4.
- **Variant matrix** (`src/blueprint/variant-plan.ts`): a variant = one resolved point in
  `type × era × descriptor-combo × lifecycle-stage`; `generatedArtKey` is the database
  primary key, and `queryVariants` offers text + faceted (type/era/stage/wealth/tag) lookup
  for agents/Fate. `defaultVariantMatrix`: buildings get base + poor + rich + complete +
  ruin cuts; plants their whole stage timeline; props base only; base rows collapse onto
  existing keys (no duplicate spend).
- Cost math, **re-measured 2026-08-02 offline via `--plan` (nothing spent)**: **56 base
  presets ≈ $1.68**; the full **494-variant** matrix ≈ **$14.82** at `QWEN_EDIT_COST_USD =
  0.03` (`src/llm/replicate-image-client.ts:16`) — that is what the frozen reseed is waiting
  on. (The often-quoted 52 / 431 / $1.6 / $13 are the 2026-07-11 pilot's counts and have
  drifted; recount with `npx tsx scripts/seed-building-art.ts --plan [--matrix]` rather than
  trusting any number written here.)

## 11. Guardrails — the tests that pin the pipeline

- **`assetgen-golden.test.ts`**: djb2 hashes of all four G-buffer channels + canvas size for
  two fixtures — the full-pipeline **cottage** (`size 322`, grey `9e75d1b9`, normal
  `538ba0d3`, material `bb842e63`, emissive `9571f256`) and a bare **stone box**. The version
  history is written INTO the test as comments (a living changelog: v11 weathering, v12 lit
  windows, v17 bay sizing, v18 bay-aware openings, v24 palette warm, v27 trim, v32 window
  trim thinning…). Intentional change → update pins + bump `ART_RECIPE_VERSION` (read the
  current value from `src/core/content-version.ts` — never restate it here).
- **`building-image-prompt-truth.test.ts`**: across EVERY structure preset — every present
  material named in the legend, no absent material mentioned, no positive description of a
  door/window/chimney the geometry doesn't show, the qwen adherence clause verbatim as the
  final clause, and customization weaving into prompt + cache identity.
- **Determinism discipline**: no `Math.random` anywhere (`tests/unit/no-random-in-sim.test.ts`
  guards the sim; the assetgen code is pure hash/seeded by construction — k-means init is a
  fixed stratified sample, noise is integer-hash, geometry defaults are mulberry32).
- Plus ~20 more assetgen/blueprint/iso tests: fit math, rasterize z-order, linear barriers
  (arched gates keep the wall full height above the passage), manifold runtime, compose
  smoke tests, mount-anchor geometry parity.

## 12. Findings & recommendations

1. **`weather: false` contract drift (confirmed in code).** `ComposeOpts.weather` documents
   "pass `false` when the grey is consumed as an img2img INIT — weathering muddies the
   material-coded colours the prompt legend keys off." But **neither
   `GeneratedBuildingArtSource.produce()` nor `seed-building-art.ts` passes it** — both call
   bare `composeStructure(toGeometry(rb))`, so the init IS weathered (dirt/streaks/rust baked
   in). It empirically didn't hurt the pilot (the 0.974–0.994 IoU measurements ran through
   the same path), but the documented contract is unhonored anywhere. Decide: pass
   `weather: false` on the img2img init for cleaner material-region fidelity, or update the
   comment.
2. **Seeded material maps are dead weight.** The seeder writes `material.png` per sprite, but
   the runtime deliberately substitutes a neutral material (AO 1, dielectric) because a
   2D-canvas backing store is premultiplied and decoding an alpha-0 material PNG silently
   zeroes its RGB → AO 0 → lit black. So the weathering pass's material-channel work (rust
   de-metalling) is computed and persisted but never consumed. Normal + emissive are plain
   RGB and survive; material does not.
3. ~~**Two cache philosophies side by side.**~~ **RETRACTED 2026-08-02 — this finding was
   wrong.** Both arms are recipe-versioned and persistent: the parametric cache also writes
   through to IDB keyed on `ART_RECIPE_VERSION` and has its own vendored bundle. The claim
   came from the stale comment noted in §9. The REAL contrast is *free and locally
   recomposable* vs *paid reseed* — not memory vs disk — and the "K0d's flip needed no recipe
   bump because the cache is per-session" reasoning does not hold.
4. **What players see today** — corrected 2026-08-02. Two populations, neither of them grey:
   - The vendored img2img library is **stale at `v31`** while the recipe is newer, so **every
     exact-key lookup misses**. `fetchFromBaseLibrary` then falls back by **bare preset name**
     (`generated-building-art-source.ts:244-252`), and all **46 manifest entries carry a
     `preset`** — so those preset types render **v31 img2img PAINTED art**, tagged
     `preset-fallback` because it was painted against possibly-since-edited geometry.
     `pickBuildingSource` prefers `generated` over `parametric` (`iso/iso-building.ts:186-191`).
   - Everything else renders the **K0d analytic texture** (parametric `surfaceTexture: true`).
   - **Flat grey is only the compose/manifold-wasm failure path.** Runtime paid generation is
     off by default (`liveBuildingArtEnabled = false`, `src/game.ts:456-467`, user directive
     "don't spend money yet") and the reseed is frozen — but "grey massing until a funded
     reseed" is wrong in both directions, and CLAUDE.md has been corrected to match.
5. **The registerAlbedo negotiation is the craft**: geometry alpha is authoritative in the
   eroded core (holes flood-filled with neighbouring colour, never black), the LLM wins in a
   ~4% (of the short side) inward band (crenellations/notches survive), and nothing overhangs
   outward by default — that is what keeps the repaint co-registered with the PBR maps, the
   lesson of the v30 maroon-smear failure.

## Appendix — file map

**Scale/projection**: `render/scale-contract.ts`, `assetgen/render/projection.ts`, `fit.ts`
**Blueprint**: `blueprint/presets/`, `blueprint/catalogue` (facts), `blueprint/connectome/`,
`blueprint/descriptors.ts`, `blueprint/lifecycle.ts`, `blueprint/registry.ts`,
`blueprint/parts/`, `blueprint/features/`, `blueprint/wall-geometry.ts`,
`blueprint/compile/to-geometry.ts` (+ to-collision / to-anchors / to-mount-anchors)
**Geometry**: `assetgen/geometry/solids.ts`, `building.ts`, `arch.ts`, `column.ts`,
`roundwood.ts`, `linear.ts`, `stair-spec.ts`, `tower-spec.ts`, `gate-spec.ts`,
`flora/`, `manifold-runtime.ts`
**Render**: `assetgen/render/rasterize.ts`, `ao.ts`, `weathering.ts`, `ground-shadow.ts`,
`material-surface.ts`
**Compose**: `assetgen/compose.ts`, `assetgen/types.ts`, `material-pbr.ts`
**Prompt**: `assetgen/building-image-prompt.ts`, `flora-image-prompt.ts`
**LLM**: `llm/building-image.ts`, `openrouter-image-client.ts`, `replicate-image-client.ts`
**Cache**: `render/generated-art-cache.ts`, `render/parametric-sprite-cache.ts`,
`services/idb-guard.ts`
**Runtime sources**: `render/parametric-building-source.ts`,
`render/generated-building-art-source.ts`, `render/iso/iso-building.ts`,
`render/iso/sprite-canvas.ts`, `render/sprite-codec.ts`, `render/chroma-key.ts`,
`render/sprite-postprocess.ts`, `render/compose-{scheduler,offthread,payload}.ts`
**Boot**: `game/boot-sequence.ts`, `game/art-settle-gate.ts`, `game/render-context.ts`
**Worldgen placement**: `world/building-placer.ts`, `world/settlement-plan.ts`,
`world/building-collision.ts`, `blueprint/footprint.ts`, `blueprint/orientation.ts`
**Seeding**: `scripts/seed-building-art.ts`, `blueprint/variant-plan.ts`,
`blueprint/presets/express.ts`, `from-building-type.ts`
**Tests**: `tests/unit/assetgen-*.test.ts` (13 files), `building-image-prompt-truth.test.ts`,
`building-image.test.ts`, `generated-building-art-source.test.ts`, `iso-building-*.test.ts`,
`parametric-building-source.test.ts`, `sprite-postprocess.test.ts`, `mount-anchor-geometry-parity.test.ts`
**Docs**: `docs/superpowers/2026-07-11-img2img-structure-adherence-research.md`,
`docs/superpowers/plans/2026-06-09-img2img-building-sprites.md`,
`docs/superpowers/plans/2026-06-09-metric-scale-standardization.md`,
`docs/superpowers/plans/2026-06-07-assetgen-buildings.md`,
`docs/superpowers/plans/2026-06-08-assetgen-manifold-geometry.md`,
`docs/superpowers/plans/2026-06-08-live-parametric-building-sprites.md`,
`docs/reference/medieval-building-reference.md`
