# Fact catalogue + building connectome — Slice 0 & 1 (spec)

**Date:** 2026-06-14 · **Status:** spec (ready for plan) · **Brainstorm:**
[worldbuilding fact database + connectome](2026-06-14-worldbuilding-fact-database-design.md) ·
**Builds on:** [blueprint parameter model](2026-06-08-blueprint-parameter-model-design.md),
[asset catalogue / variant / lifecycle](2026-06-14-asset-catalogue-variant-lifecycle-design.md)

## Purpose

Two slices that lay the spine:

- **Slice 0 — Fact catalogue foundation.** A domain-neutral, agent-extensible
  knowledge base (the single source of truth) that feeds patch content, `toBrief`
  prompts, and LLM grounding.
- **Slice 1 — Building connectome (latent room-graph) + hearth→smoke payoff.** A
  seeded grammar (fed by the catalogue) expands a building into a Zone/Portal/
  Fixture graph and resolves it *down* into the existing geometric `Blueprint`,
  deriving correct doors/windows and the hearth→smoke-egress chain.

Early-medieval Europe is the seed content. **The engine is content-neutral** —
fantasy, sci-fi, and user/agent-authored settings are future packs requiring no
engine change.

## First principles (the load-bearing constraints)

1. **Domain neutrality.** The engine knows only four abstractions — `Catalogue`,
   `Connectome` (Zone/Portal/Fixture), `Grammar` interpreter, `Constraint`
   checker. *All* specifics (room types, materials, functions, topologies, the
   medieval rules) are **data** in a **content pack**. No closed TypeScript enums
   for content; everything is **string-keyed open registries**, self-describing
   like the existing Part/Feature registry. Medieval is `pack: 'medieval-europe'`.
2. **Agent-extensible.** A cheap LLM (or the user) can register a new catalogue
   entry at runtime ("wizard's tower", "starship bridge") and the grammar +
   validator operate on it without recompilation. Grammar rules are declarative
   data, not code.
3. **Layer above, resolve down.** The connectome resolves into today's
   parts/features `Blueprint`; the geometry pipeline (manifold → img2img →
   SpritePack) is untouched.
4. **Latent now.** The room graph is generated and used only to constrain the
   *exterior*; it is carried on the resolved blueprint for interior use later.
5. **Determinism.** Everything is seeded (sfc32). `(pack, type, era, wealth,
   region, seed)` → a fixed connectome → a fixed exterior. The resolved graph
   joins the canonical art identity.

## Non-goals (this spec)

- Interior rendering / floor-plan drawing (the graph is latent only).
- The settlement/world connectome and economic edges (Slice 5 — but the catalogue
  schema must not preclude them; the research seed data for districts/trades is
  captured in an appendix for later).
- Building any fantasy/sci-fi content (only the *seam* is built + proven by a tiny
  test pack).
- Funded art reseed (early presets lose chimneys now; art mismatch accepted per
  the brainstorm decision).

---

## Slice 0 — Fact catalogue foundation

### Data model

A `Catalogue` is a registry of `FactEntry` records. One entry = one fact about one
catalogue item, at graduated levels of description (LOD).

```ts
type CatalogueKind =                         // OPEN — packs may add kinds
  | 'buildingType' | 'roomType' | 'fixtureType' | 'portalType'
  | 'material' | 'roofCovering' | 'smokeSystem' | 'frameType' | 'topology'
  | 'districtType' | 'tradeType';            // (last two seeded but unused until Slice 5)

type Visibility = 'geometry' | 'texture-prompt' | 'data-only';

interface FactEntry<F = Record<string, unknown>> {
  id: string;                 // 'cottage', 'hall', 'open-hearth', 'thatch'
  kind: CatalogueKind;
  pack: string;               // 'medieval-europe'
  applicability?: {           // when this fact is valid; omitted = always
    eras?: Era[];             // e.g. ['medieval'] — gates by period
    regions?: string[];
    wealth?: string[];
  };
  lod: {
    l0: string;               // one-line gloss
    l1: string[];             // short visible-trait list
    l2?: string;              // paragraph (function/construction/layout)
  };
  fields: F;                  // kind-specific structured data (see below)
  constraints?: ConstraintRef[]; // rules that must hold (validator)
  provenance?: string[];      // wiki citations — grounding + audit
  visibility?: Visibility;    // default by kind
  tags?: string[];            // semantic anchors
}
```

Kind-specific `fields` (the structured L3) — examples:

```ts
interface BuildingTypeFields {
  topology: string;           // 'tripartite-linear' | 'courtyard-hub' | 'vertical-stack' | 'church-axial' | …
  roomProgram: RoomSlot[];    // which rooms, counts, sizes (grammar input — Slice 1 consumes)
  entrance: EntranceRule;
  hearthRule: HearthRule;     // which room gets heat, or 'none'
  sizeBays: [number, number]; // min/max
  defaultMaterials: Record<string, string>; // { walls, roof, ground }
}
interface MaterialFields { wealthLadder?: string[]; regionAffinity?: string[]; rgb?: string; }
interface SmokeSystemFields { egressFixture: string; eras: Era[]; wealth?: string[]; }
```

### Registry, loader, packs

- `CatalogueRegistry` — `register(entry)`, `get(kind, id)`, `query({kind, pack,
  era,…})`, `all(kind)`. String-keyed; later packs override/extend earlier ones
  by `(kind,id)`.
- `loadPack(pack: FactPack)` — a pack bundles `entries[]` + `constraints[]` +
  declarative `grammarRules[]` (Slice 1). `medieval-europe` is the default pack,
  loaded at boot.
- Agent seam: `registerFact(entry)` / `registerPack(pack)` are the public API for
  runtime authoring (Fate / user). No engine code path branches on content ids.

### Constraint checker

`validate(entry | connectome): Issue[]` against declarative `Constraint`s
(predicates over fields/graph). Severity `error` (block resolve) vs `warn`
(log + auto-correct). Seed constraints, e.g.:
- `chimney + era∈{primordial,ancient,classical,medieval-early}` → **warn**,
  auto-downgrade egress to louver/smoke-hole. (The headline rule, enforced.)
- `thatch + roof∈{flat}` → error.
- `buildingType.roomProgram references unknown roomType` → error.

### `toBrief` rewire

Replace the ad-hoc `DETAILS` array in `to-brief.ts`. `AssetBrief.traits` is now
assembled from the resolved building's catalogue entries: `l1` of the
buildingType + `l1`/`visibility:'texture-prompt'` facts of its materials, roof,
and (Slice 1) its fixtures. `l2`/provenance feed LLM grounding, not the image
prompt. Golden cottage brief stays bit-stable (the catalogue reproduces today's
phrases for the cottage).

### Single-source migration (begins here)

`eras.ts` / `descriptors.ts` / `lifecycle.ts` material+window+vent+stage values
move into catalogue entries (`material.wealthLadder`, `smokeSystem.eras`, etc.).
The existing patch functions become thin readers over the catalogue. (Full
migration may trail into Slice 1–2; Slice 0 must at least route material ladders
and the smoke-system gating through the catalogue.)

### Slice 0 seed content (from the Wikipedia research)

- **buildingType** — the existing 17 presets + new entries primed: longhouse,
  manor, inn, parish-church, tithe-barn, granary, dovecote, smithy, bakehouse,
  brewhouse, watermill (full room program). (Geometry for the new ones lands in
  Slice 4; the *facts* seed now.)
- **roomType** — ~45 entries (hall, open-hall, solar, parlour, chamber, pantry,
  buttery, kitchen, scullery, larder, dairy, undercroft, cellar, loft, byre,
  shippon, stable, screens-passage, cross-passage, porch, nave, chancel, aisle,
  refectory, dorter, chapter-house, taproom, snug, guest-chamber, garderobe,
  mill-room, granary, …) — from the rooms glossary.
- **fixtureType** — ~40 (open-hearth, hearthstone, wall-fireplace, inglenook,
  smoke-hood, bread-oven, forge-hearth, anvil, bellows, brewing-copper, mash-tun,
  well, water-wheel, millstone, settle, dais, manger, dung-drain, staddle-stones,
  font, altar, pigeonholes, potence, …) — from the fixtures glossary.
- **portalType** — ~20 (doorway, cart-door, postern, window-shuttered,
  mullioned-window, lancet, arrow-slit, smoke-hole, louver, dormer, hatch, gate,
  wicket-gate, portcullis, …) with the typical sizes from the portals glossary.
- **material / roofCovering / smokeSystem / frameType / topology** — the
  cross-cutting catalogues (materials + ladders; thatch/shingle/stone-slate/
  slate/tile pitch+eave from `medieval-building-reference.md`; the smoke timeline;
  cruck/box-frame/mass-wall/stave; the 4 master topologies).
- **districtType / tradeType** — seeded from the settlement research (appendix)
  but inert until Slice 5.

### Slice 0 acceptance / tests

- Every existing preset resolves to a `buildingType` fact entry (`buildingType`
  coverage test).
- `validate()` passes on the whole `medieval-europe` pack.
- Golden cottage `AssetBrief` is byte-stable vs current output.
- Material ladders + smoke gating read from the catalogue (the two migrated paths).
- **Domain-neutral proof:** a fixture `scifi-test` pack with one new
  `buildingType` ('hab-module') + `roomType` ('airlock') registers and `validate`s
  with zero engine changes.

---

## Slice 1 — Building connectome + hearth→smoke

### The connectome model

```ts
interface Zone {                 // a room/space node
  id: string;
  type: string;                  // roomType id (catalogue)
  fn?: string;                   // function tag ('living','service','sleeping','animal','worship')
  bays: number;                  // size along the run
  level: number;                 // 0 = ground (vertical-stack uses this)
  tags?: string[];
}
interface Portal {               // an edge
  id: string;
  type: string;                  // portalType id (catalogue) — carries size class
  from: string | 'OUTSIDE';
  to: string;
  face?: WallFace;               // for exterior portals
  main?: boolean;
}
interface Fixture {              // a leaf in a zone
  id: string;
  type: string;                  // fixtureType id
  zoneId: string;
  requires?: string[];           // requirement tokens it emits (e.g. 'smoke-egress')
  satisfies?: string[];          // requirements it fulfils
}
interface Connectome { zones: Zone[]; portals: Portal[]; fixtures: Fixture[]; }
```

### The grammar (declarative, pack-supplied)

`expand(buildingTypeId, ctx{era,wealth,region,seed}) → Connectome`. Driven by the
buildingType's `topology` + `roomProgram` + rules. The four master topologies
from the research are reusable template interpreters:

| topology | wiring | medieval examples |
|---|---|---|
| `tripartite-linear` | `OUTSIDE→cross-passage→[service end]│[hall (hearth)]│[upper end]` | cottage, hall house, longhouse(→byre), manor, guildhall |
| `courtyard-hub` | central court zone; ranges open off it | inn, monastery, courtyard almshouse |
| `vertical-stack` | one zone/level, stair portals between levels | keep, tower house, bastle, mills |
| `church-axial` | `porch→nave→chancel→altar(east)`, aisles flank | church, hospital, aisled barn |

The grammar steps (deterministic, seeded):
1. Instantiate `roomProgram` → zones (bay counts from the program + footprint).
2. Wire portals per the topology template (interior doors on shared cross-walls;
   exterior doors per `entrance`; the cross-passage punches both long walls).
3. Place the hearth fixture per `hearthRule` (or none).
4. **Derive smoke-egress** (below).
5. Mark light-needing zones' exterior walls for windows (from roomType fields).

### Hearth → smoke-egress (the payoff)

- `hearth` fixture (`open-hearth` / `wall-fireplace`) placed in the heated zone;
  it `requires: ['smoke-egress']`.
- Derivation rule reads the `smokeSystem` catalogue, gated by `(era, wealth)`:
  early/poor → `smoke-hole`/`louver`; late/elite or `topology:vertical-stack`
  stone → `wall-chimney`. Picks the egress fixture that `satisfies:
  ['smoke-egress']` and attaches it positioned **over the hearth's zone**.
- The constraint checker downgrades any chimney that violates the era gate
  (auto-correct + warn).

### Resolve down → Blueprint (`connectomeToBlueprint`)

For latent-exterior, the connectome emits the existing parts/features:
- bay partition → `body` part footprint (Slice 3 makes bays first-class; Slice 1
  derives footprint from total bays).
- each exterior `Portal` of door type → a `door` feature on the right wall with
  size from the portalType (human/cart/grand → existing width/height + `main`).
- window-marked exterior walls → `window` features (style/glazed by era catalogue).
- the smoke-egress fixture → a `vent` feature (existing!) at the ridge point above
  the hearth zone → **"the hearth determines the vent"**, literally.
- The full `Connectome` is attached to the `ResolvedBlueprint` (new optional
  field) for interior use later and joins `canonicalJson` (the exterior-affecting
  projection — see open Q).

### Wiring into resolve

`resolveAsset(req)` for `class:'building'`: `expand()` → `connectomeToBlueprint()`
→ existing patch/resolve → 4 compilers. **Strip the hand-authored default
chimneys** from the early-medieval presets (cottage/longhouse → central hearth +
ridge louver); their egress now derives.

### Slice 1 acceptance / tests

- **cottage** → 1 exterior door, 1 zone, `open-hearth`, ridge **louver/smoke-hole,
  no chimney**.
- **hall house** → cross-passage (2 opposed exterior doors), zones
  service+hall(+hearth)+upper, interior doors between them.
- **longhouse** → cross-passage, living zone (hearth) + byre zone (no hearth, no
  windows), `dung-drain` fixture in byre.
- **barn** → 2 cart-sized opposed doors, no hearth, no windows.
- **late+rich cottage** (era=medieval-late or current, wealth=rich) → `wall-
  fireplace` + **wall-chimney** (the upgrade path).
- **ruin variant** of cottage retains the hearth zone/fixture (construction +
  ruin read the same node).
- `vent` feature position == ridge point above the hearth zone (derivation test).
- Golden: a fixed `(pack,type,era,wealth,region,seed)` → byte-stable connectome
  and resolved blueprint.

---

## File layout (proposed)

```
src/catalogue/                 — domain-neutral fact DB (cross-cutting; serves world later)
  types.ts                     — FactEntry, CatalogueKind, field interfaces
  registry.ts                  — CatalogueRegistry + query
  pack.ts                      — FactPack + loadPack + agent register seam
  constraints.ts               — Constraint model + validate()
  packs/medieval-europe/       — the seed pack (entries split by kind + grammarRules)
src/blueprint/connectome/      — building grammar (promote to src/world/ at Slice 5)
  types.ts                     — Zone / Portal / Fixture / Connectome
  grammar.ts                   — expand() + topology template interpreters
  smoke.ts                     — hearth→egress derivation
  to-blueprint.ts              — connectomeToBlueprint (resolve down)
```

Catalogue at top-level `src/catalogue/` (it is the single source of truth for
buildings *and* the future settlement/world layers); connectome under `blueprint/`
for now since it is building-scoped this slice.

## Open questions carried into the plan

- **Canonical identity scope** — full connectome in `canonicalJson`, or only its
  exterior-affecting projection? (Affects how interior-only changes invalidate
  exterior art cache.) *Lean: exterior projection for now.*
- **Migration depth in Slice 0** — how much of `eras/descriptors/lifecycle` moves
  in Slice 0 vs trails into 1–2. *Lean: material ladders + smoke gating in 0; rest
  opportunistic.*
- **Era taxonomy for non-medieval packs** — keep the fixed `Era` enum, or let
  packs define their own era axis? *Lean: keep enum now; packs add `applicability`
  tags; generalize when a non-medieval pack is actually built.*
- **Bays in Slice 1 vs 3** — Slice 1 derives footprint from total bays; Slice 3
  makes per-room bays + frameType first-class. Confirm the seam.

## Appendix — settlement seed data (inert until Slice 5)

Captured from research so it isn't lost: settlement types (hamlet→city, bastide,
grange); district nodes (market square, high street, shambles, tannery quarter
[downstream/downwind], wharf, religious close, castle ward, jewry, burgage rows,
common/green, mill district, suburb); trade nodes + economic edges (farms→grain→
miller→flour→baker→bread; butcher→hides→tanner→leather→cordwainer; shepherd→wool→
spinster→weaver→fuller→dyer→draper→tailor; smith = universal supplier hub);
placement logic (noxious trades + fire-risk to the edges, water-power/effluent
trades on the river, clean high-value trades central).
