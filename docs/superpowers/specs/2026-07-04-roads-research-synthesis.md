# Roads, Gates & Desire Lines — Research Synthesis → Adoption Menu

**Date:** 2026-07-04 · **Status:** research complete (4/5 threads, primary-source verified), adoption menu ranked.
**Sources:** Galin et al. 2010 *Procedural Generation of Roads* (full PDF), Parish & Müller 2001 (full PDF),
Citygen (Kelly & McCabe 2007), StreetGen (Cura et al.), Chen et al. 2008 tensor streets, Watabou
TownGeneratorOS (actual Haxe source), RimWorld *Desire Paths* mod source (fluffy-mods), Helbing active-walker
model (PRE 56, 1997), Ghost Recon Wildlands GDC 2017, Cities: Skylines dev deep-dives, Dwarf Fortress wiki,
Vintage Story mods, CityEngine docs. Coverage gap: Manor Lords / Banished / Songs of Syx internals
(that research thread died — relaunch if their gridless burgage-snap becomes relevant).

Folk claims corrected by the research (don't re-import them): Watabou's routing is **not** A\* (no heuristic,
no priority queue — plain cheapest-first over ward vertices); vanilla RimWorld has **no** desire paths (mod
only); Red Blob has no slope-road article; UnReal World trampled trails are unverified.

---

## 1. What we already do right (research-validated — keep, don't churn)

| Ours | Research confirmation |
|---|---|
| `road-walker.ts`: slope cost `slopeFactor·g` + `overGradePenalty` above `maxGrade` (drives switchbacks) | Exactly Galin's transfer-function shape: bounded cost below threshold κ₀, effectively-∞ above |
| Per-cell `bridgeCost` on water → routes gravitate to NARROW crossings | Galin costs water by depth; per-cell cost ∝ width is the discrete equivalent |
| `roadAffinity 0.6` discount on existing road/bridge cells | Ghost Recon Wildlands "magnetization toward existing roads" — cost pull, not post-hoc snapping. Verbatim from their GDC talk: pathfinder prefers "cheaper alternatives" |
| `bankAffinity 0.85` valley following | Galin characteristic samplers (vegetation/water proximity) |
| 4-connected walk + Catmull-Rom centerline smoothing removes the staircase from the CARVE | Galin's k-neighborhood masks solve the same "limit-on-direction" problem in-search; our smooth-after is the cheaper fix **but see §2.2 (re-validate!)** |
| Gates COMMITTED as portal nodes BEFORE roads (round 5, `commitDirectionGates`) | Watabou's exact order: walls+gates exist before any street/road; gates are pre-committed nodes, never "wherever a road crosses" |
| Wall cells = obstacles for the approach walker, gate openings exempt (`gate-approach.ts`) | Watabou: blocked nodes = wall vertices MINUS gates — gates are the only traversable wall vertices (portals) |
| Trample: deposit 12/step @3Hz, promote ≥120, revert <80, decay ×0.9, saturation 255, hysteresis gap | The RimWorld Desire Paths mod numbers, verified from its source (create-120/remove-80/×0.9 — we adopted its proven shape) |
| Promoted `dirt` gets a cheaper pathfinder tier (TRAIL_COST) | **The Helbing bundling term.** "The accumulator and the pathfinder must be coupled or footfalls never bundle into one trail" — we are coupled |
| Trails cap at `dirt`, never road-class; farmland/roads/water opt-out by terrain set | Author-named RimWorld pitfall (paving farmland) + our lint-contract isolation |
| Throttled deposit pass separate from low-Hz promote/decay, sparse active-cells-only sweep | The canonical two-pass perf shape from every implementation surveyed |
| 47-blob autotiler for junction visuals | The tile-grid classic: junction geometry as adjacency-masked sprites |

## 2. Adoption menu (ranked)

### 2.1 Stitch≈0 via gate-commit-time repair — **the round-5 NEXT item, now with the mechanism**
Watabou never stitches because internal streets and external roads are routed on complementary node
subsets of **one shared graph**, both hard-terminating at the same gate node — coupling by construction.
His degenerate case (gate has no outer edge to route on) is repaired **at gate-commit time** by editing
geometry (splitting the outer ward to manufacture the missing edge), *not* by post-hoc road repair.
→ For us: when `commitDirectionGates` places a gate, immediately verify BOTH half-edges exist — a
walkable interior corridor cell adjacent inside, and a routable approach cell outside (not water/steep/
building). If either is missing, move the gate along the ring (or carve the missing connector cell) *in
that same commit step*. The `wireGateToRoad` stitch then only guards genuine bugs. Also pin endpoints
in any smoothing pass touching gate approaches — Watabou pins smoothing endpoints so **smoothing can
never detach a road from its gate**.

### 2.2 Re-validate the smoothed ribbon (Galin's author-named pitfall) — cheap lint, real bug class
After clothoid/spline smoothing "the curve may lie slightly inside or above the terrain" — Galin
re-segments the smoothed curve and re-labels road/bridge/tunnel. Our Catmull-Rom + `filletApproach` +
`reconcileFilletRaster` reconciles *walkability*, but nothing asserts the smoothed ribbon's *legality*.
→ Add a `roads.ribbon-legal` lint contract: every reconciled ribbon cell is non-water-without-bridge,
not inside a curtain (except at a gate), not under a building. Catches the whole
"smoothing moved the road somewhere the router never approved" family.

### 2.3 Foundation's "social gravity" — trails feed back into settlement growth ⭐ best gameplay fit
Foundation sites new housing relative to existing worn paths, so paths shape the town that shaped them.
We already have both halves: `TrampleGrid.promoted` + settlement-growth site scoring.
→ Growth scoring bonus for parcels adjacent to promoted trail cells / high-wear cells. Emergent result:
the town grows along the desire lines its own believers carved — deeply Small Gods. Small patch,
pure-scoring, deterministic, no new state.

### 2.4 Traffic-proportional road dynamics (`edge.dynamics` is already there)
DF traffic designations + CS lane-on-type suggest the inverse loop too: roads the sim doesn't use decay.
We already persist `RoadDynamics` (age/condition/wear/overgrowth) and tick road-evolution.
→ Feed real traffic into it: count NPC transits per edge (cheap: bucket the trample deposits that land
on road tiles by nearest edge), let busy tracks resist overgrowth / quiet spurs overgrow across D2 era
skips. "Roads believers walk stay alive" — thematically perfect for era-scale worlds.

### 2.5 Trample neighbor spill — trail WIDTH from traffic volume
RimWorld mod deposits ×0.2 into 8-neighbors. One-line change in the deposit path; busy trunk trails
widen to 2–3 tiles organically while side paths stay single-file. Do together with the open
trample-visibility tuning (round-5 note: live equilibrium ~12 promoted cells is too subtle).

### 2.6 RoadJunction compile object — use Citygen's three snap tests verbatim
For the world-compiler NEXT item ("RoadJunction as compile object"). Proposed segment `ab` with snap
radius, tests in priority order: (1) endpoint near existing **node** → node snap (reuse); (2) segment
×segment intersection → split + join; (3) endpoint near a **segment** → split it, **promoted to a node
snap if the hit lands within snap distance of that segment's own endpoints** (the duplicate-node-
prevention rule). Resolve events closest-to-root first; termination guaranteed when
`dSNAP > dSTEP·cos(θDEV)`. Cross-cutting invariants: a road ending on/crossing another MUST split the
segment and insert a node; check node-snap *before* segment-split; keep the two-tier graph (junction
topology over terrain-following polyline) — ours already is (RoadGraph nodes/edges over walked polylines).

### 2.7 StreetGen buffer-intersection fillets (when junction SURFACES get geometry)
They explicitly rejected closed-form corner arcs ("not robust: flat angle, zero angle, road contained
in another"). Robust recipe: buffer axis₁ by `w₁+r`, axis₂ by `w₂+r`, intersect the buffer boundaries,
take the candidate nearest the junction center as the fillet arc center; assemble the junction surface
with polygon-area ops. Clamp radius against short incident segments (the CS "tiny segment → cars
glitch" degeneracy); minimum-radius fallback; width-change-only joints get a linear taper, not an arc.

### 2.8 Orientation-augmented road search (true hairpins) — only if mountain roads look wrong
Galin lifts A\* into position×orientation (8–12 angular bins) so curvature is a cost between states —
this is what *produces* legal switchbacks. ~16× slower search. Our over-grade penalty already zigzags;
adopt only if a Volcanic/mountain seed shows visibly illegal kinks. If adopted, pair with k≈5
neighborhood masks (`gcd(i,j)=1`, 11.3° resolution) in the same change.

### 2.9 Bridge ARCS in-search (span candidates the optimizer buys)
Galin adds long-span segments (bounded length, costed on depth/water) so the search *chooses* bridge
placement vs detour, subsampled stochastically for speed. Our per-cell `bridgeCost` approximates this
well for tile bridges; revisit only when multi-tile span structures (crossing-builder viaducts) want
optimizer-chosen placement rather than authored sites.

## 3. Suggested batching

- **Next roads round:** 2.1 (stitch≈0) + 2.2 (ribbon lint) + 2.5 (spill, with visibility tuning) + 2.3
  (social gravity) — all small, all on shipped systems, together they close round 5's open items.
- **World-compiler WP-D era:** 2.6, then 2.7.
- **Backlog until visually motivated:** 2.4 (needs era-skip pacing), 2.8, 2.9.
