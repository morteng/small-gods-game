# The Unified World Connectome — composable, scale-free, agent-controllable

**Status:** design brainstorm (2026-06-20). Foundational architecture; no code yet. Worked
example: `2026-06-20-river-crossings-generative-sites-brainstorm.md`.
**Origin:** user — *"our idea is to build up a full world connectome that is flexible enough
to handle really good worldbuilding and can be efficiently controlled, built and modified by
agents."* And, on bridges: not "a building" per se, but **part of the same structural
system** as buildings — some bridges have rooms/doors, some carry buildings on them.

## The goal

ONE graph vocabulary that expresses **all** worldbuilding structure — a cottage, a stone
arch, an inhabited bridge with shops, a fortified gatehouse, a temple complex, a whole
settlement, a region — with four properties:

1. **Composable** — structures are built from a shared set of primitives that nest and
   attach. A bridge = span + piers + deck + *optionally* rooms, a gatehouse, or whole
   buildings standing on the deck. "Building on a bridge" is just a building node
   `contained-by` a deck node. No special bridge type; composition does the work.
2. **Scale-free** — the same node/relation vocabulary at every scale: part → structure →
   site → settlement → region. A "site" contains "structures" contain "parts", recursively.
   (This is the "scale-free building connectome" of the worldbuilding-fact-database epic,
   promoted to the whole world.)
3. **Flexible for real worldbuilding** — kinds are an open, fact-DB-backed vocabulary, not a
   fixed enum; parameters (material, era, style, scale, prosperity, biome) cascade down the
   composition with local overrides (Blueprint's layered patches, world-wide).
4. **Agent-controllable** — the connectome IS the API surface Fate/MCP agents read, build,
   and modify over the command/query bus. Legible vocabulary + bounded verbs + deterministic
   realization → an LLM can reason about the world and edit it predictably and replayably.

Render stays a **projection** of this graph (the already-shipped "ONE renderer = projection
of ONE connectome" thesis), and realization reuses the existing generators — nothing here is
a new renderer.

## What already exists (this is an ELEVATION, not a greenfield)

The pieces are largely built; the work is unifying them under one vocabulary:

| Need | Already in the codebase |
|------|--------------------------|
| Composable structure model | **class-neutral Blueprint** — parts + features registry, layered patches, 4 compilers ([[project-blueprint-parameter-model]], [[project-parametric-buildings]]) |
| Scale-free graph + catalogue | **worldbuilding fact-database** + scale-free building connectome (HEAG210) ([[project-worldbuilding-fact-database]]) |
| Realization → art | **blueprint → manifold → img2img → SpritePack** pipeline ([[project-img2img-building-sprites]], [[project-openrouter-building-pipeline]]) |
| Multiple graph producers | roads/rivers (ribbons), walls (enclosure), settlements, shrines, defensive works — all emit graph structure today |
| One spatial authority | **spatial-coordination epic** — one footprint def, one OccupancyGrid, renderer projects placed geometry ([[project-spatial-coordination-epic]]) |
| World layout from graph | [[project-connectome-world-layout]] |
| Agent control surface | **command/query bus** S0 + **capability registry** (~20 verbs incl. `author_set_climate`) + **Fate** brain ([[project-command-query-bus]], [[project-command-channel-capability-registry]], [[project-fate-brain]]) |

The gap is that these are **separate** vocabularies/producers. Unification = one node/edge
model they all emit into, one parameter-cascade, one realization dispatch, one agent verb set.

## The vocabulary (the heart of it)

**Node** — a place/structure at any scale:
- `kind` — open, fact-DB-backed (cottage, pier, deck, gatehouse, toll_booth, crossing,
  bank_apron, settlement, …). Not an enum; new kinds are catalogue entries.
- `params` — material / era / style / scale / prosperity / biome / role …, **inherited**
  from the parent with local overrides (region → settlement → site → structure → part).
- `anchor`/`footprint` — the single spatial-coordination footprint + occupancy claim.
- `composition` — child nodes + Blueprint features (the recursive part).

**Relation (edge)** — typed:
- `contains` (deck contains a shop; settlement contains buildings; structure contains rooms)
- `connects` / `leads-to` (roads, portals, paths)
- `spans` (bridge over a river reach)
- `adjoins` / `serves` (mill serves a crossing; apron adjoins the bank)

**Realization** — a node is realized by dispatching on `kind` to the right existing
generator: structures → blueprint/manifold/img2img/SpritePack; ground & biome → worldgen;
linear features → ribbons. Deterministic + cached per (kind, params, composition hash), just
like building art today.

## Agent control (the property that shapes everything)

The connectome is what Fate/MCP manipulate. To be *efficiently* controllable it needs:
- **Read** — `GameQuery` extensions to walk nodes/edges/params (cf. `GameQuery.beliefPowers`).
- **Build** — capability-registry verbs that emit/compose nodes: `place_structure`,
  `compose_into`, `connect`, `set_param`, `span`, … (extends the existing ~20-verb registry).
- **Modify** — patch a node's params/composition; realization re-runs deterministically so
  the edit is predictable and replay-safe (matches the sim's snapshot/replay discipline).
- **Legibility** — compact, stably-named vocabulary; bounded verb set; so the LLM reasons
  about "the crossing site, its bridge, its toll booth" rather than raw geometry.

This is the same command/query bus that already drives the WebGPU UI and MCP integration —
the connectome just becomes its primary noun.

## Worked example: a river crossing

A footpath crossing a stream and a trunk road crossing a river produce *different sites* from
the same machinery (full detail in the crossing brainstorm):

- **footpath × stream** → `crossing` node `spans` the reach; composition = a bare
  `deck`+`piers` bridge (log/plank, poor era); two `bank_apron` nodes, no ancillary
  structures; biome lightly trodden.
- **trunk road × river, prosperous, late era** → `crossing` with a multi-arch **stone
  bridge** that `contains` a `gatehouse` and shop nodes on the deck; each `bank_apron`
  `contains` a `toll_booth` + `guard_shack` (+ maybe a `shrine` at the threshold); biome =
  cleared, paved apron, riparian planting. Fate can later `set_param prosperity↑` (the site
  grows shops), `span destroyed` (flood washes out the bridge → roads reroute), or
  `compose_into bank_apron shrine` (a cult claims the crossing).

Every node here is realized through the shared pipelines; the whole site is one agent-legible
sub-connectome.

## How this folds the in-flight epics together

- **Blueprint** becomes the *part/structure* tier of the connectome (extend upward: a
  Blueprint can be a child node of a larger node — scale-free).
- **spatial-coordination** supplies the one footprint/occupancy authority every node uses.
- **fact-database** supplies the open `kind` vocabulary + parameter catalogue.
- **command/query bus + capability registry + Fate** become the agent control surface over
  connectome nouns.
- **connectome-world-layout / settlement-growth / shrine-procession / defensive-constructions
  / roads-rivers** become *producers* that emit into the one connectome with one vocabulary.

## Open design decisions (for refinement)

1. **Vocabulary first or use-case first?** Formalize the node/edge/param model up front, or
   grow it from the crossing example and one or two others (settlement, shrine) and let the
   shared shape emerge? (Lean: grow from 2–3 worked examples, then lift the common model.)
2. **Extend Blueprint upward, or a new connectome layer above it?** Make Blueprint nodes
   recursive (a node can contain nodes), or introduce a thin "WorldNode" layer that *holds*
   Blueprints as leaves. (Lean: thin WorldNode layer; keep Blueprint focused on one structure.)
3. **Agent verb set + serialization** — what's the minimal read/build/modify verb set, and a
   compact, LLM-legible serialization of a sub-connectome?
4. **Realization caching/invalidation** at site scale (a param change high in the cascade
   re-realizes children) — reuse the building-art cache keys + `ART_RECIPE_VERSION` discipline.
5. **Migration** — connectome producers move onto the shared vocabulary incrementally; what's
   the first producer to port (crossing is new, so it can be native from day one)?

## Suggested next step

Stay in design: pick **2–3 worked examples** (crossing + settlement + an inhabited/gatehouse
bridge) and draft their node/edge/param compositions concretely. The shared vocabulary that
falls out of all three becomes the v0 connectome model — then we spec the realization
dispatch + the agent verb set against it.
