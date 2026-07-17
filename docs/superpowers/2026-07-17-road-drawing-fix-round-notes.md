# Road A\*/drawing fix round — verification notes (2026-07-17, WCV 102)

Five slices closing the road A\*/drawing defects surfaced by the two prior investigations
(the metre-true-grade diagnosis + the 3-seed empirical audit). Harness:
`scripts/road-audit.ts` (cleaned repo version of the scratchpad audit; run
`npx tsx scripts/road-audit.ts 12345 777 999`).

## Slices

1. **S1** — `repairConnectionSplits` connectors become REAL `RoadEdge`s (junction nodes,
   class/surface from the repaired connection → centerline/carve/ribbon like any road);
   `reconcileRoadTileVisibility` clears `baseType` on ribbon-orphaned road tiles so nothing
   walkable renders as bare ground.
2. **S2** — honest centerline reconciliation: `edge.pins` (persisted polyline indices kept
   as spline control points), `reconcileCenterlineBows` (plain-smoothing bows > 0.65 tiles
   re-fitted THROUGH the walked cells — no more stamped "lens" doubling, no more rejected
   sag), `reconcileCenterlineLegality` (escalation ladder: pins → reject node fillet →
   reject all fillets), whole-line `roads.ribbon-legal` error clause + generated-world probe
   test (`tests/unit/road-ribbon-legal-probe.test.ts`), `orthogonalize` both-bad fallback
   prefers the bridgeable water cell over an obstacle cell.
3. **S3** — metre-true grade: walker cost in PHYSICAL rise/run via `reliefM` +
   `METRES_PER_TILE` (envelope 8/12/18/25 % by class; `slopeFactor` 50 → 2.08 ≙ identical
   linear term at default relief; over-grade penalty QUADRATIC in the excess so modest hills
   stay routable while steep faces switchback); sub-tile step grade through the bilinear
   midpoint; carve grade/fill sampling via `heightMetresBilinearAt` at the true fractional
   centerline (plan and carve see the renderer's surface).
4. **S4** — cross-edge tangent continuity: degree-2 shared nodes carry a through-tangent;
   each seated edge end is filleted onto it (same line→arc machinery as gates), killing the
   free-standing ~90° hairpin hooks. Gate/anchor ends stay authoritative; micro-edges
   (< 4 tiles) and true reversal apexes are exempt.
5. **S5** — `WORLD_CONTENT_VERSION` 101 → 102 (+ pin test), full verification below.

## Before / after (seeds 12345 / 777 / 999, default world)

"Before" = the empirical audit on pre-round `main`; "after" = this round's head
(`scripts/road-audit.ts` + the paint-class audit). 999 had no full published baseline;
its before-cells use the earliest in-round measurement where available.

| Metric | Before 12345 | After 12345 | Before 777 | After 777 | Before 999 | After 999 |
|---|---|---|---|---|---|---|
| Road tiles (total) | 766 | 760 | 751 | 907 | ~772 | 892 |
| Ribbon-painted | 404 (53 %) | 488 (65 %) | 418 (56 %) | 543 (61 %) | 416 | 519 (59 %) |
| INVISIBLE tiles (walkable road drawn as ground) | 29 | **0** | 13 | **0** | — | **0** |
| Ribbon-illegal cells (rock/water/curtain/building under the drawn line) | 23 | **0** | 55 | **0** | 9 | **0** |
| Max drawn-vs-walked deviation (tiles) | 1.57 (plain bow) | 1.77 (a stamped, legal fillet span) | 1.56 | 0.83 | 1.54 | 1.41 |
| Max sag off ANY road tile | 2.0 over a 19-tile arc | ≤ 1.41 (one diagonal cell) | 2.0-class | ≤ 1.41 | — | ≤ 1.41 |
| Node kinks (free-standing ~90° hook class) | 92/88/85° present | **gone** (57/54/30/30) | present | gone | present | gone |
| Node angles > 60° remaining (all excluded classes, see below) | 5 | 3 | — | 7 | — | 5 |
| Bridge tiles > 1 tile off the drawn ribbon | — | 0 | — | 0 | — | 0 |
| Repair connectors | 4 (bare tiles, 23 invisible) | 4 REAL edges | 1 | 1 | — | 1 |
| Gate stitches | 0 | 0 | 0 | 0 | 0 | 0 |
| Walked max PHYSICAL grade | 0.31 (old model blind to it) | 0.32 | 1.66 | 1.57* | 1.49 | 1.05 |

\* 777's 1.57 max survives on a short unavoidable pitch; the whole-route picture improved
(total honest detour +~35 % length on the two mountainous seeds — see "route stability").

Also green: `npm run lint:world` (both seeds, 0 errors incl. the new whole-line
`roads.ribbon-legal` clause and `buildings.off-roads-ribbon`), `npx tsc --noEmit`.

## Route stability at default relief (S3 expectation, revised)

The working expectation was "paths change little at default relief since the linear term
dominates". Empirically that held **only for gentle terrain** (12345: 1/24 edges changed,
+2 % total length). Seeds 777/999 are mountainous between their POIs — their old routes
climbed **91–166 % physical grades** the normalised-unit model simply could not see.
Making grade honest necessarily re-routes those (total length +~35 %, worst grade down
1.66→1.57 / 1.49→1.05, visually valley-following, no spaghetti). `gradeOverSteps` remains
high there (398/350 steps above the per-class envelope) because the envelope is a SOFT
economic knee and the terrain leaves no fully-legal line — exactly the signal the
reconciliation-structures track (stairs/embankments) consumes.

## Remaining node angles > 60° — classification (not the hook class)

Probed individually (`wt-kink-probe` in the round's scratchpad):

* **Corridor reversals (155–178°)** — consecutive connection segments genuinely double
  back along a SHARED corridor at a junction waypoint (spur tips; both polylines overlap).
  Route-level artifact, not a drawing one; a tangent cannot fix route geometry. Follow-up
  belongs to route dedup / RoadJunction ownership (WP-C; see `claims.unresolved`
  road-x-road infos).
* **Micro-edges (< 4 tiles)** — angle is inherent; re-shaping degenerates the line
  (guarded in `filletOntoNodeTangents`).
* **Obstacle-trimmed non-meeting ends** — the two edges never reach a shared point.
* **Gate/anchor-owned ends** — the fillet machinery is authoritative there by design.

## Deferred (with reasons)

1. **Bridge-deck "N/M crossings have NO ribbon-seated opening" warning** — root cause is
   UPSTREAM of this round: a road NODE sited in render water leaves no dry bank within the
   ribbon for the deck to seat against (`detect-crossings.ts` declines rather than seating
   an abutment in open water). The fix is road-node/connection-endpoint siting at layout
   time, not centerline honesty; left as-is (the warning is the honest surface).
2. **Settlement street STYLE seam** (blocky tile-colour streets vs the analytic ribbon) —
   explicitly out of scope this round. Follow-up: either project settlement plan edges into
   the road graph so streets get ribbon paint, or commit to the blocky style and make the
   inter-POI approach blend at the settlement edge. Note S1's visibility reconcile makes
   orphan tiles use the SAME blocky style, so the seam is at least consistent.
3. **Graph-adjacent unpainted road tiles** (raster staircase cells straddling the smooth
   ribbon, pavedness ≈ 0) — intentional: the walk raster is 4-connected and wider than the
   drawn ribbon; ground showing between ribbon edge and tile boundary is correct.
4. **Rival `re-repair-*` permissive fallback** — the repair BFS is now barrier-strict
   (never rides a street cell through a croft fence); if strictness ever leaves a seed's
   components unjoinable it falls back to the permissive path WITH a warn, and the
   road×barrier claim lint names the residue. No fallback fired on the audit seeds.

## New/changed contracts & persisted fields

* `RoadEdge.pins`, `RoadEdge.nodeTangentRejected` (persisted with the graph, like
  `filletRejected`); graph `rev` bumps on every reconcile mutation.
* `roads.ribbon-legal` gains the whole-centerline clause (error). Gen self-heals via the
  pin→reject ladder, so a fresh gen is clean by construction; residual errors mean a LATER
  pass stamped illegal ground onto the drawn line (ground truth — investigate that pass).
