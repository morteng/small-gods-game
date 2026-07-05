# Flora quality — ez-tree gap analysis (trees, bushes, grass, rocks)

**Date:** 2026-07-04 · **Status:** 🧠 brainstorm/design (no code yet)
**Question:** [dgreenheck/ez-tree](https://github.com/dgreenheck/ez-tree) (MIT, ~1.4k LOC, three.js) makes
strikingly lush trees — what would it take to get our trees, bushes, grass, and rocks to that level?

**Answer in one line:** we already *exceed* ez-tree on skeleton generation and determinism; the visual
gap is four specific presentation tricks — **crown-radial "rounded" normals, a leaf-card silhouette
shell, wind sway, and per-instance color variance** — all of which port cleanly into our existing
bake/blit pipeline without adopting three.js or live 3D.

---

## 1. What ez-tree actually is

Read in full (sparse clone of `src/lib`, 926-line `tree.js` + options/presets, plus the demo app's
grass/ground):

- **Skeleton:** simple recursive branching. Each branch = `sections × radial segments` tapered tube
  rings. Per level: `angle, children, length, radius, taper, twist, gnarliness, start`.
  - *Gnarliness* = per-section random Euler perturbation scaled by `1/√radius` (thin twigs wander more).
  - *Growth force* = a world-space direction each section rotates toward, strength `∝ 1/radius`
    (phototropism / prevailing-wind lean). A trellis variant pulls growth onto a grid (espalier).
  - Child placement: stratified slots along the parent + stratified radial angle with a *shuffled*
    slot permutation so height and angle are uncorrelated (avoids spiral artifacts).
- **Foliage:** textured alpha-tested **quad cards** (single or perpendicular-double billboard) at
  branch tips. **The signature trick — `roundedNormals`:** each card vertex's normal is blended
  toward `(vertex − treeOrigin)`, so thousands of flat cards *shade as one smooth canopy volume*.
  This, plus a leaf texture with a fluffy alpha silhouette, is ~80% of why ez-tree reads "lush"
  instead of "cards glued to sticks".
- **Wind:** vertex shader — 3-octave sinusoid, phase = simplex noise of world position (so
  neighboring trees desynchronize), amplitude weighted by `uv.y` (tips sway, roots don't). The demo
  grass uses the same shader (`sin·cos` product) over a single instanced tuft mesh (5k–25k
  instances, simplex patchiness mask, per-instance scale + **per-instance color** jitter).
- **Bushes:** the same generator, just presets (`bush_1..3`).
- **Rocks:** *not procedural* — three static GLBs in the demo. Nothing to adopt there.
- Seeded RNG, fully deterministic. Bark = tiled texture with radius-scaled wrap count.

## 2. Where we already beat it (don't touch)

| Ours | vs ez-tree |
|---|---|
| **Space colonization** with crown-envelope authority (`envelopeMaxR`) — dome/cone/column/weeping/spreading crowns, coverage pass fills silhouette holes (`src/assetgen/geometry/flora/space-colonization.ts`) | naive recursion; crown shape is emergent/uncontrolled |
| **da Vinci pipe-model radii** (`pipeExp≈2.6`) — physically plausible taper | hand-set per-level radius+taper |
| **Fact-DB species** (34 entries, Wikipedia-grounded botany → derived params) + biome pools | 12 hand-made presets |
| **Bakes into the shared G-buffer sprite pipeline** — flora lights/shadows identically to buildings, ~10k instances in a cached static layer | live meshes, per-tree draw calls |
| Deterministic *and* `Math.random`-free by guard test | seeded but library-local |
| Generative rocks (`rockFacets`: jittered octa-sphere, aspect→monolith, cluster→pile) | static GLB props |

So "get to ez-tree's level" ≠ adopt ez-tree. Our 2026-06-14 flora design already (correctly)
rejected three.js. The gap is entirely in **how foliage is *presented***, and it shows up in our
bakes as the "broccoli problem": solid octa-sphere blobs with face-normal shading → hard lumpy
silhouettes and per-facet banding that reads as boulders painted green.

## 3. The gaps, ranked by visual payoff ÷ effort

### G1 — Crown-radial normals on foliage (the roundedNormals steal) — tiny effort, biggest payoff
`WorldFacet` already carries an explicit `normal`, and albedo = `shadeRGB(brightness(normal))`
(`src/assetgen/geometry/solids.ts:56`); the baked normal channel drives the runtime banded lighting.
Today `blobFacets` (`src/assetgen/geometry/flora/mesh.ts:117`) uses true face normals → each blob
shades as its own little ball.

**Change:** after building foliage facets, re-aim each facet normal at
`slerp(faceNormal, normalize(centroid − crownCenter), k≈0.7)` and recompute the shade. `crownCenter`
is already known (envelope origin). The whole canopy then shades as **one rounded volume** — sun side
bright, ambient side dark, smooth band gradation across the crown — while jittered blob geometry
still supplies the bumpy silhouette. Apply the same to conifer tiers (radial from the cone axis, not
a point) and to the weeping curtain (radial from the apex). ~30 lines in `mesh.ts` + a `crownCenter`
param threaded from the generator; golden-hash pins update + `ART_RECIPE_VERSION` bump.

### G2 — Leaf-card silhouette shell — medium effort, second-biggest payoff
Blob octa-spheres give a *smooth* outline; real canopies have a fluffy, broken edge. ez-tree gets it
from leaf-texture alpha. Our equivalent, keeping everything in the facet bake:

- Keep blobs as the **mass** (they own occlusion + the G1 volume shading).
- Add a shell of small **leaf-cluster cards** (2-tri quads, `foliage` mat, slight albedo jitter)
  scattered on blob surfaces facing *outward* — the existing **coverage pass already samples the
  envelope surface** (`space-colonization.ts:309`); reuse those sample points as card anchors.
- Cards get G1 radial normals; the z-buffer rasterizer composites them over the blobs, breaking the
  silhouette into leafy tufts. Optional: a 2-3 px dithered edge on card rims for the pixel-art read.

No alpha textures needed at all — at our sprite resolutions (~40 px trees), 8–20 jittered cards per
crown is enough to roughen the outline. Species knob: `leafType` (broadleaf → lobed cards, needle →
thin spiky fans we already build for conifers).

### G3 — Wind sway — medium effort, brings the world alive
Hooks already reserved (`botanical.flexibility`, spec'd as "Slice 3"). Our sprites are static baked
billboards, so ez-tree's per-vertex approach maps to two options:

- **(a) Blit-time top-shear (recommended):** in the entity instance shader, shear the sprite quad's
  top edge by `amp(flexibility, heightPx) · sin(t·f + phase(entityId))`, amplitude ~±1–2 px at the
  crown, zero at the foot. Phase from a hash of entity id/world pos (ez-tree's desync trick), time
  from the render clock — **render-only, nothing in `src/sim/`**, replay-safe. Breaks strict 1:1
  for the sheared rows only; at ±1–2 px it reads as wind, not blur. Grass/flowers get larger
  relative amplitude (whole-sprite `sin·cos` lean), trees subtle, rocks zero.
- **(b) Baked sway frames:** 2–3 pre-baked skeleton poses per species cycled SNES-style. Strictly
  pixel-pure but N× sprite memory and pairs badly with the planned 8-yaw atlas (8 yaws × 3 frames).

Decide (a) vs (b) with a visual A/B in the arboretum studio; (a) is the cheap default and shares the
shear machinery nothing else needs. Storm/wind events can drive a global `windStrength` uniform
(Fate-visible weather feedback for free).

### G4 — Growth-force + gnarliness in our skeletons — small effort, adds character
Space-col growth steps currently head straight at attractors. Add ez-tree's two habit knobs:
- **Directional force:** bias each growth step by a world-space vector, strength `∝ 1/branchRadius`.
  Gives *wind-swept coastal trees* (force from prevailing wind at exposed/coast tiles — placement
  already knows the tile), leaning riverside willows, upright poplars (force = +z).
- **Gnarliness:** per-step random perturbation scaled `1/√radius` for ancient oaks/yews vs clean
  young growth. Could derive from species `narrative` age facts.

Both are per-step vector tweaks inside `space-colonization.ts` growth (envelope culling still
applies, so silhouettes stay contract-true). Also steal the **shuffled-slot stratified placement**
for proctree shrub children (kills its occasional spiral artifact).

### G5 — Grass field density + per-instance tint — small effort, transforms grassland
ez-tree's meadow reads rich because of *density* (5k–25k tufts) and **per-instance color jitter**.
Ours: `density 0.11, maxPerTile 2` (`src/world/brushes/grassland.ts`) and identical albedo per
species sprite.
- **Tint variance:** per-entity albedo tint at blit time (hash of entity id → ±10% green-channel
  jitter, yellow-dry vs lush ramp by moisture/season later). The blit path already supports tint
  (`blobFacets` flower tint proves the channel exists at bake; runtime needs a per-instance tint
  multiply — check the instanced blit uniforms; if absent this is the one real renderer change).
- **Density:** raise grass-tuft density toward `maxPerTile 3–4` with a *cheaper micro-tuft sprite*
  (half-size L-system fan, ~8×10 px) so the static-layer build cost stays amortizable; keep the
  simplex clump field (we already have patchiness — ez-tree validates the exact same approach).
- Flowers already exist (oxeye/poppy/foxglove pools); density + tint carries them too.

### G6 — Bark read on trunks — small, optional
ez-tree wraps a bark texture with radius-scaled wrap count. Our 5-sided tubes are flat-shaded color.
Cheap parity: vertical facet striping on trunk tubes (alternate albedo ±6% per side, plus a darker
band at limb joins), or route trunk facets through the existing material-exemplar texturing the way
walls do. Only worth it on the 2–3 px-wide trunks if it survives quantization — test in studio first.

### G7 — Rocks — already ahead; polish separately
ez-tree offers nothing here. To lift rocks the same *visual* notch:
- **Keep flat face normals** (rocks want facets — the opposite of G1).
- **Strata:** albedo banding by quantized world-z (sedimentary layers) for monoliths/outcrops.
- **Moss/lichen cap:** blend `foliage` green onto up-facing facets (`normal.z > 0.6`) by moisture —
  ties rocks into the biome palette the way ez-tree's demo relies on scene lighting to.
- Clusters/piles already exist; add a `partialBury` (sink base 10–20% below grade + ground-blend pad
  from round 6's settle-in machinery) so boulders sit *in* the land, not on it.

### G8 — Lifecycle & state variants: age, season, burnt, stump — the pipeline's unfair advantage
Because a species sprite is a *bake of parameters*, variants that would each be hand-drawn art in a
normal pixel game are here just **re-bakes along extra axes**. The fact-DB already reserves the
authority fields: `phenology` (deciduous/evergreen/marcescent), `coppices`, `flexibility`.

**Variant axes** (per species, only where botanically meaningful):

- **Age class** (sapling / mature / ancient): scale `heightM`/`crownWidth` down for saplings
  (pipe-model thins the trunk automatically); ancient = G4 gnarliness up, crown broader + slightly
  hollowed, maybe a dead limb. 3 bakes, reuses the existing scale-class variety seam.
- **Season** (from the game calendar, `src/core/calendar.ts`): deciduous species get
  `autumn` (foliage albedo ramped amber — the `tint` channel `blobFacets` already has) and
  `winter` (**foliage stripped: limbs only** — our space-col skeletons are good and are currently
  never seen; winter is where they shine). Evergreens keep crowns (pine forests carry the winter
  palette); marcescent oaks/beeches keep brown leaves. Grass/herbs: dry-yellow autumn, absent or
  stubble winter. Snow later = a top-facing albedo dusting pass, same trick as G7 moss.
- **Damage states**: `burnt` (skeleton pruned ~40%, charred near-black albedo + ember-red sparse
  tint, no foliage), `stump` (trunk truncated at 0.3–0.6 m, top cap ringed — pairs with `coppices`
  facts for regrowth-into-sapling), `fallen` (optional later: limb laid along +x, reads as a log).
- **Regrowth loop**: stump → (coppicing species) sapling → mature closes a harvest/fire/recovery
  cycle the sim can own.

**Keying & cost:** cache key becomes `kind@age.season.condition` with sparse population — bake
**lazily on first sight** (the multiview-atlas plan already commits to lazy per-yaw baking; this is
the same seam, and the two compose: yaw × state both go through `composeStructure` params). Most
combinations never exist (no burnt-winter-sapling unless the world makes one). Full-forest winter
flip = one re-bake per *visible deciduous species* (~10–20 bakes), amortized like the prewarm.

**Sim wiring — two different seams, keep them separate:**
1. **Season is global + derived**: pure function of the calendar tick — *no per-entity state*,
   render-side selection only (like the yaw bucket). Deterministic, replay-safe, costs nothing in
   saves. Season boundaries must **invalidate the cached static draw layer** (same class of bug as
   the `tilesRev` gotcha — without the bump, spring repaints stale winter until reload; give it the
   same treatment: a `floraSeasonRev` the static-layer cache keys on).
2. **Age/damage are per-entity sim state**: a small `floraState` on vegetation entities
   (`age: sapling|mature|ancient`, `condition: healthy|burnt|stump`), mutated only through the
   command/event path — fire events, lightning miracles (`summon_storm` finally gets a visible
   consequence), harvesting, time-skip aging (D2 skips should age saplings and regrow coppice —
   cheap: bump age class by elapsed years). Placement assigns initial age from the clump field
   (grove cores older, edges younger — free forest-structure realism).

Fate/divine tie-in is the real payoff: a burnt grove that *stays* burnt for seasons, then regrows,
is exactly the kind of legible long-horizon consequence the belief loop wants NPCs (and players) to
read off the terrain.

## 4. What NOT to do

- **Do not import three.js / the ez-tree package** — bundle ban stands; the 2026-06-14 design
  already chose port-the-algorithms, and we only need ~4 ideas, all small.
- **Do not switch to live 3D tree meshes** — the multiview-atlas plan already rejected live 3D to
  preserve pixel-crispness; 10k live skeletons would also swamp the static-layer win.
- **Do not replace space colonization with ez-tree recursion** — ours is the better skeleton.

## 5. Suggested slices

| Slice | Contents | Est. | Verify |
|---|---|---|---|
| **F1 canopy-volume shading** | G1 radial normals (+ per-crown `k`), golden re-pin, `ART_RECIPE_VERSION` bump | S | arboretum before/after grabs |
| **F2 silhouette shell** | G2 leaf cards off coverage samples, per-`leafType` card shapes | M | arboretum + envelope-containment tests still green |
| **F3 wind** | G3 option (a) blit shear, `flexibility`-driven, global wind uniform | M | live capture; replay determinism untouched (render-only) |
| **F4 habit forces** | G4 force+gnarliness knobs, coastal wind-swept derivation, proctree slot shuffle | S | skeleton digest tests re-pinned per species |
| **F5 living grassland** | G5 tint variance + micro-tuft density | S–M | grassland flyover grab; static-layer build time budget |
| **F6 rock polish** | G7 strata + moss cap + partial bury | S | studio rock sheet |
| **F7 seasons** | G8 seam 1: calendar→season selection, deciduous winter/autumn bakes, `floraSeasonRev` static-layer invalidation | M | scrub a year in Time-Debug; watch the forest turn |
| **F8 lifecycle states** | G8 seam 2: `floraState` (age/condition), fire/harvest/regrow verbs through the command path, time-skip aging | M–L | burn a grove via storm event; time-skip; regrowth |

F1 is the standout: ~30 lines for the single trick that makes ez-tree look the way it does, and it
compounds with everything else (F2 cards need F1 normals; the 8-yaw atlas re-bakes whatever the
facets say). F1+F2+F5 together would close most of the perceived gap; F3 is the "alive" multiplier.

## 6. Sources

- ez-tree source (read in full): `tree.js`, `options.js`, presets, `app/grass.js` — MIT, sparse
  clone at commit of 2026-07-04. Demo: https://eztree.dev
- Our pipeline: `src/assetgen/geometry/flora/*` (space-colonization, proctree, recipes, mesh),
  `src/flora/*` (species/facts/biome pools), `src/blueprint/parts/flora-branch.ts`,
  `src/assetgen/compose.ts:119`, `src/render/parametric-plant-source.ts`,
  `src/render/iso/{entity-draw-list,iso-sprites}.ts`, `src/world/brushes/{grassland,vegetation-placer}.ts`
- Prior art docs: `specs/2026-06-14-flora-vegetation-generation-design.md` (custom-generator
  decision), `plans/2026-06-21-flora-multiview-bake-atlas-plan.md` (8-yaw atlas, not started)
