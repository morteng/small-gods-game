# Realistic rivers & streams — design (brooks, waterfalls, dams, rocks)

**Status:** design · 2026-07-05 · feeds a future round plan (WCV bump — gen output changes)
**Problem statement (user):** rivers/streams "look like a brush has been drawn in squiggles over the
map to paint them." Wanted: realistic streams and rivers, brooks and small waterfalls where
possible, perhaps beaver dams; rocks IN rivers; and all rocks sunk slightly into the ground with
the ground-blend treatment.

Grounded in a full pipeline audit (2 code explorations) + an online research pass (geomorphology
numbers + game techniques, cross-verified). Precedent: the roads epic got visibly better by
adopting real technique (grade envelopes, fillet raster) — same play here.

---

## 1. Why rivers look painted — root causes (code audit)

The pipeline is: `generateHydrology` (pit-fill → D4 steepest-descent → flow accumulation →
threshold, `terrain/hydrology.ts`) → water connectome (`terrain/river-network.ts`: reaches classed
`brook|stream|river|major_river` by Strahler ∨ flow buckets) → centerline smoothing → tile
disc-stamp + carve (`world/river-deformation.ts`) + SDF render (`render/gpu/river-channel-geometry.ts`,
`water-wgsl.ts`). Width is already continuous (W ∝ √Q per vertex); the render silhouette is
sub-tile SDF, not tiles. The problems are upstream of rendering:

1. **A terrain-blind injected sine meander.** `smoothCenterline` (`river-network.ts:341`) runs
   Chaikin ×2, then `meanderPolyline` (`:220`) displaces every reach by a Kinoshita-flavoured sine
   (amp ≤ 2.8 tiles, wavelength ~`24·halfWidth`) **regardless of slope or valley form**. Real
   rivers meander on LOW-gradient floodplains and run straight/braided on steep gradient
   (Leopold & Wolman 1957: the meander/braid threshold slope S꜀ ∝ Q^−0.44). Also the injected
   wavelength is too short: real λ ≈ 10–14 channel widths (at 1 tile = 2 m, a 2–3 tile river wants
   λ ≈ 22–33 tiles), radius of curvature ≥ 2.5 widths. Short-λ, uniform wiggle = "painted squiggle."
2. **The D4 staircase under the smoothing.** `drainTo` (`hydrology.ts:259`) is 4-neighbour
   steepest-descent, so diagonals arrive as 90° staircases that Chaikin rounds into arcs
   disconnected from the actual valley line.
3. **No gradient response at all.** Every reach gets the same smooth-ramp water surface
   (`river-surface-field.ts` just smooths downstream ×2 passes); the only slope response in the
   whole engine is cosmetic shader foam (`water-wgsl.ts:654` — steeper = faster streaks + more
   white). No waterfalls, no rapids, no pools, no steps. Grep confirms zero occurrences of
   waterfall/weir/dam/beaver as features.
4. **Uniform ribbon profile.** Per-class constant carve depth (`REACH_CARVE`, brook 1.0 m …
   major 6.5 m) + disc-stamp width means a flat lowland brook and a steep mountain stream have
   the same character; valleys don't *fit* their rivers (the carve is stamped through terrain).

## 2. Why there are no rocks in rivers — it's a bug

`riparian-scatter.ts` **already places** `granite-boulder`s in the shallow river margin
(`WATER_BOULDER_DENSITY = 0.07` + flow bonus) and cobbles/boulders on the banks. But
`clearObstructedVegetation` (`world/vegetation-clear.ts:156`, run LAST in `map-generator.ts:657`)
deletes every `vegetation`-category entity within `UNDERGROWTH_CLEAR_RADIUS = 1.2` tiles of any
`river` tile — and all rocks are category `vegetation` (a render-routing choice,
`entity-kinds.ts:62`). It erases exactly the boulders placed for the river. Lakes use tile types
`water`/`shallow_water` which `isRoadOrRiver` doesn't match, so lake rocks survive. **Two passes
in direct conflict; the eraser wins because it runs last.**

## 3. Rocks sit ON the ground, never IN it

`terrain-lift.ts` lifts every prop foot to sit exactly on the surface; no sink/embed offset exists
anywhere. No ground-texture blend exists under any entity either (the only "blend" vocabulary
today: settle-in pads = heightfield carve with feather (`settlement-deformation.ts`,
`SETTLE_DEPTH_M = 0.12`, `PAD_FEATHER_TILES = 2.5`), and tile-type swaps (trample→dirt,
POI ground patches)). The flora gap-analysis doc (2026-07-04, §G7) already proposes `partialBury`
(sink 10–20% below grade + settle-in pad) + strata banding + moss caps — unimplemented.

---

## 4. Design

### R1 — Gradient-aware meanders (kills the squiggle) — ~2 days

Replace the uniform sine with geomorphology-driven planform, per reach:

- Compute per-reach **valley slope** S_v along the raw centerline (bed elevation is already
  sampled for `vertexFill`).
- **Meander/straight gate:** threshold slope S꜀ = k·Q^−0.44 (flow-accum as Q proxy; calibrate k on
  the 24 probe seeds). Above threshold → NO injected meander (Chaikin-smoothed line only —
  steep streams run straight). Below → meander.
- **Meander sizing from science, not vibes:** target sinuosity K = S_v / S_channel clamped
  [1.05, 2.5]; wavelength λ = ~11 × full channel width (NOT `24·halfWidth` ≈ 5–6 widths as today);
  amplitude from A/λ ≈ 0.9743·ln K + 0.0803; radius-of-curvature floor 2.5 widths. Keep the
  Kinoshita third-harmonic skew (already there) — it's the right curve family, just mis-driven.
- **Confinement clamp:** if the flat valley floor is narrower than the meander belt (probe
  perpendicular height rise), clamp amplitude down — rivers pinned in gorges don't wander.

Files: `river-network.ts` (`reachMeander`, `smoothCenterline`) + a small per-reach slope helper.
Deterministic (same hash-seeded phase). Everything downstream (tiles/carve/SDF/mask) consumes
centerlines unchanged. This is the highest leverage-per-line worldgen change.

> **SHIPPED 2026-07-05 (WCV 86).** Done as written, with two corrections from building it:
> - **Slope source:** `reachValleySlope` reads the `hydro.surfaceW` water-surface raster (already
>   on every reach cell) rather than re-sampling bed elevation — same gradient, no new plumbing. A
>   second centerline pass runs it once the per-world reference flow (√Q width) is known.
> - **Sinuosity ratio was inverted in the spec.** `K = S_v / S_channel` makes *steep* reaches the
>   curvy ones. Shipped as `K = clamp(S꜀ / S_v, 1.05, 2.5)` — flatter valley ⇒ curvier, which is
>   what "steep runs straight, lowland wanders" actually requires.
> - `MEANDER_SLOPE_K = 0.16` calibrated on 6 probe seeds (median ~59 % of reaches meander,
>   38–100 % by terrain relief; K p50 1.3–2.3, p90 pinned at the 2.5 ceiling).
> - **Confinement clamp DEFERRED** (its own follow-up): it needs a perpendicular land-elevation
>   probe, but `buildWaterNetwork` only receives `hydro` (surfaceW is water-only, −1 on land).
>   Threading a heightfield through all three call sites (map-generator / river-deformation /
>   water-network-store) risks breaking the centerline agreement they currently share.
> - **Downstream coupling the spec missed — "everything consumes centerlines unchanged" is FALSE.**
>   Bridge deck **seating** and croft **gate derivation** are position-sensitive: moving a channel
>   under a crossing put a deck abutment in open water / a road across a gateless wall (3 `lint:world`
>   errors on seed 12345 with a 9-tile cap). Two guards fix it without touching those passes:
>   (a) a reach shorter than one wavelength runs straight (`MEANDER_MIN_LEN_WAVELENGTHS = 1` — short
>   connector reaches are where crossings sit); (b) amplitude capped at `min(3·fullW, **2.75 tiles**)`,
>   the historically-safe belt band (pre-R1 was 2.8). Kept conservative because the live game rolls
>   random gen seeds the 2-seed lint can't all cover — a barely-passing edge value would break unseen
>   seeds. **Unlocking bigger belts is a follow-up:** confinement clamp + making bridge-seating /
>   croft-gate derivation adapt to a meandered (angled/wider) crossing.

*Later upgrade (own slice, only if meander HISTORY wanted as narrative terrain):* Paris et al.
SIGGRAPH Asia 2023 kinematic migration (MIT code, runs at our grid size, terrain-gradient falloff
makes it confinement-aware for free, oxbow cutoffs at 1×W) — ~800 LOC port, 3–5 days.

### R2 — Reach types + steps, pools & waterfalls (the big read) — ~4 days

Adopt the Montgomery–Buffington slope classification per reach segment (this is the "Procedural
Riverscapes" (Peytavie et al. 2019) recipe — the published blueprint for exactly our gap):

| Gradient | Type | Treatment |
|---|---|---|
| < 1% | pool-riffle | today's smooth ramp + riffle scoring (R4) |
| 1–3% | plane-bed | today's smooth ramp (already correct!) |
| 3–8% | step-pool | discrete bed steps every 1–4 widths, H ≈ 0.2–0.4 m |
| 8–26% | cascade | dense boulder chaos + near-continuous whitewater |
| local drop > ~2 m over 1–2 tiles | **waterfall** | vertical face + plunge pool |

Mechanism — **per-pool flat water** (the load-bearing trick; Dwarf Fortress gets waterfalls
"free" from z-quantization, Tiny Glade reads the same way):

- In `river-surface-field.ts`, stop smoothing the fill into one continuous ramp on steep reaches:
  quantize the water surface into **pool levels joined by discrete drops** at step/fall sites.
  Each pool is planar; the drop is the absence of a ramp.
- Bed side: steps carve via the existing deformation channel (a `carve` below the step, the step
  lip stays); plunge pools carve 0.5–1× fall height deep, 1–3 tiles wide.
- Render: at each drop ≥ ~1.5 m, a vertical water face + foam band at lip and base (the SDF
  already knows the segment; the shader's existing `drop` term extends to a real discontinuity).
  Small steps (< 1 m) need no face — just the foam + the surface break.
- Waterfall siting is **emergent**: wherever the profile demands it (steep slope crossing), which
  answers "small waterfalls where possible." Brooks in hills become step-pool chains; a river off
  a plateau edge becomes a proper fall.

### R3 — Honest ponds + beaver dams — ~2–3 days after R2

- **Stop erasing depressions.** Swap pit-fill for selective **breaching** (Lindsay) or keep
  priority-flood but route the flow *through* depressions using **Fill-Spill-Merge**
  (Barnes 2020, open C++ reference, O(N log N), sub-ms at our size): depressions fill to their
  spill elevation and become flat-surfaced ponds/tarns with a real outlet where the river resumes.
  Today `LAKE_MIN_FILL` only rescues deep basins; small hollows that should be ponds are erased.
- **Beaver dams = a crest-clamp weir** (Timberborn's model — no runtime water sim needed): a dam
  is a segment whose spill elevation is clamped to a crest; the pond upstream falls out of
  fill-to-spill. Siting rule from beaver science: narrow valley cross-section (perpendicular probe
  until ground rises N m) on a **moderate-flow reach (brook/stream, never trunk)** near wood
  (forest density). Renders as a stick/mud bar prop (parametric prop pipeline, grey-massing-safe)
  + still pond + trickle-over foam. Optional: make dams a *live* element (Fate/sim can add or
  breach one — flood event downstream) since they're just a deformation + network edit.

### R4 — Rocks in rivers + wakes — ~1 day

- **Fix the eraser conflict** (the actual bug): `clearObstructedVegetation` must not delete what
  `riparian-scatter` placed. Cleanest: run riparian scatter AFTER the clear pass, or tag
  riparian entities (`waterPlaced`) and exempt them; the clear's purpose (no trees blocking
  road/river corridors) stays intact for everything else.
- **Riffle-scored placement** (upgrade from uniform margin scatter): score river cells by
  slope × flow ÷ depth; boulders cluster on riffles/constrictions and in cascade reaches (chaos),
  never in pools — matches river science (River Builder) and reads immediately right. Size ∝
  width; bias to banks and step lips.
- **Wakes:** foam already scales with the shader's flow streaks; seed extra foam where a boulder
  overlaps the channel (rock-local SDF term → V-wake smeared downstream by the advected noise —
  a few lines once R6's foam band exists).

> **Reality check 2026-07-05 (shipped R4 placement, deferred wakes):** the eraser fix
> (`waterPlaced` tag) and riffle-scored placement landed (`riparian-scatter.ts`:
> `slope × flow^~0.6` via `waterSurfaceSlope`, calibrated `RIFFLE_REF_SLOPE 0.012` on the
> 24-seed placement domain — ~85% of in-water boulders now sit on the top ~25% steepest cells;
> pools clear). **Wakes turned out NOT to be "a few lines":** the water pass (`water-wgsl.ts`)
> is a purely analytic channel SDF with no awareness of scattered rock entities — foam keys only
> to the SDF + depth. A rock-local wake needs boulder positions fed INTO the water shader (a
> rock-SDF texture or per-instance channel), which is a genuine render-pipeline addition, not a
> shader-local edit. Deferred to its own slice (bundle with R6-style water work). Constrictions
> and bank-bar riffle-biasing also deferred (width is near-constant on current worlds, so
> constriction detection has little signal; bank rocks stay uniform for now).

### R5 — Rocks seated in the ground (all rocks, everywhere) — ~1 day

Two halves, both reusing round-6/7 vocabulary (matches flora doc §G7 `partialBury`):

- **Geometry sink:** rocks get a per-instance bury fraction (10–20% of height, seeded) applied as
  a negative foot offset in the draw-item lift (a `buryPx` alongside `footLift` in
  `terrain-lift.ts` + the iso lifted-projection path) — the sprite sinks below the surface line;
  the baked silhouette needs no change (bottom rows clip under terrain via the existing per-pixel
  terrain clip). Trees likely want a tiny version of this too (root flare), separate knob.
- **Ground blend:** a small settle-in ring — for big boulders (≥ ~1.5 m) a mini settle pad
  (`settlement-deformation.ts` machinery: level-to-mean, tight feather ~0.75 tile) so ground
  meets the rock; for small rocks (field-stone, pebbles) skip the heightfield and use the
  terrain-detail patch that already instances finer mesh around deformation footprints. A subtle
  albedo darkening/wetness ring at the contact line can ride the same SDF the settle pad defines
  (cheap shader term, same trick as doorstep wear).

### R6 — Water render polish (independent, biggest visual delta per line) — ~2 days

1. **Bank edge fade + wet band:** fade water alpha and boost foam as channel-SDF → 0; darken
   terrain albedo in a thin band outside the waterline. Kills the hard vector-cutout edge — the
   single biggest "painted" tell. The signed distance already exists on both sides.
2. **Valve dual-phase flow advection:** two noise layers advected along the flow tangent, phase
   offset ½ cycle, cross-faded (Vlachos SIGGRAPH 2010) — water visibly *moves* downstream and
   bends around meanders. ~0.5 day of WGSL on the existing flow vectors.
3. **One foam signal:** `foam = smoothstep(band→0, min(edgeSDF, rockSDF, dropSDF))` thresholded
   against the advected noise — banks, rocks, step lips and fall bases all foam from one term.

---

## 5. Adoption order & scope

| Slice | What | Cost | Visual payoff |
|---|---|---|---|
| 1 | R6 render polish (edge fade, flow advection, foam) | ~2 d | huge, zero gen risk (no WCV) |
| 2 | R4 rock eraser fix + riffle scatter | ~1 d | rocks in rivers (WCV bump) |
| 3 | R5 rock bury + ground blend | ~1 d | everything seated |
| 4 | R1 gradient-aware meanders | ~2 d | squiggle gone (WCV bump) |
| 5 | R2 reach types, steps, pools, waterfalls | ~4 d | brooks/falls/rapids |
| 6 | R3 fill-spill-merge ponds + beaver dams | ~2–3 d | ponds, dams, floods lever |

Escalation path if valleys still read carved after R1/R2: Génevaux §6.2 valley cross-profile
(valley walls blend toward `river_z + λ·d`), then a short Braun–Willett stream-power erosion pass
(~300 LOC, <1 s at our grid) — both deferred, not needed for the ask.
Ruled out by research: pure network→elevation (documented failure at hobby scale), runtime water
CA for static ponding (overkill), full particle hydrology (fights seed-proof anchoring).

## 6. Constraints & gotchas to honour

- **Determinism:** all of it stays seeded (sfc32); Paris-style migration and FSM are deterministic
  ports. No `Math.random` in `src/sim/`/gen paths (guard test).
- **Hydrology runs twice** (map-generator + hydrology-store) and must stay byte-identical — any
  change lands in `generateHydrology`/network code shared by BOTH callers; the zero-temperature
  second call is inert (only `elevation` is read) but threshold/scorch parity is load-bearing.
- **Deformation channel is the only terrain writer** (steps, plunge pools, dam crests, settle
  pads all = `Deformation` producers). Any post-gen `tile.type` write → `bumpTilesRev(map)`.
- **WCV bump** for every gen-output slice (2–6) + pin-test update in the same commit.
- **Freeze-safe art:** dams/rocks ride the parametric prop pipeline (grey massing OK, no paid gen).
- Probe changed seeds via `scripts/probe-world.ts` / `npm run lint:world` (≥2 genSeeds); goldens
  (`river-channel-geometry`, crossings, water-s1) will need re-pins on slices 4–6.

## 7. Water sites in the connectome — DECIDED (user, 2026-07-05)

**Yes: waterfalls, ponds, and kin become connectome site nodes**, following the
crossing-structures / site-connectome pattern ([[project-establishments-site-connectome]]):

- **`waterfall` node** (from R2 sites): carries fall height, reach class, pool extent. Affordance
  seats: **mill** (water power — establishment), **shrine seat** ("the shrine by the falls" is
  exactly this game's flavour), viewpoint/procession anchor. Fate/storylets can reference it by
  node id; roads/bridges route around or to it.
- **`pond` node** (from R3 fill-spill-merge; subtype natural | beaver | weir): carries area,
  depth, inlet/outlet. Affordance seats: **fishing** — a `fishery` affordance scored by
  area/flow, realizing as a fisherman's hut + jetty + drying racks (prop pipeline, grey-safe);
  washing/watering spots; reed/waterfowl scatter for the read.
- **`fishing_pond`** is thus not a separate generator — it's a pond node whose fishery affordance
  won a seat (same siteSelect vocabulary as other establishments). NPC fishing as an activity
  hooks in later via the existing activity FSM + needs (prosperity/food) — do NOT block the
  worldgen slices on sim work.
- **Beaver dams:** start gen-time (part of R3); the node structure deliberately supports a later
  live element (dam appears/breaches over time — a Fate lever + downstream flood event).

Still open (fine to defer):
- Braided reaches (steep + high flow): split channels vs. straight single channel + gravel-bar
  tint? (Leave for later; straight is already correct per the science.)

## 8. Sources (key)

Leopold & Wolman 1957/1960 (meander/braid threshold, λ≈11W) · Langbein & Leopold 1966 / USDA-ARS
(K = S_v/S_c, Kinoshita design curve) · Montgomery & Buffington 1997 (reach types by slope) ·
Peytavie et al. 2019 "Procedural Riverscapes" (per-pool flat water + slope-classed reaches) ·
Barnes et al. 2020 Fill-Spill-Merge · Génevaux et al. 2013 (valley profiles) · Paris et al. 2023
"Authoring and Simulating Meandering Rivers" (MIT code) · Vlachos SIGGRAPH 2010 (flow maps) ·
Braun & Willett 2013 / Cordonnier 2016 (stream power) · Timberborn water deep-dive (crest-clamp
dams) · Scheingross & Lamb 2017 (plunge pools). Full annotated list with links in the research
transcript; reference code (Paris et al. meander sim) archived in session scratchpad.
