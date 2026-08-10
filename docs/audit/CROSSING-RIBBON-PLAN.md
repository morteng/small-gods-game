# Bridges beside the river: re-seat the deck on the graph the game actually draws

Measured baseline at HEAD 63a3bd78 (clean tree), via `npx tsx scripts/probe-world.ts --genseed <s>`:
- genseed 777:   `[worldgen] 8/13 crossing(s) have NO ribbon-seated opening`  (NOT 4/8 — see §E)
- genseed 12345: no decline warn (3/3 seated per the WCV-117 note in content-version.ts)
- genseed 424242, 31337: no decline warn

Current `WORLD_CONTENT_VERSION = 121` (src/core/content-version.ts:172), pinned at
tests/unit/content-version.test.ts:15.

## A. What actually happens today

1. The router records, per road edge, the RAW walked polyline + the cells it chose to bridge
   (`edge.bridgeCells`) (src/world/road-graph.ts).
2. Gen detects crossings ONCE, at src/map/map-generator.ts:716, with `isWater`/`bridgeAt` =
   render-water mask. `detectCrossings` seeds runs from `bridgeCells` (detect-crossings.ts:253-267),
   extends them over render-wet road cells (:268-277, cap `MAX_RUN_EXTEND=5` :60), and seats
   `bankCells`/`axis` via `banksOnRibbon` on `smoothCenterline(polyline, edge.pins)` (:246-248, :292-311).
3. AT THAT MOMENT `edge.pins` IS EMPTY. The only pin writers are `reconcileCenterlineBows`
   (road-deformation.ts:1189) and `reconcileCenterlineLegality` (:1300); in gen, bows first runs at
   map-generator.ts:924 — 200 lines AFTER detection. So step 2's "ribbon" is the UNPINNED plain
   Catmull-Rom, which bows up to ~1.6 tiles off the walked path (road-deformation.ts:1095-1097).
4. Ancillaries realize from those specs (map-generator.ts:720, `withSpan:false` :722); stair
   suppression reads their banks (:888-904, `CROSSING_STAIR_EXCLUDE=5`).
5. `reconcileCenterlineBows` (:924) pins the plain smoothing back within 0.65 tiles of the walked
   path (`RECON_MATCH_MARGIN_TILES`, road-deformation.ts:759; loop :1130-1198) and bumps `graph.rev`.
6. `reconcileFilletRaster` (:929) re-stamps road/bridge TILES along the final line; its legal-water
   cells come from `deckCellKeys` → `getCrossingOpenings` → a FRESH `detectCrossings` on the
   now-pinned graph (road-deformation.ts:921; crossing-openings.ts:53-68).
7. The span pass (:946-981) builds every bridge entity from the STALE step-2 specs; when a spec has
   no `bankCells`, `buildBridgeObject` falls back to the raw walker chord (crossing-structures.ts:98-112).
8. The DRAWN ribbon = pins + node/gate/anchor fillets + `pinBankOpenings(fresh openings)`
   (road-deformation.ts:565-583).

Net: the drawn ribbon, the tile raster, and the `bridge.seating` lint all consume POST-pin
openings; the physical deck alone consumes PRE-pin specs. Any pin that moves detection moves the
road but not the bridge — the user's "bridge to the side of the place it should cross".

## B. Why the two prior fixes did not hold

- **WCV 115(b)** made the detector smooth with `edge.pins` "the SAME bow-reconciliation pins the
  drawn ribbon uses" (detect-crossings.ts:246-248). True — *if pins exist*. They exist for every
  post-gen consumer (`getCrossingOpenings` runs on the finished, pinned graph), but at the ONLY
  call that sites decks (map-generator.ts:716) no pin has been written yet (§A.3). The fix aligned
  the openings/raster/lint path with the drawn road and left the deck on the unpinned curve.
- **WCV 117(a)** (`nearestDry`, detect-crossings.ts:146-164, 185-208) rescues exactly one decline
  shape: the walk runs off the ribbon END while wet (:149-164). DECLINE-A returns at :139 before
  any walk starts; DECLINE-B returns at :169 at the cap. Both untouched. Its diagnosis ("a road
  NODE sited IN the water", also crossing-structures.ts:95-97) is now empirically disproven for the
  gen-time declines: snapping road waypoints off water changed nothing (prior experiment, reverted).

Both rounds tuned the seating HEURISTIC downstream of a stale input. This plan changes WHICH graph
state the seating reads — the same post-reconcile state every other consumer already reads. That is
a source-of-truth/ordering repair, not a third heuristic: after it, deck, ribbon pin, raster stamp
and lint are all projections of ONE detection on ONE graph state.

## C. The decision

**Q1 — move detection to the drawn ribbon?** No — split the two halves detection already has.
CROSSING EXISTENCE + IDENTITY stay seeded on the raster `bridgeCells`: (a) tangential contact
between a bankside road and the wide drawn ribbon must not mint crossings (guard rationale,
detect-crossings.ts:39-46); (b) `crossing@<edge>#<n>` ids anchor ancillary `poiId`s
(crossing-structures.ts:496), the crossing-tier store re-key and desire-line host-split renames
(desire-line-adoption.ts:207-209, :305-322) — identity must be a function of router intent, not of
smoothing state; (c) `claims.unresolved` / `road.on-water` are tile-raster truths
(claims-diagnostics.ts:36; connectome-diagnostics.ts:488-509) resolved by the deck over the
walker's own `bridge` stamps. SEATING (bankCells/axis/spanTiles) moves to the post-reconcile graph
by RE-RUNNING `detectCrossings` inside the existing span pass. Where in the order: exactly
map-generator.ts:946 — already after bows (:924) and fillet raster (:929); no pass moves.
Ancillaries keep the early specs (they need pre-assembly tiles and are ring-nudged ±4 anyway);
stair exclusion keeps early banks (drift ≤ ~2 tiles vs radius 5).

**Q2 — a crossing whose ribbon genuinely never crosses render water.** It is NOT a phantom you may
drop. The walker stamped `bridge` TILES over tile-water there, and `bridge.tiles-vs-deck` errors on
any bridge-tile run with no deck over it (connectome-diagnostics.ts:679-700); `road.on-water`
exempts those tiles only because a deck resolves the claim (:498-499, pinned by
connectome-diagnostics.test.ts:158-162). So the fallback deck stays — the existing comment's
conclusion survives even though its node-in-water diagnosis does not. What changes: the residual is
COUNTED PER REASON (§D slice 2) so it can never again read as "fixed". If post-fix residuals turn
out to be tile-vs-render water disagreement on thin reaches (the cell mask stamps a cell only when
its centre is in the swath — WCV 112 note), the follow-up is judging "visible channel" via
`getRenderWaterDist`, measured first.

**Q3 — DECLINE-B / raising `RIBBON_BANK_MAX_TILES`.** Not as a blind bump. A ~15-tile wet ribbon
run is ~3× the widest authored reach (~5-tile band — the stated basis of `MAX_RUN_EXTEND`,
detect-crossings.ts:57-60): that is a ribbon running ALONG drawn water (bankside road inside the
render swath, lake margin, estuary), not a wider river. A cap big enough to "seat" it would
(a) seat banks far down the shore → a deck lying along the channel; (b) via `deckLineCells`
(crossing-openings.ts:82-112) legalize a 15-tile water lane the ribbon may then legally paint over
(road-deformation.ts:921/:1055/:1257/:1335 all treat deck cells as legal water); (c) let the
`seenOpenings` dedupe (detect-crossings.ts:259-317) merge distinct crossings into one monster.
Decision: classify first (slice 2 logs wet-run length per decline); bump the cap only if a genuine
transverse class with width ≤ ~8 shows up, to that measured width, with the exactness suite as the
regression gate.

## D. The plan

**Slice 1 — spans seat on the post-reconcile graph.** *Independently shippable. THE fix.*
- Change: in the span pass (map-generator.ts:946-981), re-run
  `detectCrossings(roadGraph, width, { isWater: renderWaterAt, bridgeAt: renderWaterAt, defaults: {…} })`
  (same options as :716) and build `buildBridgeObject` + the decline warn from these FRESH specs.
  Early `crossingSpecs` keep feeding ancillaries (:720) and stair exclusion (:890) unchanged.
- Files: src/map/map-generator.ts (~15 lines); src/core/content-version.ts 121→122 + matching pin
  in tests/unit/content-version.test.ts — SAME commit (deck entity positions are worldgen output).
- Measurement: seed 777 decline warn 8/13 → strictly fewer (target ≤ 2 — WCV-117 names at least
  one genuine open-water residual on 777); 12345/424242/31337 stay warn-free;
  `npx tsx scripts/connectome-lint.ts 777 12345` — `bridge.seating`, `bridge.tiles-vs-deck`,
  `claims.unresolved` counts not worse; the six guard suites + full `npm test` green; `npm run lint`
  zero; `npx tsc --noEmit` clean.
- Could break: if pins flip the `seenOpenings` dedupe, a later run's id shifts (`#2`→`#1`) and an
  ancillary's `poiId` points at an id no deck carries — cosmetic grouping only, nothing joins on it
  hard (verified: tier store and adoption key off openings/entities, not ancillary poiIds). Deck
  count can drop where two runs newly share one opening — that is the intended one-opening-one-deck
  rule. `bridge-deck-carries-road.test.ts` is pure-unit over `buildBridgeObject` and does not
  constrain this; nothing here touches deck elevation, so the "underside never below its bank" pin
  (:232-241) is untouched.

**Slice 2 — decline reasons become data.** *Independently shippable. No WCV bump (log/spec-internal
only — no entity or tile changes).*
- Change: `banksOnRibbon` returns a typed decline reason (`no-wet-interval` at detect-crossings.ts:139,
  `cap` at :169, `end-no-dry` when `nearestDry` fails); `detectCrossings` carries it on the spec
  (optional field, never persisted); the map-generator warn (:976-980) prints a histogram, e.g.
  `2 declined (1 cap, 1 no-wet-interval)`. ~40 lines in detect-crossings.ts + map-generator.ts.
- Measurement: the warn itself; gives §E its missing numbers on every seed.

**Slice 3 — residual DECLINE-A: window from the run, not a pad.** *Contingent on slice-2 data; NOT
independently shippable before slice 1.*
- If `no-wet-interval` persists post-slice-1: seed the wet-interval scan from the run's own
  (extended) wet raster cells projected onto the ribbon via `arcOfNearest`, unioned with the
  current ±`RIBBON_SCAN_PAD_TILES` window — robust to oblique crossings where the crossing point
  slides > 3 arc-tiles. detect-crossings.ts only; WCV bump + pin; measured on the same counters.

**Slice 4 — DECLINE-B remedy.** *Contingent on slice-2 classification.*
- Transverse-wide class (wet run ≤ ~8): raise `RIBBON_BANK_MAX_TILES` 6→measured width; WCV bump +
  pin; regression gates = bridge-crossing-exactness suite and the painted-ribbon-yields-to-water
  block (bridge-deck-carries-road.test.ts:244-288), plus max `deckLineCells` run length logged.
- Along-channel class: leave declined (deck falls back, counted); optionally a named road-contract
  warn on the offending edge so routing owns the repair. No constant bump.

## E. What I could not determine

- **The 4/8 baseline.** The brief's `4/8` on genseed 777 did not reproduce: a clean HEAD measures
  8/13, twice. All targets above are stated against 8/13. (The 4/8 may have been measured on a
  dirty tree during the reverted waypoint experiment.)
- The per-reason A/B split at HEAD — I did not re-instrument (read-only); slice 2 makes it permanent.
- Whether the 15-tile wet run on 777 is a lake margin, estuary, or bankside road — slice 2 answers it.
- Whether `reconcileCenterlineLegality` is wired into gen at all (no caller found in src/); if it is
  added later, slice 1 stays correct because it re-reads whatever graph state exists at span time.
- Whether render-mask gaps on sub-cell-width reaches contribute residual A declines (inferred
  possibility from the WCV-112 centre-in-swath stamping rule; unmeasured).
- 424242/31337 show no decline warn, but "zero crossings" vs "all seated" is indistinguishable
  from the warn alone (it only fires when declined > 0); slice 2's histogram fixes that too.

Verified vs inferred: every file:line above was read in the planning session. Inferred (flagged):
the exact `bridge`-tile stamping site in `applyRoadMask` (supported by
connectome-diagnostics.ts:482-509 and connectome-diagnostics.test.ts:158-162, not read at its
definition), and the render-mask-gap hypothesis.

---

## Parent-session verification (2026-08-10, before accepting this plan)

The plan was written by a read-only planning agent. Its load-bearing claims were re-checked
independently against the source before it was saved:

- **CONFIRMED — the ordering defect.** `src/map/map-generator.ts`: `detectCrossings` at :716,
  `reconcileCenterlineBows` at :924, the span pass (`buildBridgeObject` + the decline warn) at
  :946/:959/:976. The only writers of `edge.pins` anywhere in the tree are
  `src/world/road-deformation.ts:1189` and `:1300`. Nothing writes a pin before :716, so the deck
  really is sited from the unpinned curve. This is the plan's whole foundation and it holds.
- **CONFIRMED — the 8/13 baseline.** A clean-tree probe run reproduced
  `[worldgen] 8/13 crossing(s) have NO ribbon-seated opening` on genseed 777. The earlier `4/8`
  figure (recorded in session memory) is wrong; 8/13 is the number to beat.
- **CORRECTED — §E bullet 4 is resolved, in the plan's favour.**
  `reconcileCenterlineLegality` *is* wired into gen: it is called at
  `src/world/road-deformation.ts:960`, inside `reconcileFilletRaster` (defined at :919), which
  map-generator invokes at :929. So by the span pass at :946 BOTH bow pins and legality pins
  exist — strictly more of the drawn ribbon's final shape than the plan assumed. Slice 1 is
  better-founded than it claims, not worse.

Not re-verified (stated as such): the crossing-openings / desire-line-adoption line references in
§C, and the slice-2/3/4 line numbers inside `detect-crossings.ts`. Those are navigational, not
load-bearing — slice 1 is the fix.
