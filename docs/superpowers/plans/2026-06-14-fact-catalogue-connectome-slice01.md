# Fact catalogue + building connectome — Slice 0 & 1 (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [fact-catalogue-connectome-slice01-spec](../specs/2026-06-14-fact-catalogue-connectome-slice01-spec.md) ·
**Brainstorm:** [worldbuilding-fact-database-design](../specs/2026-06-14-worldbuilding-fact-database-design.md) ·
**Builds on:** [blueprint-parameter-model](2026-06-08-blueprint-parameter-model.md)

**Goal:** Lay the worldbuilding spine in two slices. **Slice 0** — a domain-neutral,
agent-extensible **fact catalogue** (the single source of truth) feeding patch
content, `toBrief` prompts, and LLM grounding. **Slice 1** — a seeded **building
connectome** (Zone/Portal/Fixture grammar) that expands a building into a latent
room-graph and resolves it *down* into today's `Blueprint`, deriving correct
doors/windows and the hearth→smoke-egress chain (the headline payoff: early-medieval
buildings get a louver, **not** a chimney).

**Branch:** `feat/fact-catalogue-connectome` (off `main`).

---

## Architectural contract (read before starting — this is the load-bearing part)

The whole point of this epic is a clean spine we keep extending for years. **Module
boundaries are the deliverable, as much as the features.** Three hard rules:

1. **The engine knows no content.** `src/catalogue/` (the registry, loader,
   constraint engine) and `src/blueprint/connectome/` (Zone/Portal/Fixture +
   grammar interpreter) must contain **zero medieval strings, zero hard-coded ids,
   no closed content enums**. Everything specific lives in
   `src/catalogue/packs/medieval-europe/` as data. A grep of the engine dirs for
   `'cottage'`, `'hearth'`, `'thatch'` etc. must come back empty (enforced by a
   guard test, Task 21).
2. **Content is open string-keyed data.** Catalogue kinds, room types, materials,
   topologies — all `string` ids in open registries, self-describing exactly like
   the existing Part/Feature registry. New content = register an entry, never edit
   a `type` union. The only closed enum that survives is the existing `Era`
   (carried by `applicability`, generalized when a non-medieval pack is actually
   built — open Q resolved: keep enum now).
3. **Layer above, resolve down.** The connectome resolves into the existing
   parts/features `Blueprint`. The geometry pipeline (manifold → img2img →
   SpritePack) and the 4 compilers are **untouched**. The connectome is an
   *optional* new field on `ResolvedBlueprint`; everything downstream still works
   if it is absent.

**Forward seams to design in now (so later slices don't refactor the engine):**
- `CatalogueKind` includes `districtType`/`tradeType` already (seeded, inert) so
  the **settlement/world connectome** (Slice 5) reuses the same registry.
- `Connectome` primitives are scale-free (a Zone is a room *or* a district *or* a
  region) so the same grammar interpreter serves building → settlement → world.
- Grammar rules are **declarative data** (a `GrammarRule[]` on the pack), not code,
  so a cheap LLM/agent can author a new building type without a recompile.
- `toBlueprint` lives under `connectome/` and is building-specific this slice;
  when Slice 5 adds settlement expansion, the *engine* (`expand`) is reused and
  only a new resolve-down target is added.

**Parallel-work boundary:** another session owns `src/studio/**`. This plan does
**not** touch `src/studio/**`. Do not edit studio files; if a studio panel later
wants to browse the catalogue, that is a follow-up wired from the studio side.

---

## File structure

**New — domain-neutral engine (`src/catalogue/`):**
- `types.ts` — `FactEntry`, `CatalogueKind`, `Visibility`, `Applicability`, the
  kind-specific field interfaces (`BuildingTypeFields`, `MaterialFields`,
  `SmokeSystemFields`, `RoomTypeFields`, `PortalTypeFields`, `FixtureTypeFields`,
  `TopologyFields`), `ConstraintRef`.
- `registry.ts` — `CatalogueRegistry` class: `register`/`get`/`query`/`all`;
  `(kind,id)` keyed; later packs override earlier.
- `pack.ts` — `FactPack` type (`entries[]` + `constraints[]` + `grammarRules[]`),
  `loadPack`, and the agent seam `registerFact`/`registerPack`.
- `constraints.ts` — `Constraint` model (id, predicate, severity, autoCorrect?),
  `validate(target, registry): Issue[]`.
- `catalogue.ts` — the default `catalogue` singleton + `loadDefaultPacks()`
  (loads `medieval-europe` at boot).
- `index.ts` — barrel (public API surface only).

**New — seed content pack (`src/catalogue/packs/medieval-europe/`):**
- `index.ts` — assembles + exports the `FactPack` (imports the kind files below).
- `building-types.ts`, `room-types.ts`, `fixture-types.ts`, `portal-types.ts`,
  `materials.ts`, `roof-coverings.ts`, `smoke-systems.ts`, `frame-types.ts`,
  `topologies.ts` — the seed `FactEntry[]` per kind.
- `districts.ts`, `trades.ts` — seeded `districtType`/`tradeType` entries (inert
  until Slice 5; present to prove the schema carries them).
- `constraints.ts` — the seed `Constraint[]` (chimney-era gate, thatch-flat-roof,
  unknown-roomType ref, …).
- `grammar.ts` — the declarative `GrammarRule[]` consumed by Slice 1.

**New — connectome engine (`src/blueprint/connectome/`):**
- `types.ts` — `Zone`, `Portal`, `Fixture`, `Connectome`, `ExpandCtx`.
- `grammar.ts` — `expand(buildingTypeId, ctx, registry): Connectome`; the four
  topology template interpreters keyed by `topology` id (domain-neutral —
  interpreters read catalogue fields, hold no content).
- `smoke.ts` — `deriveSmokeEgress(connectome, ctx, registry): Connectome` (the
  hearth→egress rule; reads the `smokeSystem` catalogue).
- `to-blueprint.ts` — `connectomeToBlueprint(connectome, base, ctx): BlueprintPatch`.
- `index.ts` — barrel.

**Modified (`src/blueprint/`):**
- `compile/to-brief.ts` — `DETAILS` array + ad-hoc trait assembly replaced by a
  catalogue read. Golden cottage brief stays byte-stable.
- `eras.ts` / `descriptors.ts` — material ladders + window/vent/smoke gating become
  thin readers over the catalogue (Slice 0 routes ladders + smoke; rest trails).
- `presets/index.ts` — `resolveAsset` gains the connectome expand→resolve-down step
  for `class:'building'`; early-medieval presets lose their hand-authored
  chimney/smokehole defaults (cottage/longhouse/yurt) — egress now derives.
- `types.ts` — `ResolvedBlueprint` gains optional `connectome?: Connectome`.

**Tests (`tests/unit/`):** `catalogue-registry.test.ts`,
`catalogue-constraints.test.ts`, `catalogue-medieval-pack.test.ts`,
`catalogue-domain-neutral.test.ts`, `catalogue-engine-purity.test.ts`,
`connectome-grammar.test.ts`, `connectome-smoke.test.ts`,
`connectome-to-blueprint.test.ts`, `connectome-golden.test.ts`; plus updates to
`blueprint-golden-regression.test.ts` and `assetgen-golden.test.ts` (strip-chimney
pin bumps).

---

## Phase A — Catalogue engine core (domain-neutral; no existing consumers touched)

Builds the empty knowledge-base machinery. No content, no medieval strings. Build
stays green throughout (nothing imports it yet).

### Task 1: Catalogue types

**Files:** Create `src/catalogue/types.ts`; Test `tests/unit/catalogue-types.test.ts`

- [ ] **Step 1: Write the failing test.** Assert the shape of a hand-built
  `FactEntry` typechecks and round-trips: an entry with `id`, `kind`, `pack`,
  `lod.{l0,l1[]}`, `fields`, optional `applicability`/`provenance`/`visibility`/
  `tags`/`constraints`. Assert `CatalogueKind` accepts the 11 seed kinds AND an
  arbitrary string (open — use `CatalogueKind = (typeof CORE_KINDS)[number] |
  (string & {})` so packs can add kinds without a type error).
- [ ] **Step 2: Implement.** `FactEntry<F>`, `CatalogueKind`, `Visibility`,
  `Applicability`, `ConstraintRef`, and the kind-specific field interfaces from the
  spec (`BuildingTypeFields`, `RoomTypeFields`, `FixtureTypeFields`,
  `PortalTypeFields`, `MaterialFields`, `SmokeSystemFields`, `TopologyFields`).
  Re-export `Era` from `src/core/era.ts`. No content values here — interfaces only.
- [ ] **Step 3: Run the test; confirm green. Run `npm run build`.**

### Task 2: CatalogueRegistry

**Files:** Create `src/catalogue/registry.ts`; Test `tests/unit/catalogue-registry.test.ts`

- [ ] **Step 1: Failing test.** `register(entry)` then `get(kind,id)` returns it;
  `all(kind)` lists entries of a kind; `query({kind, pack, era})` filters by
  applicability (an entry with `applicability.eras:['medieval']` is excluded when
  querying `era:'ancient'`, included for `era:'medieval'` or no era filter);
  registering a second entry with the same `(kind,id)` **overrides** (later pack
  wins) and emits no throw. Unknown `get` returns `undefined`.
- [ ] **Step 2: Implement** `CatalogueRegistry` with a `Map<string, FactEntry>`
  keyed `` `${kind}:${id}` ``, plus a `kind → id[]` index for `all`/`query`.
  Applicability matching is a pure helper `appliesTo(entry, ctx)`.
- [ ] **Step 3: Green + build.**

### Task 3: Constraint engine

**Files:** Create `src/catalogue/constraints.ts`; Test `tests/unit/catalogue-constraints.test.ts`

- [ ] **Step 1: Failing test.** Define two toy constraints over a fixture registry:
  one `error` (predicate false → Issue with severity `error`), one `warn` with an
  `autoCorrect(target)` that mutates and returns a corrected copy. `validate`
  returns `Issue[]` with `{constraintId, severity, message, target}`; a passing
  target yields `[]`; the warn path returns the issue AND the corrected value is
  applied when `validate` is called in `{apply:true}` mode.
- [ ] **Step 2: Implement** `Constraint` (`id`, `kind?` scope, `severity`,
  `check(target, registry): boolean`, `message`, `autoCorrect?`), and
  `validate(target, registry, opts?): {issues: Issue[], corrected?: T}`. Pure;
  no content.
- [ ] **Step 3: Green + build.**

### Task 4: Pack loader + agent seam

**Files:** Create `src/catalogue/pack.ts`, `src/catalogue/catalogue.ts`,
`src/catalogue/index.ts`; Test `tests/unit/catalogue-pack.test.ts`

- [ ] **Step 1: Failing test.** Build a tiny in-test `FactPack`
  (`{name, entries, constraints, grammarRules}`); `loadPack(pack, registry)`
  registers every entry + appends constraints/rules; `registerFact(entry)` and
  `registerPack(pack)` operate on the default singleton; loading a second pack with
  an overlapping `(kind,id)` overrides. Assert the default `catalogue` singleton is
  empty until `loadDefaultPacks()` is called (decouples engine from content).
- [ ] **Step 2: Implement** `FactPack`, `loadPack`, `catalogue` singleton (a fresh
  `CatalogueRegistry`), `loadDefaultPacks()` (will import medieval pack in Task 11
  — for now a no-op stub with a TODO), and the public barrel `index.ts`.
- [ ] **Step 3: Green + build.**

---

## Phase B — medieval-europe content pack (Slice 0 seed data)

Pure data. Each kind file is independently reviewable. Use the Wikipedia research
already captured in the spec + `docs/reference/medieval-building-reference.md` for
values; cite in `provenance`.

> Tasks 5–10 are **independent** — safe to fan out to parallel subagents (each owns
> one kind file + its slice of `catalogue-medieval-pack.test.ts`). Task 11 assembles.

### Task 5: Cross-cutting catalogues — materials, roofs, smoke, frames, topologies

**Files:** Create `materials.ts`, `roof-coverings.ts`, `smoke-systems.ts`,
`frame-types.ts`, `topologies.ts` under `packs/medieval-europe/`.

- [ ] `material` entries with `wealthLadder` (the existing `LADDERS` from
  `descriptors.ts`) + `regionAffinity` + `rgb`. `roofCovering` with pitch/eave from
  `medieval-building-reference.md` (thatch .30/.15, shingle .24/.12, tile .20/.10,
  slate .10/0). `smokeSystem` entries (`smoke-hole`, `louver`, `smoke-hood`,
  `wall-chimney`) each with `egressFixture` + `eras` + optional `wealth` (the
  timeline: hole→louver→hood→late/elite chimney). `frameType` (cruck, box-frame,
  mass-wall, stave). `topology` (the 4 masters: `tripartite-linear`,
  `courtyard-hub`, `vertical-stack`, `church-axial`) with an `interpreter` id field.
- [ ] Test: each entry validates; smokeSystem era gating is correct (no chimney
  before `medieval` late / `current`).

### Task 6: buildingType entries

**Files:** Create `building-types.ts`.

- [ ] The existing 11 building presets (cottage, tavern, townhouse, market_stall,
  temple_small, farm_barn, tower, castle_keep, dock, shrine, guard_post, watermill,
  yurt, longhouse) each get a `buildingType` entry: `topology`, `roomProgram`
  (`RoomSlot[]`), `entrance`, `hearthRule`, `sizeBays`, `defaultMaterials`. Plus
  facts-only primed entries for Slice-4 types (manor, inn, parish-church,
  tithe-barn, granary, dovecote, smithy, bakehouse, brewhouse) — `roomProgram`
  filled, geometry deferred.
- [ ] Test: every existing preset id has a matching `buildingType` entry
  (coverage); roomPrograms reference only declared roomTypes.

### Task 7: roomType entries (~45)

**Files:** Create `room-types.ts`. From the spec's rooms glossary. Each carries
`fn` (function tag), `needsLight` (bool → windows), `heatable` (bool), typical
`bays`. Test: count ≥ 40; each has `lod.l0` + `fn`.

### Task 8: fixtureType entries (~40)

**Files:** Create `fixture-types.ts`. From the fixtures glossary. Hearth fixtures
(`open-hearth`, `wall-fireplace`, `inglenook`) carry `requires:['smoke-egress']`;
egress fixtures (`smoke-hole`, `louver`, `smoke-hood`, `wall-chimney`) carry
`satisfies:['smoke-egress']`. Test: hearth/egress requirement tokens present.

### Task 9: portalType entries (~20)

**Files:** Create `portal-types.ts`. From the portals glossary, each with a
`sizeClass` (`human`/`cart`/`grand`/`slit`) → width/height hints + `passable` bool.
Test: count ≥ 18; cart-door is wider than doorway.

### Task 10: districtType + tradeType (inert) + constraints + grammar rules

**Files:** Create `districts.ts`, `trades.ts`, `constraints.ts`, `grammar.ts`.

- [ ] `districtType`/`tradeType` from the settlement appendix (seeded, no consumer).
- [ ] `constraints.ts`: the seed `Constraint[]` — **chimney-era gate** (chimney +
  era∈{primordial,ancient,classical} OR medieval-not-late+not-rich → warn +
  autoCorrect egress→louver), thatch+flat-roof→error, buildingType.roomProgram
  references unknown roomType→error.
- [ ] `grammar.ts`: the declarative `GrammarRule[]` (Slice 1 consumes; can be a
  typed stub list now, filled in Phase D).
- [ ] Test: constraints validate against the pack; the chimney gate fires on a
  synthetic early+chimney target and auto-corrects to louver.

### Task 11: Assemble + load the pack

**Files:** Create `packs/medieval-europe/index.ts`; wire `loadDefaultPacks()`;
Test `tests/unit/catalogue-medieval-pack.test.ts`

- [ ] **Step 1: Failing test.** After `loadDefaultPacks()`: `validate()` over the
  whole pack returns **zero `error` issues**; counts meet the spec minimums
  (buildingTypes ≥ 14, roomTypes ≥ 40, fixtureTypes ≥ 38, portalTypes ≥ 18); every
  existing preset resolves to a buildingType.
- [ ] **Step 2: Implement** `index.ts` assembling all kind arrays into one
  `FactPack`; point `loadDefaultPacks()` at it.
- [ ] **Step 3: Green + build.**

---

## Phase C — Wire catalogue into briefs + begin single-source migration

### Task 12: `toBrief` reads the catalogue

**Files:** Modify `src/blueprint/compile/to-brief.ts`; Test update
`tests/unit/` (golden brief).

- [ ] **Step 1: Failing test.** Golden cottage `AssetBrief` is **byte-stable** vs
  current output (snapshot the current brief first, then refactor under it). New
  assertion: a building's `traits` now include the `l1` traits of its buildingType
  + its materials' `texture-prompt` facts, sourced from the catalogue.
- [ ] **Step 2: Implement.** Replace the `DETAILS` array + ad-hoc assembly: look up
  the resolved building's buildingType entry + material/roof entries; assemble
  `traits` from their `l1` (filtered to `visibility:'texture-prompt'|'geometry'`);
  `l2`/`provenance` exposed on the brief for LLM grounding (new optional
  `grounding?` field on `AssetBrief`, not fed to the image prompt). Reproduce the
  cottage's current phrases exactly in the catalogue so the golden holds.
- [ ] **Step 3: Green + build.** If the byte-stable golden can't hold without
  changing one phrase, update the snapshot in the same task and note it.

### Task 13: Material ladders + smoke gating read from catalogue

**Files:** Modify `src/blueprint/descriptors.ts`, `src/blueprint/eras.ts`;
Test `tests/unit/` (existing era/descriptor tests).

- [ ] **Step 1:** Keep existing era/descriptor tests green; add a test that the
  ladder used by `descriptorPatch` is the **same array** sourced from
  `material.wealthLadder` in the catalogue (single source), and that era vent gating
  reads `smokeSystem.eras`.
- [ ] **Step 2:** `LADDERS` in `descriptors.ts` becomes a thin reader:
  `catalogue.all('material').map(m => …)`. `eraPatch`'s vent kind reads the
  era-appropriate `smokeSystem`. Leave window-style migration for Slice 2
  (opportunistic — note it).
- [ ] **Step 3: Green + build.**

---

## Phase D — Connectome engine (domain-neutral grammar)

### Task 14: Connectome types

**Files:** Create `src/blueprint/connectome/types.ts`; Test `connectome-types.test.ts`

- [ ] `Zone`, `Portal`, `Fixture`, `Connectome`, `ExpandCtx` ({era, wealth, region,
  seed} + registry handle) exactly per spec. Scale-free Zone (no "room"-specific
  fields beyond `bays`/`level`/`fn`/`tags`). Test: shapes typecheck + a hand-built
  connectome round-trips.

### Task 15: Grammar interpreter — `expand()`

**Files:** Create `src/blueprint/connectome/grammar.ts`; Test `connectome-grammar.test.ts`

- [ ] **Step 1: Failing tests** (the spec's Slice-1 acceptance, graph-level):
  - cottage → 1 zone, 1 exterior door, `open-hearth` fixture in the hall zone.
  - hall house → cross-passage (2 opposed exterior doors), zones
    service+hall(hearth)+upper with interior doors between them.
  - longhouse → cross-passage, living(hearth) + byre zone (no hearth, no windows),
    `dung-drain` in byre.
  - barn → 2 cart-sized opposed doors, no hearth, no windows.
  - **Determinism:** same `(type,era,wealth,region,seed)` → byte-identical
    connectome.
- [ ] **Step 2: Implement** `expand(buildingTypeId, ctx, registry)`:
  1. read buildingType `topology` + `roomProgram` → instantiate zones (bay counts
     from program).
  2. dispatch to the topology interpreter (keyed by `topology.interpreter` id —
     `tripartite-linear`/`courtyard-hub`/`vertical-stack`/`church-axial`); each is a
     pure function `(zones, ctx) → portals` reading catalogue fields, holding no
     content strings.
  3. place hearth fixture per `hearthRule`.
  4. mark light-needing zones (roomType `needsLight`) for windows.
  All seeded via `createRng(ctx.seed)`. **No medieval strings in this file.**
- [ ] **Step 3: Green + build.**

### Task 16: Hearth → smoke-egress derivation

**Files:** Create `src/blueprint/connectome/smoke.ts`; Test `connectome-smoke.test.ts`

- [ ] **Step 1: Failing tests:**
  - early/poor cottage → egress fixture is `louver`/`smoke-hole`, **never**
    `wall-chimney`.
  - late+rich cottage (era `current` or medieval-late + wealth rich) →
    `wall-fireplace` + `wall-chimney`.
  - `vertical-stack` stone (keep) → `wall-chimney` allowed.
  - the egress fixture is attached **over the hearth's zone** (carries `zoneId`).
- [ ] **Step 2: Implement** `deriveSmokeEgress`: find fixtures with
  `requires:['smoke-egress']`; query `smokeSystem` catalogue by `(era,wealth)`;
  pick the entry whose `egressFixture` `satisfies:['smoke-egress']`; attach it to
  the hearth's zone. Run the chimney-era **constraint** as the final guard
  (auto-correct downgrades). Pure; reads catalogue only.
- [ ] **Step 3: Green + build.**

---

## Phase E — Resolve down + wire into the building pipeline

### Task 17: `connectomeToBlueprint`

**Files:** Create `src/blueprint/connectome/to-blueprint.ts`; Modify
`src/blueprint/types.ts` (add `connectome?` to `ResolvedBlueprint`); Test
`connectome-to-blueprint.test.ts`

- [ ] **Step 1: Failing tests:**
  - exterior door portals → `door` features on the correct wall face, size from the
    portalType `sizeClass` (human/cart/grand → width/height; `main` flag for the
    main entrance).
  - window-marked exterior walls → `window` features (style/glazed by era catalogue).
  - smoke-egress fixture → a `vent` feature at the **ridge point above the hearth
    zone** (`vent` kind from the egress fixture: louver→`smokehole`,
    wall-chimney→`chimney`). **"the hearth determines the vent", literally** — assert
    the vent's `t` maps to the hearth zone's position along the run.
  - footprint derived from total bays.
- [ ] **Step 2: Implement** `connectomeToBlueprint(connectome, base, ctx):
  BlueprintPatch` emitting the existing `door`/`window`/`vent` features. Bay→
  footprint is a simple total-bays mapping (Slice 3 makes per-room bays
  first-class — note the seam). Returns a patch so it composes with era/descriptor
  patches.
- [ ] **Step 3: Green + build.**

### Task 18: Wire into `resolveAsset` + strip default chimneys

**Files:** Modify `src/blueprint/presets/index.ts` (and the early-medieval preset
files); Test update `blueprint-golden-regression.test.ts`

- [ ] **Step 1:** Add a test: `resolveAsset({type:'cottage', era:'medieval'})`
  yields a resolved blueprint whose features include a louver vent (kind
  `smokehole`) and **no `chimney`**; the `connectome` field is populated; a
  `barn` has 2 doors + no vent.
- [ ] **Step 2:** In `resolveAsset` for `class:'building'`: call
  `expand()` → `deriveSmokeEgress()` → `connectomeToBlueprint()` and **prepend** its
  patch to the preset/era/descriptor/stage patch stack, then resolve as today.
  Attach the `Connectome` to the `ResolvedBlueprint`. **Delete the hand-authored
  vent/chimney features** from cottage/longhouse/yurt presets (egress now derives);
  leave tavern/townhouse/keep chimneys for now (cooking/elite — but verify they pass
  the era gate; tavern at medieval may downgrade — accept + note, or mark them
  late). Guard: if `expand` finds no buildingType entry, fall back to the raw preset
  (connectome absent) — pipeline still works.
- [ ] **Step 3:** Green. **Run `npm run build`.**

### Task 19: Canonical identity + golden pins

**Files:** Modify `src/render/generated-art-cache.ts` (canonicalJson) only if
needed; Test update `assetgen-golden.test.ts`, add `connectome-golden.test.ts`

- [ ] **Decision (open Q resolved):** canonicalJson includes only the
  **exterior-affecting projection** of the connectome (the resolved door/window/vent
  features it already produces are in the blueprint), **not** the full graph — so
  interior-only changes later won't bust exterior art cache. Confirm the connectome
  object is **not** spilled into canonicalJson; only its resolved features (already
  there) count.
- [ ] **Golden:** stripping chimneys changes cottage/longhouse/yurt geometry →
  `assetgen-golden.test.ts` G-buffer hashes change. Update the pins AND bump
  `ART_RECIPE_VERSION` (per the established geometry-change protocol). Add
  `connectome-golden.test.ts`: a fixed `(pack,type,era,wealth,region,seed)` →
  byte-stable connectome JSON.
- [ ] Green + build.

---

## Phase F — Domain-neutrality proof + guardrails

### Task 20: scifi-test pack (the domain-neutral proof)

**Files:** Create `tests/fixtures/scifi-test-pack.ts`; Test
`tests/unit/catalogue-domain-neutral.test.ts`

- [ ] A minimal `FactPack` (`pack:'scifi-test'`) with one `buildingType`
  ('hab-module', topology `vertical-stack`), one `roomType` ('airlock'), one
  `fixtureType`, one `portalType`. Test: `loadPack` + `validate` pass with **zero
  engine changes**; `expand('hab-module', …)` produces a connectome;
  `connectomeToBlueprint` resolves it. Proves the seam.

### Task 21: Engine-purity guard test

**Files:** Test `tests/unit/catalogue-engine-purity.test.ts`

- [ ] Grep the engine dirs (`src/catalogue/{types,registry,pack,constraints,
  catalogue,index}.ts` and `src/blueprint/connectome/**`) for medieval content
  literals (`cottage`, `hearth`, `thatch`, `louver`, `byre`, `medieval`, …) and the
  preset ids; assert **none appear** (content lives only in `packs/`). This locks
  the boundary so future edits can't smuggle content into the engine. (Mirror of the
  existing `no-three-in-bundle` / `no-random-in-sim` guard pattern.)

### Task 22: Full suite + build + memory

- [ ] `npm test` (full suite green; ~1844 + new). `npm run build` clean (emits
  manifold.wasm).
- [ ] Update `MEMORY.md` + `project-worldbuilding-fact-database.md`: Slices 0–1
  status → SHIPPED (branch, SHA, test count), record the chimney-strip + recipe
  bump, note the funded art reseed follow-up.

---

## Acceptance (whole plan)

- `medieval-europe` pack loads at boot; `validate()` → 0 errors.
- Golden cottage `AssetBrief` byte-stable (or one documented phrase change).
- cottage/hall-house/longhouse/barn connectomes match the spec's acceptance graphs.
- early-medieval cottage resolves to **louver, no chimney**; late+rich → wall-chimney.
- vent position derives from the hearth zone (the literal payoff).
- ruin variant retains the hearth zone/fixture.
- scifi-test pack registers + expands with zero engine changes.
- engine-purity guard green (no content in the engine dirs).
- full suite + build green; `ART_RECIPE_VERSION` bumped.

## Deferred (explicitly out of this plan)

- Interior rendering / floor-plan drawing (graph is latent only).
- Settlement/world connectome + economic edges (Slice 5 — schema carries them inert).
- Funded art reseed (early presets lose chimneys now; art mismatch accepted).
- Per-room bays + frameType first-class (Slice 3).
- Full `eras/descriptors/lifecycle` migration (Slice 0 routes ladders + smoke only).
- Non-medieval `Era` axis generalization (keep enum until a real pack needs it).
- Any `src/studio/**` integration (owned by a parallel session).
