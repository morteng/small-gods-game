# River Crossings as Generative Sites — Brainstorm

**Status:** brainstorm (2026-06-20). No code yet beyond the interim stopgap.
**Origin:** user direction — *"roads should stop at each side of the river crossing (the
fords?), and we will have proper bridge in relevant materials and design for the site
based on prosperity, time period, style and so on; each side of bridge becomes a custom
area where things can happen (a kind of waypoint perhaps?) and there can be guard shacks,
toll booths and so on located there if needed."*

## Thesis

A river crossing is **not a road texture — it is a PLACE**. Model it as a node in the
world connectome (same shape as the shrine-procession sub-connectome). The road
*terminates* at each bank; the span is a generated **structure**; each bank becomes a
**waypoint** where ancillary structures site and storylets fire. This reuses two systems
already in the codebase — the building-art generation pipeline and the storylet/Fate
place layer — instead of inventing a bespoke bridge renderer.

## What exists today (and what changes)

- `road-graph.ts` walks roads with A* and **auto-bridges** water cells (`bridgeCells`,
  `autoBridge`, water made cheap to cross). The road ribbon then spans the water.
- **R3b (shipped, `84dfdb2`)** renders that span as a raised timber plank deck on the
  road ribbon — a **STOPGAP**. This brainstorm supersedes it: the deck-on-ribbon
  approach is replaced by a sited bridge structure once Phase 2 lands. Keep R3b live in
  the interim so crossings aren't visually broken (roads dead-ending into a river with
  nothing spanning is worse than a placeholder deck).

## Model: a Crossing sub-connectome

When a road must cross water, emit a **Crossing** node instead of silently auto-bridging:

```
Crossing {
  water:      ref to the spanned feature (river reach / strait / lake neck)
  approaches: [BankApproach a, BankApproach b]   // the two waypoints
  roads:      feeding road edge ids
  span:       { lengthTiles, waterWidthTiles, deckWidthTiles(from road class) }
  importance: derived (busier road class × endpoint prosperity)  // gates investment
  era/style:  inherited from the dominant settlement (tech caps, material palette)
}
BankApproach (waypoint) {
  apron:   small landing where the road terminates (a Place)
  slots:   ancillary structure slots (guard_shack | toll_booth | shrine | watermill | …)
}
```

- **Roads terminate at the apron** — the ribbon ends at the bank, not across the water.
  The walker still needs to know the two banks connect (routing), but the *geometry* of
  the span belongs to the Crossing, not the road ribbon.
- **Importance gates investment**: a trunk road between prosperous towns earns a stone
  arch + toll booth + guard; a footpath gets a log-and-rope footbridge and nothing else.

## The bridge as a generated structure

Reuse the building pipeline (blueprint → manifold geometry → magenta grey init → img2img
→ chroma-key → quality gates → register → SpritePack), with a **bridge-specific
compiler** because a bridge is LINEAR (variable span) rather than a fixed footprint:

- **Parameters:** span length, water width, deck width (road class), pier count (from
  span), railing style, **material** (era × prosperity × local resource: rope/log →
  timber trestle → stone arch), abutment style.
- **Era/prosperity coupling:** reuse `ERA_TECH` caps + the medieval material palette.
  Stone-age = felled-log or rope-and-plank; medieval prosperous = multi-arch masonry.
- **Open question:** does the span render as ONE generated sprite (works for short
  spans, fixed silhouette) or as a *tiled* parametric deck + generated *material*
  (better for long/variable spans — ties back to the just-shipped road-material atlas
  prototype `90de950`)? Likely **hybrid**: parametric pier/deck geometry, generated
  surface material + generated abutment/gatehouse sprites at the ends.

## The crossing as a waypoint (gameplay)

- Register the Crossing + its two approaches as **named Places** in the world graph →
  storylets / Fate / divine-inbox can target them (`bandits hold the bridge`,
  `toll dispute`, `flood washes out the ford`, `procession crosses at dawn`).
- **Ancillary structures** site by need/prosperity/era using the settlement-growth siting
  logic: `toll_booth` (economic chokepoint), `guard_shack` (control/safety),
  `shrine` (thresholds attract devotion — ties to belief), `watermill` (water power).
- NPCs path *through* crossings; a washed-out/destroyed span reroutes them — a real
  consequence lever for events and rival/divine action.

## Proposed phasing

- **Phase 0 — interim (now):** keep R3b plank deck as the stopgap. No change.
- **Phase 1 — Crossing nodes + roads stop at banks:** `road-graph` emits Crossing nodes
  (approaches + span metadata + importance); the road ribbon terminates at the apron; a
  simple parametric span placeholder fills the gap. Retire the ribbon's plank spanning.
- **Phase 2 — Generative bridge structures:** bridge blueprint compiler → building art
  pipeline → sited bridge (material/era/style from the site). Replaces the placeholder.
- **Phase 3 — Crossing as a place:** waypoint/Place registration; ancillary structure
  slots sited by prosperity/need/era; storylet + Fate hooks; gameplay (tolls, control,
  flood/destruction reroute).

## Dependencies / related

- [[project-connectome-world-layout]] — crossings are connectome nodes.
- [[project-shrine-procession-connectome]] — same "generative sub-connectome for a site
  type" pattern; share the scaffolding.
- Building pipeline ([[project-img2img-building-sprites]], [[project-parametric-buildings]])
  — the bridge compiler is a new blueprint family.
- [[project-storylet-engine]] / Fate — crossings as targetable Places.
- [[project-settlement-growth]] — ancillary-structure siting logic.
- Road-material atlas prototype (`90de950`) — candidate for the deck surface in the
  hybrid render path.

## Open questions for sequencing

1. Start Phase 1 now, or finish other in-flight roads/rivers polish first?
2. Bridge render: single generated sprite vs hybrid parametric-deck + generated-material?
3. Scope of Phase 3 gameplay (tolls/control/flood) — MVP which subset?
