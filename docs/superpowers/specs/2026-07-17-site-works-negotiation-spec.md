# Spec — Site-works negotiation: structures reshape the terrain (and neighbours) that receives them

**Date:** 2026-07-17 · **Status:** spec (ratified direction; slices unscheduled)
**Builds on (read these first):** `src/world/terrain-deformation.ts` (THE substrate — source-tagged,
priority-ordered `DeformationStore` with `removeSource` + `targetAt`/`amountAt` profiles),
`src/world/settlement-deformation.ts` (`settlement:pad` — the shipped timid version of this idea),
`src/world/connectome/crossing-structures.ts` (the crossing pass that today *adapts to* banks but
never touches them), `src/world/runtime-poi.ts` (M4 — ownership stamps + scrub reconcile both
directions), `src/world/road-deformation.ts` (`road:cut`/`road:levee` — linear features already
negotiate grade), `docs/superpowers/specs/2026-07-17-road-wear-economy-spec.md` (S3
CrossingTierStore — the runtime consumer of this spec's crossing pilot).

> **Thesis (user, 2026-07-17):** "everything would look better if all things could change the
> terrain under and around them (as well as push other things around a little, if needed) so that
> at one side or the other of a bridge it naturally makes the river and banks work for it. goes
> for buildings too." A structure should not merely be *placed* on terrain that happens to fit —
> when the site isn't quite right, the structure **makes it right**, the way real builders do:
> cut-and-fill, revetted banks, graded approaches. The terrain yields to the built thing, in one
> deterministic, ownership-tagged, reversible pass.

**Cost: $0.** Deformations + parametric geometry only; no art pipeline change, no paid gen.

---

## 1 · What already works this way (the substrate is shipped)

The codebase is half-committed to this principle already. Inventory:

| Shipped mechanism | What it does | Why it's the timid version |
|---|---|---|
| `DeformationStore` | ONE composed channel over base terrain: `heightAt = base ⊕ defs`, each def source-tagged (`'settlement:pad'`, `'road:cut'`, …), priority-ordered, ties broken by id (deterministic), `removeSource()` for wholesale replacement, `version` for memo invalidation, per-tile `targetAt`/`amountAt` profiles | the substrate is COMPLETE — nothing here needs to change |
| `settlement:pad` (`settlement-deformation.ts`) | settle-in `level` pad per built lot/civic rect, levels to mean BASE height, 2-tile taper | splits the difference on a slope instead of terracing; no cut face, no retaining edge, no downhill fill apron |
| `road:cut` / `road:levee` | roads level to their own grade profile (`targetAt` = longitudinal grade + cross-section) | roads got the assertive treatment; point structures didn't |
| `river:incision`, `wall:ditch`, `wall:foundation`, `earthwork:*`, `rock:pad`, `boulder:pad` | linear + earthwork producers all write the channel | each producer negotiates for ITSELF; nothing negotiates a *site* (structure + approaches + banks as one composition) |
| Crossing pass (`crossing-structures.ts`) | hunts for bank anchors (`bankCells`), rides detected bank height (compressed clearance), grounds the span with abutment *parts* | pure adaptation: when banks are unequal, ragged, or the opening won't seat (`bridge.seating` warnings, "NO ribbon-seated opening" repairs), it flags or floats — it never FIXES the bank |
| `RuntimePoiStore` (M4) | runtime structures own physical stamps; scrub reconciles both directions | the ownership/reversibility pattern this spec's runtime half must reuse |

So the epic is **not** "build a terrain-editing system" — it's teaching structures to *use* the
shipped channel assertively, plus one genuinely new rule (bounded neighbour displacement).

---

## 2 · The model: site-works as owned deformation bundles

A **site-works bundle** is the set of deformations a structure writes to make its site work:

- **Ownership:** every deformation in the bundle carries `source: '<kind>:siteworks:<stableId>'`
  (e.g. `crossing:siteworks:edge-12@3,45`). One structure = one source = one `removeSource()`
  undoes the whole intervention. This is the same contract `settlement:pad` and the M4 stamps
  already honour.
- **Reversibility:** gen-time bundles derive purely from gen inputs (re-derived on load, like
  settlement pads — nothing persisted). Runtime bundles (a crossing upgrading tier, a building
  placed by Fate/player) ride the owning store's snapshot state and reconcile both directions on
  scrub, exactly per the RuntimePoiStore pattern. A scrubbed-away bridge takes its bank-works
  with it.
- **Read discipline (no self-reference):** a bundle's targets/amounts are computed from BASE
  height (or from strictly lower-priority composed height), never from the composed height that
  includes itself — the one-shot-level rule `settlement-deformation.ts` already states. This is
  what keeps regeneration idempotent.
- **Priority bands:** composition order encodes who yields to whom. Proposed bands (exact
  numbers fixed in N1 against the current producers' priorities): terrain-scale features
  (river incision, lake conform) < linear features (road cut/levee) < **site-works** <
  earthworks/defences (motte, ditch) — so a bridge approach grades OVER the road's own profile
  where they overlap, and a deliberately-dug ditch still cuts through anything.
- **Tile writes:** where a bundle also changes ground *surface* (revetment stone, worn approach),
  it goes through the existing tile-write rules — `bumpTilesRev(map)` mandatory.

**What site-works may do:** raise/carve/level/sink within its bounded footprint, per-tile
profiles included. **What it may not do:** touch hydrology topology (a bundle may *pinch* a bank
by a fraction of a tile of fill; it may never move, dam, or reroute a channel — that stays the
water network's business), exceed its declared AABB, or write outside its priority band.

---

## 3 · Pilot: crossing site-works (the bridge makes the banks work for it)

The crossing is the perfect first consumer: one structure, two banks, an obvious
before-looks-wrong / after-looks-right test, and a live harness (the crossing-site studio) to
watch it under dials. The bundle, per detected crossing (all from `CrossingSpec` data the pass
already has — banks, span, yaw, deck width, road class):

1. **Abutment pads** — `level` at each bank cell set (deck-width + 1 tile), target = the deck's
   seat height at that end. Kills the ragged-bank seating failures at the source: instead of
   `bridge.seating` *warning* that an opening won't seat, the site MAKES a seat. The lint clause
   stays (it now proves the negotiation worked) but its warning population should trend to zero.
2. **Approach grading** — a short `level` ramp per side with `targetAt` = linear grade from the
   road's arriving height to the abutment seat, capped at the road-class grade envelope (reuse
   the walker's envelope constants — a highway earns a longer, shallower approach ramp; a path
   accepts a scramble). On a low floodplain side this naturally reads as a causeway (fill), on a
   high side as a cutting.
3. **Bank revetment** — a 1-tile `raise`-to-seat lip along each abutment's waterline edge
   (masked, small amounts), so the bank meets the water as built edge, not eroded slump.
   Optionally paired with a surface tile treatment (stone at high tiers) — behind `tilesRev`.
4. **Channel pinch (optional, tier-gated)** — at stone tiers only, ≤ 0.5 tile of abutment fill
   narrowing the opening, echoing how real bridge sites concentrate flow. OFF by default until
   the render proves it reads; never enough to alter the water mask's connectivity (rule §2).
5. **Vegetation clearance (user, 2026-07-17: "bridges would probably have large trees cleared
   away in immediate vicinity")** — large flora (canopy-tier trees) removed within a small
   radius of the abutments + approach ramps: the crossing was a worksite, its timber likely
   *became* the bridge, and the approaches stay clear for traffic and sight-lines. Radius
   scales gently with tier (a log crossing clears almost nothing; a stone bridge keeps a real
   apron open). Underbrush/ground flora stays — this is tree clearance, not sterilization.
   Deterministic: clearance is a filter applied where flora placement/regrowth already runs,
   keyed on the crossing's footprint (same source-tag ownership — a removed crossing lets the
   trees come back via normal regrowth, nothing persisted beyond the bundle).

Wiring: the bundle is built inside the crossing pass (gen-time) from the same spec the structure
entities use, registered to the world `DeformationStore` under the crossing's source tag —
BEFORE the composed-heightfield finalization the span pass already waits on (the existing
two-stage crossing realization gives us exactly the right insertion point).

**Runtime tie-in (road-wear S3):** when CrossingTierStore re-realizes a crossing at a higher
tier, it re-derives the bundle at the new tier (bigger abutments ⇒ wider pads, longer ramps)
via `removeSource` + `add` — one atomic replacement, scrub-reconciled with the tier itself. The
never-un-build rule applies to site-works too: a stranded stone bridge keeps its causeway.

---

## 4 · Buildings: from settle-in pads to true terracing

Upgrade `settlement:pad` (and the runtime building path) from "level to mean" to **cut-and-fill
terrace** on sloped lots (flat lots keep the current pad byte-identical — the upgrade activates
above a slope threshold):

- target = a height chosen *within* the lot's base range biased toward the uphill side (real
  builders cut more than they fill — fill settles);
- the uphill edge gets a short cut face (steeper mask falloff on that side) and the downhill
  edge a fill apron with the gentle taper;
- at higher building tiers/materials, the cut face can carry a retaining-wall surface treatment
  (tile write, `tilesRev`) — the visual cue that the terrace is *built*, not slumped.

Same ownership contract, same `settlement:pad`-derived determinism (pads derive from plans, not
persisted). This is a small delta over the shipped code — most of it is mask-shaping.

---

## 5 · "Push other things around a little" — bounded one-way displacement

The genuinely new rule, and the one to be most careful with. A general mutual-relaxation solver
(A pushes B, B re-pads, A's ground changed…) is a determinism and convergence trap — REJECTED.
Instead, **one pass, strict order, no loops**:

- **Precedence:** structures already placed hold their ground; the structure being placed may
  shift *lower-precedence, not-yet-anchored* neighbours by a bounded nudge (≤ 1–2 tiles) from a
  small candidate set (the placement machinery's existing legality scan reused as the nudge
  search). Precedence = the placement order the settlement/site planner already runs, so no new
  global ordering is invented.
- **One-shot:** a nudged thing re-pads at its new seat and is then anchored — it never pushes
  back, and nothing revisits it. If no legal nudge exists, the incoming structure yields
  (current behaviour — skip/flag), so the system degrades to today's placement, never worse.
- Scope note: this is a **placement-time** rule (gen + runtime placement), not a physics pass.
  90% of the visual win ("the shed scooted aside for the bridge approach") at none of the
  oscillation risk.

---

## 6 · Slices

- **N0** — this spec + priority-band ratification against the live producers' priorities
  (one table in `terrain-deformation.ts`'s header becomes the registry of bands).
- **N1 — crossing site-works (pilot)**: bundle builder (pure, unit-tested on synthetic specs) +
  gen-time wiring + `bridge.seating`/repair-count before/after on ≥ 2 seeds + a **site-works
  toggle dial in the crossing-site studio** (the harness currently being built) for the visual
  A/B. Channel pinch lands OFF.
- **N2 — building terracing**: slope-gated cut-and-fill upgrade of `settlement:pad` (+ runtime
  building placement path), flat-lot byte-parity test pinned.
- **N3 — displacement nudges**: placement-time one-way rule in the settlement/site planners,
  behind a flag until the linter shows invariant parity (INV1/INV3 must not regress).
- **N4 — runtime re-expression**: CrossingTierStore (road-wear S3) drives bundle replacement on
  tier change; scrub tests both directions. N4 merges INTO the road-wear epic's S3 slice rather
  than shipping separately.

Order: N1 → (N2 ∥ N3) → N4. N1 must not start before the crossing-site studio lands (it is the
verification harness).

## 7 · Risks & open questions

- **Repaint/memo cost:** every bundle mutation bumps `DeformationStore.version` and (with tile
  writes) `tilesRev` — fine at gen, but runtime re-expression must batch its writes (one
  removeSource+add, one tilesRev bump) to avoid repaint storms. The store's linear `at()` scan
  is a noted follow-up if bundle counts grow past "tens".
- **Lint contracts:** `bridge.seating` and the spatial invariants become *proofs the negotiation
  worked* — they must be kept, not loosened, and N1's acceptance is their warning counts
  dropping on real seeds.
- **Hydrology interaction (open):** revetment/pinch touch tiles the water mask reads — N1 must
  prove the render water mask and flood-watch are unaffected (or explicitly reconciled) before
  pinch ever defaults on. GOTCHA from memory: hydrology runs twice; any geometric gate must sit
  in both.
- **Open:** should approach causeways claim road-graph membership (so use-tally traffic on the
  causeway counts toward the crossing's edge)? Leaning yes-trivially (they sit on the edge's
  existing polyline cells) — confirm in N1.
- **Open:** does the displacement rule (N3) apply to flora/props too (cheapest win — they have
  no pads), before buildings? Likely yes; N3 can land flora-first.
