# Bridge fix plan: one world, one water

**Arbitration of two root-cause accounts + the implementation plan. Measured at HEAD 92aa38c9
(clean tree), 2026-08-10.** Probes used (repo root, throwaway, delete after S0 promotes them):
`scratch-probe-bridge-classes.ts` (per-deck classifier, 6 world×seed combos),
`scratch-probe-lake-truths.ts` (per-cell truth dump at defect sites),
`scratch-probe-snap-divergence.ts` (pre-snap vs post-snap hydrology diff),
plus the pre-existing `scratch-probe-dry-deck.ts`.

---

## 1. Verdict: A and B both saw shadows of a third mechanism neither named

**The root cause is that worldgen builds the world from TWO DIFFERENT HYDROLOGIES.**

The causal chain, every step verified in source and by measurement:

1. `applyPoiInfluences(fields, worldSeed.pois, config)` builds the elevation field from the
   POIs' **layout positions** (map-generator.ts:288). Hydrology derives from it
   (map-generator.ts:309, :325 with beaver weirs). Lake/river tiles are stamped from THAT
   hydrology (map-generator.ts:336-355), and the river raster is widened from a water network
   built from THAT hydrology (map-generator.ts:374, :384-406). **Tile truth = pre-snap.**
2. `snapDrySettlementsOffWater` then **mutates `poi.position` in place**
   (map-generator.ts:362, mutation at :211) — settlements standing in a lake/sea walk to dry
   shore, up to 24 rings away.
3. Everything derived afterwards goes through memoised stores keyed on POI positions:
   `getHeightfield`'s cache key includes `poiHeightSignature(pois)` = `type@x,y` of every
   elevation-influencing POI (heightfield.ts:39-51, :145), and `getHydrologyResult` calls
   `getHeightfield(map.seed, …, map.worldSeed?.pois …)` (hydrology-store.ts:40-43). So the
   render-water ribbon (`buildRenderWaterType`, render-water-mask.ts:48-75), the water network,
   the continuous water distance, and — critically — the `renderWaterAt` predicate the crossing
   detector seats banks with (map-generator.ts:415-419, first called lazily at :716, i.e.
   AFTER the snap) are all recomputed from **post-snap** positions. **Render truth = post-snap.**
4. `computeHeightfield`'s own contract comment says the opposite is intended: *"Mirror
   map-generator EXACTLY … so this field equals the one biomes were classified from"*
   (heightfield.ts:118-121). The snap silently violates that contract for any world where a
   settlement snapped.

**Measured divergence** (`scratch-probe-snap-divergence.ts`):

| combo | POIs snapped | waterType cells differing | lake gained / lost |
|---|---|---|---|
| default/777 | 6 (millbrook_farm moved 17 tiles) | **1,656** | 1,082 / 448 |
| dawn/777 | 4 (dusk_temple ~34 tiles, flintgate_mine ~26) | **194** | 63 / 130 |

Spot checks at the defect sites (same probe): the class-1 worst case `re1#0`'s pond
`(213,194)`/`(213,200)` is **pre=Lake post=Dry** — the road bridged a lake that exists in the
tile grid (tiles `bridge`/`water`, `baseType water`) and does not exist in the drawn world
(ribbon=Dry, `hyWT=0`; `scratch-probe-lake-truths.ts`). The class-2 banks `(196,174)`,
`(198,164)`, `(191,159)` are **pre=Dry post=Lake** — roads walked on honest dry mountain
(`tile=dirt_road base=mountain`) that the post-snap lake then grew over. The bank cell
`(140,153)` shared by two dawn class-3 crossings is **pre=Lake post=Dry**.

### Where that leaves the two accounts

**Account A** ("width mismatch between two water truths") had the right genus — two water
truths — and the wrong species. The +0.7-tile render margin
(render-water-mask.ts:61-66 vs the tile stamp map-generator.ts:390) is real, but it is
**measured to cause none of the three defect classes**: across all 6 probed combos, every deck
whose nearest water is river-ribbon is defect-free (class1/2/3 all false, banks dry, banks on
the road). That is because `banksOnRibbon` seats banks on the first **render-dry** step
(detect-crossings.ts:174) — the margin is absorbed at seating time. A's prediction that bridged
cells read *wet* to the mask is refuted for 26/52 cells (Account B's measurement, reproduced
here). A's scout's claim "a bridge tile still reads as water in the render mask — design
decision" is true only where the ribbon covers the cell; it covers 26 of 52.

**Account B** (mask blind after the bridge stamp, `render-water.ts:55-61` never consults
`baseType`) is real, measured, and correctly refutes A on that point — but it is mostly a
**downstream symptom** of the snap divergence, not an independent primary cause. Of the 26
blind bridged cells on default/777, 22 are `baseType:'water'` cells of **pre-snap lakes/ponds
that post-snap hydrology deleted** — the ribbon doesn't cover them because the post-snap world
has no water there, and the bridge stamp then destroyed the tile fallback, the only remaining
signal. Only the 4 `baseType:'river'` cells on `re16` are pure B: D8-staircase raster river
cells that the ribbon legitimately drops (render-water-mask.ts:52) and re-stamps elsewhere.
B's implied fix alone (a baseType-aware mask) would treat the symptom: the detector would see
the pond again, but the pond would still not be drawn where the sim thinks it is.

So: **not the same mechanism seen from two angles, and not two independent defects either —
two partial observations of one upstream defect**, plus one small genuine B-residual (the D8
cells) that survives the main fix and gets its own contingent slice.

---

## 2. Defect class attribution (measured, per class)

Baseline from `scratch-probe-bridge-classes.ts` over default/dawn/frost × 777/12345
(37 decks; the brief's 46 additionally included default × 424242/31337 — the harness takes
those as parameters):

| combo | decks | class1 (no drawn water under deck) | class2 (both abutments in drawn water) | class3 (bank ≥2 off every drawn road) |
|---|---|---|---|---|
| default/777 | 13 | 6 | 4 | 1 |
| dawn/777 | 7 | 2 | 0 | 4 |
| frost/777 | 4 | 0 | 0 | 2 |
| default/12345 | 3 | 0 | 0 | 0 |
| dawn/12345 | 6 | 0 | 0 | 3 |
| frost/12345 | 4 | 1 | 0 | 1 |
| **total** | **37** | **9** | **4** | **11** |

**Class 1 — deck spans no drawn water (9).** Cause: **snap divergence**, compounded by B's
stamp-blindness. 5 of 9 have `blind` chord cells (`baseType` water, mask dry) — pre-snap lake
tiles bridged by the road, deleted from post-snap hydrology; every one has visible (tile-only)
water within 1 cell of the deck midpoint, so on screen these are bridges beside/over orphaned
tile-water the drawn world disowned. The remaining 4 are degenerate 1.41–3-tile spans with 0–2
interior cells next to lake margins — same lake-displacement neighbourhoods, too short for the
chord metric to register water. Neither account's *primary* story fits unamended: A predicted
the walker under-bridged a wider channel (banks would sit render-wet — they don't: all class-1
banks are render-dry); B correctly explains the blindness but not why the ribbon is missing —
the snap does.

**Class 2 — both abutments in drawn water (4, all default/777).** Cause: **snap divergence at
lakes**, full stop. All four are `cap` declines (detect-crossings.ts:176) at the same
displaced-lake complex: the road was walked on pre-snap-dry mountain/rocky ground
(bank tiles `dirt_road`/`stone_road` with `baseType mountain`/`rocky`), the post-snap lake grew
over it (bank cells hyWT=2, ribbon=Lake, netLake=true), `banksOnRibbon`'s 6-tile outward walk
(RIBBON_BANK_MAX_TILES, detect-crossings.ts:71) can't clear a lake that isn't supposed to be
there, and the decline fallback's 4-tile `snapBankToLand` (detect-crossings.ts:54, :335-338)
can't either. Not A's +0.7 margin (that predicts ≤~1-tile wetness at banks, not 12-tile-wide
lake arms), not B (these banks read WET, not blind).

**Class 3 — bank ≥2 tiles off every drawn road (11, mostly seated decks).** Cause: **the
`nearestDry` end-of-ribbon rescue firing against displaced water.** Fingerprint: on dawn/777,
6 of 7 seated decks have a bank >0.75 tiles off their own edge's drawn ribbon — impossible for
the normal `banksOnRibbon` walk, whose points lie ON the ribbon by construction
(detect-crossings.ts:151-177); only the `nearestDry` tangent/ring rescue (:163-171, :194-217)
produces off-ribbon banks, up to 6 tiles out. It fires when the smoothed ribbon ENDS while
render-wet — a road node inside drawn water. Every class-3 deck sits at a lake or tile-only
water body; several sit exactly at pre↔post divergent cells ((140,153) pre=Lake post=Dry
serves two of them); **zero class-3 decks sit at river-ribbon water**. The node is "in the
water" because the walker/node-siting consulted the tile world and the seater consulted the
post-snap drawn world. This is the population WCV 122's own OUTCOME note flagged as
`nearestDry` seatings; the missing "why does the ribbon end wet so often" is the snap.

**Caused by neither account as written: all three classes.** Both accounts' *mechanisms* appear
only as secondary actors (B's blindness inside class 1; A's "two truths" as the correct
abstract shape).

---

## 3. The plan

Three slices. Strictly serial where marked — S1 and S2 both own `src/map/map-generator.ts` and
`src/core/content-version.ts`, so they are a serialization point; do not parallelize them.
S0 has no file overlap with S1/S2 and may run concurrently with S1's implementation, but S1's
**acceptance** requires S0 merged. Honest summary: this is a chain, S0 → S1 → (remeasure) → S2.

Everything else from both accounts is **cut** (see §4/§5): A-slice-1 (walker prices render
margin — refuted: zero river-crossing defects), A-slice-2 (pre-sited fords — see §5),
A-slice-3 (channel-derived axis — no measured population left to justify it; revisit on
post-S1 evidence), A-slice-4 (unify tile/render stamp width — the +0.7 is deliberate sub-cell
bed-colour slop, documented at render-water-mask.ts:61-65; the real dual truth is the snap,
fixed by S1).

### Slice 0 — the deck-vs-visible-water harness *(no WCV bump)*

- **Files owned:** `scripts/probe-bridge-decks.ts` (new — promote
  `scratch-probe-bridge-classes.ts` verbatim plus a `--summary` flag),
  `scripts/probe-hydrology-parity.ts` (new — promote `scratch-probe-snap-divergence.ts`,
  parameterised on world+seed, exit non-zero when the pre/post waterType diff is non-zero).
  Delete the four `scratch-probe-*.ts` files in the same commit.
- **Dependency order:** first; nothing depends on its code, every later slice's acceptance
  depends on its existence.
- **Work-package brief:** The probe generates a world (`planWorldLayout` → `generateWithNoise`),
  re-runs the exact span-pass detection (`detectCrossings(graph, W, { isWater: mask, bridgeAt:
  mask, defaults: { era: 'late-medieval', prosperity: 'modest' } })`, identical to
  map-generator.ts:977-980), and for each deck reports: the two abutment cells, drawn-water
  samples along the abutment chord (`getRenderWaterMask` per cell + `getRenderWaterDist` at
  0.1-tile steps), per-cell `tile.type`/`baseType`/ribbon `WaterType`, `blind` count
  (baseType-wet ∧ mask-dry), bank distances to every drawn road ribbon
  (`smoothCenterline(edge.polyline, {keepIndices: new Set(edge.pins)})` sampled at 0.25) and to
  the deck's OWN edge ribbon, the decline reason, and the three class flags. **This is the
  acceptance instrument for every subsequent slice** — the criterion is always "where did the
  deck end up relative to the water the player sees", never a decline count.
- **Acceptance criterion:** reproduces the baseline table in §2 byte-for-byte on the six
  combos (`npx tsx scripts/probe-bridge-decks.ts default 777`, etc.).
- **Might break:** nothing (scripts only).
- **Coordinator note:** yes — this is slice zero on purpose; the WCV 122 round was declared
  shipped against a decline-count metric and only the per-deck measurement exposed the miss.

### Slice 1 — one hydrology per world: freeze POI height influence at layout positions *(WCV bump)*

- **Files owned:** `src/core/types.ts` (add `heightAnchor?: { x: number; y: number }` to `POI`,
  types.ts:191-216), `src/map/map-generator.ts` (in `snapDrySettlementsOffWater`, set
  `poi.heightAnchor ??= { x: poi.position.x, y: poi.position.y }` immediately before the
  mutation at :211), `src/terrain/poi-influence.ts` (`applyPoiInfluences` reads
  `poi.heightAnchor ?? poi.position` for elevation influence, poi-influence.ts:423),
  `src/world/heightfield.ts` (`poiHeightSignature` keys on `heightAnchor ?? position`,
  heightfield.ts:39-51), `src/core/content-version.ts` + `tests/unit/content-version.test.ts`
  (bump + pin, SAME commit), new `tests/unit/hydrology-snap-parity.test.ts`.
- **Dependency order:** after S0 merges (for acceptance). Serialization point with S2.
- **Work-package brief:** *Mechanism attacked:* the pre-snap/post-snap hydrology divergence of
  §1 — the only mechanism behind classes 2 and 3 and the dominant one behind class 1. The tile
  world (biomes, water stamps, roads, settlements) is built from elevation with POI plateaus at
  **layout** positions (map-generator.ts:288, before the :362 snap); every post-snap
  derivation — including the renderer and the crossing seater — rebuilds elevation with
  plateaus at **snapped** positions. The fix makes the height influence permanently read the
  layout position: `snapDrySettlementsOffWater` records `heightAnchor` before moving the POI,
  and the two elevation readers (`applyPoiInfluences`, `poiHeightSignature`) prefer it. Result:
  `getHeightfield`/`getHydrologyResult`/`getWaterNetwork`/`buildRenderWaterType` become
  byte-identical to the in-gen derivation (restoring the documented contract at
  heightfield.ts:118-121), the drawn lakes move back onto the lakes the roads were actually
  routed around, and `renderWaterAt` at detection time (map-generator.ts:716, :977) finally
  describes the same world the walker walked. Anchors persist for free: `worldSeed` travels in
  the save (save-file.ts:64) and is structuredClone'd on save/load. Unsnapped POIs carry no
  anchor → bitwise-identical behaviour. Runtime POIs are already heightfield-inert
  (heightfield.ts:44-48). Do NOT instead reorder generation to re-derive hydrology post-snap —
  that is a larger rewrite inside `generateWithNoise` (pending the WP-D plan/compile split) for
  the same observable outcome; and note the plateau-beside-snapped-settlement look this "bakes
  in" is already the reality of the shipped tile world, since tiles were always classified
  pre-snap.
- **WCV impact:** BUMP (drawn water, terrain lift, and deck positions all change on any world
  where a POI snapped). Same-commit pin in `tests/unit/content-version.test.ts`.
- **Acceptance criteria** (all deck-vs-visible-water; commands exact):
  1. `npx tsx scripts/probe-hydrology-parity.ts default 777` and `… dawn 777` report **0
     waterType cells differing** (mechanism proof: one hydrology).
  2. `npx tsx scripts/probe-bridge-decks.ts` on all six §2 combos: **class 2 → 0** (no deck
     with both abutment cells in drawn water); **class 1 → ≤2 total**, and 0 among decks with
     span ≥ 2 tiles (the two sub-2-tile degenerate spans are measurement-degenerate, not
     visual); **class 3 → ≤3 total**, and every survivor individually inspected and explained
     by a genuine shoreline terminus (e.g. a dock road ending at drawn water), not by displaced
     water; **river-ribbon crossings stay at 0 defects** (regression gate — they are 0 today).
  3. Full `npm test` via `./scripts/ci-on-server.sh` green (expect a handful of worldgen-pinned
     tests to need re-pins; re-pin only after eyeballing that the new value reflects converged
     water, and treat any river-position change on a NON-snapping world as a bug — unsnapped
     worlds must be byte-identical). `npm run lint` zero; `npx tsc --noEmit` clean.
  4. New `tests/unit/hydrology-snap-parity.test.ts`: a small synthetic world with one
     settlement authored inside a lake; assert post-gen `getHydrologyResult(map).waterType`
     equals the waterType array captured from the generator's own hydrology (exposed for test
     via the map or recomputed through the same store path) — the permanent guard that no
     future mid-gen mutation reopens this class of bug.
- **Might break:** any consumer that accidentally depended on POST-snap water (none found by
  probe — but `lint:world` findings will shift; re-measure its ~293-finding baseline before and
  after, per MEMORY, and compare counts not exact matches). Saves: pre-bump worlds are already
  refused by `slotCompat` on WCV bump — no migration.

### Slice 2 — CONTINGENT: crossing predicate remembers bridged-over water *(WCV bump)*

- **Trigger:** run S0's probe after S1 lands. Execute this slice **only if** any deck with
  span ≥2 tiles still shows `class1` with `blind > 0` chord cells (the D8-staircase residual,
  today: `re16#0`'s 4 `baseType:'river'` cells). If the trigger is empty, close this slice as
  "not needed — measured".
- **Files owned:** `src/map/map-generator.ts` (only), `src/core/content-version.ts` +
  `tests/unit/content-version.test.ts` (bump + pin). Strictly serial after S1.
- **Work-package brief:** *Mechanism attacked:* Account B's residual — `getRenderWaterMask`'s
  tile fallback (`render-water.ts:60`) reads `tile.type`, which `applyEdge` overwrote with
  `bridge` (road-graph.ts:430-444) while the original water survives only in `baseType`
  (road-graph.ts:462). Where the ribbon doesn't cover the cell (D8 raster river cells the
  ribbon legitimately drops, render-water-mask.ts:52), the crossing detector is blind to water
  the road itself bridged. Fix at the CALL SITE, not in the mask: in map-generator, build
  `const crossingWaterAt = (x, y) => renderWaterAt(x, y) || (ROAD_TILE_TYPES.has(tiles[y]?.[x]?.type ?? '') && WATER_TYPES.has(tiles[y]?.[x]?.baseType ?? ''))`
  and pass it as `isWater`/`bridgeAt` to BOTH `detectCrossings` calls (:716-733 and :977-980 —
  they must stay identical or the early/span spec ids can diverge). `getRenderWaterMask`'s
  public semantics ("water the player can SEE") stay untouched — mills, vegetation and lints
  keep their meaning. No new crossings can be minted: runs still seed exclusively from
  `edge.bridgeCells` (detect-crossings.ts:262, guard rationale :39-46).
- **WCV impact:** BUMP (bank seatings move on affected crossings).
- **Acceptance criterion:** `npx tsx scripts/probe-bridge-decks.ts` on the six combos: decks
  with span ≥2 and `class1 && blind>0` → **0**; total deck count per combo unchanged vs post-S1
  (no phantom crossings); river-ribbon crossings stay at 0 defects.
- **Might break:** a crossing over a genuinely-dry carved channel could now seat banks one cell
  wider; watch the `bridge.seating` / `bridge.tiles-vs-deck` lint counts (not worse).

---

## 4. What was cut, and why

- **A-slice-1 (walker prices render-wet margin cells at bridge cost).** Refuted by
  measurement: the +0.7 margin causes zero defects — every river-ribbon crossing in 37 probed
  decks is clean, because `banksOnRibbon` already seats banks render-dry
  (detect-crossings.ts:174) and the run-extension absorbs the margin
  (detect-crossings.ts:277-287). Its amended form ("alongside, not instead of") is coherent but
  solves a problem the data says does not exist.
- **A-slice-3 (channel-derived axis for declined decks).** After S1 the measured decline
  population collapses to genuine estuaries/road-into-sea; there is no measured yaw-defect
  population to size it against. Revisit only if the post-S1 probe shows one.
- **A-slice-4 (unify the tile stamp and render mask widths).** The +0.7 is deliberate,
  documented sub-cell bed-colour slop (render-water-mask.ts:61-65). The "dual water truth"
  worth killing was the pre/post-snap divergence — S1 kills it. Touching the tile stamp width
  would ripple through every tile consumer for no measured benefit.
- **B-as-mask-fix (make `getRenderWaterMask` baseType-aware globally).** Cut in favour of the
  scoped S2 predicate: the mask's contract is *visible* water; making it remember paved-over
  ponds would silently change mills, vegetation clearing, and lints.

## 5. The architectural question: should crossings be sited before roads?

**No — keep the retrofit architecture. Re-ordering is not the fix and would inherit the bug.**

The player's framing ("real crossings work the other way: ford first, road bends to it") is
good hydrology-anthropology, but the measurement says the game's failure is not the ORDER of
decisions — it is that the two deciders consulted **different worlds**. Evidence:

- Where the two worlds agree, retrofit works: default/12345 (no divergence at its crossings)
  has 3/3 decks crossing the drawn channel, banks dry, banks on the drawn road, at river
  crossings. That is the desired end state, produced by today's architecture.
- Every defective deck in 37 sits at water that moved (or vanished) between the tile world and
  the drawn world. A pre-siting pass would site fords against ONE of those hydrologies and the
  player would still see the other — same bug, more machinery, plus the routing fallback
  problem A's own plan flags (a reach with no ford-worthy site makes the connection unroutable),
  built on the part of A's research that its own fleet never completed (the pre-siting scout
  timed out).
- Cost asymmetry: S1 is ~15 lines across four files plus tests, on a documented existing
  contract (heightfield.ts:118-121). Pre-siting is a new worldgen subsystem, a new walker
  constraint mode, reroutes on every seed, and a re-tune of every road-adjacent test — inside a
  generator already queued for the WP-D plan/compile split.

**Decision rule for reopening it:** if, after S1 (+S2 if triggered), `probe-bridge-decks`
still shows ANY deck at a **river-ribbon** crossing whose chord misses the drawn channel or
whose bank sits ≥2 tiles off every drawn road, then the retrofit heuristics have a residual the
unified truth cannot explain — reopen pre-siting as a scoped spec (ford siting from the water
network + `Connection.waypoints` injection, which `buildRoadGraph` already supports). Today
that population is zero.

## 6. Honest unknowns

- default × 424242/31337 (the brief's remaining 9 decks) were not re-probed this session; the
  S0 harness covers them by parameter. Nothing in the mechanism is seed-shaped, but the S1
  acceptance run should include them.
- Whether the two degenerate sub-2-tile class-1 spans (`re3#0`, `re9#0`-class) are visually
  wrong on screen or only metrically wrong is untested — they sit ≤1 cell from visible water.
  Eyeball at zoom ~1 during S1 acceptance before spending a slice on them.
- What the player literally sees at orphaned tile-water (pond tiles the drawn world disowned)
  was inferred from the tile-colour path, not screenshotted. S1 removes the category either
  way; a before/after grab of `default/777 (213,195)` during S1 acceptance would close it.
