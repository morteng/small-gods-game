# Flora & rock generation + dynamic effects + flora fact-DB (brainstorm)

**Date:** 2026-06-14 · **Status:** brainstorm (user-directed) · **Builds on:**
[world-prop / vegetation rendering](2026-06-13-world-prop-vegetation-rendering-design.md),
[render trees slice 2 spec](2026-06-13-render-trees-slice2-spec.md),
[worldbuilding fact database](2026-06-14-worldbuilding-fact-database-design.md),
[fact-catalogue + connectome](2026-06-14-fact-catalogue-connectome-slice01-spec.md),
[asset catalogue / variant / lifecycle](2026-06-14-asset-catalogue-variant-lifecycle-design.md),
[semantic feature anchor tags](2026-06-13-semantic-feature-anchor-tags-design.md)

## What the user asked for

> "Research vegetation builders out there. like speedtree. for trees, bushes,
> plants and flowers. everything. also rocks. do you see any open source systems
> out there we could vendor that will allow us to build good simple but reasonably
> recognizable flora to be incorporated into our connectome system so we can have
> 'realistic' 3d tree models?"

Follow-ups:
> "If better we can just copy the good parts of one or several to build something
> custom for our needs. Should be partnered with proper wikipedia MCP research and
> storage so we can get a good tree info DB too."
>
> "Consider wind effects and fire/damage/harvesting (to leave trunk?) and other
> things I am not thinking of."

Scoping answers (Q&A 2026-06-14): flora fact-DB coverage = **curated common set
(~20–40 species)**; ingestion = **hybrid (author-time seed script + runtime lazy
fill + cache)**, mirroring the `IDB → vendored → paid gen` art pipeline.

---

## Headline decision

**Build a small custom generator by taking the good parts of several projects —
do not vendor any single library whole.** No OSS project covers trees + bushes +
flowers + rocks, and the highest-fidelity tree libraries are welded to three.js,
which the bundle bans. Everything emits into the **existing `manifold-3d` CSG →
2:1 iso projection → z-buffer raster → sprite → chroma-key → register → quantize →
cache** pipeline. Flora becomes a new entity class on the **existing blueprint +
3-axis patch + anchor-tag + connectome** machinery — not a parallel system.

**three.js stance (user Q 2026-06-14): NO — do not adopt three.js to use
three-bound generators.** The bundle ban is a runtime/size constraint, but the
generators we picked (proctree, lindenmayer, etc.) are engine-free anyway; the
only thing three.js buys is ez-tree's fidelity. Adopting it (even author-time
only) **forks geometry away from the manifold → G-buffer (albedo+normal+material)
→ banded-lighting pipeline**, so flora would light/shadow inconsistently with
buildings, and we'd lose runtime + agent-parametric generation. Decision: **port
the algorithms into manifold.** Escape hatch if ez-tree's exact look is ever
wanted: export GLB offline → parse the triangle mesh into manifold (no three.js
dependency in repo/bundle) for a few hand-picked hero trees only.

**License stance (user-directed 2026-06-14): take what we can, don't gate on
licenses.** Practically this resolves cleanly along the existing plan, because the
two source classes already call for two different moves:
- **Permissive code (MIT/BSD lineage)** — proctree.js, lindenmayer, the
  grass-blade math, the flower refs → **copy the code directly.** proctree.js's
  LICENSE file 404'd but its lineage is permissive (BSD-3 C++ port + MIT glTF
  wrapper) → treat as permissive, no verification gate.
- **GPL code** — Arbaro, Blender `add_mesh_rocks`, SnappyTree, `meshgen` →
  **port the algorithm, write our own code.** Algorithms aren't copyrightable; we
  were already going to reimplement these (they're engine-bound), so this is both
  the natural build path and the clean line for a GitHub-Pages-deployed game.

---

## Part 1 — Geometry generation (researched, verified)

All license/dependency claims below were verified 3-0 against primary repo
sources in a deep-research pass (25 claims, 0 killed) plus a focused follow-up.

### Trees — vendor `proctree.js` core ✅
- **Pure JS, engine-agnostic.** Emits raw `verts / normals / UV / faces` with
  **separable trunk + twig** sets. three.js is only an *example*, not a dep.
- **License:** permissive lineage (BSD-3 C++ port + MIT glTF wrapper); JS repo
  LICENSE 404'd but treated as permissive per the license stance above — **copy
  the code directly, no gate.**
- **Integration:** trunk/branch geometry is watertight → CSG-ready. **Twigs are
  billboard alpha cards, not solids** → don't feed to CSG; replace with
  **foliage-as-clustered-solids** (displaced ellipsoid blobs at branch tips).
- Clean reference / WASM-port option: `jarikomppa/proctree` (**BSD-3, zero deps**).
- **Do not vendor:** `ez-tree` (MIT but three.js-built → GLB-export only);
  `SnappyTree` (GPLv2 — but its **JSON param output** is safe as a preset-author tool).

### Tree/shrub structure — port Space Colonization ✅
- **Runions, Lane & Prusinkiewicz (EG 2007).** Purely geometric (attraction
  points → grown node/edge skeleton), engine-independent, designer/agent-friendly
  parameters. Recommended for natural crowns and larger shrubs.
- **MIT reference to port:** `dsforza96/tree-gen` (C++, MIT; deps Voro++/Yocto =
  BSD/MIT). No JS port exists → port the math.
- Alternative = **Weber & Penn (1995)**; cleanest reference `Arbaro` is **GPL Java
  → reference only.** Space Colonization wins on license cleanliness.

### Small plants (bush / shrub / grass / flower / fern) — vendor an L-system engine + write a turtle ✅
- **No engine-free 3D small-plant mesh library exists** (all 3D = three.js-bound;
  all engine-free = 2D canvas).
- **Vendor `nylki/lindenmayer`** (**MIT, zero deps, no three.js**) — does L-system
  string rewriting only; you supply geometry. Rules can be string maps, arrow
  functions, parametric symbols, context-sensitive, stochastic → **very
  agent/LLM-friendly** (compact JSON rule-sets). Accepts a custom RNG → slot
  **sfc32** in to stay `src/sim/` Math.random-free (guard test).
- **Write a ~100–200 line 3D turtle interpreter** (standard ABoP command set:
  `F f + - & ^ \ / | [ ] ! '` + leaf/petal symbols) → tapered cylinders +
  leaf/petal quads → manifold union. Same kind of code as today's `solids.ts`.
  This is the one gap the field leaves, and it's small.
- **Per category:** bushes = bracketed stochastic L-system; **grass = port blade
  math from `CK42BB/procedural-grass-threejs`** (MIT — tapered triangle-strip
  along a quadratic Bézier, ~7 verts/blade; strip the three.js); flowers =
  phyllotaxis (golden-angle 137.5°) + parametric petal whorl (ref
  `Platane/Procedural-Flower`, MIT 2D); ferns = L-system frond via the turtle.
- **License flags:** `eobermuhlner/plant-generator` & `caiofov/...P5js` = **no
  declared license** (reference-only); `jtsiomb/meshgen` = **GPLv3** (do not vendor).

### Rocks — implement your own ✅
- **No clean vendorable JS rock generator exists.** Blender `add_mesh_rocks` =
  **GPL-2/3 Python welded to `bpy`** (subsurf + displace + texture stack) →
  reference only.
- **~50-line noise-displaced icosphere** in-house: manifold icosphere +
  multi-octave noise displacement (+ optional low-poly facet pass). Bakes great to
  small stylized sprites; zero dependency, zero license risk.

### The crux nobody hands you: skeleton → watertight mesh
Space Colonization, Weber-Penn, and proctree's clean part all output **branch
skeletons**. The **watertight tapered-cylinder meshing** that turns a skeleton
into a manifold-CSG-ready solid (generalized cylinders / per-segment capsule
unions) is **ours to build** — and it lives naturally next to today's `solids.ts`
(`solidCylinder` + `union`). This is the real engineering of the epic.

---

## Part 2 — Flora fact-DB (Wikipedia MCP)

Mirrors the building fact-catalogue → connectome pattern exactly. Proven out
live: a `Quercus robur` pull returned height/crown/bark/lifespan/range cleanly.

```
FloraSpecies  (curated ~20–40, hybrid seed + lazy-fill)
├ identity   commonName, scientificName, family, wikipediaTitle
├ botanical  habit, matureHeight_m, crownShape, leafType, leafPhenology
│            (deciduous/evergreen), trunkHabit, lifespanYears, barkTexture,
│            coppices(bool), flexibility/stiffness, flowering/fruiting windows
├ ecology    biome[], climate, soil, moisture, nativeRange[]   ← worldgen placement
├ narrative  keyFacts[] (verbatim WP), sources[]               ← LLM connectome
└ generation GenParams →  proctree preset | space-colonization envelope
                          | L-system rules | rock-noise params
```

- **Ingestion = author-time seed script** (like `seed-building-art.ts`): Wikipedia
  MCP `search → summarize_article_for_query` per field → **LLM normalizes prose**
  ("large, broad-spreading" → `matureHeight_m:{25,40}, crownShape:'rounded'`) →
  writes vendored `public/asset-library/flora-facts.json`. **Runtime lazy-fill**
  for misses → cache. Keyless players get the full seeded core.
- `botanical` **derives** `generation` params; `ecology` drives placement;
  `narrative` grounds the connectome. One entry → recognizable baked sprite **+**
  grounded narration.
- **Gotcha:** Wikipedia prose ≠ numbers → the LLM-extraction step is mandatory;
  Wikipedia is the *truth source*, not a scraper target.

---

## Part 3 — Dynamic effects (researched)

**The architectural line (sources converge):** *bake what changes the
silhouette/content; shade what only moves, recolors, or fades existing pixels.*

| Effect | Verdict | Notes |
|---|---|---|
| Wind sway | **Shader** | Vertex displace top of quad, height-scaled, base-anchored; per-instance phase from entity tile (x,y); gusts = shared scrolling wind texture sampled by world-XY. **Pixel-art gotcha: snap displacement to whole texels** (`round(off*res)/res`) or it shimmers/aliases. `flexibility` from fact-DB drives amplitude. |
| Burn glow / char | **Shader** | Emissive flicker (reuse planned PBR Slice 5 emissive) + `mix(albedo, char, burnProgress)`. |
| Burn-away consume | **Shader** | Noise dissolve (low-res NEAREST noise) + `discard`/`ALPHA_SCISSOR` for crisp edge + ember band; hands off to baked char/ash end-state. |
| Flames / smoke | **Overlay sprites/particles** | Additive draw-list items, decoupled from the flora sprite. |
| Damage states / **stump** | **Bake** (lifecycle axis) | Discrete sprite-swap (Don't Starve-style). Stump = **CSG cut of the same trunk blueprint** (boolean-cut at stump height — reuses door-aperture machinery). |
| Felling | **Hybrid** | Shader skew/rotate-about-base → swap to baked stump + leaf particles. |
| Harvest (fruit gone) | **Bake** swap + particles | Laden → bare-branch variant. |
| Autumn recolor | **Shader** tint | Per-type summer/autumn tint lerp by `state.clock` season; per-instance range → staggered turn. |
| Snow dust | **Shader** | `snow = max(0, normal.y) * amount` on existing baked normals. |
| Bare winter / heavy snow load | **Bake** variant | Silhouette change. |

**Tradeoff stated:** baking = exact art, zero shader cost, but **combinatorial
sprite explosion** (state × season × damage); shaders = low memory, continuous,
but per-frame GPU **and per-instance uniforms can break batching**. Since the Pixi
layer already draws each sprite as a unit-quad mesh, **carry per-instance state
(phase, season, burn, snow, lifecycle-tint) as vertex attributes on one shared
"flora" shader** → whole forest in one batch, each tree sways/burns independently.

**Recommended split for the codebase:**
1. **One shared flora GL shader** extending `lit-shader.ts`: vertex wind
   (pixel-snapped, world-XY phase, shared gust texture) + season tint + normal.y
   snow + burn block (emissive flicker + dissolve).
2. **Baked variants via the existing lifecycle-stage axis** (healthy/damaged/stump,
   laden/bare, summer/winter-bare/snow-laden) — foot-anchored so swaps don't jump.
3. **Overlay particles** for flames, smoke, falling leaves, debris.
4. **Canvas2D fallback** degrades: no sway (or whole-sprite jitter), static baked
   variants only, simple burn tint — same as today's "Canvas2D = unlit parity."

---

## Part 4 — Things the user didn't name (worth considering)

- **Death → decay chain mirrors the NPC `remains` pattern** (never delete,
  convert): standing dead **snag** → fallen **log** (changes collision/passability)
  → moss/mushroom → humus. Fallen logs become real terrain features.
- **Sacred / landmark belief** — core to a *god game*: belief currently attaches
  to NPCs; a tree the god touches could become a **shrine that radiates belief**
  and draws worshippers. The connectome already models belief edges → add non-NPC
  belief anchors. Arguably the most game-relevant flora behavior on the list.
- **Overharvest → ecological consequence** — deforestation shifts biome/soil →
  divine-consequence feedback loop (on-theme), like settlement pop-pressure.
- **Flowering/fruiting windows** gate *when* harvest yields food → ties to NPC
  prosperity need.
- **Growth during time-skip (D2)** — century jumps age forests deterministically
  (closed-form, like mortality `projectTurnover`).
- **Storm/lightning damage as a settlement-event type** (there are 8) — wind-felled
  trees, lightning-struck (divine!) snags.
- **Fire spread propagates cell-to-cell like belief along the social graph** —
  same pattern, new graph (spatial adjacency); dryness/season gates ignition.
- **Anchor-tag separability** (trunk / branches / canopy), like buildings'
  door/shutter/lantern parts → wind the canopy only, burn canopy-first, fell to
  trunk, drop fruit from branches. One model, many behaviors.
- **Coppicing** (`coppices:true` — willow/hazel/ash): felled → resprout → young
  again. Medieval-accurate harvest loop.

---

## Open questions

1. **Skeleton→watertight-mesh approach** — generalized cylinders vs. per-segment
   capsule unions (lean on `solids.ts`); how cheap can it stay for small sprites?
2. **Rock method** — noise-displaced icosphere vs. Voronoi chunks for small-sprite
   legibility; does it need subdivision smoothing or will low-poly displacement do?
3. **Foliage representation** — proctree blobs vs. L-system leaf quads vs. a
   billboard-canopy bake; which reads best at sprite scale and bakes cleanly?
4. **How much shares the building blueprint vs. a flora-specific blueprint?** —
   parts/features registry reuse vs. a parallel "stalk/branch/leaf/petal" vocab.

---

## Suggested slicing (brainstorm → spec → plan per workflow)

- **Slice 0 — flora blueprint + turtle/skeleton meshing core.** L-system engine
  vendored, 3D turtle, skeleton→cylinder meshing, into manifold + bake. One tree +
  one bush + one flower + one rock through the existing pipeline.
- **Slice 1 — flora fact-DB + Wikipedia seed script.** ~20–40 curated species,
  hybrid ingestion, `botanical → generation` derivation, connectome grounding.
- **Slice 2 — lifecycle/damage/season baked variants** on the existing 3-axis
  patch system (sapling→…→snag→log; healthy→stump; summer→bare→snow).
- **Slice 3 — shared flora GL shader** (wind + season tint + snow + burn).
- **Slice 4 — gameplay ties** (harvest/yields, fire spread, sacred-tree belief,
  overharvest ecology, time-skip growth).

---

## Sources (primary, verified)

Trees/algorithms: `github.com/supereggbert/proctree.js`,
`github.com/jarikomppa/proctree`, `github.com/dgreenheck/ez-tree`,
`github.com/donmccurdy/glTF-Procedural-Trees`, `github.com/supereggbert/SnappyTree`,
`algorithmicbotany.org/papers/colonization.egwnp2007.large.pdf`,
`github.com/dsforza96/tree-gen`, `arbaro.sourceforge.net`.
Small plants: `github.com/nylki/lindenmayer`, `github.com/msiric/procedural-plants`,
`github.com/CK42BB/procedural-grass-threejs`, `github.com/Platane/Procedural-Flower`,
`en.wikipedia.org/wiki/The_Algorithmic_Beauty_of_Plants`.
Rocks: `github.com/versluis/Rock-Generator`, `github.com/blender/blender-addons`.
Dynamic effects: `godotshaders.com/shader/wind-with-pixel-snapping`,
`halisavakis.com/my-take-on-shaders-grass-shader-part-i`,
`github.com/aarthificial/pixelgraphics`,
`godotshaders.com/shader/2d-dissolve-with-burn-edge`,
`gmtk.substack.com/p/how-games-do-destruction`,
`mtnphil.wordpress.com/2011/10/25/vegetation-improvements`,
`medium.com/@5argon/demystifying-sprite-atlas-variants`.
