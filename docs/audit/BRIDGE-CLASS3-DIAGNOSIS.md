# Bridge class-3 diagnosis: why a road node stands in a lake

**Diagnosis only — no source changed.** Measured at HEAD `30cdc346` (WCV 123, clean tree), 2026-08-10,
on the six world×seed combos of `BRIDGE-FIX-PLAN.md` §2. Pre-fix figures come from a read-only
`git archive 5cc380be` extracted to a scratch dir (identical `public/` — `git diff --stat
5cc380be 30cdc346` touches 7 files, none under `public/`).

Instruments:
- `scripts/probe-bridge-decks.ts` (unmodified; the parent's before/after runs, reproduced).
- A throwaway scratch probe that re-implements `banksOnRibbon` / `nearestDry`
  (`src/world/connectome/detect-crossings.ts:128-217`) **verbatim**, instrumented to report which
  side of which ribbon ran out wet, which branch fired, and what graph node sits at that end.
  Self-check: the replicated bank cells are compared to the real `spec.bankCells` on every deck —
  **0 mismatches across all 39 decks in all six combos**, and the replicated class counts
  (14/7/4/3/7/4 decks, 19 class-3) reproduce the probe's numbers exactly.

---

## 0. Headline

**Nothing "overshoots". The road really does end in the lake, and `nearestDry` is faithfully
reporting that.**

For **19 of 19** class-3 decks, the ribbon end that ran out wet is *exactly* the graph node
(`nodeToSmEnd = 0.00` in every case — the node cell, the walked polyline's terminal cell and the
smoothed ribbon's terminal point are the same cell), and **that node cell is drawn Lake water**
(`getRenderWaterMask` true, `buildRenderWaterTypeMemo` = `Lake`, `tile.type = 'bridge'`,
`tile.baseType = 'water'`). Case (3) of the brief — "node dry, ribbon still ends wet" — occurs
**zero** times among class-3 decks (it occurs twice elsewhere; see §4).

The dominant reason a node stands in a lake is a **desync introduced by the round's own upstream
fix's sibling pass**: `snapDrySettlementsOffWater` walks a POI out of a lake by mutating
`poi.position`, but the road is walked to `conn.waypoints`, which still point at the cell the POI
just vacated. That cell is, by definition of the snap trigger, inside a lake.

Single strongest corroboration: **`default/12345` is the only combo where no POI snapped
(no `snapped to dry shore` line in its worldgen log), and it is the only combo with zero class-3
decks.** Every other combo's snap log lists exactly the cells the offending nodes occupy.

---

## 1. Per-deck evidence

`node` = the graph node at the end of the ribbon that ran out wet. `wet?` = drawn-water truth at
that node's own cell (`mask` / ribbon `WaterType` / `tile.type` / `tile.baseType`). `bank` = the
abutment `nearestDry` produced; `offRoad` = its distance to the **nearest sample of any** drawn
road ribbon (the class-3 metric); `chord` = drawn-wet interior cells / interior cells.

All 19 class-3 decks are covered; nothing is skipped. The 10 further decks where the rescue fired
without producing a class-3 bank are listed in §4 for completeness (29 of 39 decks in total have
the rescue firing on one side).

| # | combo · deck | edge end | node | node kind / poiRef | node in drawn water? | branch | bank | offRoad | chord | mechanism |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | default/777 `re1#0` | B (ribbon end) | `rn2` (213,199) | poi · millbrook_farm | **yes** — Lake, bridge/water | end-ring, reach 8.49 | (219,193) | **6.27** | 1/8 | A |
| 2 | default/777 `re3#0` | B | `rn4` (263,163) | poi · crossroads_inn | **yes** — Lake, bridge/water | end-tangent, 2.00 | (265,163) | **2.00** | 3/3 | A |
| 3 | default/777 `re12#0` | B | `rn15` (196,186) | waypoint | **yes** — Lake, bridge/water | end-ring, 4.47 | (194,182) | **2.27** | 5/6 | B |
| 4 | default/777 `re13#1` | B | `rn16` (157,197) | poi · forest_ruins (**is** the POI centre) | **yes** — Lake, bridge/water | end-tangent, 4.12 | (158,201) | **4.12** | 8/8 | C |
| 5 | default/777 `re15#0` | B | `rn18` (251,211) | poi · ironkeep_castle | **yes** — Lake, bridge/water | end-tangent, 3.00 | (251,214) | **3.00** | 5/5 | A |
| 6 | default/777 `re16#0` | A (ribbon start) | `rn18` (251,211) | poi · ironkeep_castle | **yes** — Lake, bridge/water | end-tangent, 3.16 | (250,214) | **3.16** | 3/8 | A |
| 7 | default/777 `re17#0` | B | `rn20` (217,211) | poi · lakeside_dock | **yes** — Lake, bridge/water | end-tangent, 5.10 | (212,210) | **5.10** | 8/8 | A |
| 8 | dawn/777 `re6#0` | B | `rn7` (184,164) | waypoint | **yes** — Lake, bridge/water | end-tangent, 2.00 | (182,164) | **2.00** | 2/2 | B |
| 9 | dawn/777 `re7#0` | B | `rn8` (156,144) | poi · dusk_temple | **yes** — Lake, bridge/water | end-ring, 7.07 | (161,139) | **4.69** | 1/6 | A |
| 10 | dawn/777 `re14#0` | B | `rn16` (143,178) | waypoint | **yes** — Lake, bridge/water | end-ring, 4.24 | (140,175) | **2.72** | 0/2 | B |
| 11 | dawn/777 `re15#0` | B | `rn17` (140,152) | poi · flintgate_mine | **yes** — Lake, bridge/water | end-tangent, 3.16 | (141,149) | **3.16** | 6/6 | A |
| 12 | dawn/777 `re19#0` | B | `rn17` (140,152) | poi · flintgate_mine | **yes** — Lake, bridge/water | end-tangent, 3.16 | (141,149) | **3.16** | 5/5 | A |
| 13 | frost/777 `re5#0` | B | `rn7` (156,138) | poi · hall_of_ancestors | **yes** — Lake, bridge/water | end-ring, 7.07 | (161,133) | **4.56** | 4/6 | A |
| 14 | frost/777 `re9#0` | B | `rn12` (144,152) | poi · ironfjord_mine | **yes** — Lake, bridge/water | end-ring, 4.24 | (141,149) | **4.24** | 7/8 | A |
| 15 | dawn/12345 `re13#0` | B | `rn15` (256,196) | poi · bone_ruins (**is** the POI centre) | **yes** — Lake, bridge/water | end-tangent, 3.16 | (253,195) | **3.16** | 6/6 | C |
| 16 | dawn/12345 `re15#1` | B | `rn17` (140,152) | poi · flintgate_mine | **yes** — Lake, bridge/water | end-tangent, 3.00 | (143,152) | **2.98** | 4/4 | A |
| 17 | dawn/12345 `re19#0` | B | `rn17` (140,152) | poi · flintgate_mine | **yes** — Lake, bridge/water | end-tangent, 3.00 | (140,149) | **2.97** | 4/4 | A |
| 18 | frost/12345 `re7#0` | B | `rn8` (256,194) | poi · boneships_ruins (**is** the POI centre) | **yes** — Lake, bridge/water | end-tangent, 3.00 | (256,191) | **2.83** | 4/4 | C |
| 19 | frost/12345 `re9#0` | B | `rn10` (144,152) | poi · ironfjord_mine | **yes** — Lake, bridge/water | end-tangent, 2.00 | (144,150) | **2.00** | 3/3 | A |

Mechanism totals: **A = 13, B = 3, C = 3.** Every off-road bank in the table is the `nearestDry`
output for that deck (checked deck by deck: the bank coordinates in the trace equal the abutment
the spec carries).

### The witness that closes mechanism A

The WCV-123 fix left a perfect forensic marker in the data: `POI.heightAnchor` is minted at exactly
the moment of the snap (`map-generator.ts:220-221`) and records **the pre-snap cell**. For every
mechanism-A node, the node cell equals that POI's `heightAnchor`, and the POI's live `position` is
somewhere else and dry:

| combo | POI | worldgen snap log | node the road actually ends at | POI's final position | node → POI |
|---|---|---|---|---|---|
| default/777 | millbrook_farm | `(213,199) → (230,182)` | `rn2` (213,199) | (230,182), dry | **24.0 tiles** |
| default/777 | crossroads_inn | `(263,163) → (261,161)` | `rn4` (263,163) | (261,161), dry | 2.8 |
| default/777 | ironkeep_castle | `(251,211) → (249,213)` | `rn18` (251,211) | (249,213), dry | 2.8 |
| default/777 | lakeside_dock | `(217,211) → (228,221)` | `rn20` (217,211) | (228,221), dry | **14.9** |
| default/777 | oakshire | `(234,175) → (230,179)` | `rn0` (234,175) | (230,179), dry | 5.7 |
| dawn/777 | dusk_temple | `(156,144) → (132,120)` | `rn8` (156,144) | (132,120), dry | **33.9** |
| dawn/777 | flintgate_mine | `(140,152) → (122,133)` | `rn17` (140,152) | (122,133), dry | **26.2** |
| dawn/777 | ember_heights | `(146,204) → (144,202)` | `rn12` (146,204) | (144,202), dry | 2.8 |
| dawn/777 | palefield_farm | `(178,186) → (175,183)` | `rn10` (178,186) | (175,183), dry | 4.2 |
| frost/777 | hall_of_ancestors | `(156,138) → (138,116)` | `rn7` (156,138) | (138,116), dry | **28.4** |
| frost/777 | ironfjord_mine | `(144,152) → (124,132)` | `rn12` (144,152) | (124,132), dry | **28.3** |
| dawn/12345 | flintgate_mine | `(140,152) → (138,151)` | `rn17` (140,152) | (138,151), dry | 2.2 |
| dawn/12345 | palefield_farm | `(178,186) → (174,182)` | `rn10` (178,186) | (174,182), dry | 5.7 |
| frost/12345 | ironfjord_mine | `(144,152) → (144,150)` | `rn10` (144,152) | (144,150), dry | 2.0 |
| default/12345 | *(no POI snapped)* | — | — | — | — |

Full drawn-water audit of the road nodes on default/777 (probe section `ROAD NODES in drawn water`):
`rn0` oakshire, `rn2` millbrook_farm, `rn4` crossroads_inn, `rn11` waypoint, `rn12` ironvein_mine,
`rn15` waypoint, `rn16` forest_ruins, `rn18` ironkeep_castle, `rn20` lakeside_dock — **nine road
nodes standing in drawn Lake water**, every one of them `tile=bridge`, `base=water`. (`rn23`–`rn25`
also read wet but belong to `feature:'river'` edges, which mint no crossings.)

---

## 2. Mechanism verdict

### Mechanism A — the settlement moved, its road's endpoint did not (13 / 19)

1. `planWorldLayout` translates POI positions **and** `conn.waypoints` by the same integer offset
   (`src/world/poi-layout.ts:70-85`, applied at `:132-133`). Every authored road in
   `default.json` / `dawn.json` / `frost.json` carries explicit waypoints whose first and last
   entries are its two POIs' authored cells, so after layout the terminal waypoint sits exactly on
   the POI. (Verified arithmetically per world: default offset (+131,+96), dawn (+60,+86), frost
   (+60,+78) — every offending node cell equals an authored waypoint plus that offset.)
2. `snapDrySettlementsOffWater` (`src/map/map-generator.ts:193-222`, called at `:372`) walks a
   `DRY_SETTLEMENT_POI` (`:157-159`) out of a Lake/Ocean cell up to 24 rings away. It mutates
   **`poi.position` and `poi.heightAnchor` only** (`:220-221`). It does not touch
   `worldSeed.connections`, and no later pass re-derives waypoints from POI positions.
3. `buildRoadGraph` builds its point sequence from `conn.waypoints` **when present**, and only falls
   back to POI positions when they are absent (`src/world/road-graph.ts:269-277`). So the road is
   walked to the vacated lake cell. `nodeFor` mints the node there and, via the `endpointOf` hint
   (`:226-249`, passed at `:371-372`), stamps it `kind:'poi'` with the settlement's `poiRef` — the
   graph asserts the mine's road attachment is a lake cell 28 tiles from the mine.
4. The walker bridges it: every on-path water cell is folded into `bridgeCells`
   (`road-graph.ts:362-368`), and `applyEdge` stamps `tile.type='bridge'` while `preserveBaseType`
   files the drowned `water` under `baseType` (`:430-455`, `:461-463`).
5. `detectCrossings` (called with `isWater/bridgeAt = renderWaterAt` at
   `map-generator.ts:987-990`) therefore sees a bridge run whose ribbon **ends inside the drawn
   channel**, and `banksOnRibbon`'s `walk` falls into its end-of-ribbon branch
   (`detect-crossings.ts:151-172`) and calls `nearestDry` (`:194-217`), which walks up to
   `RIBBON_BANK_MAX_TILES = 6` (`:71`) off the road.

**What was supposed to prevent it, and why it didn't.** `snapDrySettlementsOffWater` is the only
guard, and it is a *POI* guard, not a *road* guard. There is one place in the pipeline that already
does the right thing by accident: `gateApproachPlan` (`src/world/connectome/gate-approach.ts:109-121`)
**replaces** a ringed POI's terminal waypoint with that ring's live gate-opening cell, derived from
the settlement as actually built. Measured on default/777, `stonehaven_city` and `khar_ordu` have
their road nodes at gate cells, not at their authored/translated cells — and neither appears in the
wet-node list. Every mechanism-A POI has its node sitting on the raw stale cell, i.e. gate injection
did not fire for it. So the shape of the fix already exists in the codebase; it is simply not
applied to unringed POIs.

**Note on the prior "disproven" claim.** `map-generator.ts:1018-1021` states *"A road NODE sited in
render water is DISPROVEN — snapping road waypoints off water moved the count by exactly zero."*
That experiment was run **before** WCV 123, against the post-snap hydrology (in which these lake
cells had been deleted) and judged on a **decline count**. Both the world and the metric were wrong.
The claim is now false: 9 road nodes on default/777 stand in drawn water and they produce 5 of its
7 class-3 decks.

### Mechanism B — an authored MID waypoint inside a lake (3 / 19)

`rn15` (196,186) on default/777 is `oakshire→forest_ruins`'s middle waypoint (65,90); `rn7`
(184,164) is dawn's `amberharbor→dusk_temple` (124,78); `rn16` (143,178) is dawn's
`ember_heights→flintgate_mine` (83,92). Mid waypoints are never snapped by anything — `snapDry…`
only iterates POIs — so an authored routing hint that happens to land in a filled basin becomes a
degree-2 junction node inside the lake, and **both** edges meeting there run out wet. Same
downstream path as A.

### Mechanism C — a POI that is deliberately wet (3 / 19)

`ruins` is intentionally excluded from `DRY_SETTLEMENT_POI` (`map-generator.ts:150-159`: *"a sunken
shrine in the marsh … want the water and stay put"*). `forest_ruins`, `bone_ruins` and
`boneships_ruins` therefore stand in a lake **legitimately** — probe confirms the POI's own final
position reads `mask=true, ribbon=Lake` — and their node is the POI centre, not a stale cell. The
road runs into the water to reach them, so the ribbon genuinely ends wet. This is not a desync; it
is a missing rule about how a road should *approach* an inherently-wet destination.

---

## 3. Is `nearestDry`'s output wrong? — mostly the road, not the bridge

`nearestDry`'s premise is written in its own comment: *"the connected road continues on dry land a
tile past the node"* (`detect-crossings.ts:157-162`). Measured, that premise is false for every
class-3 deck:

- **8 of 19 sit on a degree-1 node** (`rn2`, `rn16`, `rn20`, `rn8`/dusk_temple, `rn15`/bone_ruins,
  `rn7`/hall_of_ancestors, `rn8`/boneships_ruins, plus `rn10`/palefield in the non-class-3 set):
  **nothing continues past the node at all.** The road *terminates* in the lake. The rescue plants
  an abutment on the far shore of a lake that no road ever reaches — a bridge to nowhere, and the
  chord is often a perfectly good span across real water (`re13#1` 8/8, `re17#0` 8/8) which makes it
  read as a deliberate bridge into empty ground.
- **The remaining 11 sit on a degree-2/3 node** (`rn18`, `rn17`, `rn12`, `rn11`, `rn15`, `rn4`).
  A road does continue — but *from the same wet node*, so the continuing edge also runs out wet and
  gets its own outward rescue in its own direction. `default/777 re15#0`→(251,214) and
  `re16#0`→(250,214) are the same node's two edges flinging two abutments to two different cells;
  `dawn/777 re15#0` and `re19#0` both fling to (141,149).
- Direction is incidental, not corrective: `re17#0`'s node is the stale `lakeside_dock` cell
  (217,211) and the real dock is at (228,221) to the south-east; the tangent rescue walked
  **west** to (212,210), directly away from the destination.

**Verdict: `nearestDry` is doing the only thing available to it and is not the defect.** Given a
road that ends in a lake, "land the abutment on the nearest dry ground" is a defensible answer; the
answer is unusable because the *road graph* is wrong. This is a road-graph problem presenting as a
bridge problem. Independent corroboration from worldgen's own logs: the connection-split repair
fires on 5 of the 6 combos (`connection repair FIRED for ironkeep_castle→lakeside_dock — carved 16
tile(s)`, `amberharbor→palefield_farm — 48 tiles`, `azuredun_camp→mirage_oasis — 139 tiles`, …) —
i.e. worldgen already knows these roads do not reach their settlements and is BFS-patching a
connector after the fact.

---

## 4. Decks where the rescue fired but the bank still landed on a road (10)

Listed so the population is complete, and because two of them are the **only** instances of the
brief's case (3).

| combo · deck | node | node wet? | note |
|---|---|---|---|
| default/777 `re0#0` | `rn0` (234,175) poi·oakshire | yes, Lake | mechanism A; ring rescue landed on a road (offRoad 0.0) |
| default/777 `re8#0` | `rn11` (245,170) waypoint | yes, Lake | mechanism B; bank 2.93 off its OWN ribbon but 0.0 off another |
| default/777 `re9#1` | `rn12` (198,161) poi·ironvein_mine | yes, Lake | **authored-data variant of A**: `stonehaven_city→ironvein_mine`'s terminal waypoint is (67,65) while the mine is authored at (89,70) — the road was never aimed at the mine. Node is 27.9 tiles from the mine's final (224,171). |
| dawn/777 `re9#0` | `rn10` (178,186) poi·palefield_farm | yes, Lake | mechanism A; bank 3.87 off own ribbon, 0.14 off another |
| dawn/777 `re11#0` | `rn12` (146,204) poi·ember_heights | yes, Lake | mechanism A |
| frost/777 `re18#0` | `rn20` (226,109) waypoint | yes, **River** | mechanism B on a river rather than a lake — the only wet node that is not a lake |
| frost/777 `re19#0` | `rn20` (226,109) waypoint | yes, River | same node, other edge |
| dawn/12345 `re9#0` | `rn10` (178,186) poi·palefield_farm | yes, Lake | mechanism A |
| default/12345 `re3#0` | `rn5` (263,163) poi·crossroads_inn | **no** — Dry, `tile=grass` | **case (3)**: node dry, ribbon ends wet. Polyline terminal cell is (262,161), **2.24 tiles short of the node**, and that cell is drawn water. |
| dawn/12345 `re21#0` | `rn22` (242,110) poi·dune_watch | **no** — Dry, `tile=grass` | **case (3)**, same shape: polyline ends (243,112), 2.24 short of the node, wet. |

Both case-(3) instances are the same mechanism **D**: the edge's polyline is *truncated* relative
to its node. `buildRoadGraph` drops walked cells that fail the obstacle test
(`road-graph.ts:342`: `cells = walked.filter(c => !isObstacle(c.x, c.y))`) — the node stays at the
waypoint but the polyline no longer reaches it, and here the surviving terminal cell happens to be
in water. This is *not* a smoothing bow (`nodeToSmEnd` is 2.24 while the smoothed end coincides with
the polyline end exactly). **Which obstacle drops those cells — building footprint, protected green
or wall — is INFERRED from the code path, not measured.** Neither deck is class-3 (offRoad 0.54 and
1.41), so mechanism D currently costs nothing; it is logged because it is a second, independent way
for a ribbon to end wet and will need a different fix if it ever bites.

---

## 5. Why the deck count rose 37 → 39

Two combos gained one deck each; the other four are unchanged in count. The two are **not the same
kind of event**.

**default/777: 13 → 14, the new deck is `crossing@re5#0` — LEGITIMATE.**
Diffing the road graph pre/post (`EDGE` dump, same probe, both trees) shows the fix changed the
*graph* on this combo: `stonehaven_city`'s road attachment moved from a single shared node
`rn6 (270,188)` to two distinct gate nodes `rn6 (290,170)` and `rn10 (274,204)`, edge `re5` was
re-walked (`len 27 → 29`) and gained two bridge cells `(284,179) (285,179)` where it had none, and
the `re-repair-crossroads_inn-stonehaven_city` split-repair edge **stopped being needed and
disappeared**. Total road bridge cells 52 → 54, matching the probe's `bridged cells` line. The new
deck is clean by every deck-relative measure: abutments (282,178)/(287,179), 4/4 interior chord
cells in drawn water, banks 0.00 and 0.52 tiles from the drawn ribbon, no class flag. This is the
fix working — the road now leaves the city by a gate that faces the water it must actually cross.
*(INFERRED, not measured: the gates moved because the settlement ring is derived from
post-snap-keyed terrain/water stores, which the fix changed. The graph change itself is measured.)*

**dawn/12345: 6 → 7, the new deck is `crossing@re15#0` — ARTEFACT.**
Here the road graph is **byte-identical** pre/post: the `EDGE` diff shows only `pins` counts
changing on `re9` and `re19` (a reconciliation output, not the walk); every polyline length and
every `bridgeCells` list is unchanged, total road bridge cells 16 both sides. Edge `re15` has bridge
cells `(139,152) (140,152) (140,154)`, i.e. two raster runs. Pre-fix both runs resolved to the
**same** opening and the `seenOpenings` dedupe collapsed them into one spec
(`detect-crossings.ts:266-271`, `:328-332`); post-fix the moved ribbon makes them resolve to two
openings, so both are emitted. The extra one, `re15#0`, is a **1.41-tile span with zero interior
chord cells and zero drawn water** — it is also dawn/12345's single class-1 deck. The real crossing
survives as `re15#1`. So this is a spurious second slab at one crossing site, exactly the failure
the dedupe exists to prevent, re-opened by the ribbon shift.

---

## 6. Candidate fixes

Ordered by how far upstream they act. Every acceptance criterion is stated in terms of where decks
end up relative to drawn water and the drawn road — **no criterion is a decline count, and no
criterion is a class-3 count alone**.

Shared acceptance instrument for all of them: `npx tsx scripts/probe-bridge-decks.ts <world> <seed>`
on all six combos (`default|dawn|frost` × `777|12345`), plus the parity gate
`npx tsx scripts/probe-hydrology-parity.ts` must stay at 0 differing cells.

### F1 (primary) — a road's terminal point is the POI's FINAL position, not an authored waypoint

**Where it acts:** upstream of the walker, upstream of the rescue. Two viable placements:

- *Narrow:* a pass immediately after `map-generator.ts:372`, before `gateApproachPlan(:587)` /
  `buildRoadGraph(:614)` — for every connection, if a terminal waypoint equals the endpoint POI's
  freshly-minted `heightAnchor` (the exact pre-snap cell), rewrite it to `poi.position`. Only
  connections that point at a vacated cell change; unsnapped worlds stay byte-identical.
- *Broad:* in `buildRoadGraph` at `road-graph.ts:269-277` — when waypoints exist, overwrite
  `points[0]` / `points[n-1]` with the two POIs' live positions and treat the authored terminals as
  interior hints. This also repairs the authored-data bug behind `re9#1`
  (`stonehaven_city→ironvein_mine`'s terminal waypoint is 28 tiles from the mine).

**Precedent:** `gateApproachPlan` already replaces exactly these two points for ringed POIs
(`gate-approach.ts:109-121`), and the two ringed POIs on default/777 are conspicuously absent from
the wet-node list.

**Size:** narrow ≈ 10-15 lines in one file + a test; broad ≈ 6 lines + wider re-pinning.
**WCV:** bump (routes move on every snapping seed).

**What it would break:** every worldgen-pinned test on the affected seeds; `lint:world`'s finding
mix (re-measure the ~293 baseline before and after and compare counts, not exact matches); road
lengths grow where the snap was large (millbrook 24 tiles, dusk_temple 34) so approach grades,
settlement road-adjacency and `connection repair` firings all shift. It does **not** fix mechanisms
B, C or D.

**Acceptance:**
1. On all six combos, **no deck's abutment sits ≥2 tiles from every drawn road ribbon** unless its
   edge terminates at an inherently-wet POI (`ruins`/`lake`/`swamp`) — i.e. the mechanism-A rows 1,
   2, 5, 6, 7, 9, 11, 12, 13, 14, 16, 17, 19 of §1 all clear, and the survivors are enumerated by
   name and are exactly the mechanism-C set.
2. Every seated deck with span ≥2 keeps **both abutments within 0.75 tiles of its OWN edge's drawn
   ribbon** (`bank*OwnDist ≤ 0.75`) — this is the `nearestDry` fingerprint going to zero for the
   fixed population, and it is the property the class-3 metric is a proxy for.
3. No regression in spanning: every deck with span ≥2 keeps ≥1 interior chord cell in drawn water
   (`maskWet ≥ 1`), and `class2` stays 0.
4. `default/12345` (the no-snap control) stays **byte-identical**: same deck ids, same abutment
   cells. If it moves, the change is broader than the desync.

### F2 — a mid waypoint may not sit in standing water

**Where it acts:** same pass as F1's narrow variant. For each connection's *interior* waypoints,
if the cell is `Lake`/`Ocean` in the generator's own `hydrology.waterType`, move it with the
existing `nearestDryLand` helper (`map-generator.ts:163-180`). Rivers deliberately left alone — a
road *should* cross those.
**Size:** ~8 lines, reuses the helper. **WCV:** bump.
**Breaks:** route shape on any seed with a wet hint; a hint moved to a shore can flip which side of
a lake a road takes. Worth a per-combo route-length delta check.
**Acceptance:** the three mechanism-B decks (§1 rows 3, 8, 10) plus `default/777 re8#0` and
`frost/777 re18#0/re19#0` all satisfy F1's criteria 1-3, and no new deck fails them.

### F3 — a road to an inherently-wet POI stops at the shore

**Where it acts:** the connection point sequence, before the walk. For an endpoint POI **not** in
`DRY_SETTLEMENT_POI` whose cell is Lake/Ocean, terminate the connection at the nearest dry cell on
the POI's own shore instead of at the POI centre (or give such POIs an explicit landing anchor,
which is the more honest data model — the same shape as `POI.coast`).
**Size:** ~15 lines plus a decision about the data model. **WCV:** bump.
**Breaks:** the ruins' road no longer physically touches the ruin — a deliberate visual change
(a causeway/jetty is the eventual answer, not a bridge into a lake).
**Acceptance:** for `forest_ruins`, `bone_ruins`, `boneships_ruins`, **no deck is minted at the
terminus at all** (the walker bridges nothing because the road ends dry), the road's last drawn cell
is dry and orthogonally adjacent to drawn water, and total deck count drops by exactly 3 with no
other deck's abutments moving.

### F4 — a standing contract so this can never regress silently

**Where it acts:** `src/world/connectome-diagnostics.ts` as a new declaration, evaluated by
`npm run lint:world`, plus a `--summary` assertion in `scripts/probe-bridge-decks.ts`.
Rule: *no `feature:'road'` edge may have a terminal node whose cell is drawn water*, exempting
inherently-wet POI termini until F3 lands.
**Size:** ~30 lines. **WCV:** none (diagnostic only).
**Breaks:** nothing; it will report findings until F1-F3 land, so land it with a baseline count.
**Acceptance:** the finding count equals the number of wet road-terminal nodes the probe reports
(9 on default/777 today), and goes to 0 (or to the enumerated wet-POI exemptions) after F1+F2+F3.

### Explicitly NOT recommended

- Tuning `RIBBON_BANK_MAX_TILES`, the tangent/ring order in `nearestDry`, or `MAX_RUN_EXTEND`.
  §3 shows the rescue is answering a well-posed question correctly; the input is wrong.
- Making `banksOnRibbon` decline at a wet ribbon end. That reverts to the raw-walker-chord fallback
  the WCV-122 note calls *"a slab sitting BESIDE the road"* — a different visible defect, not fewer.
- Anything that re-opens the dedupe (§5, dawn/12345). If the spurious 1.41-tile slab needs killing
  on its own, the honest lever is a minimum-span rule on decks with **zero drawn-water chord cells**,
  measured as such — but re-measure after F1, since it may not survive the route change.

---

## 7. What I could not determine

- **Why `stonehaven_city`'s ring gates moved on default/777** (§5). The graph change is measured;
  the attribution to a post-snap-keyed store feeding settlement/ring derivation is **INFERRED**.
- **Whether `oakshire` / `ironkeep_castle` own defensive rings at all.** Their nodes sit on the raw
  stale cell, so gate injection did not fire for them — but I did not distinguish "no ring" from
  "ring exists, `nearestRealGate` returned undefined because every gate is `kind:'gap'`"
  (`gate-approach.ts:64-75`). This matters only for phrasing the F1 precedent, not for the mechanism.
- **Which obstacle truncates the polyline** in the two mechanism-D cases (§4). The code path is the
  only one that can do it (`road-graph.ts:342`); the specific blocking cell is unmeasured.
- **What the player literally sees.** Everything here is read from `getRenderWaterMask` /
  `buildRenderWaterTypeMemo` / `tile.baseType`. No screenshot was taken; a grab at zoom ~1 centred
  on `default/777 (217,211)` (the lakeside_dock terminus, offRoad 5.10, chord 8/8 wet) would be the
  single most informative confirmation.
- **`default × 424242/31337`** were not probed (the brief's six combos were).
- **Runtime paths** (`desire-line-adoption`, `splitEdgeAtIndex`) were not exercised — this is
  worldgen-time only.
