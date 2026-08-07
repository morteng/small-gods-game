I now have the full, verified picture — including a significant finding that reshapes the plan: the blueprint layer (`authoring.ts`, `param-schema.ts`, `describe-registry.ts`, `lint.ts`, plus the Fate `author-building` tool and headless preview scripts) already implements much of the brief's surface. Here is the complete plan.

---

# LLM-Authorable Parametric Modeling — implementation plan (2026-08-07)

**Status:** plan. No code yet. **Spend: $0** — every phase is local/deterministic tooling and docs; no paid generation anywhere in scope.
**Input brief:** `2026-08-07-llm-authorable-modeling-brief.md` (verified context, constraints, ManifoldCAD research).

**Goal:** make Small Gods' parametric modeling pipeline an LLM-authorable surface — an LLM (dev agent, MCP-connected player agent, or the in-game Fate author) authors believable structures as **validated declarative specs** with a **fast visual + diagnostic feedback loop**, instead of hand-editing imperative manifold-3d geometry code.

**The pivotal finding (verified this planning round):** most of the surface the brief asks for **already exists** at the blueprint layer, one level above `Part[]`:

| Brief asks for | Already exists | Where |
| --- | --- | --- |
| Declarative authoring surface | `Blueprint` / `BlueprintPatch` / `AuthorInput` (preset OR raw blueprint OR patches, + descriptors + seed) | `src/blueprint/types.ts`, `authoring.ts` |
| Schema + validation | `ParamSchema`/`validateParams` per registry entry — "the registry IS the capability catalogue" | `src/blueprint/param-schema.ts` |
| Machine-readable capability catalogue | `describeRegistry()` / `formatCatalogue()` — header comment: "the answer to 'what can an LLM author?'" | `src/blueprint/describe-registry.ts` |
| Lint/audit gate with a single ok verdict | `lintBlueprint` (4 rules: compile-throw, part-out-of-footprint, dormer-unhostable, parts-overlap) inside `authorBlueprint()` — "an LLM … hands in a preset name or a raw Blueprint … it CANNOT author a broken asset past this floor" | `src/blueprint/lint.ts`, `authoring.ts` |
| In-game LLM already authors through it | Fate `author-building` tool resolves + lints before placing | `src/game/fate/fate-tools.ts:859` |
| Headless deterministic preview | `scripts/building-preview.ts` (~1 s browserless PNG via `composeStructure`, plus lint + montage + catalogue print), `barrier-preview.ts`, `bridge-preview.ts`, `assetgen-preview.ts` | `scripts/` |

So this epic is **gap closure, not greenfield**. The plan below targets exactly the five real gaps, in dependency order.

## Problem statement

An LLM can already author a building through `authorBlueprint`, but the loop is half-blind and half-documented:

1. **No ad-hoc visual feedback.** `building-preview.ts` renders only *registered presets*; there is no path "here is my `AuthorInput` JSON → gate → PNG + diagnostics". Fate's author tool gets a one-line text verdict, never an image or a stats block. An LLM cannot judge a silhouette from `"2 warnings"`.
2. **Diagnostics stop at the blueprint level.** Four lint rules, all pre-geometry. Nothing audits the *compiled* structure (bbox vs sprite budget, volume, facet counts, openings vs walls, z<0 penetration, manifold robustness surfacing).
3. **The catalogue is shallow.** `ParamSpec.doc` is optional and sparsely populated; there are no worked examples; nothing validates that what the catalogue advertises actually composes.
4. **No measurement tools.** Nothing answers "does this spec sit on that terrain?" — ground clearance/occlusion against a real heightfield.
5. **The golden/version contract is folklore.** How geometry-affecting changes interact with `assetgen-golden` pins and `ART_RECIPE_VERSION` is known to maintainers but written down nowhere an authoring agent will find it.

## Goals / non-goals

**Goals:** close gaps 1–5 above; keep every constraint in the brief (determinism, goldens discipline, WebGPU-only, mount anchors, mesh/sprite parity, lint-zero, import-cycle-free).

**Non-goals:** adopting ManifoldCAD or any external CAD runtime (rejected — see DR-2); a second renderer or preview viewport tech (previews reuse `composeStructure` headless, exactly like the existing preview scripts); runtime gameplay/economy/save changes; new paid art generation; turning the raw compose-level `Part[]` union into an authoring surface (rejected — see DR-1); changing Fate's tool *semantics* (only enriching what its verdict carries).

## Decision record

**DR-1 — The authoring surface is the Blueprint layer, not raw `Part[]`.**
The brief proposed completing the compose-level `Part` union into an LLM surface. Evidence found this round: `src/blueprint/` already provides schema'd parts+features, validation, lint, catalogue, presets, and a live LLM consumer (Fate). Raw `Part[]` is a *compile target* (`toGeometry` emits it); exposing it to authors would fork the vocabulary and bypass every existing gate. **Decision:** author at blueprint level; document `Part[]` as the compile target with a "do not author here" note. *Trade-off:* compose prims like `roundwood`/`rock`/`linear` that blueprints can't express stay unreachable to authors until Phase B4 bridges or accepts that.

**DR-2 — Reject ManifoldCAD as runtime or surface; adopt three ideas only.**
ManifoldCAD is an imperative JS/TS editor on the same manifold-3d kernel — the exact medium that makes LLM authoring fragile. Zero new dependencies (its CLI ships inside the already-vendored `manifold-3d` package, but we don't need it: `composeStructure` is already our headless spec→render path). **Adopt:** (a) its live-preview loop as proof our headless preview is the right shape; (b) its idiom catalog (extrude→subtract→fillet; exact-90° rotations) when writing registry `doc` strings in Phase B2; (c) manifoldness-error surfacing, mirrored in Phase B1.

**DR-3 — No new dependencies; hand-rolled schema stays.**
`ParamSchema`/`validateParams` already do typed validation with ranges/enums/defaults. Adding zod would duplicate one working mechanism and add a dep to a deliberately lean dependency list. The catalogue is *generated from the registry* (single source of truth), so docs can never silently drift from enforcement — that property beats any schema library.

**DR-4 — Feedback loop = new CLI script on existing machinery, no runtime changes.**
`scripts/building-preview.ts` already proves browserless deterministic render (~1 s, `pngjs`, `composeStructure`). Phase B0 generalizes it to accept an arbitrary `AuthorInput` JSON and emit PNG(s) + a machine-readable diagnostics JSON. Nothing in `src/game/` changes; no goldens touched (scripts aren't pinned).

**DR-5 — Audits are two-stage: blueprint lint (existing) + structure audit (new).**
Blueprint lint runs pre-geometry and can't see bbox/facets/openings-in-solid. A new compose-stage audit consumes the `ResolvedBlueprint`/`StructureSpec` + `StructureResult` and reports geometric facts. Stages stay separate so the cheap gate stays cheap on the Fate path.

**DR-6 — Measurement is author-time tooling (script first, MCP verb optional and gated).**
Ground clearance needs a real terrain context; that's a script in the `measure-*`/`probe-*` family (precedent: `measure-spawn-walkability.ts`). An MCP verb would extend the external-agent API — verb names are API (CLAUDE.md) — so it's deferred behind explicit product sign-off.

**DR-7 — Golden/version policy is codified, not changed.**
Previews never touch goldens (they're scripts). Geometry-affecting registry changes update `assetgen-golden` pins and bump `ART_RECIPE_VERSION` (read current value from `src/core/content-version.ts`; never restate it) **in the same commit**, with `content-version` test updated alongside — the convention already used for `NPC_ART_RECIPE_VERSION`. The deliverable is a written contract an agent can follow, not a mechanism change.

## Phased plan

Phases are ordered by dependency; each is independently shippable. B0 is the payoff slice — everything after it is verifiable *through* it.

### Phase B0 — Ad-hoc authoring preview loop (the payoff slice)

**Objective:** `npx tsx scripts/author-preview.ts spec.json [--map grey|normal|material|albedo] [--montage] [--json]` → validate+gate via `authorBlueprint` → compose → PNG(s) in `.dev-grabs/` + diagnostics JSON on stdout.

**Files:**
- New `scripts/author-preview.ts`. Reuses `building-preview.ts` internals (extract shared helpers into `scripts/lib/` if duplication appears — `scripts/lib/` already exists).
- Reads an `AuthorInput`-shaped JSON file (`{ preset?, blueprint?, descriptors?, patches?, seed? }` — the exact type from `src/blueprint/authoring.ts`).
- Emits: lint report (existing), `StructureResult`-derived stats block (bbox, `depthRange`, anchors incl. mount `tags`, per-material pixel coverage, opaque fraction), and the catalogue via `--catalogue` (wraps `formatCatalogue`).
- Exit code non-zero when `AuthorResult.ok === false`, so an agent loop can branch on it.

**Tests:** `tests/unit/author-preview.test.ts` — feed a fixture spec, assert: diagnostics shape (keys present, bbox sane), exit-code semantics on a deliberately broken spec, determinism (two runs → byte-identical PNG). No golden pins (this is tooling, not shipped geometry).

**Acceptance:** an agent can iterate `spec.json → run → PNG + JSON → revise` with no browser, no world, no renderer; a broken spec fails the gate with actionable lint, not a crash.

**Goldens/version:** none — script-only.

### Phase B1 — Structure-stage audit + manifold robustness surfacing

**Objective:** deepen diagnostics past blueprint lint.

**Files:**
- New `src/blueprint/audit-structure.ts` (pure leaf, imports nothing mutable — keep blueprint/ import-cycle-free): consumes `ResolvedBlueprint` + `StructureResult` (+ facets where needed) and reports `StructureAudit[]` with severity, mirroring `BlueprintLint` shape so B0 prints one merged report.
- Initial rules (each cheap and deterministic): bbox vs sprite budget; part z-min < 0 penetration; openings (features where `isOpening`) with no wall mass behind them; volume/facet-count stats as `info`; mount-anchor presence for parts that declare them.
- Manifold robustness: surface compose-time failures as `compile-throw`-style errors (already partially via lint); where the manifold API exposes status on solids, map it into audit errors — verify what `manifold-3d` 3.5.x actually exposes before promising a rule (open question Q2).

**Tests:** `tests/unit/audit-structure.test.ts` — one fixture per rule (a spec that trips it, a spec that doesn't); severity ordering; determinism.

**Acceptance:** B0 output includes the merged audit; each rule demonstrably fires on its fixture.

**Goldens/version:** none — audits read geometry, never change it.

### Phase B2 — Catalogue completeness + generated PRIMITIVES.md + worked examples

**Objective:** the catalogue an agent reads is complete, exemplified, and proven true.

**Files:**
- Populate `doc:` strings across every registry `paramSchema` (`src/blueprint/parts/*.ts`, `src/blueprint/features/*.ts`) — terse, unit-annotated (1 tile = 2 m; z in cube units), idioms borrowed from ManifoldCAD's API docs (DR-2b). Pure comment/data changes — **no geometry change**, so no golden/version impact; verify each edit compiles by running `describeRegistry` in a test.
- New `scripts/generate-primitives-doc.ts` → writes `docs/PRIMITIVES.md` from `describeRegistry()` + a hand-authored preamble (units contract, blueprint-vs-Part layering note from DR-1, descriptor/material vocab, worked examples below). Checked in.
- New `docs/primitives-examples/` (or inline in the doc): 5–8 worked `AuthorInput` specs (cottage variant, crenellated wall-bearing structure, ruin via lifecycle `stage`, etc.).
- `tests/unit/primitives-doc.test.ts`: doc is in sync (regenerate → diff empty); **every worked example passes `authorBlueprint(...).ok === true`** and composes non-empty — the catalogue can never advertise a broken spec.

**Acceptance:** an agent given only `docs/PRIMITIVES.md` can author a spec that passes the B0 gate; sync test proves doc ≡ registry.

**Goldens/version:** none (docs + doc strings only).

### Phase B3 — Measurement tools (spec ↔ terrain)

**Objective:** answer "does this authored thing fit that ground?"

**Files:**
- New `scripts/measure-structure-fit.ts` (family precedent: `measure-spawn-walkability.ts`): load/generate a small deterministic world (or accept a saved snapshot), place a spec at (x,y), report ground-clearance per footprint cell, max slope under footprint, mount-anchor heights vs terrain, occlusion vs neighbouring structures where the world has them.
- Optional, **deferred pending product sign-off (DR-6):** a read-only MCP/dev verb wrapping the same measurement. Verb name is API — propose, don't ship silently.

**Tests:** `tests/unit/measure-structure-fit.test.ts` — flat synthetic heightfield ⇒ clearance 0; tilted fixture ⇒ reported slope matches; determinism.

**Goldens/version:** none.

### Phase B4 — Archetype vocabulary expansion (registry-level, deliberate)

**Objective:** grow the authorable vocabulary where evidence says agents reach for it — each addition is its own mini-commit because it DOES touch geometry.

**Process per new part/feature type:** registry entry + paramSchema + doc → B2 sync/example tests → `assetgen-golden` pin updates + `ART_RECIPE_VERSION` bump + content-version test **in the same commit** (DR-7) → example spec in PRIMITIVES.md.
**First candidates** (from the brief + existing gaps): a wall/parapet part exposing the `linear.ts` masonry cross-sections (talus/crenels) to blueprints; a lifecycle-stage convenience already half-present via `stage`. Explicitly **not** bridging every compose prim (`roundwood`, `waterwheel`) without a use-case — YAGNI, and each bridge is golden-tax.

**Acceptance:** one new part type lands end-to-end per the process; example authors + renders through B0.

**Goldens/version:** YES per addition — this is the phase where the DR-7 contract is exercised for real.

> **B4 disposition (decided 2026-08-07, implemented):** the plan's first candidate — a
> wall/parapet part exposing `linear.ts` masonry cross-sections (talus/crenels) — was found
> to be **ALREADY implemented**: `src/blueprint/parts/barrier.ts` is a registered part that
> emits the `linear` prim with `kind:'wall'`/`rampart`/`palisade`/…, `crenellated`
> (merlon/crenel parapet), `material` override, `lengthM/heightM/thicknessTiles`, optional
> `gateWidthM`; and `body.parapet` puts a crenellated parapet on a flat roof. Adding it again
> would have duplicated geometry and incurred `ART_RECIPE_VERSION`/golden churn for zero new
> capability — against the plan's own YAGNI + keep-B4-small rules. **Decision: do NOT add new
> geometry or bump audio/art versions; close B4 with documentation only.** Delivered: a
> worked `docs/primitives-examples/crenellated-wall.json` example (auto-adopted by the
> primitives-doc sync test) and a defensive-construction note in PRIMITIVES.md. This is the
> explicit no-geometry closeout the review called for.

### Phase B5 — Policy + docs codification

**Objective:** write the contract down where an agent will find it.
- New `docs/LLM-AUTHORING.md`: the authoring loop (B0), the gate semantics (`ok` ⇒ commit, else feed lints back), the golden/version commit convention (DR-7), spend policy ($0 — previews are free), and pointers to PRIMITIVES.md.
- ROADMAP entry suggestion (for the ROADMAP editor, not applied here).

## PRIMITIVES catalogue skeleton (what the doc will contain — blueprint level)

**Units contract:** 1 tile = 2 m; `at`/`size` in tiles (structure-local); z in cube units; angles in degrees, snapped to 45° where canonical (the `-89.999…` crack defense).

- **Blueprint envelope:** `version, class, preset?, era?, category?, parts, materials?, palette?, descriptors?, stage?, footprint, notes?`; patches deep-merge, `null` deletes a part.
- **Parts** (from registry — skeleton, doc generated in B2): each entry = `type`, `at/size/material/params/features/tags`, per-param `{kind, range|values, default, doc}`. Current families include wall/roof/door/window/dormer/chimney-types (exact list generated, never hand-copied).
- **Features:** openings (`isOpening`) vs attachments; `threshold` flag surfaced.
- **Descriptors:** wealth/quality/style/condition vocabulary (`descriptorPatch`).
- **Materials/works:** `Mat` enum + masonry `work` strings (`ashlar`, `coursed_rubble`, `dry_stone`, `running`) as used by `solids.ts`/`linear.ts`.
- **Compile target (documented, not authored):** compose-level `Part[]` prims (`box, cylinder, cone, prism, pyramid, waterwheel, ellipsoid, arch, column, roundwood, building, flora, rock, linear, skirt`) → `partFacets` → manifold → shared by sprite flatten and `structure-mesh` (drift impossible by construction).

## Risks / open questions / deferrals

**Risks:**
- **R1 — Catalogue promises what geometry can't keep.** Mitigated by B2's examples-must-compose test; the doc is generated, so drift fails CI, not the author.
- **R2 — B4 golden churn.** Each vocabulary addition repins goldens + bumps `ART_RECIPE_VERSION`; doing this casually invalidates art caches. Mitigated by DR-7's same-commit rule and by keeping B4 deliberately small.
- **R3 — Preview ≠ in-game truth.** Headless compose skips lighting/terrain interplay/draw-cache (per `building-preview.ts`'s own header). The plan accepts this: geometry massing is verified headless; in-game grabs stay the tool for lighting. Say so in LLM-AUTHORING.md.
- **R4 — Fate tool enrichment changes agent behaviour in-game.** Carrying stats/audit into Fate's verdict is additive text; keep the gate semantics identical.

**Open questions:**
- **Q1:** Should barriers/walls (`BarrierRun` → `linear` prim) become blueprint-authorable, or stay world-driven? B4 decides with a use-case; default is stay world-driven.
- **Q2:** Exactly what robustness/status does manifold-3d 3.5.x expose per solid for B1 to surface? Check the vendored `manifold.d.ts` before writing that rule.
- **Q3:** Does the MCP/external-agent surface get an authoring verb (DR-6)? Product decision — the meta-verb surface is API.

**Deferrals (explicitly out):** adopting ManifoldCAD/JSCAD/OpenSCAD; any browser viewport for authoring; paid generation; save-format or runtime economy changes; a zod migration; exposing raw compose `Part[]` as an authoring surface.

## What I'd implement first

**Phase B0, alone, first.** It's small (one script on proven machinery), touches no shipped code, no goldens, no version constants — and it converts the whole epic from "the LLM can submit specs" to "the LLM can *see and measure* what it submitted." Every later phase (audits in B1, examples in B2, fit in B3, archetypes in B4) is then developed *through* the loop instead of blind. The second commit is B2's worked-examples test, because it's the cheapest permanent guard against the catalogue lying.

---