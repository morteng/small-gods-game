# Spec — Analytic structural validity for the authoring loop ($0)

**Status:** candidate (draft — not scheduled)
**Date:** 2026-08-07
**Intent:** give the deterministic authoring loop a **structural-plausibility** signal alongside
its existing **fit** signal, sourced from the ASCE Bridge Designer crossover — without a physics
solver, without geometry, without spend. `$0`, no golden repin, no `ART_RECIPE_VERSION` bump.
**Supersedes/deferral notes:** engine tooling only; the gameplay **cost** mechanic and any
**span-dependent geometry** are explicitly out of scope and gated.

## Why

Crossings today read "on the world, not in it": the structure-mesh epic fixes their *drawing*,
but nothing answers the author question *"will this crossing read as an engineered span, or a
lintel in the void?"* The fit tool (`scripts/measure-structure-fit.ts`) reports clearance and
slope only. ASCE Bridge Designer's value is that a design's **failure is legible** and its
**span is checked against a class** — we can ship that as an analytic, judgement-free string
reusing the manifold-era precedent (the `WORLD_CONTENT_VERSION` 116/117 rise/seat guards) from
*rise* to *span*.

## Non-goals (explicit — restate in review)

- **No physics/load solver.** No member-force maps, no truck-load FEM, no hot-color stress view.
  The structure-mesh epic's non-goals already rule a solver out; this spec keeps that line.
- **No change to produced geometry.** Every output below is a diagnostic string. If a span check
  ever wants to *add* a mid-pier or re-mass a deck, that is a separate, gated change (golden
  repin + `ART_RECIPE_VERSION` bump — it is the `v34` deck precedent).
- **No cost/budget/score model.** "Cost to build X" is gameplay (effort/prayer economics), gated
  behind product sign-off per the DR-6 precedent (MCP/dev verbs + content await sign-off).

## Design

### 1. A pure analytic module — `scripts/lib/structure-validity.ts`

Deterministic, injectable (mirror `measure-structure-fit.ts`'s metre-sampler style), imports
nothing.

- **`maxSpanM(class, material) -> number`** — a per-bridge-class / per-material max clear span
  table: `deck` / `arch` / `timber` / `stone`. Coarse, defensible, first-guess values (this is
  a legibility signal, not a civil-engineering standard). Lives as a small data table the
  placement + author tools both read, so the envelope and the check can never disagree.
- **`clearSpanM(place, footprint, terrainSampler) -> number`** — abutment-to-abutment span from
  the crossing placement + terrain, reusing the same `heightAt(map, store, tx, ty)` /
  `getWorldDeformationStore(map)` sampling the fit tool already uses.
- **`sagProxyMmPerM(spanM, class) -> number`** — a cheap continuous-beam sag proxy (uniform
  load, `5 w L^4 / 384 E I` collapsed to a `span^4`-scaled number; no FEM). Pure function of
  span + class defaults; returns mm-per-metre legibility, not a real deflection.
- **`checkSpan(place, footprint, terrainSampler) -> SpanReport`** — the aggregate:
  `{ clearSpanM, class, maxSpanM, ratio, status: 'ok'|'warn'|'fail', suggested: 'arch'|'mid-pier'|null, msg }`.
  `ratio > 1` → `fail` ("log-plank at 32 m should be an arch or get a mid-pier"); between
  `ov_limit..1` → `warn`; else `ok`.

### 2. Wire into the existing author loop (both already gate/exit on the same contract)

- **`scripts/measure-structure-fit.ts`** — append a **"span report"** block beside clearance /
  slope / sockets / occlusion: clear span vs class-recommended span, ratio, and the
  `suggested` remedy. No new flag; print by default (informational, never fails the tool's
  exit code on its own).
- **`scripts/author-preview.ts`** — add a `structure-validity` **advisory** (info/warn severity)
  to the merged report for specs that contain a `barrier`-style crossing or a bridge-ish part.
  Advisory only — blueprint lint / structure audit **ERRORS** still own exit 1.

### 3. Build-time placement check — SEPARATE CONTRACT (later, gated)

> **Correction vs the $0 framing above:** steering a crossing to a different superstructure
> class CHANGES WORLdgen OUTPUT. That is NOT pure-tooling — it carries the `WORLD_CONTENT_VERSION`
> bump + **discard-older-autosave** contract (see `src/core/content-version.ts` history: every
> geometry/placement shift invalidates prior autosaves) and needs its own determinism pin
> (`tests/unit/*`), NOT the `$0` author-loop contract. Treat this as a separate decision from
> sections 1–2, not hidden inside them.

- IF product later wants crossings that never read as a "lintel in the void": extend the
  existing rise/seat guard precedent (the `WC_V` 116/117-style rise + `riseM + ARCH_RING_M =
  clearZM` deck-seating already in `crossing-structures.ts`) with a **span-vs-class** check:
  when a crossing's clear span exceeds its class envelope, steer toward a class that plausibly
  spans (arch) — or log a `warn` and keep current fallback if none fits without mid-pier
  geometry. This is the piece most entangled with worldgen determinism + the golden/world
  content contracts; it must land as its own reviewed change, not smuggled into the tooling
  slice. The analytic `maxSpanM`/`clearSpanM` from section 1 are the shared source both the
  author tools and any future placement check read, so envelope and check can never disagree.

## Deliverables / acceptance

- New pure module + unit tests: every table value explicit, sag proxy monotone in span, the
  three `status` outcomes hit by crafted place/footprint/terrain fixtures.
- Fit tool + author-preview print the span report / advisory; existing exit-code contract
  unchanged (0/1/2; span is informational).
- **Author-loop slice only: zero geometry output change ⇒ existing `assetgen-golden.test.ts`
  hashes unchanged; no `ART_RECIPE_VERSION` bump.** Guarded by a test that asserts no golden
  diff on an existing example spec run through the new path. (Sections 1–2.)
- **Build-time check (section 3) is explicitly separate**: `WORLD_CONTENT_VERSION` bump +
  autosave-discard + determinism pin, its own review — not required to ship the tooling.
- `npm run lint` zero; `src/blueprint/` unaffected (this is `scripts/` + connectome).

## Gated / deferred (do NOT fold in here)

- **Cost/budget/score** as a build mechanic — product sign-off (DR-6 precedent).
- **Span-dependent geometry** (mid-pier, deck re-massing) — separate change; golden repin +
  `ART_RECIPE_VERSION` bump (`v37`→`v38`), its own review.
- **Fate/player-facing bridge-building activity or stress-minigame** — content, gated.

## Crossover lineage

Sourced from the ASCE Bridge Designer, Cloud Edition (asce.org pre-college outreach; GPL v3,
since 2002) + West Point Bridge Designer lineage (bridgecontest.org). Approved-minded ideas
adopted: legible failure, span-vs-class validity, design→test→redesign loop. Rejected: physics
solver, member-force heatmaps, cost-as-score (gated as gameplay). Note: bridge-type families
are already richer here than the source implies — bridges are ONE coherent parametric object
(`buildBridgeObject`, `src/world/connectome/crossing-structures.ts`) with real `abutment` /
`arch_span`/`deck` parts (`src/blueprint/parts/bridge.ts`).
