# Grade reconciliation — a feature vocabulary for crossing hostile terrain

> Brainstorm. 2026-06-26. Origin: user direction — *"roads need to build up terrain under
> them as well as carve through, and respect rules for how steep a class of road can be. for
> footpaths we must also build a stairs module, varying from 'climb the cliff' to 'placed
> natural stone stairs' to 'concrete following latest accessibility rules' and all stages in
> between. we also need to get into bridges to handle all kinds of situations. with an eye to
> also supporting aqueducts and other irrigation systems."*

## The thesis: it is all ONE problem

Roads, footpaths, stairs, embankments, bridges and aqueducts look like six features. They are
**one mechanism** seen at different terrain. A linear feature has a **grade envelope** — the
range of longitudinal slope its class tolerates — and a **cross-section**. As its centreline
crosses terrain, at every point the natural ground either *fits* the envelope or it doesn't, and
the feature reconciles the mismatch with a small **vocabulary of structures**:

| Terrain vs. the feature's envelope | Reconciliation structure | Status today |
|---|---|---|
| Ground grade within envelope | light **cut/fill** to grade (today's road carve) | ✅ EXISTS (`level` op) |
| Ground too **high** along the line | deeper **cut** (a shelf through the hill) | ✅ EXISTS (grade-window smoothing) |
| Ground too **low** / a dip or gap | **embankment / causeway** (fill berm with batters) | ⚠️ PARTIAL (fill exists, no batter geometry) |
| **Cross-grade** too steep for the class | **switchback** (reroute) | ⚠️ SOFT (global grade penalty, not per-class) |
| Too steep for a *path*, short rise | **stairs** (the path's steep-terrain form) | ❌ MISSING |
| A **gap over water/void** | **bridge / viaduct** (elevated span) | ❌ MISSING (designed, never rendered) |
| Carry **water up-gradient of nothing** | **aqueduct** (elevated/cut channel, near-flat envelope) | ❌ MISSING |

So we are not adding six systems. We are adding **one grade-envelope model** + **one fill
(embankment) cross-section** + **one above-ground structural-geometry capability**, and then
*stairs, bridges and aqueducts fall out as parametrisations* of pieces we already have.

## What already exists (recon 2026-06-26, grounded in code)

This is much closer than it looks. The deformation channel and the construction-spectrum model
already carry most of the weight.

1. **Terrain can already be RAISED.** `terrain-deformation.ts:45` ops are
   `'raise' | 'carve' | 'add' | 'level' | 'sink'`. `applyOp` (`:74`): `level` lerps current
   height toward `targetAt` — so where the smoothed road grade sits *above* the ground (a dip),
   roads **already fill it** up to `cutStrength` (0.2 footpath → 0.9 highway). Cut-and-fill is
   half-here; what's missing is a *deliberate embankment* (a fill berm with side-slope batters
   and its own footprint), not the incidental dip-fill.
2. **The construction/era spectrum is the stairs template.** `road-state.ts:77` `deriveRoadState`
   turns `importance × eraTech × surface` into `construction ∈ [0,1]`, and `roadCrossSection:135`
   maps that continuously onto a cross-section (dirt track → engineered highway). **A `StairState`
   is the same shape**: `construction` → rough scramble (primordial) → cut-stone steps (classical)
   → switchback ramp at accessible grade (current). "All stages in between" = one continuous knob,
   exactly as roads already do.
3. **A per-feature grade signal already exists in routing.** `road-walker.ts:37` has
   `DEFAULT_MAX_GRADE = 0.05` with a soft `OVER_GRADE_PENALTY = 400`. It is **global, soft, not
   per-class**. Promoting it to a **per-class envelope** (path tolerates 0.20, highway 0.04, stairs
   handle near-vertical, aqueduct ≈ 0.002) is a small, surgical change with big emergent payoff:
   the router already prefers switchbacks; per-class limits make a highway refuse a grade a path
   would take, and *flag* where a structure (stairs/embankment/bridge) is required.
4. **The crossing connectome is already built — just not rendered.** `detect-crossings.ts`,
   `crossing-builder.ts` (deck + piers + bank aprons, material/form gated by era × prosperity),
   `realize-crossing.ts` (placements). Brainstorm `2026-06-20-river-crossings-generative-sites`
   already designed "roads stop at banks; the span is a sited structure." **Building placements
   spawn (grey massing); span/pier placements are produced and then dropped** — the ribbon pass
   that drew the deck was removed as tech debt (`a562a73`). Roads currently just carve through
   water via `edge.bridgeCells`.
5. **One shared analytic-SDF substrate exists.** `feature-geometry.ts` (`FeatureSeg`, stride 8,
   `binFeatureSegments`) is shared by road pavedness and river channel. New linear features slot
   in here.

## The ONE genuinely new capability: above-ground structural geometry

Everything in the renderer is **carved INTO the heightfield**. There is no mechanism to place a
surface *above* the ground plane. A bridge deck, an arch, an elevated aqueduct channel all need
this. **This is the single gating capability** for "all kinds of bridge situations" and elevated
aqueducts — and it's worth building once, generally:

- An **elevated linear-deck** primitive: a parametric ribbon (deck width, thickness, soffit
  profile, support spacing) whose Y rides a *feature-authored* grade line, not the terrain — with
  piers/arches dropped where the soffit clears the ground by more than a threshold. Lit by the
  existing banded `SpritePack`/normal pipeline; y-sorted into the entity pass (which already draws
  things at arbitrary screen-Y) rather than the carved-terrain pass.
- Bridges, viaducts, and elevated aqueducts are then **the same deck primitive** with different
  cross-sections (road surface / water channel) and different envelopes.
- *Tunnels are the dual* (an above-ground portal + the feature simply not carving through the
  ridge). Out of scope for v1; named so the model stays honest.

## Aqueducts & irrigation — the inverted river

A river is hydrology's **output**: water the terrain sheds, flowing downhill, carved by `'carve'`.
An aqueduct is an **input**: water carried along a **near-constant, author-chosen** gentle
down-grade *regardless of terrain* — cut where the ground is above the water line, elevated on a
deck where it's below. So an aqueduct = (grade-envelope feature with a ~0.2% target) +
(elevated-deck capability) + (a thin water surface on the channel). Irrigation = an aqueduct trunk
+ branches to fields + **flow apportionment at junctions** + an "irrigated" terrain tag that feeds
biome/fertility. The flow-apportionment + irrigated-tag is the deepest net-new modelling and
should be its own later track; the channel-as-feature is reachable much sooner.

## Decomposition (each slice independently shippable, value-first)

- **G1 — Per-class grade envelope.** Promote `road-walker`'s global max-grade to a per-class
  envelope on `RoadState`/feature class; route honours it; **emit a diagnostic** (the connectome
  linter already exists) wherever the chosen line still exceeds the envelope — that diagnostic is
  the trigger list for G2/G3/bridges. Pure, testable, no rendering. *Foundation for everything.*
- **G2 — Embankment fill cross-section.** Make roads "build up as well as carve": where the grade
  line sits above ground beyond a threshold, emit a **fill berm** with side-slope batters (the
  `add`/`level` ops + a trapezoidal cross-profile) and reach-derived footprint. Pure deformation;
  the detail-mask coverage work already exists to keep it crisp. *Directly answers the first ask;
  no new rendering capability needed.*
- **G3 — Stairs module.** A `path` whose required grade exceeds the path envelope (G1 flags it)
  becomes **stairs**: a `StairState` off the construction spectrum (scramble → cut stone →
  accessible switchback-ramp), carved as stepped cross-section + a **traversal-cost** tag (today
  walkability is binary — stairs need "passable at a cost"; this also seeds NPC-pathfinding-aware
  features). *Reuses the road spectrum template wholesale.*
- **G4 — Above-ground deck primitive** (the new capability). Build the elevated linear-deck +
  pier/arch generator. Wire the **already-built crossing connectome** (deck/pier placements that
  currently drop) into it. *Unlocks bridges for real.*
- **G5 — Bridges, all situations.** Compose G1 (envelope says "span here") + G4 (deck) + the
  crossing-builder's era×prosperity material/form + ancillary structures. Footbridge-over-stream →
  multi-arch stone viaduct carrying a gatehouse, emergent from importance.
- **G6 — Aqueduct channel.** Grade-envelope feature (~0.2%) + G4 deck (elevated runs) + a channel
  water surface. Cut runs reuse river-channel geometry; elevated runs reuse the deck.
- **G7 — Irrigation network.** Aqueduct trunk + branches + flow apportionment + irrigated-terrain
  tag → biome/fertility feedback. *Deepest; its own track.*

**Recommended first push: G1 + G2 together** — they're pure-deformation/routing, need no new
rendering, are fully unit-testable, make roads visibly "build up as well as carve" *and* respect
per-class steepness (the two things asked for first), and G1's diagnostics become the worklist
that drives stairs/bridges. G3 (stairs) is the natural second push; G4 (elevated geometry) is the
big rendering investment that gates G5–G6.

## Risks / open questions

- **Embankment vs. fill realism** — a real causeway has batters and a wider base than crest; the
  cross-profile must widen the *footprint* downward, and the detail-mask reach must follow (the
  coverage machinery exists). Watch the worst case (tall fill across a deep valley) — clamp or
  defer to a bridge above a height threshold (G1 already decides this).
- **Grade envelope vs. existing worlds** — tightening routing changes road layout → bump
  `WORLD_CONTENT_VERSION` (stale-autosave gotcha) and re-pin worldgen goldens.
- **Above-ground geometry in a heightfield renderer** — the entity pass already draws at arbitrary
  screen-Y with lighting; the deck rides that, not the terrain mesh. Cast shadows + foot-z lift
  interplay needs care (a pier's foot lifts off terrain; the deck doesn't).
- **Traversal cost** — introducing "passable at a cost" touches NPC pathfinding; keep G3's tag
  additive and behind the sim's existing cost model.
- **Determinism** — all of this is derived from the persisted graph + seed; nothing new persisted,
  re-derives on load (the road/river precedent).

## Supersedes / relates

- Subsumes `2026-06-20-river-crossings-generative-sites-brainstorm.md` (bridges = G4+G5 here).
- Builds on `2026-06-24-roads-as-carved-terrain-design.md`,
  `2026-06-25-linear-features-vector-sdf-adaptive-terrain.md` (the shared SDF substrate),
  `2026-06-24-river-channel-sdf-design.md` (channel geometry the aqueduct reuses).
- Feeds the connectome diagnostics loop (G1 emits lint findings).
</content>
</invoke>
