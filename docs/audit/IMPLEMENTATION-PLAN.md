# Implementation Plan — Believability Round (2026-08-10)

Sources: the four audits in `docs/audit/` (their **"Verification pass (independent re-read,
2026-08-10)"** sections are authoritative), re-verified against source in this session, plus
**new empirical probes run for this plan** (see §1.2 — they materially change the mill fix).

Planning only. Nothing here is implemented.

---

## 1. Verification results (everything re-checked against source)

### 1.1 The audit "confirmed" list — all confirmed, with one line-level correction

| Claim | Verdict | Evidence |
|---|---|---|
| Waterwheel vertical is a constant | **CONFIRMED** | `src/blueprint/parts/structural.ts:124` `cz = radius - submerge`; comment at `:121-123` states the z=0 == ground == waterline assumption. `src/blueprint/presets/index.ts:362` `submerge: 0.38`. |
| `waterSurfaceAt` has zero production callers | **CONFIRMED** | `src/render/gpu/water-field.ts:892`; callers = its docstring, `src/dev/debug-api.ts:309`, `tests/unit/water-surface-at.test.ts`. |
| Mill seats on dry bank; channel incised below it | **CONFIRMED** | `src/world/mill-site-store.ts:85` (bank must be render-dry), `src/world/river-deformation.ts:35-40` (`REACH_CARVE` 1.0–6.5 m). But see §1.2 — the *drawn* surface is bank-referenced (`SURFACE_INSET_M = 0.5`, `src/render/gpu/river-surface-field.ts:37`), so the real gap is NOT the carve depth. |
| Barriers invisible to vegetation passes | **CONFIRMED** | `src/world/place-barrier.ts:105-112` tags `['barrier','obstacle','settlement']`, no `'building'`; `src/world/building-collision.ts:36-42` `isBuilding` = category `'building'` or that tag; `src/world/vegetation-clear.ts:226-228` and `src/world/vegetation-fill.ts:144-145` both gate on `isBuilding`. Bonus (makes the fix cheap): `EntityRegistry.indexEntity` (`src/world/entity-registry.ts:261-264`) indexes `footprintCells` per-cell, so `getAtTile` already returns the barrier run on every blocking cell — only the predicate is wrong. |
| Gate siting: one gate per bearing, arc-only dedup | **CONFIRMED** | `src/world/enclosure.ts:1033-1057` `commitDirectionGates`, `:1060-1071` `dedupeGatesBySpacing`, `minSep = max(gateW*1.5, 3)`. `roadCross` seeding + direction-gate dedup against it at `:653-657` exactly as the gate audit's verification note re-scoped it. |
| Wards are decorative | **CONFIRMED** | `src/world/building-placer.ts` — "ward" appears only in comments (`:438`, `:502`); no `plan.wards` read. |
| No party walls | **CONFIRMED** | `margin: 1` in the placement constraint (`building-placer.ts:696`), enforced in `canPlaceIgnoringNature` (`:402-405`); zero hits for party/terrace/shared-wall row logic in `src/world/` + `src/sim/`. |
| Silent unknown-POI-type fallback | **CONFIRMED** | `src/core/types.ts:193` `type: string`; `src/map/poi-zones.ts:156-166` `getZoneRule` returns `buildings: []`, `{min:0,max:0}` for unknown types, no warning. |
| Spiral-scatter POI types | **CONFIRMED** | `POI_ZONE_RULES` has exactly ten types; `temple`, `mine`, `tavern`, `tower`, `ruins` carry `internalRoads: false`; `port` has `true`. |
| Contract system is live | **CONFIRMED** | `registerContract` calls in `src/world/connectome/wall-contracts.ts:145-148` (+ road/scaling/defense); `src/map/map-generator.ts` imports wall-contracts; `settlementRingContracts` (`wall-contracts.ts:164`) is the declaration seam. New invariants belong here. |

Correction: the "dead" list is also confirmed dead — in particular `roadCross` **is** deduped
against direction gates (`enclosure.ts:653-657`); only roadCross-vs-roadCross is unchecked, and
those entries are **mandatory** openings (a road physically crosses there), so "deduping" them
away would put a road on a blocking cell. See WP-3 for how this is handled.

### 1.2 NEW empirical findings (probes run for this plan; scripts in the session scratchpad)

A headless probe (worldgen via `planWorldLayout` + `generateWithNoise`, heights via
`heightField`, water via `waterSurfaceAt`) on the default world:

1. **Both placed mills on the pinned world (genSeed 12345) sit on "dry-fringe" sites.** The
   wheel-face cell that `computeMillSites` accepted as `WaterType.River` is a render-**mask**
   cell whose centre **clips dry** in `waterSurfaceAt` (the mask includes the ribbon fringe;
   the drawn waterline is sub-cell). Actual wet water starts 1–3 tiles away laterally.
   - `khar_ordu_civic_mill` @(291,112): foot 25.6 m, nearest wet surface ≈ 23.5 m → **gap ≈ 2.1 m ≈ 42 px** (at ~20 px/m), wet water 3 tiles north.
   - `oakshire_civic_mill` @(234,168): foot 27.8 m, wet surface ≈ 26.0 m → **gap ≈ 1.8 m ≈ 36 px**, wet water 3 tiles south.
2. **Site census** — of all tagged mill sites, only a minority are genuinely wet-adjacent, but
   there are plenty of them: genSeed 12345 → 209 wet of 783; genSeed 777 → 139 of 1019.
3. **On wet-adjacent sites the vertical gap is small**: foot−surface median 0.33–0.45 m,
   p75 0.6–0.8 m, max 2.2–3.1 m (both seeds). A small negative tail exists (foot *below*
   surface, min −2.05 m) — those are flood-risk sites and must also be filtered.

Consequences: (a) the mill symptom is **two** defects — lateral (dry-fringe seating) and
vertical (constant submerge) — and the audits saw only the vertical one; (b) the verification
note's "≈48–90 px above water" (full `REACH_CARVE` depth) **overestimates**: the drawn surface
is bank-referenced (`SURFACE_INSET_M`), so on wet sites the residual is sub-metre; (c) terrain
surgery is NOT needed — filtering to wet sites + a per-site submerge spans the whole observed
range.

### 1.3 Facts that shape the mill fix (verified this session)

- **The watermill is served by stale painted art.** `watermill` is one of the 46 `preset`
  entries in `public/asset-library/building-sprites/manifest.json`; the vendored library is
  stale at v31, so it renders via the bare-preset fallback
  (`src/render/generated-building-art-source.ts:251-256`, tagged `preset-fallback`). **Any
  blueprint/param change to the mill is invisible until that fallback is bypassed for it.**
- **Per-site params are cheap and already supported.** `synthesizeBlueprint(name, patches, seed)`
  (`src/blueprint/presets/index.ts:734`) accepts `BlueprintPatch.parts[..].params`
  (`src/blueprint/types.ts:67-79`); the parametric sprite cache is content-addressed over the
  compose spec with `ART_RECIPE_VERSION` baked in (`src/render/parametric-sprite-cache.ts:123-131`)
  — "any spec/param change simply misses". A per-site `submerge` patch therefore gets its own
  cached sprite with **no recipe bump**.
- **Below-grade sprite geometry is visible, not buried** (`src/render/CLAUDE.md`; the v36
  content-version log records a below-grade "foundation skirt" tried and REVERTED). For the
  wheel this is exactly what we want — the wheel flank is rotated toward the water at placement
  (`wheelOrientationForFace`, `building-placer.ts:613`), so below-foot pixels overpaint the
  carved bank slope on the water side only.
- Versions: `ART_RECIPE_VERSION = 'v37'`, `WORLD_CONTENT_VERSION = 119`, `SAVE_VERSION = 4`;
  all pinned in `tests/unit/content-version.test.ts` (same-commit rule). Precedent v115: several
  worldgen believability fixes bundled under ONE `WORLD_CONTENT_VERSION` bump.

---

## 2. Work packages

Version-bump rule for the whole round: **no WP touches `src/core/content-version.ts` or
`tests/unit/content-version.test.ts`.** WPs 1–3 change worldgen output; the integrator lands ONE
`WORLD_CONTENT_VERSION` 119→120 bump (+ test pin, same commit, v115-style bundled changelog)
after the wave merges. No WP needs `SAVE_VERSION` (no schema change) or `ART_RECIPE_VERSION`
(no preset geometry change in wave 1).

### WP-1 — Mill wheel reaches the water (lateral + vertical)

- **Goal**: the user-visible defect — "waterwheel not in the river, far too high above water."
  After this WP a mill only seats where the wheel-face cell is *drawn* wet, and the wheel's
  lower arc meets the drawn surface at that site.
- **Files touched** (complete list):
  - `src/world/mill-site-store.ts` — site filter + new `gapM` field
  - `src/world/building-placer.ts` — per-site submerge patch in the civic-mill branch (~`:600-630`)
  - `src/world/settlement-plan.ts` — thread `gapM` through the mill hint type (`MillPlacement`
    hints) so the placer sees it (type-level; verify whether the hint type lives here or in
    building-placer and touch only where it does)
  - `src/render/generated-building-art-source.ts` — preset-fallback denylist (`:251-256`)
  - `src/world/connectome/site-contracts.ts` — NEW: `mill.wheel-reaches-water` contract
  - `src/map/map-generator.ts` — ONE side-effect import line for site-contracts
  - `scripts/probe-mill-gap.ts` — NEW: commit the session probe (adapted) as a permanent probe
  - Tests: NEW `tests/unit/mill-wheel-water.test.ts`; check `tests/unit/place-settlement.test.ts`
    (map-less path unaffected — mills only place with a map) and `tests/unit/settlement-plan.test.ts`
    for mill pins.
- **Approach** (three parts, all deterministic, no RNG):
  1. **Wet-site filter** (`computeMillSites`): in addition to the render-type check, require
     `waterSurfaceAt(map, nx, ny).wet` on the wheel-face cell, and compute
     `gapM = footZ − surfaceZ` (curved `heightField` × relief, bank cell max vs wet-cell
     surface). Reject `gapM < 0` (flood risk) and `gapM > ~1.5 m` (wheel can't plausibly reach);
     store `gapM` on `MillSite`. §1.2 shows 139–209 candidates per world survive, gaps mostly
     ≤ 0.8 m. A settlement with no surviving site in `radius + 12` gets **no mill** — the
     existing flush-or-nothing philosophy (`mill-site-store.ts` header), logged.
  2. **Per-site submerge** (building-placer civic loop): pass
     `[{ parts: { wheel: { params: { submerge: q } } } }]` to `synthesizeBlueprint('watermill', …)`,
     where `q = (site.gapM + RIM_DIP_M) / METRES_PER_PRIM_Z`, quantized to 0.05 steps (bounds
     sprite-cache variants to ~30 across all worlds). `METRES_PER_PRIM_Z` must be **calibrated
     empirically** (offline `building-preview.ts` render, measure px — the paramSchema docs
     disagree on units: radius "metres" vs submerge "tiles"). Keep the preset default 0.38
     untouched (no ART bump).
  3. **Make it visible**: skip the bare-preset fallback for `watermill` (a small denylist beside
     `generated-building-art-source.ts:251` with a comment naming this WP) so the patched mill
     renders through the parametric source (textured K0d, not grey) instead of the v31 painted
     sprite composed for the old geometry. No paid regeneration (spend is frozen).
  4. **Contract**: `mill.wheel-reaches-water` (`kind:'requirement'`, `severity:'warn'`), world-level
     scan of entities with `properties.civic === 'mill'`: wheel-face-adjacent cell wet AND
     `gapM − submerge·METRES_PER_PRIM_Z ≤ 0`. Register following the scaling-contracts pattern;
     `lint:world` then pins the invariant.
- **Tests**: new unit test with a stub map (the `water-surface-at.test.ts` fixture pattern):
  (a) a mask-River-but-dry-centre neighbour does NOT tag a site; (b) a wet neighbour does, with
  correct `gapM`; (c) negative/oversized gaps rejected; (d) submerge quantization is stable;
  (e) the contract flags a mill whose wheel misses the water. Update any settlement test that
  pins mill presence on fixtures whose sites become dry-fringe.
- **Version bumps**: rides the shared WCV 120 bump (mill positions/specs shift → old saves must
  regenerate to shed high-and-dry mills). NO `SAVE_VERSION`. NO `ART_RECIPE_VERSION` (patch-only;
  cache keys shift with the spec). `tests/unit/assetgen-golden.test.ts` holds (goldens are
  cottage + stone box).
- **Risk**: some settlements lose their mill (correct per flush-or-nothing; verify counts don't
  collapse — probe both seeds, expect ≥1 mill on the pinned world; if the pinned world's two
  settlements end up mill-less, widen the gap ceiling before widening anything else).
  Determinism: pure function of memoised fields — safe. Sprite variants: bounded by quantization.
  Watch `reconcileBuildingsWithWater` (tile-type based) — wet-adjacent seating stays on dry bank
  cells so it should not nudge; add a probe assertion.
- **Size**: multi-day (1–2 days including calibration + eyeball round).
- **Model tier**: **opus** (elevation/units/determinism reasoning; the calibration is subtle).

#### The user's two mill options — evaluation (asked for explicitly)

- **Option A — "lower the building and terrain"**: a pad/notch deformation stepping the mill
  down toward the waterline. Rejected as the primary fix: it is heavier (a new deformation
  producer + door-grade access back up to the street + flood-dynamics interplay), it does NOT
  fix the lateral dry-fringe defect (§1.2 — the dominant failure on the pinned world), and the
  measured residual on wet sites (median ≤ 0.5 m) doesn't justify terrain surgery.
- **Option B — "taller building, entrance at bank top, wheel reaches the water"**: recommended,
  refined into WP-1 above (per-site wheel drop rather than a fixed taller preset, because
  measured gaps vary 0–1.5 m after filtering; a single authored depth either floats on some
  sites or buries on others).
- **Verifying the claim "taller building needs no worldgen determinism change and no save bump"**:
  *Partially true.* A **pure preset-only** change (fixed deeper wheel/undercroft, no placement
  change) indeed needs no WCV/save bump — but it DOES need an `ART_RECIPE_VERSION` bump (compose
  output changes for the same spec; v30 precedent), it is **masked by the v31 preset-fallback**
  until that is bypassed, and it cannot fit the measured per-site variance. The recommended
  variant avoids the ART bump (patch-only) and needs no `SAVE_VERSION`, but **does** change
  worldgen output (site filter + per-entity spec) and therefore rides the shared
  `WORLD_CONTENT_VERSION` bump. There is no variant that both fixes the observed defect and
  ships with zero bumps.
- Optional **phase 2** (defer, pending eyeball): a stone wheel-pit/undercroft face descending
  with the wheel on the water flank — preset geometry ⇒ ART bump + golden re-pin; do it only if
  the bare wheel over the bank slope reads poorly in the render.

### WP-2 — Vegetation clears walls and towers

- **Goal**: trees/undergrowth no longer stand inside wall/tower footprints, and ground cover is
  no longer re-sown over them.
- **Files touched**: `src/world/building-collision.ts`, `src/world/vegetation-clear.ts`,
  `src/world/vegetation-fill.ts`, `tests/unit/vegetation-clear.test.ts` (+ new cases; add
  fill-pass cases there or a new `tests/unit/vegetation-fill-barrier.test.ts`).
- **Approach**:
  1. Add `isBarrier(e: Entity): boolean` to `building-collision.ts` — `e.tags?.includes('barrier')`
     (matches `place-barrier.ts:110`). Do **NOT** widen `isBuilding` itself — it feeds the
     movement collider (`building-collision.ts:81`) and barriers already collide via their
     `obstacle` tag; widening it would double-count and change unrelated semantics.
  2. `vegetation-clear.ts:226-228`: `onBuilding` → `onStructure`:
     `.some((b) => b.id !== e.id && (isBuilding(b) || isBarrier(b)))`. The registry already
     returns the run on every blocking cell (§1.1), so this is the whole clearing fix for
     trunk-on-footprint.
  3. `vegetation-fill.ts:144-145`: same predicate in the occupancy check.
  4. **Canopy clearance around tall barriers** (the "around" in the symptom): collect the
     blocking cells of runs whose `run.kind` is a tall type (wall/palisade/rampart — NOT
     hedge/fence/paling, which live happily beside trees) into a Set once, and clear TREES whose
     trunk is within `TREE_CLEAR_RADIUS` of any such cell (reuse the `nearRoadOrRiverTile`
     shape). Pure geometry, no RNG.
- **Tests**: new cases — tree on a wall blocking cell is cleared; tuft is not re-sown on a wall
  cell; tree 2 tiles from a palisade cleared, 2 tiles from a hedge kept; gate opening cells
  (not in `blocking`) unaffected.
- **Version bumps**: rides the shared WCV 120 bump (vegetation set changes; v115(c) precedent).
- **Risk**: low. Over-clearing near long walls is the only aesthetic risk — the tall-kind gate
  bounds it. Determinism unchanged (removals only, fill skips more cells).
- **Size**: half-day. **Model tier**: sonnet.

### WP-3 — Gate siting: angular dedup (kills "two main gates side by side")

- **Goal**: two roads arriving at similar bearings share ONE gate; no more adjacent gates on the
  same wall face.
- **Files touched**: `src/world/enclosure.ts`, `tests/unit/enclosure.test.ts`.
- **Approach**:
  1. In `commitDirectionGates` (`:1033`), after the per-direction picks, dedupe by **angle from
     the ring centroid**: keep a pick only if its bearing is ≥ `GATE_MIN_ANGLE_DEG` (recommend
     55°; named constant + comment) from every already-kept pick's bearing. Iterate picks in
     best-alignment-first order (sort by `bestDot` desc) so the better-aligned gate of a cluster
     wins; ties broken by stable input order (deterministic, no RNG). Then run the existing
     `dedupeGatesBySpacing` as today (arc floor stays — tiny rings).
  2. Direction-vs-`roadCross` dedup at `:655-657` additionally gets the same angular test (a
     street crossing within 55° of a proposed direction gate absorbs it — this is already the
     stated intent at `:648-651`).
  3. **Leave `roadCross` self-dedup alone**, deliberately: those are mandatory openings (a road
     physically crosses each one); removing one puts a road tile on a blocking cell and trips
     `wall.crossing-only-at-gate`. `gatesWhereOpen` already merges contiguous runs; the residual
     double-crossing case is rare and needs a *merge-and-widen*, not a drop — deferred, noted in
     the code comment.
  4. Gate **budget by tier** and **postern kind** are deferred to WP-9 (wave 2+) — the angular
     rule alone removes the reported symptom.
- **Tests**: `enclosure.test.ts:151` ("commits a gate toward each inbound connection direction")
  — verify its bearings are >55° apart (adjust if not); ADD: two connections 30° apart → exactly
  one gate; two at 90° → two gates; angular-dedup keeps the better-aligned pick.
- **Version bumps**: rides the shared WCV 120 bump (gate layouts change).
- **Risk**: a town with two real POIs at <55° loses a gate — intended (the second road routes to
  the committed gate, the same path water-blocked directions already take, `:1053-1055` /
  `gateApproachPlan`). Watch `lint:world` `gate.road-connected` counts pre/post (pre-existing
  failures: 44 + 61 findings on the two probed worlds — compare COUNTS, don't chase absolutes).
- **Size**: half-day. **Model tier**: **opus** (circular-arithmetic edge cases; regression
  surface is every walled town).

### WP-4 — Gate-spacing connectome contract (regression guard)

- **Goal**: `lint:world` flags any ring with two real gates closer than the angular minimum, so
  WP-3 can never silently regress.
- **Files touched**: `src/world/connectome/wall-contracts.ts`, NEW `tests/unit/wall-contracts.test.ts`
  (none exists today).
- **Approach**: new `Contract` `gate.minimum-separation` (`level:'settlement'`, `kind:'invariant'`,
  `severity:'warn'` — existing worlds violate it until WP-3 lands), evaluating every pair of
  non-gap gates on a centroid-bearing ring: report pairs with angular separation below
  `params.minAngleDeg ?? 55`. Register it and add the declaration in `settlementRingContracts`
  (`:164`). The threshold is a param default here, deliberately not imported from `enclosure.ts`
  (keeps the file sets disjoint for parallel work; note the duplication in a comment, unify in a
  follow-up).
- **Tests**: contract fires on a synthetic ring with two gates at 20°, silent at 90°; gap-kind
  openings ignored; ownerPoiId rings exempt (existing declaration rule).
- **Version bumps**: none (eval-only).
- **Risk**: none at runtime; adds warn-findings on unfixed worlds (expected until WP-3).
- **Size**: half-day. **Model tier**: sonnet.

### WP-5 — Unknown-POI-type guard

- **Goal**: an unrecognised `POI.type` no longer silently generates an empty site.
- **Files touched**: `src/map/poi-zones.ts`, NEW `tests/unit/poi-zones.test.ts`.
- **Approach**: in `getZoneRule` (`:156`), on a miss, `console.warn` once per unknown type
  (module-level `Set` memo) naming the type and the fallback behaviour, then return the existing
  fallback (behaviour otherwise unchanged — `hamlet` in `studio/crossing-site-scene.ts` is an
  intentional out-of-table use and just logs once in the studio). Do NOT narrow `POI.type` to a
  union in this round (Fate/agents author POIs; a type error there is a larger design question).
- **Tests**: unknown type warns once and returns the zero-building rule; known types don't warn.
- **Version bumps**: none (no output change).
- **Risk**: none. **Size**: one-liner + test. **Model tier**: sonnet.

### WP-6 — Party-wall rows (wave 2)

- **Goal**: adjacent frontage buildings on the same road side read as a continuous row, not
  detached sheds with 1-tile gaps — the single largest urban-form visual gap.
- **Files touched**: `src/world/building-placer.ts` (frontage commit path), possibly
  `src/world/settlement-plan.ts` (lot adjacency metadata); tests
  `tests/unit/building-placer.test.ts`, `tests/unit/settlement-parcels.test.ts` (spatial
  invariants), NEW row-formation test.
- **Approach** (needs its own short design pass before implementation): reduce `margin` to 0
  **only** between two frontage-lot buildings on the same road edge and side (lot metadata knows
  this), keeping margin 1 against everything else; buildings still never overlap (placement
  invariant "no building cell overlaps another" must hold by construction). Visual wall-sharing
  beyond adjacency (merged sprites) is out of scope.
- **Version bumps**: shared WCV bump of its wave. **Risk**: medium — placement density changes
  every settlement; door-cell walkability between abutting footprints needs care.
- **Size**: multi-day. **Model tier**: **opus**.

### WP-7 — Church east-west orientation (wave 2)

- **Goal**: the parish church's chancel faces east (door west) — the landmark cue.
- **Files touched**: `src/world/building-placer.ts` (focus placement branch, ~`:848-862`); test
  additions in `tests/unit/building-placer-descriptor.test.ts` or a new file.
- **Approach**: pass a preferred orientation for the church at focus placement (same
  orientation mechanism the mill's `wheelOrientationForFace` uses); fall back to
  road-facing when the east-west footprint doesn't fit.
- **Version bumps**: shared WCV bump of its wave. **Risk**: low (rotation of an existing
  footprint; collision paths handle rotations).
- **Size**: half-day. **Model tier**: sonnet.
- **Serialization**: touches `building-placer.ts` → must land after WP-1 (and coordinate with
  WP-6/WP-8).

### WP-8 — Wards consumed by the placer (wave 3)

- **Goal**: trades cluster in their wards; a settlement reads as an economy.
- **Files touched**: `src/world/building-placer.ts` (slot ordering), `src/world/settlement-plan.ts`
  (ward→trade affinity), NEW test.
- **Approach**: ward affinity as an additional deterministic sort key in `orderedSlotsFor` — an
  ordering change, no new RNG (preserves the mechanisms-in/exponents-out rule).
- **Version bumps**: shared WCV bump of its wave. **Risk**: medium (re-orders every placement).
- **Size**: multi-day. **Model tier**: **opus**.

### WP-9 — Gate budget by tier + postern kind (wave 3, optional)

- **Goal**: cap main gates per settlement tier; introduce `kind:'postern'` for secondary
  approaches. `BarrierGate.kind` is already optional (`barrier.ts:9`), so consumers tolerate
  absence — cheaper than the gate audit estimated, but still a cross-cutting render change.
- **Files touched**: `src/world/barrier.ts`, `src/world/enclosure.ts`,
  `src/catalogue/packs/medieval-europe/barrier-types.ts`, render gate/gatehouse consumers,
  tests across barrier/enclosure/iso-barrier.
- **Version bumps**: WCV; possibly ART (gatehouse vocabulary changes) — assess at design time.
- **Size**: multi-day. **Model tier**: **opus**.
- **Serialization**: shares `enclosure.ts` with WP-3 → strictly after WP-3.

---

## 3. Dependency + conflict matrix

Files each WP edits (tests omitted where obviously disjoint):

| WP | mill-site-store | building-placer | settlement-plan | gen-art-source | site-contracts (new) | map-generator | building-collision | veg-clear | veg-fill | enclosure | wall-contracts | poi-zones | barrier.ts / catalogue / render |
|----|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| 1  | ✏ | ✏ | ✏* | ✏ | ✏ | ✏ (1 line) | | | | | | | |
| 2  | | | | | | | ✏ | ✏ | ✏ | | | | |
| 3  | | | | | | | | | | ✏ | | | |
| 4  | | | | | | | | | | | ✏ | | |
| 5  | | | | | | | | | | | | ✏ | |
| 6  | | ✏ | ✏ | | | | | | | | | | |
| 7  | | ✏ | | | | | | | | | | | |
| 8  | | ✏ | ✏ | | | | | | | | | | |
| 9  | | | | | | | | | | ✏ | | | ✏ |

(*WP-1's settlement-plan touch is type-threading only; if the `MillPlacement` hint type turns
out to live entirely in building-placer, WP-1 drops settlement-plan and the WP-6/8 note below
still stands on building-placer alone.)

**Parallel-safe (wave 1): WP-1, WP-2, WP-3, WP-4, WP-5 — fully disjoint file sets.**
WP-3 and WP-4 are logically coupled (same 55° threshold) but share no file by design; land in
either order, then reconcile the constant in a follow-up if desired.

**Must serialize:**
- WP-1 → WP-7 → WP-6 → WP-8 (all edit `building-placer.ts`; WP-6 and WP-8 also share
  `settlement-plan.ts`). Never run two of these concurrently.
- WP-3 → WP-9 (`enclosure.ts`).
- The **integration commit** (WCV 119→120 + `tests/unit/content-version.test.ts`) lands ONCE,
  after all of wave 1 merges — no wave-1 WP may touch `src/core/content-version.ts`.

**Shared checkout warning** (from MEMORY): other sessions share the main checkout — run each WP
in its own worktree; integrate on main only after `./scripts/ci-on-server.sh` reports
`✓ Server CI passed` (grep for it; background exit codes lie).

---

## 4. Recommended first wave (impact ÷ risk)

Order of value:

1. **WP-1 (mill)** — the user's top complaint; empirically characterized (§1.2); high impact,
   contained risk. Recommendation over the user's two options: **the taller-building direction,
   implemented as wet-site filtering + per-site wheel submerge** (see the evaluation in WP-1) —
   not terrain lowering. The strict "no worldgen determinism change / no save bump" property
   only holds for a fixed-preset variant that measurement shows cannot work; the recommended
   variant needs the shared WCV bump and nothing else.
2. **WP-2 (vegetation vs walls)** — the user's second complaint; cheapest real fix in the round;
   near-zero risk.
3. **WP-3 (gate angular dedup)** — removes the "two main gates side by side" absurdity in one
   function.
4. **WP-4 (gate contract)** + **WP-5 (POI-type guard)** — cheap guards, no version cost.

All five run in parallel (disjoint files), then one integration commit: WCV 119→120 + test pin +
bundled changelog entry (v115 precedent).

**Acceptance for the wave** (beyond unit tests):
- `npm run lint` stays ZERO; `npx tsc --noEmit` clean (trust it, not editor diagnostics).
- `npm run lint:world` finding counts compared against the pre-existing baseline (44 + 61 on the
  two probed worlds) — must not grow except the intended new `gate.minimum-separation` warns
  pre-WP-3-merge.
- Re-run the mill probe on genSeeds 12345 + 777: every placed mill wet-adjacent, gap−submerge ≤ 0,
  and at least one mill still places on the pinned world.
- Eyeball live (user rule): delete IDB `small-gods-saves` first (stale-autosave gotcha), frame the
  oakshire mill at zoom ~1 centred, grab via `__debug.grab()`.
- Pre-existing test flakes (water-s1-carve-fill, load/perf) measured at BASE before blaming the wave.

---

## 5. Open questions (no work planned)

- **Bridges / missing water crossings**: the placement-fit sweep returned zero bugs in both
  bridge dimensions, which contradicts observation. Cause unknown; likely outside the files those
  scouts read (runtime adoption/growth paths were the unverified Group 1). Needs its own targeted
  sweep — out of scope here by instruction.
- **Placement-fit Groups 1, 2, 6** (runtime reconciler gap, water-contract split, pre/post-fillet
  bank cells) were never verified by the authoritative pass — do not plan against them without a
  fresh source read.
- **roadCross merge-and-widen** (two mandatory street crossings within min spacing) — deferred
  from WP-3 with a code comment.
- **Mill undercroft/wheel-pit geometry** (ART-bump phase 2) — decide after eyeballing WP-1.
- **Vendored art reseed** remains FROZEN (user: no spend). WP-1's watermill fallback denylist is
  the interim; fold the mill back in whenever a funded reseed happens.
