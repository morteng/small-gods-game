# Agent-friendly worldbuilding fact database + functional building model (brainstorm)

**Date:** 2026-06-14 · **Status:** brainstorm (user-directed) · **Builds on:**
[blueprint parameter model](2026-06-08-blueprint-parameter-model-design.md),
[asset catalogue / variant / lifecycle](2026-06-14-asset-catalogue-variant-lifecycle-design.md),
[era-aware worldgen content](2026-06-05-era-aware-worldgen-content-design.md),
[settlement growth](2026-06-13-settlement-growth-placement-design.md),
[medieval building reference](../../reference/medieval-building-reference.md)

## What the user asked for

> "Consider our world generation system with blueprints, in levels, so we can go
> from world to buildings and props and whatever. Use Wikipedia to research the
> buildings we have defined to determine what we are missing and should include in
> blueprints — features and functionality. For medieval buildings, the number,
> type and placement of fireplaces should determine the building's chimney vents,
> and we should model the base geometry of the fireplace and chimney so it can
> work in construction variant and ruin variant. Focus on early medieval and see
> what is what for real. Also start building an agent-friendly fact database on
> world items (buildings first) with different levels of descriptions and spread
> of variations — to supply facts for descriptive and generative prompts/outputs
> by small, cheap, potentially local LLM agents. What am I not thinking of?
> Suggest a path forward to great detail and variety in worldbuilding."

Follow-up: **"We aim for blueprint-driven generation for both outdoor and indoor
eventually. Do outside first."**

## Decisions taken (from the brainstorm Q&A, 2026-06-14)

1. **Fact DB = single source of truth (refactor).** It becomes canonical; the
   existing scattered data (`eras.ts`, `descriptors.ts`, `lifecycle.ts`, the
   `to-brief.ts` `DETAILS` array, the prose `medieval-building-reference.md`) is
   migrated to read from it. No long-term drift between facts, patches, and prompts.
2. **Strip chimneys now, reseed art later.** Early-medieval presets lose their
   default chimneys immediately (cottage/longhouse → central hearth + ridge
   louver). Baked art mismatches until a funded reseed — accepted; the library is
   already orphaned (gemini-keyed → FLUX) per the variant-lifecycle epic.
3. **Brainstorm doc first** (this document), then spec → plan per the standard
   workflow.
4. **Spatial connectome is the architectural spine** (added 2026-06-14, second
   Q&A). A building is modelled as a *graph* (rooms + portals + fixtures), not a
   bag of parts — see "The spatial connectome" below.
5. **Connectome layers ABOVE the existing Blueprint** — it resolves *down* into
   today's parts/features `Blueprint` for the exterior and carries the room-graph
   for interior later. The working geometry pipeline is untouched (lowest risk).
6. **Room-graph is latent now, constrains the exterior** — generated immediately
   and used to make the *exterior* correct (door count/size/placement, windows,
   hearth→egress); interior rendering later reuses the same graph, zero rework.
   Honours "do outside first" while building the indoor foundation.
7. **Domain-neutral engine; content lives in swappable packs** (added 2026-06-14,
   third Q&A). The engine knows only Catalogue / Connectome / Grammar / Constraint
   — *all* content (room/material/fixture/function types, topologies, rules) is
   **data** in a content pack, via string-keyed **open registries** (no closed
   enums). Early-medieval is pack #1; fantasy, sci-fi, and user/agent-authored
   settings are future packs needing **no engine change**. Agents register new
   catalogue entries at runtime. Grammar rules are declarative data.

→ **Spec for Slices 0–1:**
[fact-catalogue + building connectome](2026-06-14-fact-catalogue-connectome-slice01-spec.md).

## The spatial connectome — the architectural spine

The user's framing (two follow-ups): a building should be modelled by the
*relationships* between its features — "correct number of doors of correct sizes,
correct type and number of rooms, the hearth logically placed in relation to all
of them" — and, more broadly, **"think of the entire gameworld as layers of
connectomes. A settlement can have a market-district node, a butcher node, and so
on."**

The answer: stop treating a building (or a settlement, or the world) as a *bag of
parts* and treat it as a **graph**. The same three primitives recur at every
scale, which is exactly what lets interior, exterior, settlement, and world live
in one parametric system.

### Three primitives, applied at every scale

- **Zone** (node) — a bounded volume/area with a *function* + parameters.
  Recurses: `world ▸ region/biome ▸ settlement ▸ district/ward ▸ plot ▸ building
  ▸ room ▸ niche`. A building is a zone whose children are room-zones; a
  settlement is a zone whose children are district- and building-zones.
- **Portal** (edge) — a connection between two zones, with a *type* and *size*:
  door, passage, gate, window (non-walkable "light/air" portal), street,
  road-segment, river, trade-route. **"Correct number of doors of correct sizes"
  lives here** — it is an edge property, not a free-floating part.
- **Fixture** (leaf) — attached to a zone or wall, *not* a connection: hearth,
  oven, well, anvil, market stall, furniture, staddle stones. A fixture can
  **emit a requirement** another fixture satisfies — the hearth emits "smoke must
  escape," satisfied by a louver/chimney fixture placed by derivation.

On top sits a **seeded grammar**: given a zone's `(function, period, wealth,
region, seed)`, rules expand it into child zones + portals + fixtures. The grammar
is the connectome generator; the **fact DB is its content** (what rooms a tavern
has, what a market district contains, where hearths go). Two halves of one thing:
*fact DB = the knowledge, connectome = the structure that knowledge instantiates.*

### The whole gameworld = layers of connectomes (a multigraph)

The key generalization from the second follow-up: there is **not one graph per
layer — there are several relationship graphs over the same nodes.** A node
participates in many at once. The "butcher" example makes this concrete — the
butcher is simultaneously:

- a **Zone** (the shop building) ⊂ market district ⊂ settlement — *containment graph*
- a node in the **circulation graph** (its door opens onto a market street)
- a node in the **functional/economic graph** (buys hides → sells to tanner;
  buys stock → from farms; aggregates → into the market)
- staffed by NPCs who are nodes in the **social graph**
- a conduit in the **belief graph**

So the world is a **layered multigraph**: containment, circulation, economy,
social, belief — same nodes, different edges. This is the unifying vision.

### Most of these graphs already exist — this is unification, not greenfield

Critically, the engine already runs several of these connectomes independently:

| Graph | Already in code |
|---|---|
| Social | `src/sim/social-graph.ts` (NPC relationships) |
| Belief | belief propagates along the social graph (`systems/belief-propagation`) |
| Circulation (settlement) | road graph + frontage + `Connection{wall}` (settlement-growth epic) |
| Circulation (building↔world) | `toAnchors` — doors as connection points |
| Containment (settlement) | `Village.wards` (golden-spiral named wards), burgage lots |

The connectome model **unifies** these under one Zone/Portal/Fixture abstraction
rather than inventing from scratch — which both de-risks it and clarifies what's
genuinely new (rooms inside buildings; functional/economic edges; district-level
*functional* nodes like "market district" / "butcher").

### Why this is historically real (the building layer)

Medieval vernacular buildings *are* small, highly-constrained graphs — the
research gives us the rules directly:

- **Hall house** — cross-passage (two opposed exterior doors) splits a *service
  end* (pantry + buttery, unheated, by the entrance) from the *hall* (central
  hearth) and the *upper end* (parlour, with the *solar* stacked above):
  `service —passage— hall —door— parlour —stair— solar`.
- **Longhouse** — same cross-passage; far end is a *byre* (animals, partitioned,
  dung drain); heated end has the hearth.
- **Barn** — two big opposed doors (cart + threshing draught); no hearth, no windows.

Get the graph right and "correct rooms / correct doors / logically-placed hearth"
all fall out of the topology.

### How it makes the three asks literally derive

- **Doors** — count + placement from the topology (1-room cottage → 1 door;
  cross-passage hall → 2 opposed; barn → 2 cart-sized). **Size** is a portal-type
  property (human / cart / grand-main). The main door's wall faces the settlement
  road graph.
- **Rooms** — the grammar expands building function → a room program → assigned
  to the footprint.
- **Hearth → egress** — hearth is a fixture in the hall room; period sets its
  position (central early / gable-or-cross-wall late); the smoke-egress fixture is
  placed at the roof point **directly above the hearth's room**. "The hearth
  determines the chimney vent" becomes a one-line graph derivation — correct in
  *both* construction and ruin variants because both read the same hearth node.

### The layout step is tractable (the usual fear)

No general floor-plan solver needed. Medieval vernacular = **linear bay
sequences** (a 4-bay hall = 4 modules along one axis). Room assignment =
partitioning the bay sequence into contiguous runs in the grammar's canonical
order; cross-wing/L/H = a small 2D version; upper floors = a stack (solar over
parlour). Doors on shared cross-walls; cross-passage punches both long walls at
the passage bay; windows on light-needing rooms' exterior walls. Bounded,
seedable, deterministic — the same *family* as the WFC already used for terrain.

### Integration: layer ABOVE the Blueprint (decision 5)

The connectome does **not** replace the geometric `Blueprint`. It is a higher
layer that resolves *down* into it:

```
Program  (type, era, wealth, region, seed)
  → Connectome   (zones + portals + fixtures, via seeded grammar ← fact DB)
      → resolves to → Blueprint (today's parts/features)        [exterior, NOW]
                    + carries the zone/room-graph               [interior, LATER]
          → 4 compilers (geometry / collision / anchors / brief)
          + a future interior compiler (floor plan, room volumes)
```

The Blueprint stays the geometric IR; the whole working pipeline (parts →
manifold → img2img → SpritePack) is untouched. The resolved zone-graph joins the
**canonical identity** (alongside the resolved blueprint), keeping interior and
exterior art keys consistent with the variant DB.

### Phasing: latent now, constrains the exterior (decision 6)

Generate the room/zone graph **now** and use it only to make the *exterior*
correct (door count/size/placement, windows, hearth→egress). The outside is
correct *because* there is a plausible inside behind it. When indoor rendering
lands, the same graph is walked from inside — zero rework. Exterior-first value
immediately; interior is free foundation.

### Agent payoff

The multigraph **is** the fact structure agents read and edit. A cheap local
model reasons over a graph, not geometry: "tavern → taproom + kitchen + 3 lets +
cellar; hearth in kitchen; main door faces the market; butcher two doors down,
run by NPC X who believes in spirit Y." Fate's edits become graph ops: *add a
room*, *move the hearth*, *this door is too small*, *insert a chimney at the
cross-passage*, *place a tannery downstream of the butcher*. LOD fact entries
describe the nodes; the grammar validates the edges.

## The headline finding: early-medieval = no chimneys

The user's premise — *"fireplaces determine chimney vents"* — is the right
**modeling principle** (a functional cause drives a structural consequence) but
**historically inverted** for the target period. Wikipedia is unambiguous:

- **Open central hearth + a roof vent was the norm from antiquity through the
  high Middle Ages.** Peasant homes are *defined* by "the open hall and the lack
  of a chimney or upper floor, evidenced by soot from the central hearth."
- **Chimneys are an 11th–12th-c. elite/stone-castle invention** (earliest English
  example: Conisbrough keep, **1185**) and **did not reach ordinary houses until
  the 16th–17th c.** — retrofitted into open-hall houses around/after **1570**.
- The intermediate technology is the **louver/louvre** (covered roof vent; could
  be a timber lantern or a manufactured *Colchester-ware* ceramic fitting), then
  the **smoke hood / firehood** (wicker + lime-plaster, vents to roof apex or
  wall) and the **smoke bay** — **not** a chimney.

So the correct causal chain for our world is:

> **hearth (the source) → smoke must escape → period + wealth + material decide
> the egress structure:** smoke-hole → covered **louver** → **smoke-hood/canopy**
> → (late / elite only) **wall fireplace + chimney**.

This *is* the functional→structural derivation the user wanted — it just makes the
**chimney a late/elite/upgrade variant** rather than a default. That is a gift: it
yields a natural time-progression mechanic ("centuries pass, the settlement
prospers → chimneys, glazed windows, tile roofs appear as upgrades") that plugs
straight into the existing `UPGRADE_CHAINS` from the settlement-growth epic.

### Smoke-system timeline (the strongest variation axis)

| Period | Ordinary dwelling | Elite / stone |
|---|---|---|
| **Early (c. 500–1000)** | central open hearth + smoke-hole / **louver**; no chimney, no upper floor; thatch | timber keeps; halls = central hearth + built louver, tall roof drawing smoke up |
| **High (1000–1300)** | central hearth + louver standard | first **stone-keep wall fireplaces + flues** (Conisbrough 1185); smoke hoods against stone walls |
| **Late (1300–1500)** | open hearth persists; **smoke bays / firehoods** emerge late; glass/lime ~1550 | brick chimneys still mostly elite |
| **Early modern (post-1570, "modernized" overlay)** | **chimney retrofit**, open hall **floored over**, glazed mullioned windows, thatch→tile | — |

## The state of play — what the blueprint system can express today

The blueprint system (see [parameter model](2026-06-08-blueprint-parameter-model-design.md))
is genuinely strong:

- **9 part types** — `body` (plan rect/round/L/cross/stepped, 17 roof kinds,
  jetty, levels, `storeyM`), `wing`, `tower`, `porch`, `chimney`, `tree`, `well`,
  `graveyard`, `prim` (raw escape hatch).
- **4 feature types** — `door` (rich semantics: hinge/swing/lock/hardware),
  `window` (plain/shuttered/arched, glazed, sill), `vent`
  (chimney/smokehole/pipe, ridge|wall), `dormer`.
- **Layered patches** — preset → era → descriptors → lifecycle-stage → seed →
  agent overrides; each axis produces a distinct art-cache key via
  `canonicalJson` (defaults omitted → stable keys).
- **4 compilers** — `toGeometry` (→ manifold CSG `StructureSpec`), `toCollision`
  (footprint/blocked/doorCells), `toAnchors` (world-space entry points), and
  **`toBrief`** (→ `AssetBrief` with subject/traits/materials/door/palette/
  negatives — the prompt feed).
- **17 presets** — cottage, tavern, townhouse, market_stall, temple_small,
  farm_barn, tower, castle_keep, dock, shrine, guard_post, watermill, longhouse,
  yurt, well, graveyard, + 7 tree species.
- **Variant DB (Slices A–F)** — 3 orthogonal patch axes (era / descriptors /
  lifecycle-stage) + semantic anchor tags; `--matrix` seeding.
- **Manifold CSG toolkit** — box / cylinder / cone / prism / ellipsoid / arch /
  bore + union/subtract/extrude/rotate/translate; material per prim.

### Where the data lives today (and why it must unify)

"Facts" are currently scattered and prone to drift:

- `src/blueprint/eras.ts` — era → material/window/vent swaps
- `src/blueprint/descriptors.ts` — wealth/quality/condition/style ladders
- `src/blueprint/lifecycle.ts` — stage curves (plants + buildings)
- `src/blueprint/compile/to-brief.ts` — `DETAILS` array (ad-hoc prompt phrases)
- `docs/reference/medieval-building-reference.md` — prose design values

These hold the same underlying facts in incompatible forms. The user's "fact
database" is the unification of all of them into **one machine-readable canonical
source** that feeds (1) patch content, (2) prompt text, and (3) LLM grounding.

## Gaps for honest, varied early-medieval worldbuilding

| Gap | Now | Missing |
|---|---|---|
| **Function layer** | structure only (parts/features) | no *purpose* — "dwelling with a hearth", "byre", "forge". Structure should be **derived from** function + period + wealth + region. This is the real lever for variety, not more hand-authored presets. |
| **Hearth / smoke** | `vent` is roof-only, untied to anything; chimney = thin 0.30 m box | no hearth concept; egress not derived from a source nor period-gated; no proper louver / smoke-hood / chimney-breast geometry (real stacks 0.6–1.0 m, kitchen 1.5–2 m) |
| **Region axis** | era + descriptors + stage | **no region** — yet region drives materials *more than wealth does*: stone belt → stone+slate; wooded lowland → timber+thatch; west country → cob; Norse → turf |
| **Size primitive** | `footprint {w,h}` tiles | medieval buildings measured in **bays** ("4-bay cruck hall"); bays drive length (longhouse/barn), truss rhythm, window/door placement |
| **Frame type** | implicit (jetty exists) | **cruck vs box-frame** is a major silhouette axis |
| **Decay model** | one lifecycle curve | decay is **material-ordered**: thatch roof → wattle infill → frame (rots ground-up) → cob walls (slump to mounds) → stone (robbed, roofless shell) → foundations/hearthstone/earthworks. Cob ruins ≠ stone ruins. Should derive from material survival, *plus* scavenging. |
| **Missing types** | 17 presets | **granary** (raised on staddle stones), **dovecote** (manorial; pigeonholes + potence), **smithy** (forge hearth + anvil + bellows, open front), **bakehouse** (dome oven), **windmill** (post mill, 12c+; not early), proper **church** (oriented nave+chancel+bell-cote; stave/palisade timber vs stone), **palisade/stockade + gatehouse**, motte-and-bailey refinement, **byre-end** of longhouse |
| **Missing features** | door/window/vent/dormer | **shutters** (windows were *unglazed shuttered* early), louver-distinct-from-chimney (partially via `smokehole`), **smoke-hood**, bell-cote/spire, crenellation/merlons, staddle posts, aisle, cross-passage |
| **Interior vocabulary** (for "indoor later") | none | bay, open hall, solar, parlour, pantry, buttery, undercroft/cellar, byre + partitions + dung drain, inglenook, screens passage — all are interior concepts that *also* constrain the exterior (door positions, building length, smoke egress count) |

## The fact database — design

The key decision (confirmed): the fact DB is **not a separate artifact** but the
**canonical source** the patch layers and prompt builder read from. It is a small
domain ontology, grounded in real-world facts with provenance.

### Levels of description (LOD) — so cheap/local models pull only what they need

Each entry carries graduated detail:

- **L0** — id + one-line gloss: `"tavern: two-storey timber drinking house"`
- **L1** — short trait list (subject + key *visible* traits)
- **L2** — paragraph (function, construction, materials, layout)
- **L3** — structured fields:
  `construction`, `materials[]`, `roof`, `size(bays)`, `features[]`, `smoke`,
  `decay`, `variants{period,wealth,region,function}`, `constraints[]`,
  `terminology[]`, `sources[]`

### Cross-cutting catalogues (shared vocabulary, not per-type)

- **materials** (mud / wattle-and-daub / cob / turf / timber / log / brick /
  stone / thatch / shingle / stone-slate / slate / tile / hide) — with the
  wealth + region ladders that today live in `descriptors.ts`/`eras.ts`
- **roof-coverings** (pitch + eave/verge from the reference doc)
- **smoke-systems** (hearth → smoke-hole → louver → smoke-hood → wall-fireplace
  + chimney), period-gated
- **frame-types** (cruck / box-frame / mass-wall / stave)
- **feature-vocabulary** (the openings/levels/spaces/fortification terms)
- **decay-rules** (per-material survival ordering)

### Cross-cutting tags on every fact

- **provenance** — Wikipedia citation(s), so cheap models are grounded and the
  catalogue is auditable/extensible (and descriptions are reproducible).
- **visibility** — `geometry` (≥8 px, model it) / `texture-prompt` (2–5 px, paint
  it) / `data-only` (door hardware, hearth furniture) — reusing the sprite-scale
  rule already pinned in `medieval-building-reference.md`. One DB then serves
  **geometry now, prompts now, and indoor/zoom later** without modeling invisible
  detail prematurely.

### Consumers (one source, three readers)

1. **Patch content** — era/descriptor/region/stage layers read material ladders,
   smoke-system gating, and decay rules from the DB.
2. **`toBrief`** — replaces the ad-hoc `DETAILS` array; assembles prompt traits
   from L1/L2 + visibility=texture-prompt facts.
3. **LLM grounding** — Fate / narration / agent authoring speak in DB terms; when
   an era passes or Fate edits a building, it uses the same vocabulary. The DB
   *is* the authoring vocabulary.

## What the user is not thinking of (the punch list)

1. **No chimneys early** — model the hearth (source); egress is *derived* and
   period-gated. (The premise, corrected.)
2. **Function vs structure split** — structure should be *derived from*
   function+period+wealth+region. Variety comes from derivation, not from
   authoring more presets.
3. **Region is a missing axis** and it dominates materials.
4. **Bays, not tiles**, are the native size unit; they drive feature rhythm.
5. **Decay is material-ordered** (+ scavenging) — ruin variants should *derive*
   from which materials survive, not from one curve.
6. **Upgrade chains = time-progression gameplay** — chimneys/glazing/tile-roofs
   as a prospering settlement ages. Hooks into existing `UPGRADE_CHAINS`.
7. **Provenance + visibility tags** keep generation honest and serve
   geometry/prompt/future-indoor from one source.
8. **Validation** — facts contradict (thatch+flat roof; chimney+early era). Need a
   constraint checker so both the generator and LLM agents stay honest.
9. The fact DB **doubles as Fate's authoring vocabulary**.

## Suggested path forward (connectome spine; exterior first; extends to indoor)

The connectome is the backbone; the fact DB feeds it; the geometric Blueprint is
the IR it resolves into. Hearth/bays/rooms are interior concepts that *also* drive
the exterior, so adding them now (as latent constraints) lays the indoor + world
foundation for free.

- **Slice 0 — Fact catalogue foundation.** Machine-readable fact DB (schema +
  LOD + cross-cutting catalogues + provenance + visibility), seeded from this
  research for the 17 types. Rewire `toBrief` to read from it (retire `DETAILS`).
  Begin the single-source refactor: era/descriptor/lifecycle data move into the
  catalogue. Tests: every preset → a fact entry; constraint checker green; golden
  cottage brief bit-stable.
- **Slice 1 — Building connectome (latent room-graph) + hearth→smoke payoff.**
  Introduce Zone/Portal/Fixture for buildings; a seeded grammar (fed by the fact
  DB) expands `(type, era, wealth, seed)` → a room graph (linear bay partition).
  Resolve it *down* into the existing parts/features Blueprint, deriving exterior
  door count/size/placement, windows, and the **hearth→egress** chain (strip
  default chimneys from early presets; model louver + late chimney-breast geometry
  properly, with construction/ruin variants). Graph is latent (not drawn) but the
  exterior is now correct *because* of it. First concrete payoff of the spine.
- **Slice 2 — Region axis + material derivation.** Add `region` to the program /
  patch stack; region drives wall+roof material ladders (dominates wealth).
- **Slice 3 — Bays + cruck/box frame type** (the connectome's layout step made
  explicit). `body` gains `bays` + `frameType`; footprint + truss-rhythm
  window/door placement derive from the room partition.
- **Slice 4 — Missing exterior types & features** — granary (staddle), dovecote,
  smithy (forge), bakehouse (oven), windmill (post mill), church
  (nave+chancel+bell-cote), palisade/gatehouse, byre-end + shutters/aisle/etc.
  Each is a new room-graph grammar + fact entry, not just a preset.
- **Slice 5 — Settlement connectome (functional district + establishment nodes).**
  Generalize the spine *up* one level: over the existing `Village.wards` + road
  graph, add **functional district nodes** (market district, craft quarter,
  religious precinct) and **establishment nodes** (butcher, smithy, bakehouse)
  with **economic-graph edges** (butcher→tanner, market aggregates crafts) that
  bias placement/growth (butcher in market district; tannery downstream/downwind).
  Hooks into the settlement-growth epic's `UPGRADE_CHAINS`/`planCivics`.
- **Slice 6 — Material-ordered decay + upgrade chains** — derive ruin variants
  from per-material survival; wire upgrade chains (thatch→tile, +chimney, hall
  floored-over) into era/settlement progression.
- **Later / north-star (out of this epic's exterior-first scope):** interior
  compiler walks the room graph (indoor rendering); world/region connectome
  (settlements as nodes, roads/rivers/trade as edges); unify social + belief
  graphs as explicit layers of the multigraph over shared nodes.

## Concrete "one cottage, four ways" (the variety target)

1. *Midland cottar's cottage, c. 900* — cruck-framed, two bays, wattle-and-daub,
   long-straw thatch, central open hearth, **no chimney**, beaten-earth floor,
   two small shuttered openings.
2. *Kentish yeoman's house, c. 1450* — box-frame, four bays, jettied solar,
   crown-post roof, **still open hearth** (smoke-blackened timbers), thatch/early
   tile, pantry + buttery at the screens end.
3. *Devon longhouse, c. 1300* — stone walls, thatch, cross-passage dividing
   living end from a partitioned **byre** with a dung drain, central hearth.
4. *Same house "modernized," c. 1600* — brick chimney at the cross-passage, open
   hall floored over, thatch→tile, glazed mullioned windows — the early-modern
   overlay that **should not** appear on an early-medieval baseline.

## Open questions for the spec

- **Catalogue format & location** — TS modules (type-safe, tree-shaken) vs JSON
  data (Fate-editable at runtime, hot-reloadable) under `public/data/facts/` vs
  `src/blueprint/facts/`. Leaning TS-source-of-truth + a JSON export for runtime
  LLM grounding.
- **Region taxonomy** — reuse worldgen biome regions (`biome-regions.ts`) or a
  separate culture/region enum? Materials key off region; biomes already exist.
- **`hearth` as a feature vs a function** — is heat a `Feature` on `body`, or a
  new top-level `function` field that *derives* features? (Affects whether indoor
  rooms become first-class later.)
- **Constraint checker severity** — hard error (block resolve) vs soft warning
  (log + auto-correct, e.g. chimney+early → downgrade to louver)?
- **Decay derivation** — keep named stages (`ruin`/`old_ruin`) but compute their
  *content* from per-material survival, or fully procedural decay by years?
- **Grammar representation** — how are the expansion rules authored? Declarative
  data (room-program tables + adjacency rules in the fact DB) vs imperative
  expansion functions per type. Leaning declarative-data so Fate/agents can read
  and extend the grammar.
- **Zone-graph in canonical identity** — does the full resolved room graph join
  the `canonicalJson` art key, or only the exterior-affecting projection of it?
  (Affects how interior changes invalidate exterior art cache.)
- **Multigraph edge storage** — are economic/social/belief edges stored on the
  Zone nodes, in separate graph structures (as today: `social-graph.ts`), or a
  unified edge store? Likely: keep existing graphs, add a thin typed-edge
  registry that references shared node ids.
- **Where the connectome lives** — `src/blueprint/connectome/` (building-scoped
  now) vs a top-level `src/world/connectome/` anticipating the settlement/world
  layers. Leaning building-scoped now, promote when Slice 5 generalizes up.
