# Establishments — the site/premises connectome layer

**Date:** 2026-06-24 · **Status:** design brainstorm (user-directed) · **Builds on:**
- [Unified world connectome](2026-06-20-unified-world-connectome-design.md) — 🧭 names the `site` scale this realises
- [Defensive constructions connectome (DC-1/DC-2)](2026-06-14-defensive-constructions-connectome-design.md) — the `complex` grammar this generalises (merged to `main` `b8a14b4`, 2026-06-24)
- [Shrines as procession sub-connectomes](2026-06-16-shrine-procession-connectome-design.md) — the first concrete vertical slice
- [Spatial coordination — one footprint, one authority](2026-06-17-spatial-coordination-design.md) — the C1 dependency
- [Anchor-snap / fit connectome](2026-06-20-anchor-snap-fit-connectome-design.md) — frontage anchors the site graph attaches to

## What the user asked

> "It strikes me that the connectome should not sort buildings by function (like
> tavern is now) but when an agent places a tavern somewhere the connectome surfaces
> an appropriate building based on all factors. So a tavern, or a defensive
> installation, is itself a sub-graph — with building but also walls, stuff, yard (or
> not), stuff outside and inside — all programmatically determined to defaults or
> specced by a recipe."

## The reframing

A **placement is not a building. It is a site.** When an agent (or the settlement
placer, or Fate) says "put a tavern here," it should not drop one tavern footprint —
it should surface a tavern **establishment**: the taproom building *plus* its yard, a
stable, a sign, benches, a midden, a well, and "a wall (or not)" — the inside (taproom,
kitchen, cellar, lodging) and the outside (yard, hitching post, gate) all derived. The
building is the **core leaf** of a sub-graph, not the whole thing.

This is the natural generalisation of the layer DC-2 just added. Today there are two
expansion stops:

| Grammar | Input | Output sub-graph |
|---|---|---|
| **building** (`grammar.ts`) | `buildingType` (tavern) | rooms (zones) + doors (portals) + hearth (fixtures) |
| **complex** (`complex.ts`, DC-2) | `complexType` (motte-and-bailey) | wards + buildings + barrier rings + gates + well |

The complex grammar is *already* "a thing = building + walls + yard + fixtures." It is
just **hardcoded to the defensive `enclosure` topology**. The user's insight: defence is
not special. *Every* placement should expand through this layer. A defensive
installation is one `topology`; a tavern-yard, a farmstead, a freestanding chapel, a
market stall are others.

The [unified-world-connectome](2026-06-20-unified-world-connectome-design.md) doc
already names exactly this scale: *"part → structure → **site** → settlement → region. A
'site' contains 'structures' contain 'parts'."* This spec is the concrete, buildable
realisation of that `site` tier.

## The model

### 1. A `site` scale (between `building` and `district`)

`ConnectomeScale` is already an open union (`niche ⊂ room ⊂ building ⊂ district ⊂ …`).
Add `site` (a.k.a. premises/establishment/compound):

```
niche ⊂ room ⊂ building ⊂ site ⊂ district ⊂ settlement ⊂ region ⊂ world
```

A site Connectome's zones are: one **core** building zone (the tavern), zero or more
**auxiliary** building zones (stable, brewhouse), an optional **yard** zone, fixtures
(sign, well, benches, midden, hitching post), and optional **barriers** (the "wall or
not"). Same four primitives — `Zone`/`Portal`/`Barrier`/`Fixture` — one scale up. The
DC-2 `Barrier` `scale: 'complex'` we just merged is the same idea; `site` subsumes it.

### 2. `siteType` generalises `complexType`; topology is a registry

Promote `complexType` → a general **`siteType`** (or add `siteType` and make
`complexType` an alias/subset). `enclosure` becomes one entry in the existing
`COMPLEX_INTERPRETERS` registry, renamed `SITE_INTERPRETERS`. New topologies:

- **`enclosure`** — nested rings + core (today's defensive complex). Yard = ward.
- **`yard`** — a core building + an enclosed/open yard + outbuildings facing it.
  "Wall or not" is the yard's `barrier?` slot — present ⇒ walled, absent ⇒ open court.
- **`freestanding`** — a building with setbacks/aprons + ground fixtures, no enclosure
  (a wayside chapel, a smithy on the green).
- **`procession`** — threshold → funnel → axis-mundi → boundary (the shrine slice; see
  [shrine doc](2026-06-16-shrine-procession-connectome-design.md) — its four structural
  laws *are* a site topology).

`expandComplex` → **`expandSite(siteTypeId, ctx)`** dispatches on the topology id; pure +
deterministic, content-free (the engine-purity guard already covers `complex.ts`).

### 3. Defaults vs recipe — via requirement tokens (already half-built)

"All programmatically determined to defaults or specced by a recipe" maps onto the
Fixture **`requires`/`satisfies`** token mechanism that already exists:

- **Authored recipe:** a `siteType` names its wards/buildings/fixtures/barriers
  explicitly (as DC-2's `motte_and_bailey` does today). Full control.
- **Default derivation (no recipe):** a `buildingType` carries function tags
  (`hospitality`, `craft`, `worship`, `agrarian`) and need/requirement tokens. With no
  authored site, a generic **`derive`** topology synthesises one: it picks the core
  building, then queries the catalogue for auxiliaries whose `satisfies` matches the
  core's `requires` — a `hospitality` building *requires* `guest-yard` + `stabling`; a
  yard fixture and a stable building *satisfy* them. Era/wealth/region/terrain cascade
  (Blueprint's layered-patch model) decide *which* satisfier and whether a wall is worth
  it. So a poor tavern gets an open yard + bench; a wealthy one a walled court + stable +
  sign.

This means **zero authoring is required to get a plausible site** — recipes are an
override, not a precondition. New establishment kinds need only function tags.

### 4. Resolve-down + the placer change

DC-2 already has the resolve-down boundary: `complexToPlan(con)` → `{buildings,
barriers, gates, fixtures}`. Generalise to **`siteToPlan()`**. The real change is the
**placement entry point**:

- **Today:** placer/agent places a *building footprint*.
- **Proposed:** placer/agent places a *site* whose anchor is the requested building →
  `expandSite` → `siteToPlan` → footprints for core + auxiliaries + barrier runs +
  fixtures, co-placed around frontage anchors.

The agent's verb stays simple ("place tavern here"); the connectome surfaces the rest.
Fate/MCP get a legible site sub-graph to read and edit, not an opaque sprite.

### 5. Connection points — the second scale-free primitive (decided: whole stack)

There are two kinds of "connection" in the connectome, and only one is scale-free today:

- **`Portal` — an edge *between* two zones.** Already scale-free top to bottom: the
  primitive is `{from, to}` and only the `type` id changes — *doorway/stair* at building
  scale, *street* at district scale, *road/bridge* at settlement/region scale. "What
  connects two spaces" works at every rung. Done.
- **`Anchor` — a typed attachment point *on* a structure (a socket).** The "this slots
  into / hangs on / fronts onto / seats on that" relation. This exists **only at
  building/frontage scale today** ([anchor-snap](2026-06-20-anchor-snap-fit-connectome-design.md)
  frontage anchors; the unbuilt [skirt/affordance graph](#)). It is **not** uniform
  across the stack — and a site is *made of* these: sign→façade, building→yard frontage,
  gate→wall span, yard→street, building→bridge-deck, settlement→region. You cannot expand
  or co-place a site cleanly without them.

**Decision (user, 2026-06-24): implement ONE scale-free `Anchor` primitive for the whole
stack**, completing the portal/anchor pair. Shape (content-free, like the rest):

```ts
interface Anchor {
  id: string;
  host: string;          // zone/structure id this socket lives ON
  kind: string;          // catalogue id: 'frontage' | 'facade-mount' | 'gate-span' |
                         //   'footing' | 'seat-on' | 'deck-mount' | …
  where?: AnchorWhere;   // face/edge/offset/region on the host (scale-appropriate)
  accepts?: string[];    // attachment-kind tokens this socket will host (token match,
                         //   mirroring Fixture requires/satisfies)
  attrs?: Record<string, unknown>;
}
```

Plus the **attach/contain relations** the [unified-connectome
doc](2026-06-20-unified-world-connectome-design.md) already calls for ("a building
`contained-by` a deck node; composition does the work"). The same vocabulary then
expresses every rung: a sign `mounts` a façade, a building `fronts` a yard, a yard
`gates-onto` a street, a street `joins` a road, a building `stands-on` a bridge deck, a
settlement `seats-on` a region. An `Anchor.accepts` token matched against an attachable's
kind is the *same* matcher as Fixture `requires`/`satisfies` — one resolution rule, every
scale. This is what lets Fate/MCP say "attach a shrine to this crossroads" and have the
connectome find the socket.

## Dependencies & first slice

- **Hard dependency: spatial-coordination C1** (`one footprint, one authority`). A site
  sub-graph co-places a building + yard + wall + outbuildings; they must not overlap and
  the wall must ring the yard, not cut the building. This is the consumer that finally
  *needs* the single `OccupancyGrid` authority + `visual|solid|claim` footprint extents.
  (Wider-corridor road reserves are blocked on the same C1 — they'd unblock together.)
- **First vertical slice: shrines.** The user already greenlit *"shrines as a generative
  sub-connectome that retires `temple_small`"* ([shrine
  doc](2026-06-16-shrine-procession-connectome-design.md)). It is one establishment kind
  with a strong, researched topology (threshold/funnel/axis/boundary) — the ideal proof
  of the generalisation before sweeping taverns/smithies/farmsteads.

## Status (2026-06-28)

- **E0 + E1 SHIPPED** (branch `feat/site-connectome-e1`). Open question 1 resolved
  **ADD, don't rename**: `complex.ts`/`complexType`/`enclosure` stay byte-identical
  (DC-2 untouched, all its tests green); a NEW `site` scale + `siteType` kind +
  `src/blueprint/connectome/site.ts` (`expandSite`/`siteToPlan`/`registerSiteInterpreter`)
  carry the everyday topologies `yard`/`freestanding`/`derive`. Open question 2 resolved
  **fields on `buildingType`**: optional `functions`/`requires`/`satisfies` (the tavern
  emits `['stabling','signage','seating','water-supply']`; a `stable` building satisfies
  `'stabling'`; `hanging-sign`/`tavern-bench`/`well` fixtures satisfy the rest). PURELY
  ADDITIVE — `expandComplex`/`complexToPlan` were already DORMANT (tests only, no live
  worldgen caller), so NO `WORLD_CONTENT_VERSION` bump. Engine-purity guard extended to
  cover `site.ts`. Tests: `connectome-site.test.ts` (13). Stops at `siteToPlan` (data) —
  E2 places it.
- **E0.5 anchors** already on `main` (mount-anchor flavour + sprite projection).
- **NEXT:** E2 (placer routes a `place(buildingType)` through `expandSite` → co-placed
  footprints on the shared OccupancyGrid — spatial-coordination **C1** shipped `98acdc1`,
  so this is now UNBLOCKED + needs the version bump); E3 shrine `procession`; E4 sweep.

## Proposed slices

- **E0 — `site` scale + `expandSite` rename/seam (behaviour-neutral).** ✅ SHIPPED (as
  ADD, not rename — see Status). `complexType`/`enclosure` keep working byte-identically;
  the `site` scale is added to `ConnectomeScale`. No new live behaviour. Guard: existing
  DC-2 tests stay green unchanged.
- **E0.5 — scale-free `Anchor` primitive (decided).** Add the `Anchor` interface + the
  attach/contain relations + the `accepts`/kind token matcher (shared with Fixture
  `requires`/`satisfies`). Retrofit the building-scale frontage anchors onto it so
  there's ONE anchor type, not two. Pure data + resolver; no placement change yet.
  Unblocks E1/E2 (a site's parts attach via anchors) and is the connection-point half of
  the unified-connectome stack. Guard: anchor resolution is deterministic + content-free.
- **E1 — `yard` + `freestanding` topologies + `derive` default.** ✅ SHIPPED. The
  generic default-derivation path (function tags → satisfier query) is the star: a bare
  `expandSite('tavern')` synthesises an OPEN-yard site (core + yard + stable aux + sign +
  bench + well) by resolving the core's `requires` tokens to sorted-deterministic
  catalogue satisfiers (fixtures first, then auxiliary buildings); the authored
  `tavern-yard` recipe is the OVERRIDE (a `paling-fence`-walled court). `wayside-shrine`
  exercises `freestanding`. Stops at `siteToPlan`.
- **E2 — placer routes through site expansion** (gated on spatial-coordination **C1**).
  `place(buildingType)` → `expandSite` → co-placed footprints on the shared
  `OccupancyGrid`. Tavern renders as a yard+building+sign, not a bare box.
  ✅ **AUXILIARY-BUILDING SLICE SHIPPED (2026-06-28, `WORLD_CONTENT_VERSION` 28→29).**
  `placeSettlement` now runs a `2c` site-expansion pass: after the main layout, every
  placed core is expanded through `expandSite → siteToPlan` and the auxiliary buildings
  its function derives are co-placed on free, off-road ground beside it. The tavern's
  `stabling` requirement yields a `stable` outbuilding (a new generative preset) with no
  per-preset wiring — the first real consumer of the site graph. The pass is ADDITIVE +
  deterministic (a fixed spiral scan, no rng draw), so the main layout is byte-identical
  and only outbuildings are appended; auxiliaries are excluded from the `buildingCount`
  budget (they're appendages, like civic props). **Deferred to later E2 slices:** fixtures
  (sign/bench/well) — data-only today, no prop entity to realise (the well is already a
  civic prop); the yard *wall* (the croft enclosure already rings the yard); and routing
  the FOCUS path's `parish-church`/`manor` presets (their catalogue ids don't match the
  preset names, so they derive no aux yet).
- **E3 — shrine `procession` topology**, retiring `temple_small`.
- **E4 — sweep:** smithy work-yard, farmstead, market stall, manor curtilage; author
  recipes only where the default isn't good enough.

## Open questions

1. **`siteType` vs extend `complexType`?** Cleanest is one `siteType` with `enclosure`
   demoted to a topology — but that touches the just-merged DC-2 schema. Decide whether
   E0 renames or aliases.
2. **Where does default-derivation read function tags?** `buildingType` needs a
   `functions: string[]` + `requires: string[]` field, or a separate `establishmentType`
   fact keyed by building. Lean toward fields on `buildingType` (no new kind).
3. **Yard geometry** — is the yard a footprint the building fronts onto (via a `frontage`
   `Anchor`, §5) or a bounding region the placer fills? Probably the former — the anchor
   resolves the building's front edge to the yard.
4. **Determinism / content version** — site expansion changes *placed worldgen output*,
   so E2 will need a `WORLD_CONTENT_VERSION` bump + save-gate (unlike the DC-2 merge,
   which was data-only and bumped nothing).

## Why this is the right shape

It is not new architecture — it is **removing a special-case**. DC-2 already proved the
sub-graph expansion + resolve-down + barrier rings + requirement tokens. This spec
generalises "defensive complex" to "any establishment," reuses the registry/plan/token
machinery wholesale, and lands the unified-connectome `site` tier with a concrete,
greenlit first slice (shrines) and one clear blocking dependency (spatial-coordination
C1) that is already specced.
