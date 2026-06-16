# Building validity + situation awareness (brainstorm)

**Date:** 2026-06-16 · **Status:** brainstorm (user-directed) · **Builds on:**
[worldbuilding fact DB + building connectome](2026-06-14-worldbuilding-fact-database-design.md),
[settlement growth placement (SITE_RULES)](2026-06-13-settlement-growth-placement-design.md),
[shared terrain deformation channel](2026-06-15-shared-terrain-deformation-channel-spec.md),
[shrine procession connectome (alignment constraint)](2026-06-16-shrine-procession-connectome-design.md),
[semantic feature / anchor tags (affordance graph)](2026-06-13-semantic-feature-anchor-tags-design.md),
[roads / linear features (TerrainProbe)](2026-06-14-roads-linear-features-connectome-design.md)

## What the user asked (2026-06-16, rapid-fire)

> 1. "you cannot have thatched flat roofs."
> 2. "we do not have slanted roofs (1-way) at all."
> 3. "we should cap building levels by type and era tech, e.g. no 6-story early
>    medieval cottages with flat roofs."
> 4. "all buildings should be sun-aware, people always build for sun and weather."
> 5. "brainstorm other building-validity rules and how to best enforce them."
> 6. "buildings should be terrain-aware… integrate tag systems for terrains too so
>    buildings can be situated to get good views as defined by what is visible.
>    That kind of thing ties into opulence and defence structures."

These are one coherent theme: **a building must be *valid* (self-consistent and
period-plausible) and *well-situated* (oriented and sited for sun, weather,
terrain, view, and purpose).** The unifying answer is an **enforcement architecture
in two tiers** plus a **terrain affordance/tag layer** — both of which generalise
machinery that already exists in the repo.

## Code reality (what's there today)

- **Roof shapes** authored in `src/blueprint/parts/body.ts` (17 enum names) →
  collapse to **5 runtime kinds** via `ROOF_KIND` (`gable|hip|half_hip|pyramidal|
  flat`, `src/assetgen/geometry/building.ts`). **Bug confirmed:** `lean_to: 'gable'`
  (body.ts:24) — the only single-slope authoring name **renders as a symmetric
  gable**, so "we don't have slanted roofs at all" is literally true. Pitch lives
  in `ROOF_PROFILES` (`src/render/building-massing-model.ts`); `lean_to` already has
  `{pitch:0.4, fullSpan:true}` there — only the *runtime geometry* is missing.
- **Roof materials** `RoofMat = thatch|wood|tile|slate|hide|none`
  (`src/blueprint/materials.ts`); eave depth varies by material in `ROOF_OVERHANG`
  (`solids.ts`, "thatch wants deep skirts"). **No material→pitch rule exists.**
- **Levels** `{min:1,max:8}` body/wing, `{1,12}` tower — a flat numeric clamp in
  `param-schema.ts`. **No per-type or per-era cap.** Wealth `opulent` adds +1 storey
  (`descriptors.ts`).
- **Eras** `primordial|ancient|classical|medieval|current` (`src/core/era.ts`);
  `ERA_PROFILES` (`eras.ts`) carry materials + window style + glazing + vent — **no
  max-height, allowed-roof, or tech level.**
- **Constraint engine ALREADY EXISTS**: `validate<T>()` with `Constraint{id,
  severity:'error'|'warn', check, message, fix?}` in `src/catalogue/constraints.ts`
  (a test even sketches the exact `thatch-needs-pitch` rule). **This is the home for
  intrinsic validity.**
- **Siting** `SITE_RULES` + `frontageValue` gradient in `settlement-plan.ts` /
  `building-placer.ts` (doors face roads, dock-on-water). **`TerrainProbe`
  (`connectome/types.ts:79`) is a declared-but-unimplemented stub** — the planned
  terrain↔connectome seam. Nothing reads terrain for orientation/view/defence yet.

## The architecture: two tiers of enforcement

The key design question ("how best to enforce them") resolves to ***which tier* a
rule belongs in**, because validity splits cleanly by whether the rule needs the
*world*:

### Tier 1 — Intrinsic validity (no world needed; resolve-time, auto-fixing)

A building must be self-consistent *before* it is placed: thatch implies pitch,
levels fit the era's tech, a conical roof wants a square plan. These are
**declarative `Constraint`s run at resolve-time with auto-fix** (coerce to the
nearest valid value + `console.warn`), so **every resolved blueprint is valid by
construction** — never crash, always render something plausible. This matches the
existing `fitHeightUnderEave` self-check philosophy and the standing directive
*"presets should be generative, not hand-tuned"* (a rule fixes a bad combo instead
of forcing a hand-authored override).

- **Engine:** reuse `validate<T>()` (`catalogue/constraints.ts`); add a
  blueprint/connectome constraint set run inside `resolve.ts` after era+wealth+
  material patches merge, before geometry.
- **Content, not code:** rules live in the **content pack** (per era/culture), keyed
  by catalogue ids — the engine stays domain-neutral (same principle as the fact DB).
- **`fix` is mandatory for `error` severity** here (auto-correct), `warn` for
  "unusual but allowed."

### Tier 2 — Situational fitness (needs the world; siting/grammar-time, scoring)

Orientation and siting need terrain + neighbours + sun, so they run when the
building is **placed**, not when its blueprint is resolved. The blueprint carries
*preferences* (a desired orientation, a site-affordance wishlist); the **placer
satisfies them against terrain** via a multi-criteria **site-fitness score** and
writes back the chosen yaw + any foundation deformation.

- **Engine:** generalise `SITE_RULES`/`frontageValue` into a weighted **site-fitness
  function** over candidate cells; fed by the **terrain affordance layer** (below)
  and the **deformation channel** for foundations (cut-fill on slope).
- **Sun-awareness** (req 4) is the **alignment constraint** from the shrine
  brainstorm, generalised to *every* building: main living zones + their windows
  prefer the sun arc (equator-ward), service/cold rooms + blank walls to the cold
  side, the main door away from prevailing wind, deep eaves / steep pitch in wet
  climates. Resolves against `lighting-state` sun azimuth + the sky model + a
  climate field. Output: a chosen building **yaw** (the placer already has a yaw seam
  via `WallFace` + door-faces-road).
- **Terrain-awareness** (req 6): slope → foundation (cut-fill via deformation, or
  stilts, or terracing; reject if too steep), water → dock/stilt rule (exists),
  aspect → couples to sun, elevation → couples to view/defence.

## The terrain affordance / tag layer (req 6)

Today buildings query nothing about the ground's *meaning*. Introduce a
**`TerrainAffordance` layer** — the exact parallel of the building/affordance graph,
applied to terrain, and the thing `TerrainProbe.affordanceAt(x,y)` was stubbed for.
Two kinds of tags:

- **Intrinsic (derived from the heightfield + biome):** `slope`, `aspect`
  (which way it faces → sun), `elevation`, `water_adjacent`, `biome`, `flat_enough`.
- **Semantic (derived by query, the interesting part):**
  - **viewshed quality** — a visibility/line-of-sight score: *what is visible from
    here* (sea, valley, the settlement, a sacred peak). "Good views as defined by
    what is visible" = a viewshed query over the heightfield, scored by what tagged
    targets fall inside the visible set.
  - **defensibility** — high ground + natural cover (cliff-backed, river-moated) +
    **command of approaches** (chokepoints, road overlook). Feeds **defence
    structures** + the [defensive-constructions epic](../) enclosure siting.
  - **prominence** — how much the site *dominates* its surroundings (inverse
    viewshed: who can see *you*) → status sites.
  - **resource adjacency**, **sacredness** (peaks/springs → shrine siting, ties to
    the shrine brainstorm's axis-mundi alignment).

**Buildings declare a site wishlist; the placer scores and picks.** This is where
**opulence and defence** plug in (req 6):

- **Opulence** buys *prime* sites — high viewshed + prominence + sun; a manor/temple
  outbids a hovel for the spot with the sea view. (Generalises `frontageValue`.)
- **Defence** selects *defensibility* + command; a keep/watchtower wants the height
  and the chokepoint, accepts a poor view, and pulls the enclosure with it.
- A peasant hut takes leftover flat-enough ground near a road.

This is the **affordance-graph generalisation applied to terrain** — typed/tagged
nodes over the world graph — consumed by Tier-2 siting, feeding sun + view + defence
+ opulence + the shrine alignment constraint. One layer, many consumers.

## Catalogue of building-validity rules (req 5)

**Tier 1 — intrinsic (constraint engine, auto-fix at resolve):**

1. **Thatch ⇒ pitched.** `roof material = thatch ⇒ runtime roof ∉ {flat,stepped}`;
   fix: coerce flat→gable. (Generalise: any organic/shingle roof wants pitch to shed
   water; only tile/slate/stone over a tech-era may go low/flat.)
2. **Roof shape × footprint.** conical/pyramidal/onion/spire ⇒ ~square (or round)
   plan; gable/saltbox ⇒ rectangular; cross_gable ⇒ cross/L plan. Fix: coerce to the
   plan's default roof.
3. **Levels × era tech** (req 3). Per-era max storeys (e.g. primordial/ancient ≤1–2,
   classical ≤3, medieval ≤3 vernacular / taller only for stone civic+tower,
   current taller) **×** per-type cap (cottage ≤2, townhouse ≤3, tower/keep high).
   Fix: clamp `levels` to `min(typeCap, eraCap)`. (Kills the "6-storey early-medieval
   cottage.")
4. **Levels × material/structure.** Tall ⇒ load-bearing material (stone/timber
   frame), not wattle/hide; `jetty` ⇒ timber frame; tower height bounded by footprint
   (aspect ratio). Fix: clamp levels or drop jetty.
5. **Flat roof ⇒ drainage tech / arid climate.** Flat allowed only in a tech era
   (tile/slate/stone) or an arid biome; else coerce to low-pitch.
6. **Openings × wall load + era.** Window count/size bounded by wall material +
   storey (you can't punch huge holes in a wattle or defensive wall → arrow slits);
   glazing gated by `era.glazed`. (Partly modelled; formalise as constraints. Ties to
   the connectome-derived openings just shipped.)
7. **Vent × hearth × era.** smoke-egress token already; smokehole (early) vs chimney
   (medieval+). (Exists — fold into the rule set.)
8. **Structural plausibility.** Upper storey footprint ≤ lower; jetty overhang
   bounded; no inverted massing.
9. **Material × era availability.** No slate/brick before their era; no glass before
   `glazed`. (Era patch does some of this; make it a checked rule.)

**Tier 2 — situational (siting/grammar-time, scoring + deformation):**

10. **Sun orientation** (req 4) — living/windows to the sun arc, blank/service to the
    cold side, door away from prevailing wind. Climate-modulated.
11. **Weather form** — steep pitch + deep eaves in wet/snowy; low/flat in arid; small
    windows + thick walls in cold; courtyard/loggia in hot. (Couples roof pitch &
    eave & opening rules to a **climate field**.)
12. **Terrain foundation** (req 6) — cut-fill/terrace/stilt on slope (deformation
    channel); reject too-steep; no building in water unless dock/stilt.
13. **View/prominence siting** (req 6) — opulent → high viewshed + prominence + sun.
14. **Defensive siting** (req 6) — defensibility + command of approaches; pulls
    enclosure (defensive-constructions epic).
15. **Doors face circulation** — face the road/approach (exists in `SITE_RULES`).

## How to best enforce — summary

| Need | Tier | Mechanism | Status |
|---|---|---|---|
| Numeric hard bounds | — | `param-schema` min/max clamp | exists |
| Self-consistency (thatch/roof/levels/material/openings) | 1 | `validate<T>()` constraints w/ **auto-fix at resolve-time**, rules in the content pack | **engine exists, rules to add** |
| Sun / weather orientation | 2 | building carries orientation pref → placer solves vs sun azimuth + climate; writes yaw | seam exists (yaw/door-face) |
| Terrain foundation | 2 | `TerrainProbe` + deformation channel cut-fill | probe stubbed, channel built |
| View / prominence / defence siting | 2 | **terrain affordance/tag layer** → site-fitness score (generalise `frontageValue`) | new layer |

**One sentence:** intrinsic validity is *coerced* by declarative constraints at
resolve-time (always valid by construction); situational fitness is *scored* against
a terrain affordance layer at siting-time (sun, view, defence, foundation).

## Recommended slicing

- **Slice 1 — the three stated rules (Tier 1, no world).** (a) `thatch-needs-pitch`
  constraint (auto-fix flat→gable); (b) **real single-slope roof geometry** — add a
  `shed`/`mono_pitch` runtime `RoofKind` in `building.ts` and remap `lean_to`
  (+ alias) off `'gable'`, with `ROOF_PROFILES` already supplying the pitch; (c)
  **levels capped by type × era** — an `ERA_TECH` max-storey table + per-type caps,
  clamped in resolve. New geometry ⇒ golden-hash updates + `ART_RECIPE_VERSION` bump
  (v10→v11) + roof-rise/era/constraint tests. *Smallest cohesive shippable unit.*
- **Slice 2 — the constraint set + engine wiring (Tier 1 generalised).** Wire
  `validate<T>()` into `resolve.ts`; add rules 2,4–9 as pack data; make every
  resolved blueprint pass. Retire ad-hoc checks into the rule set.
- **Slice 3 — sun/weather orientation (Tier 2 minimal).** Building orientation pref
  + placer solves vs sun azimuth + a coarse climate field; verify in studio/world.
- **Slice 4 — terrain affordance/tag layer + foundation.** Implement `TerrainProbe`
  over the heightfield (slope/aspect/elevation/water) + foundation cut-fill.
- **Slice 5 — semantic terrain tags + site-fitness.** Viewshed/prominence/
  defensibility queries → weighted siting; wire opulence + defence + shrine
  alignment as consumers.

## Historical grounding — Historic England HEAG210 *Medieval Settlements*

Read 2026-06-16. Excavation evidence sharpens several of the rules above:

- **Foundation is terrain-driven (validates Tier-2 rule 12 + adds a Tier-1 rule).**
  Clayland excavations (Barton Blount, Goltho) show a real transition from
  **earth-fast posts** (timber sunk directly in holes) to a **sill beam or dwarf
  stone wall** *specifically where the ground was wet and rotting*. So the footing
  type is **a function of terrain wetness**, not just era: dry ground → earth-fast
  posts allowed; wet/clay/low ground → sill-beam or dwarf-wall footing required.
  Model as a Tier-2 siting consequence (terrain wetness → footing choice → a small
  plinth in geometry) with a Tier-1 sanity bound (earth-fast posts invalid on
  marked-wet ground).
- **House-type vocabulary (feeds the validity *type* catalogue + the fact DB):**
  **longhouse** (people one end, animals/byre the other — geographically widespread,
  cruck-built, substantial and long-lived); **cruck vs box-frame** is the major
  silhouette axis (already noted in the fact DB); **abutting / linear-terrace houses**
  (Thrislington, West Whelpington, Burton Dassett) — a row layout, not just detached;
  **courtyard farmstead** (house + farm buildings around a yard) becomes commonplace
  **only after the mid-14th century** as holdings grew → an era×wealth×acreage-gated
  *grouping*, i.e. a settlement-grammar consequence, not a single building.
- **The validity *floor* — cottager dwellings.** Documents place the poorest (widows,
  cottagers) in **small dwellings on the corner of a toft, on the village periphery,
  or on the wayside**. This is the minimum-valid building (1 bay, cheapest material,
  no upgrades) and an infill placement rule (folded into the settlement-growth epic).
- **Levels × era confirmed.** 9th–10th-c. nucleation + open central hearth + *no upper
  floor* for ordinary dwellings → the per-era storey cap (rule 3) is historically
  right: early-medieval vernacular is single-storey; height is the elite/stone/tower
  exception.

## Decisions taken

1. **Two-tier enforcement.** Intrinsic validity = auto-fixing constraints at
   resolve-time; situational fitness = scored siting at placement-time.
2. **Reuse the existing constraint engine** (`validate<T>()`) for Tier 1; rules are
   **content-pack data**, engine stays domain-neutral.
3. **Auto-fix, don't crash.** Invalid intrinsic combos coerce to the nearest valid
   value + warn (generative-by-construction).
4. **Terrain affordance/tag layer** is the `TerrainProbe` realisation — one layer
   feeding sun, view, prominence, defence, foundation, and shrine alignment.
5. **Sun-awareness = the generalised alignment constraint** (shared with shrines).
6. **Slice 1 = the three stated rules**, then generalise outward.
