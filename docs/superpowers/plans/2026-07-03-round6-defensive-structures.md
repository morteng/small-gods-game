# Round 6 — Defensive Structures That Mean It (2026-07-03)

**Status: LAUNCHED 2026-07-04, base SHA `86c84ee` (post-round-5 main).** (WP-P gates-first was the
prerequisite — gates are committed authoritative objects on the ring, produced BEFORE roads/streets.)
A parallel investigation into barrier 3D-mass/join geometry defects (user report) ran alongside and
its findings were commissioned as **WP-U** (below), added at launch time.

Goal: turn settlement defenses from *enclosure geometry* into *fortification*. Today the ring
answers only "what polygon contains the buildings?" — the rung is picked by building count alone
(`selectSettlementEnclosure`, enclosure.ts:84), towers land wherever RDP simplification leaves a
corner, and nothing in the pipeline knows what a wall is for. Real fortification design is driven
by terrain advantage, coverage geometry, and depth; this round adds all three plus a
simulation-backed lint that keeps them honest.

Historical grounding used throughout (treat as the domain spec):
- Walls sit on the **break of slope** / high ground; where a cliff or deep water already defends,
  the wall is lighter or absent — the curtain is the *gap-filler between natural defenses*.
- **Every wall run must be flankable from a tower within effective bowshot** (~30–60 m; at our
  1 tile = 2 m: 15–30 tiles). Salient (convex) angles and gates get towers first; gates get
  *flanking pairs* — the gatehouse is the strongest point of the circuit, not the weakest.
- **Depth**: ditch outside the curtain (with causeways at gates), cleared killing field beyond
  that, keep/citadel as an inner fallback. (Keep/citadel is deferred — see end.)

**Guiding principle (same as round 5):** refactor, don't bolt on. The result should read as one
coherent design; delete or demote what you obsolete.

## Shared protocol (all agents)

- Branch from post-round-5 `main` (base SHA given at launch) in your isolated worktree.
- Commit with **explicit paths** (never `git add -A`). Do NOT push, do NOT merge to main.
- Targeted tests + `npx tsc --noEmit` before finishing; the integrator runs the full gate.
- **Do NOT bump `WORLD_CONTENT_VERSION`** — integrator bumps once (WP-R and WP-S change worldgen
  output; WP-T is lint-only).
- Determinism: same seed twice ⇒ byte-identical world. All `src/sim/` stays `Math.random`-free.
- `npm run lint:world` must be **0 errors on both seeds** when you finish, and probe ≥2 genSeeds
  via `scripts/probe-world.ts`. A visual probe render catches geometry bugs no assertion does —
  do at least one and describe it.
- Offline barrier/visual harness: `scripts/barrier-world-preview.ts`; develop against the studio
  (`?studio=site`), not the live game, where applicable.
- Report back: files touched, mechanism summary, test results, deviations, seams left for the
  integrator.

## Merge order: WP-R → WP-S → WP-U → WP-V → WP-T

WP-T's new contracts validate what R and S build; it merges last and must be green against their
combined output. WP-S consumes WP-R's ring metadata (see coordination notes) but is developed in
parallel against a small interface agreed below.

---

## WP-R — Terrain-seeking ring + nature-defends segments  [model: opus]

**Today:** `traceRing` (enclosure.ts:162) casts 96 rays from the cluster centroid, takes a
windowed circular-max to enclose each sector's buildings, tucks landward of nearby water, and
RDP-simplifies to ≤14 vertices. The heightfield is never consulted: walls happily run along the
bottom of a slope, ignore ridgelines, and build full-strength curtain along cliff tops where
nothing can approach.

**Build:**
1. **Cost-based ray-length choice.** For each ray, the radius is currently "just past the
   outermost building (+ water tuck)". Make it a small 1-D optimization per ray: candidate radii
   from the building-clearance minimum outward to a bounded slack, scored by terrain — prefer
   landing on locally high ground / at the break of slope (outward drop ≥ inward drop), penalize
   wall-on-upslope-approach (enemy above wall = worst case). Keep the windowed circular-max
   *afterwards* so enclosure of buildings remains the hard constraint; terrain preference only
   spends the slack. Bounded, deterministic, cheap (96 rays × small candidate set).
2. **Nature-defends classification.** After the ring is traced, classify each ring segment by what
   lies immediately OUTSIDE it: `open` (buildable approach), `water` (existing water-fronted
   logic), `steep` (outward slope above a threshold — cliff edge / sharp drop). Emit this as
   per-segment metadata on the ring object (this is the interface WP-S consumes — settle the shape
   early and don't change it after: suggest `ring.segments[i].defends: 'open'|'water'|'steep'`
   plus the existing gate/gap classification).
3. **Lighter walls where nature defends.** `steep` segments keep the curtain (rendered walls atop
   cliffs look right and read well) but are marked so WP-S can relax tower spacing there and WP-T
   can exempt them from approach checks. `water` segments keep today's gap behavior. Do NOT drop
   curtain entirely on steep segments this round — visual continuity of the ring is worth the
   stone; the metadata is what matters.
4. **Renderer/collision lockstep.** The ring still feeds `place-barrier.ts` blocking cells and the
   slab-midpoint (k+0.5) renderer sampling — gate/gap positions committed by the round-5
   gates-first pass must be preserved exactly. You are changing ray RADII and adding metadata, not
   the gate model.

**Acceptance:** lint:world 0 errors both seeds + ≥2 probe genSeeds; determinism; visual probe on a
settlement near relief (walls visibly prefer the high line / break of slope — describe before vs
after); building enclosure never violated (every settlement building strictly inside the ring —
add a test); segment metadata present and stable across re-gen.

**Files (expected):** `src/world/enclosure.ts` (core), heightfield query helper it needs, tests.
**Do not touch:** tower/gatehouse compose or placement (WP-S), contracts/lint (WP-T),
terrain-deformation writers (WP-S owns the ditch).

---

## WP-S — Coverage-driven towers + ditch & killing field  [model: opus]

**Today:** drum towers land only where RDP simplification leaves a polygon vertex ("a real turn",
enclosure.ts:159); gatehouses sit at gates. Tower positions are an artifact of line simplification,
not a defensive decision. There is no ditch and no cleared approach.

**Build:**
1. **Coverage placement pass** over the committed ring (runs after WP-R's trace; consumes its
   per-segment `defends` metadata — coordinate on that interface, develop against a stub until
   WP-R's branch stabilizes it):
   - **Gates first:** each committed gate gets a flanking PAIR of towers (one each side, just
     outside the gate leaf span). The existing gatehouse artifact stays; pairs supplement it on
     town-wall-rung settlements (palisade rung: gatehouse only — palisades historically had
     simple gate towers at most).
   - **Salient vertices next:** convex ring vertices (exterior angle above a threshold) get a
     drum tower — these are the positions that can see along two wall faces.
   - **Fill to max spacing:** no `open` wall run may exceed MAX_TOWER_SPACING (default 24 tiles
     ≈ 48 m, tunable per rung); `steep`/`water` segments relax to 2× or unlimited. Fill towers go
     at run midpoints.
   - Deduplicate (a salient tower within min-spacing of a gate flanker wins by priority:
     gate pair > salient > fill). Deterministic ordering.
2. **Ditch band** (town-wall rung only): a shallow negative deformation band OUTSIDE the curtain
   via the existing shared terrain-deformation channel (`world/terrain-deformation.ts` — same
   mechanism as earthworks/pads). Width ~2 tiles, offset ~1 tile out from the blocking cells.
   Hard constraints: **causeway (no ditch) across every gate approach** for the full road width;
   never under buildings, roads, or water; never on `water` segments (the river IS the moat);
   skip where extramural suburb parcels/roads abut the wall (bridge-annexed suburbs exist —
   check parcel data before carving). Dry ditch only — no water fill this round.
3. **Killing field:** cull trees/scrub in a band outside the wall (~6 tiles) on `open` segments —
   reuse the vegetation-cull machinery the settlement-wear/trample pass uses. Grass stays; only
   sightline-blocking vegetation goes. Respect suburbs and orchards/fields (cultivated parcels
   are exempt — farmland outside walls is historically correct).
4. **NPC safety:** the ditch is a deformation, not a collision object — verify NPCs don't path
   through the ditch band awkwardly (deformation depth shallow enough to walk, or add the band to
   tile costs; prefer the former, keep it simple).

**Acceptance:** lint:world 0 errors both seeds + probe genSeeds; determinism; probe render of a
walled town: gate flanking pairs visible, no open wall run > MAX_TOWER_SPACING (assert in a test
over the placement output, not just visually); ditch visibly breaks at gates with a clean
causeway; no building/road/suburb intersected by the ditch (test); killing-field band clear of
trees on open segments (test).

**Files (expected):** `src/world/enclosure.ts` tower-placement section (coordinate with WP-R —
your pass CONSUMES the traced ring; keep edits to a distinct placement function/region and agree
merge order R-then-S), `src/world/place-barrier.ts` if tower entities register there,
`src/world/terrain-deformation.ts` callers (new ditch writer), vegetation cull site, tests.
**Do not touch:** ring tracing itself (WP-R), contracts/lint (WP-T).

---

## WP-T — Hostile-approach lint contract  [model: sonnet]

**Today:** nothing validates that a defended settlement actually defends. The contract layer
(`evaluateContracts`, connectome-contracts.ts:128; wall contracts in
`src/world/connectome/wall-contracts.ts`) already validates road/gate coupling — this WP extends
it with a raider's-eye check, the same way `gate.road-connected` keeps roads honest.

**Build:** new contract family evaluated per defensive ring (declared alongside
`settlementRingContracts`):
1. **`defense.closed-circuit`** (error): pathfind a hostile agent (walls + buildings block; deep
   water impassable; gates PASSABLE — raiders walk in open gates) from ≥4 map-edge entry points to
   the settlement core (plaza/center-most building). Assert every found path crosses the ring only
   at gate cells or `water`/`steep` nature-defends segments' — i.e. no forgotten hole in the
   blocking-cell circuit. Uses the ring's blocking cells + segment metadata from WP-R.
2. **`defense.gate-observed`** (warn): every gate approach path spends ≥N of its last M tiles
   within RADIUS of at least one tower (tower positions from WP-S's placement output). Warn-level:
   this measures quality, not correctness.
3. **`defense.no-cheap-bypass`** (warn): the cheapest hostile path to the core via a gate should
   not be dramatically beaten by a non-gate route (possible only via nature-defends segments —
   if fording a `steep` cliff is somehow cheaper than the gate, the metadata thresholds are wrong).
   Compare path costs; warn on ratio < 1.
4. Wire into the existing three consumers (linter CLI, MCP `lint_seed`, dev gallery) — they all
   run `evaluateContracts`, so declaration should be enough; verify.
5. **Reuse, don't fork, pathfinding:** build the hostile cost function on the existing A*
   machinery (`src/sim/pathfinding.ts` or the worldgen-side walker) with an injected
   walkability predicate — do not write a third pathfinder.

**Acceptance:** new contracts green (0 errors; warns acceptable and REPORTED with counts) on both
seeds + probe genSeeds AGAINST WP-R+WP-S OUTPUT (you merge last; final validation happens on the
integrated tree); a deliberately-broken fixture test (ring with a hole ⇒ `defense.closed-circuit`
error fires; tower removed ⇒ `gate-observed` warn fires); runtime cost of the new lint bounded
(report timing — it runs in `npm run lint:world`, keep it well under a few seconds per seed).

**Files (expected):** new `src/world/connectome/defense-contracts.ts` + registration,
tests, possibly a small shared hostile-walkability helper. **Do not touch:** enclosure.ts
(WP-R/S own it), tower placement, deformation writers.

---

## WP-U — Barrier 3D-mass & join fixes  [model: opus] (added at launch, 2026-07-04)

Commissioned from a rendered forensics audit (evidence: session scratchpad `barrier-geometry-audit/`;
harness: `scripts/barrier-world-preview.ts`). Fix layer is `parametric-barrier-source.ts` +
`assetgen/geometry/` specs + `render/iso` lift — files no other round-6 WP touches.

1. **D1 (blocker):** mural stairs placed on every ≥8-tile ring segment render as rubble stubs /
   floating columns — remove from rings except (at most) one readable flight at the main gate.
2. **D2:** gatehouse tower crowding + gate leaf floating above grade (confirm mount math first).
3. **D3:** square-cut curtain chunk end-faces poke past drum towers at diagonal vertices — oversize
   drums / extend chunks into the vertex.
4. **D4:** merlon phase restarts per 4-tile chunk (non-integer period ⇒ seam notch) and towers use a
   different pitch — phase off global path-distance, unify the period.
5. **D5:** towers/stairs paint uncoursed `stone` vs curtain's coursed masonry — unify `work`.
6. **D6 (verify-first):** barrier sprites use the building `dw/4` foot-lift convention ⇒ adjacent
   pieces lift differently on slopes (seam base mismatch). Confirm on sloped render before fixing;
   matters because WP-R makes walls hug slopes.

Accepted as-is: outward-only parapet (no merlons on viewer-facing walls).
Goldens: geometry changes re-pin `assetgen-golden.test.ts` hashes; integrator owns the
`ART_RECIPE_VERSION` bump decision. **Do not touch:** enclosure.ts, terrain-deformation.ts,
connectome/ (WP-R/S/T own those). Integrator reconciles the combined gate visual (WP-S flanking
pairs + WP-U gatehouse spacing) after both merge.

---

## WP-V — Ground-blend: foundation pads + doorstep/perimeter wear  [model: opus] (added at launch, 2026-07-04)

Commissioned from a terrain-blend audit (user ask: placed objects should shape the terrain
under/around them so they look built-there). Audit verdict: the deformation-pad and wear machinery
both exist but under-fire — pads level to footprint MEAN (no-op on flat sites) and cover burgage
lots only; wear radiates only from roads + market. The sprite ground-apron the user remembered
(`skirt`/`skirtFade`, compose.ts) is REAL but studio-only, and stays parked behind the reseed
freeze; the terrain-side texture apron (feature-SDF surface variant for plinths, promised in
feature-geometry.ts's header) is a future standalone WP.

1. **Pad settle-in + skirt:** `buildSettlementPadDeformations` levels to mean **minus ~8–15 cm**
   with a wider ~1–2 tile outward feather; coverage extends to civic sites/market/all footprints.
   Sprites follow automatically (mesh + foot-z read the same composed heightfield).
2. **Wear sources:** extend `prewarmSettlementWear` (no new system) with doorstep blobs at door
   anchors + light perimeter rings on high-traffic types; expresses through `grid.deposit()` →
   dirt-cap promote path.

Deferred by design: wall-foot wear (needs round 6's FINAL ring — post-merge follow-up), sprite
apron (reseed freeze), texture apron (standalone WP). **Do not touch:** enclosure.ts,
terrain-deformation.ts, connectome/, parametric-barrier-source.ts. Merges after WP-S (both touch
settlement-wear.ts; WP-V keeps edits scoped to the prewarm deposit sources).

---

## Integrator

Merge WP-R → WP-S → WP-T; single WCV bump + changelog line; full suite + build + lint:world both
seeds + probe genSeeds; browser E2E visual pass on a walled town (high-line walls, flanking pairs,
ditch causeways, cleared approaches); zombie-session check; ONE push; docs/memory update.

## Deliberately NOT in this round

- **Threat-driven fortification as gameplay** (rung/upgrades responding to raid/rival event
  history; wall wear/decay via the road-evolution state model; a Fate `fortify_settlement`
  authoring verb) — round 7 candidate; touches sim + Fate, not worldgen, and wants this round's
  placement machinery to exist first.
- **Keep/citadel + concentric inner ring** (promote the motte-and-bailey studio work into
  settlement gen) — wants terrain-seeking (WP-R) proven first; natural round-7 pairing with
  threat-driven evolution.
- Wet moats (water-filled ditch: hydrology interaction, deferred), portcullis + merlon phase
  (already on the parametric-walls NEXT list), postern gates, wall-walk connectivity.
