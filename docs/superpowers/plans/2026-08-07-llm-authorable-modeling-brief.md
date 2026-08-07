# Brief — LLM-authorable parametric modeling for Small Gods

> Authoritative input for the planner. This brief is self-contained and VERIFIED by the
> initiating session. Do NOT spend budget re-verifying it. Read this one file, then produce
> the final plan doc. Trust this brief over your own re-reading; only dip into the repo where
> this brief explicitly points you and you need a concrete signature/constant.
>
> **Repo cwd:** `/Users/Morten/mcpui/small-gods-game`

## Goal

Make Small Gods' parametric 3D modeling pipeline an LLM-authorable surface: an LLM authoring
believable game geometry (buildings, walls, flora, structures) as **validated declarative
specs** with a **fast visual/diagnostic feedback loop** — instead of hand-editing imperative
manifold-3d geometry code. Adopt the useful ideas from ManifoldCAD as proof/idiom reference,
but **reject ManifoldCAD as the runtime or authoring surface** (Small Gods already vendors
manifold-3d and has its own compose pipeline). Fortify the existing declarative `Part[]`
/`StructureSpec` vocabulary.

## Constraints (non-negotiable, from CLAUDE.md)

- Sim/geometry layer deterministic, `Math.random`-free (guard `tests/unit/no-random-in-sim.test.ts`).
- Geometry goldens pinned in `tests/unit/assetgen-golden.test.ts`; geometry changes update pins
  AND bump `ART_RECIPE_VERSION` (**read current value from `src/core/content-version.ts` — never restate it**).
- **WebGPU is the only renderer**; no second renderer; `pixi` forbidden (guard test).
- Mount-anchor / `to-mount-anchors` (`src/blueprint/compile/to-mount-anchors.ts`) world-space
  anchor path must keep working.
- Two consumers share the SAME solids and must not drift: sprite flatten vs live structure mesh.
- Import-cycle-free + lint-clean (`npm run lint` must stay at zero). Follow goldens/guard-test conventions.
- Authoring/dev-tooling + content capability; runtime gameplay economy and save format must not regress.
- Existing repo convention: per-epic brainstorm → spec → plan under `docs/superpowers/{specs,plans}/`;
  name plans `YYYY-MM-DD-<slug>-plan.md`. Read an existing plan for structure/tone.

## Modeling architecture (verified)

- **Only 3D modeling dep:** `manifold-3d` (WASM CSG kernel). No three.js/gl-matrix/etc.
  Rendering is hand-rolled WebGPU (`src/render/`, iso-projection). `@webgpu/types` is types-only.
- **Declarative surface ALREADY partially exists:** `Part` discriminated union + `StructureSpec`
  in `src/assetgen/compose.ts`. Prims currently: `box, cylinder, cone, prism, pyramid, waterwheel,
  ellipsoid, arch, column, roundwood, building, flora, rock, linear, skirt`. `partFacets(p)`
  dispatches each prim to bespoke geometry.
- **Geometry builders:** `src/assetgen/geometry/solids.ts` (also `building.ts, battlement.ts,
  arch.ts, column.ts, roundwood.ts, linear.ts, flora/mesh.ts, flora/turtle.ts`).
  These carry a big hand-coded domain-constant layer: metric scale, talus batters, merlon
  periods, construction families (linear.ts: masonry/palisade/light/living/earthbank), roof
  pitches (solids.ts GABLE_PITCH/HIP_PITCH etc.), `snapAngle45` (defends the -89.999/-90 crack).
- **Two consumers of the same solids (must not drift):**
  1. Sprite flatten — `composeStructure` → `projectFacets`/`rasterize` → img2img-painted
     billboard (`render/parametric-building-source.ts` etc.).
  2. Live triangle mesh — `src/assetgen/structure-mesh.ts` → `structure-mesh-wgsl.ts` projects
     object verts through the terrain iso projection into the shared depth buffer.
     Stride: pos3+normal3+albedo3; `STRUCTURE_MESH_STRIDE_FLOATS = 9`.
- **Scale contract:** 1 tile = 2 m (`render/scale-contract.ts` `mToTiles`). Part units are
  "tile x,y; cube-unit z".
- **Authoring montage already exists on compose:** `StructureResult.labels` (set-of-mark part
  labels, opt-in via `opts.labelPoints`) and `StructureResult.pick` (per-pixel provenance
  buffer, opt-in via `opts.pickIds`).
- `manifold-3d` WASM boot: `src/assetgen/geometry/manifold-runtime.ts` (lazy singleton,
  `setCircularSegments(32)`) + `manifold-wasm-browser.ts` (Vite `?url` import, browser-only).

## Established assessment (accept as premise; refine only with better evidence)

1. **manifold-3d is a great LLM fit as the engine** (deterministic, robust, spec→solid),
   but the **interface is the problem**: most modeling is hand-written imperative TS chaining
   `cube().subtract().translate()` with hardcoded coords + a large domain-constant layer.
   LLM authoring in that medium = large high-risk diffs with no visual feedback.
2. **`Part[]` JSON spec is the right LLM surface** but is incomplete/undocumented and not
   validated. Rich domain primitives (building wings/roof styles, linear construction families)
   are not surfaced as stable, documented LLM spec entries.

## Proposed improvement directions (prioritize; add your own where evidence supports)

- **A. Complete, closed, documented `Part` schema + validation** (zod or hand-rolled) + a
  PRIMITIVES catalog doc: per-prim meaning, units (1 tile = 2m), valid ranges, materials/works,
  3–5 worked example specs. LLM writes data, never control flow.
- **B. Fast feedback loop:** headless "emit spec → compose → render grey/sprite/mesh →
  screenshot (multimodal) or text diagnostics (bbox, volume, facet count, material coverage,
  depth range)". Reuse/extend the authoring montage + labels + pick.
- **C. Semantic audit diagnostics:** validator returning human-readable problems (door opening
  clears ground; parapet not self-intersecting; prism not below z=0; arch span ≤ cleared
  opening), plus surfacing manifold's own non-manifold/self-intersection warnings.
- **D. Hoist archetypes to first-class LLM spec entries** (construction vocabulary, not coords):
  e.g. `masonryWall{crossSection}` instead of hand-assembled cubes; `building{gambrel}`.
  Reuse existing knowledge in solids.ts/building.ts/battlement.ts.
- **E. Golden-hash / `ART_RECIPE_VERSION` representational policy** so iteration isn't chilled:
  a preview/fly mode that computes output WITHOUT hash parity; re-pin only at commit.
- **F. Tool-assisted measurement:** "measure/occlude/ground-clearance" callable against spec
  + terrain, exposing the metric contract (an LLM can't run geometry reliably in-head).

## ManifoldCAD research (already gathered from manifoldcad.org + docs/jsuser/ — verify only if needed)

- **manifoldCAD = manifold-3d + TS + glTF.** An app layer on the SAME kernel Small Gods vendors,
  not a new engine. Offers: a live browser editor (param input → instant rendered preview,
  orbit camera); a CLI `manifold-cad <infile.js> <outfile.glb|3mf>` (ships INSIDE the already-
  vendored manifold-3d package; `npx manifold-3d manifold-cad`); a compute server
  `@manifoldcad/compute`.
- **ITS AUTHORING MODEL IS IMPERATIVE** ("you script in JS/TS") — explicitly NOT what we want
  for LLM authoring. **Reject adopting it as the runtime/surface.**
- **Transferable:**
  1. Live-preview concept → evidence a low-latency manifold-WASM in-browser preview is cheap
     to build on Small Gods' compose path.
  2. Its sample suite + API docs are a quality catalog of manifold idioms
     (extrude→subtract→fillet; exact-90°-rotation precision guarantee) to mine for expanding
     and documenting the Part prim vocabulary.
  3. It surfaces manifold manifoldness/robustness errors in its UI → mirror that surfacing as
     parseable audit output.
- **Gotcha from its docs worth encoding:** rotating `-89.999999999` instead of `-90` causes
  mesh cracks — Small Gods' `snapAngle45` in linear.ts already defends this pattern; generalize it.

## Deliverable

Write a complete plan to:
`docs/superpowers/plans/2026-08-07-llm-authorable-modeling-plan.md`

Contents:
1. Problem statement + goals + non-goals.
2. Decision record on key calls (spec schema == LLM surface; reject ManifoldCAD runtime;
   validation; feedback loop; measurement). Include trade-offs.
3. Concrete phased plan (ordered by dependency; each phase: objective, files touched/created,
   schema/signature sketches, test strategy incl. which goldens/guard tests, acceptance
   criteria, ART_RECIPE_VERSION/golden implications). Cover P0 MVP authoring surface → later
   phases for feedback / validation / measurement / archetypes.
4. PRIMITIVES catalog skeleton (prims, params with units + ranges, materials/works) —
   enough to guide implementation.
5. Risks, open questions, explicit deferrals (not in scope).
6. "What I'd implement first" recommendation with rationale.

## Process discipline for the planner

- **Write the plan file EARLY and COMPLETE it first**; only refine in place. Do not spend the
  budget re-reading. This session previously timed out at the writing step — avoid that.
- Keep the executive summary (returned to the caller) under ~2500 words: phase list, decision
  record, top risks. The full detail lives in the doc.
- Do NOT modify any `src/`, tests, or package files. Produce only the plan markdown doc.
- Do bump-in reasoning about `ART_RECIPE_VERSION`/golden implications qualitatively, but do not
  claim a specific current value — tell the implementer to read it from `src/core/content-version.ts`.
