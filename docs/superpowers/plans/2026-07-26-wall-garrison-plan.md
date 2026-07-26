# Manning the Walls — garrison plan (2026-07-26)

**Goal:** soldiers garrison the wall-walk when a settlement's contention escalates (schism /
holy_war) or when mustered by command — visibly standing on the allure between the merlons,
facing the field, reached by the mural stair that already exists. Stand down when calm.

**Design contract:** the sim is truth. A manned wall is sim state (assignments, phases,
positions); the renderer only lifts the soldier to the walk height the geometry already
derives. Nothing here is cosmetic-first.

## Code reality (verified 2026-07-26)

- `BarrierRun` is plain data on `map.barrierRuns` (`src/world/barrier.ts`): `path`, `height`,
  `thickness`, `crenellated`, `gates`, `towers?: TowerPlacement[]`, `centroid?`, per-side
  `segments?` (`defends`). Walk height = `H − parapetHeight(H)` (`src/assetgen/geometry/battlement.ts`
  — ONE shared derivation; curtain, towers, hoardings and the mural stair all read it).
- The mural stair exists: ONE flight per crenellated masonry ring, beside the first real gate
  (`stairElements`, `src/render/parametric-barrier-source.ts:658`; geometry `stair-spec.ts`).
  Its placement is currently derived INSIDE the render source — the sim can't see it.
- NPCs: `kind:'npc'` World entities; `NpcRole` includes `'soldier'`; `NpcActivity` union in
  `src/core/types.ts:718`; movement is 60 Hz tile pathfinding (`src/sim/npc-movement.ts`,
  `findPath`); soldiers already cycle combat poses (`COMBAT_POSES`: slash/thrust/shoot) when
  `role==='soldier' && activity==='work'`. Position mutation ONLY via `World.updateEntity()`.
- Threat state exists: `ContentionLedger.stateOf(poiId)` → `calm|tension|schism|holy_war`
  (`src/sim/rival-contention.ts`), live at `state.contention`, stepped by
  `RivalContentionSystem` (`src/game/sim-systems.ts:135`).
- Garrison precedent: `castle-verbs.ts` (`GARRISON_SOLDIERS = 4`, rehomes lord + soldiers;
  verb shape + placement helpers to imitate).
- Render lift precedent: `liftElev` on entity properties lifts bridges/structure meshes
  (`entity-draw-list.ts:264`, `gpu/terrain-lift.ts:76`, `structure-mesh-field.ts:95`).
  **NPC draw items do NOT currently honour any lift** (`z: 0` at `entity-draw-list.ts:202`) —
  that seam must be built, not assumed.
- Nothing in `src/sim/` references barriers today (verified by grep) — this plan introduces
  that edge; keep it acyclic (sim → world, never sim → render).

## Slices

### W0 — Shared circulation truth (pure leaf) — SONNET
New `src/world/barrier-circulation.ts`, importable by sim AND render (precedent: `barrier.ts`
already imports `mToTiles`; importing `parapetHeight` from assetgen/geometry/battlement is fine):
- `walkZOf(run)` — `height − parapetHeight(height)` in tiles (0 for uncrenellated).
- `stairPlacementOf(run)` → `{ foot: [x,y], dir, inward, walkZ } | null` — EXTRACT the exact
  derivation from `stairElements` (gate pick, `off = width/2 + mToTiles(2.4)`, centroid inward)
  and REPOINT `parametric-barrier-source.ts` at it (leaf + repoint, never re-export; the render
  stair and the sim's climb point must be the same spot by construction).
- `wallStations(run, spacing?)` → ordered stations along `path` at ~2-tile spacing on
  crenellated legs: `{ x, y, walkZ, outward: [ox,oy], segIdx }`. Outward from `outwardSign`/
  `centroid`; skip gate/gap spans and uncrenellated legs. Deterministic, allocation-light.
- `arcLengthPoint(run, t)` — position along the path polyline (the on-wall movement track).

### W1 — GarrisonSystem (sim) — OPUS
`src/sim/systems/garrison-system.ts`, registered in `src/game/sim-systems.ts` at low Hz (0.5).
- Per walled settlement (match `map.barrierRuns` ring `centroid` to its POI): muster when
  `state.contention.stateOf(poiId)` ≥ `schism` **or** a standing muster order; stand down at
  `calm` (hysteresis comes free from the ladder's own on/off bands).
- Assign resident soldiers (≤ stations, cap ~8/ring first cut) to stations. New optional
  `NpcProperties` fields (plain data → saves fine): `garrison?: { phase: 'to_stair'|'climb'|
  'walk'|'stationed'|'descend'; stationIdx: number; t: number }` — one object, not loose fields.
- Phase machine driven from `npc-movement.ts` (branch early, like the forced-anim path):
  `to_stair` = normal tile pathfinding to the stair foot; `climb` = parametric slide up the
  flight (t 0→1, z grade→walkZ); `walk` = parametric along the run polyline to the station
  (NO tile pathfinding on the wall — wall tiles aren't walkable and must stay that way);
  `stationed` = stand facing `outward`, combat/watch pose (reuse `stationaryAnimation` —
  extend its soldier branch); `descend` = reverse. Update x/y via `World.updateEntity` every
  move; write current wall height to `p.wallZ` (tiles above grade, absent when grounded).
- All randomness via `ctx.rng`. All time windows in REAL time (1:1). No `src/sim` → render
  imports. Persisted fields must survive `restoreSnapshot` untouched (plain data).

### W2 — Render: soldiers stand ON the wall — OPUS
- NPC draw items gain a vertical lift from `p.wallZ` (convert tiles → px with the same
  `zPxPerM`/`liftPxFromElev` conventions the bridge lift uses — study `terrain-lift.ts` and
  keep foot-z parity so the soldier's feet sit the allure, not float).
- Draw order: an on-wall NPC must sort OVER its wall piece (walls bias `sortX/sortY`; verify
  against `chunkBarrierRun` piece sort keys; a soldier behind a merlon but in front of the
  walk is the acceptance bar). Verify with a live grab at zoom ~1 AND
  `scripts/barrier-world-preview.ts` if extendable cheaply.
- Facing: `outward` → `directionFromDelta`; stationed soldiers use 'shoot'/'thrust' poses.

### W3 — Command surface + triggers — SONNET
- Registry verbs `muster_garrison` / `stand_down_garrison`, settlement target, AUTHORING-tier
  shape copied from `castle-verbs.ts`; previews + honest refusals (no wall ring / no soldiers
  / already mustered). **GOTCHA:** growing a targetKind's verb set breaks the
  hover-affordances ranking pins — update those tests in the same commit.
- Auto-muster on contention entering `schism`/`holy_war`; auto stand-down on `calm`; emit an
  event-log entry + coalesced inbox tiding ("the walls of X are manned").
- Verbs must be in the capability registry allowlist (story-pack live-verbs guard).

### W4 — Tower circulation geometry — SONNET (after W0–W2 land)
From today's circulation audit: move the tower doorway to WALK level on flank towers (door
faces along the wall so the allure enters the tower; keep the grade door on gate towers), add
a vice turret (small cylinder + corbel, walk → crown) on drums. Geometry change ⇒ update
`assetgen-golden` pins AND bump `ART_RECIPE_VERSION` (read current from
`src/core/content-version.ts`) in the SAME commit. Barrier sprites are parametric (composed
live, no paid gen) — no reseed implications.

### W5 — Tests — SONNET, throughout (each slice lands with its own; this is the sweep)
- `barrier-circulation.test.ts`: stations deterministic/ordered/outward-facing; walkZ matches
  `parapetHeight`; stair placement identical to what the render source consumes (parity pin).
- `garrison-system.test.ts`: muster at schism, ≤ stations, stand-down at calm, phase
  progression reaches `stationed`, positions only via `updateEntity`, replay-deterministic.
- Draw-order: on-wall NPC sorts over its wall piece (headless, no WebGPU).
- Existing guards must stay green: no-random-in-sim, state-reset-parity (new NpcProperties
  fields don't change `GameState` shape; if any state field IS added, that test pins the count
  and tells you what to do), content-version test in the same commit as any version bump.

## Out of scope (this round)
Combat resolution on the walls, missile fire, enemy assault NPCs, sieges — this round makes
walls MANNED and legible, not fought over. Fate promotion of the muster verb: note as
follow-up. Hoarding-gallery occupancy: follow-up.

## Verification bar (per slice and at end)
`npx tsc --noEmit` clean · `npm run lint` zero · targeted suites green · full suite parsed
from the SUMMARY (harness exit code unreliable) · `./scripts/ci-on-server.sh` green
(grep `✓ Server CI passed`) before the branch is declared done. NO merge to main, NO push —
report back with the branch ready.
