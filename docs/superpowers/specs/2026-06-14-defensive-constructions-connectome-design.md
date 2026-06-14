# Defensive constructions in the connectome (brainstorm)

**Date:** 2026-06-14 · **Status:** brainstorm (design-only, queued behind consolidation +
renderer-R1 elevation) · **Builds on:**
[worldbuilding fact database + connectome](2026-06-14-worldbuilding-fact-database-design.md),
[settlement growth / placement](2026-06-13-settlement-growth-placement-design.md),
[unified renderer connectome](2026-06-14-unified-renderer-connectome-design.md),
[medieval building reference](../../reference/medieval-building-reference.md)

## What the user asked for

> "Think about connectomes and blueprints for defensive constructions of all kinds.
> A motte-and-bailey consists of several buildings, barriers, gate(s) and terrain
> modification of an area. How to implement such things and make them realistic?"

Follow-ups, in order:
> "Defensive constructions would utilise the available terrain in smart ways. No
> need to build a mound if there is a hill next to where you'd want your
> motte-and-bailey?"
> "But sometimes they picked a spot on the ground and started hauling earth too."
> "Consider what we have not thought of yet, too."

## The core reframe: a defensive work is one *function*, not a bag of buildings

A motte-and-bailey is not "a keep + a hall + a palisade + a mound." It is a single
**defensive function** that *derives* all of those — the same move as the smoke chain
(don't author a chimney; author a hearth and let period+wealth+material decide the
egress). Here: don't author a castle; author **"defend a lord + garrison at (era,
wealth, site, intent)"** and let the grammar derive the rings, the refuge, the gates,
and the earthworks.

Realism follows because the layout falls out of constraints real builders obeyed, not
from a hand-placed template. The result is legibly a *response to its place and
purpose*.

## Mapping onto the existing primitives (Zone / Portal / Fixture / Barrier)

**Zones — the recursion the connectome already promises:**

```
complex (castle)                  scale: settlement
├─ motte-ward     core/refuge     scale: district   (highest zone)
│   └─ keep                       scale: building → existing tower Blueprint
├─ bailey-ward    enclosure       scale: district
│   ├─ hall, chapel, kitchen,
│   │  stables, barracks,
│   │  granary, smithy            → existing Blueprints (reused wholesale)
│   └─ (well = Fixture, not a Zone)
```

Every leaf is an **existing** building Blueprint. The connectome only adds the
*arrangement* and the *earthworks*.

**Portals = the defensive grammar.** Defense is fundamentally controlled circulation
(a multigraph edge-layer). Access is strictly ordered, each crossing a checkpoint:

```
world → [outer gatehouse + drawbridge over bailey ditch] → bailey court
      → [flying bridge + stair over motte ditch] → motte palisade gate → keep door
```

Portal `attrs` carry the defensive props: `controlled`, `defensibility`, `chokeWidth`,
`flankedBy:[tower…]`, `canDestroy` (the flying bridge was deliberately demolishable),
`portcullis`/`murderHole` at the gatehouse. "Correct doors of correct size"
generalises cleanly to "correct gate of correct defensibility."

**Barriers = linear structures already placed by the settlement epic.**
Palisade-on-rampart (bailey), ring palisade (motte top), later stone curtain — the
settlement linear-structure placement following a **ring polygon** instead of a street.

**Fixtures emit requirements, exactly like the hearth.** The **well/cistern** emits
"must sit inside the innermost barrier" (siege water); the **keep** emits "must sit on
the highest Zone." These become constraint-catalogue entries.

## Terrain as a connectome output

The motte and ditch are the new capability. The coordination board already resolved
ownership in our favour — heightfield is **world-owned**,
`heightAt = base ⊕ connectomeDeformations`. The connectome emits deformation
primitives the world composites:

- **motte** = disc/frustum uplift (raised disc, flat top, battered slope)
- **ditch** = annular depression around motte and/or bailey
- **rampart** = linear uplift *under* the palisade

Bake in **conservation of spoil**: ditch volume ≈ motte + rampart volume. The earth
comes from somewhere — one physical rule makes ditch depth and mound height co-vary
believably instead of being two free knobs.

## Siting comes BEFORE form (use the terrain)

Real builders searched for terrain that already did the work and only deformed what the
site lacked. Terrain modification is the **fallback**, not the default. So the grammar's
first move is *siting*, not building:

```
1. propose candidate sites in the area      (grid/poisson sample)
2. score each by affordance + strategy − cost
3. pick the best                            (seeded argmax; ties → seed)
4. derive form from what's MISSING          (deformations fill only the gap)
```

`TerrainProbe.affordanceAt(x,y)` (already a seam on `ExpandCtx`) is called as a
**search** here, not a single lookup. Affordance is a small vector, and form-derivation
reads each component:

| affordance present | construction response |
|---|---|
| natural hill/knoll | skip/shrink the motte; keep on the summit |
| cliff/steep flank (N,E) | omit walls there; concentrate barrier + towers on the open side → D-shaped/triangular ward, not a tidy oval |
| river/marsh adjacent | wet moat for free; weak side faces water; maybe a watergate Portal |
| natural choke approach | gatehouse goes there; no second gate needed |
| flat, exposed, dry | full motte + full ditch + full ring + cistern (the "build everything" case) |

## …but siting is a weighted tradeoff, not a hill-search

Plenty of mottes were **wholly artificial** — dumped on flat ground because the thing
worth controlling (a ford, road junction, town, border, harbour) was on flat ground.
So siting is a weighted argmax in which terrain is only one term:

```
score(site) =  w_strat · strategicValue(site)      // controls the target?
             + w_def   · defensiveAffordance(site)  // the natural-hill/cliff/river vector
             − w_cost  · buildCost(site)            // spoil to haul = motteDeficit + ditch volume
```

`buildCost` is the spoil-conservation figure read as a cost. Both of the user's cases
fall out of one formula:
- **natural hill** → low `buildCost`, wins cheaply, minimal earthworks
- **flat by the ford** → `strategicValue` overrides; you pay the earthmoving and haul the mound

The weights are **who's building and why** — a natural **Fate / agent seam**, the
defensive cousin of the settlement epic's `SITE_RULES`:
- royal castle planted to subdue a town → `w_strat` huge (William's urban mottes went *into* towns, levelling houses)
- a baron's caput on his own manor → balanced
- a remote refuge → `w_def` dominates

```
intent {purpose, target, builder, era, wealth}
   → weights
   → siteSelect(area, weights, seed, terrainProbe)   // 3-term argmax
   → enclosure topology builds only the gap
   → connectomeDeformations haul whatever earth the site didn't provide
```

## A new master topology + the fortification era ladder

**`enclosure` / `defended-perimeter`** joins the existing 4 topologies
(tripartite-linear / courtyard-hub / vertical-stack / church-axial). It's a containment
hierarchy: nested wards, each bounded by a barrier ring with ≥1 controlled gate, plus
one designated high-point core. One topology generates the whole family:

| instance | rings | core | era/material |
|---|---|---|---|
| ringwork | 1 | — | timber, 10–11c |
| **motte-and-bailey** | 2 | timber tower on mound | 11c |
| shell keep | 2 | stone wall round motte top | 12c |
| concentric castle | 2+ curtains, mural towers, barbican | great tower | 13c |
| star fort | bastioned trace | — | gunpowder, 16c |

That table **is** the fortification era ladder — the direct analogue of smokehole →
louver → chimney. `(era, wealth, region, seed, site)` picks the rung; Fate or an agent
can author one.

## Layout tractability

Don't reach for a 2D packing solver. The building epic chose "linear bay partition, not
a floorplan solver"; the settlement epic has frontage-slot placement. **The bailey is a
ward whose 'street' is the inner wall-walk:** buildings back onto the palisade (reuse
burgage-frontage slotting), the gate sets the entry axis, the hall sits opposite the
gate, the well goes central, the motte anchors one end. Almost no new geometry — the
frontage gradient on a ring.

## Resolving down the existing pipeline

- complex Zone → sub-zones via the `enclosure` topology
- leaves → existing Blueprints (keep=tower, hall=hall-house, …)
- barriers → existing linear-structure placement along the ring polygon
- gates → gatehouse Blueprint + drawbridge feature
- terrain deformations → world heightfield (the new output channel; world-owned)
- whole thing seeded + grammar-driven → a plausible unique castle per (era, wealth, region, seed, site)

## Data model (the blind-spot pass, incorporated)

The blind-spots pass surfaced twelve under-modelled parts. Rather than leave them as a
"things we forgot" appendix, each is folded here into a concrete model affordance and
assigned to a slice in the roadmap below. They cluster into four model changes plus a
set of variant/scope decisions.

### Connectome extensions (scale-free, additive — building scale untouched)

- **`Earthwork`** (new) — a terrain-deformation primitive: `{ kind: 'motte'|'ditch'|'rampart'|…, ring?, centre?, profile }`. The connectome's new *output channel* into the world heightfield (`heightAt = base ⊕ connectomeDeformations`). Carries the **spoil-conservation** invariant: Σ cut ≈ Σ fill.
- **`Barrier`** (new) — a linear structure that is the *boundary of* (or a *line across*) terrain, not an edge between two zones. Two modes: **enclosing** (a ring bounding a ward) and **spanning** (`encloses: null` — a dyke/wall that cuts a line; *blind spot 3*). Carries `defensibility`, `material`, `builtEra`.
- **Gate Portals** reuse the existing `Portal` with defensive `attrs`: `controlled`, `chokeWidth`, `flankedBy`, `canDestroy`, `portcullis`. ("Correct gate of correct defensibility" = the door-size generalisation.)
- **Per-Zone `builtEra` + `rebuiltEra?`** (*blind spot 1*) — a stronghold is a **palimpsest**: `era` is per-node, not per-complex (stone keep of 1180 inside a 1070 timber bailey). Hooks `UPGRADE_CHAINS`.
- **`Zone.attrs.site`** — the chosen `affordanceVector` + `buildCost`, so the resolved complex records *why it sits where it does* (legibility).

### Siting front-end (*blind spots 2, 11, 12*)

- **`intent { purpose, target, builder, era, wealth }` → weights → `siteSelect`** — the 3-term weighted argmax (strategic + defensive − cost). Both "use the hill" and "haul earth on the flat" fall out of one formula.
- **`encloseExisting(zone)`** — siting *inverts* for retrofits (town walls, fortified church/manor): the protected thing is already placed and the barrier follows it. Reuses `Village.wards` / settlement Zones. *This is the more common medieval case than the freestanding castle.*
- **Ruins/spolia as a site affordance** — a candidate site may carry a prior connectome output (a Roman fort, an older ruin) as free stone / standing walls to incorporate; ties into the ruin/lifecycle variants.
- **Asymmetry is a feature** — `siteSelect` feeding the ring geometry means walls hug cliffs and follow rock; the grammar must *embrace* constraint-driven irregularity, never default to tidy ovals.

### Quantitative function→structure (*blind spot 5*)

- **Garrison-as-driver** — `intent.garrison` (head-count) × `siegeDays` *sizes* the program: well/cistern/granary/latrine **capacities**, not just presence. Function→structure made quantitative; the multigraph seam to the social-graph/NPC layer.

### Variants & lifecycle (*blind spots 8, 9*)

- **`buildCost` gates the fortification RUNG, not just the site** — wealth picks ringwork → timber m&b → shell keep → stone keep → concentric → star fort. A poor lord can't have a concentric castle; only the crown can. Yields an **`unfinished`/`abandoned-mid-build`** variant (Beaumaris was never completed).
- **Slighting** — a *targeted* decay mode distinct from material-ordered weathering: breach the wall at chosen points, mine a keep corner, fill the moat. A gameplay hook (an enemy slights the player's stronghold).

### Deferred-but-reserved (seams left open, not built in DC-1)

- **Sightlines / fields of fire** (*blind spots 6, 7*) — the *deep* version of `defensibility` (concentric castles exist because the inner wall shoots over the outer). A visibility computation on heightfield + walls. We **emit** the attrs (`defensibility`, `chokeWidth`, `flankedBy`) now so a future siege/visibility system has inputs; we don't compute fields-of-fire yet. Open decision recorded: whether a **siege model** ever consumes them (if not, they stay descriptive).
- **World-scale networks** (*blind spot 10*) — frontier chains, intervisible beacons, a castle emitting its own bent approach road + bastide town. The road=Portal / world connectome's real consumer; strictly above the single-complex slice.

### Taxonomy pass (*blind spot 4* — confirms the topology set is complete)

Enumerated before committing the abstraction. Each maps to `enclosure`, the new
**spanning `Barrier`**, or `vertical-stack` — so two topologies + the linear-barrier
primitive cover the field:

| construction | maps to |
|---|---|
| ringwork, motte-and-bailey, shell keep, concentric castle, star fort | `enclosure` (n rings) |
| hillfort (ditch-and-bank, no buildings) | `enclosure`, 1 ring, empty ward |
| burh (planned defended town) | `enclosure` over an existing settlement (`encloseExisting`) |
| Roman marching camp (playing-card) | `enclosure`, rectilinear ring, `intent.purpose='temporary'` |
| town wall, fortified church/manor | `encloseExisting` |
| pele tower / bastle (farmhouse-fort) | `vertical-stack` + defensive `attrs` |
| watchtower / beacon | `vertical-stack`, single zone, world-network node |
| Offa's Dyke, Hadrian's Wall, frontier dyke, fortified bridge | **spanning `Barrier`** (no enclosed zone) |

---

## Slice roadmap (each blind spot scheduled)

- **DC-1 (foundation, engine-pure, NOW — unblocked by renderer R1):**
  `Earthwork` + `siteSelect` (3-term) + `deriveEarthworks` (spoil conservation) as pure
  math (mock probe); `enclosure` topology interpreter + `expandComplex`; `Barrier`
  (enclosing + spanning) + gate Portals; per-Zone `builtEra`; `encloseExisting`;
  constraints (keep-on-highest, water-inside-innermost, every-ring-needs-a-gate);
  `complexToPlan` resolve-down to a structured plan. Medieval content: `motte_and_bailey`,
  `ringwork`, `town_wall`. **World placement stays latent** (like the room-graph was) —
  no `src/world` edits this slice.
- **DC-2:** real `TerrainProbe` adapter over the merged `heightAt` field; wire
  `complexToPlan` → building-placer + heightfield deformation; in-world motte/ditch.
- **DC-3:** `buildCost`-gated fortification rung ladder + the `unfinished` variant;
  garrison-as-driver capacity sizing.
- **DC-4:** slighting decay mode; ruins/spolia as a site affordance (lifecycle hook).
- **DC-5 (above single complex):** world-scale defensive networks — chains,
  intervisible beacons, castle-emits-approach-road + bastide; the road=Portal consumer.
- **Reserved (no slice yet):** sightlines / fields-of-fire visibility + a siege model
  that consumes `defensibility`. Attrs are emitted from DC-1 so this can be added
  without reshaping the graph.

## Dependency / sequencing notes

- **Renderer R1 is merged** (`heightAt` world heightfield + terrain height-shading) —
  the siting dependency is **unblocked**. DC-1 builds against a mock probe to stay
  engine-pure and testable; DC-2 wires the real `heightAt`.
- Reuses the connectome **Slice 5** (settlement) district/ward machinery where it
  overlaps `encloseExisting`; DC-1 does not require Slice 5 first (it tests with
  synthetic wards).
- **Branch:** `feat/defensive-constructions-connectome` off `main` (post-consolidation).
