# Studio Graph Overhaul — Brainstorm / Design

**Date:** 2026-06-14
**Status:** Brainstorm (no code). Sequenced after the parallel-lane consolidation lands; built in worktree `small-gods-studio` on `feat/studio-graph-overhaul` (off `main` @ `ffddf56`).
**Related:** [[project-unified-renderer-epic]] (R2 WebGPU scene — this studio is its first consumer), [[project-asset-catalogue-variant-lifecycle]] (studio-ux base), [[project-worldbuilding-fact-database]] (connectome + fact-catalogue this browses).

---

## 1. The ask (user, verbatim)

> "give studio a complete overhaul, make it use the new rendering (webgpu) and give it a way to fully [browse] the entire world graph instead of just object browser (objects in world connectome to be browseable of course but also the blueprints, systems of blueprints etc, the entire default library (e.g. early medieval for time being)."

Two distinct tracks live inside this one sentence, and they move at different speeds:

- **Track A — the graph browser.** Make the studio navigate the *entire* authoring graph: the default library (early-medieval pack), every blueprint, the **connectome** (systems of blueprints — Zone/Portal/Fixture + the derivation edges), and live placed instances from a real world. **All the data already exists and is merged to `main`** — this is UI over existing data, unblocked today.
- **Track B — the WebGPU viewport.** Swap the preview from Canvas2D-iso/Pixi to the new WGSL scene. **Blocked on R2** (the unified-renderer's instanced-lit GPU scene), which is the next renderer slice and unbuilt. The studio is the *ideal first consumer* of R2 — one object, controlled light, one camera — so Track B co-develops with R2 rather than waiting idle.

## 2. What the studio already is (code reality, do not rebuild)

`src/studio/` is richer than "object browser." It already:

- Routes via `?studio=<kind>` → `mountStudio()` (`src/studio/studio.ts`), a single-object scene reusing the **exact game render path** (terrain + PixiJS lit entity layer + baked cast shadows, real `Camera` + controls).
- **Object browser** (`object-browser.ts`) — text/class/category/era search over `assetCatalogue()`, plus wealth/quality/condition descriptor sliders and a **lifecycle scrubber** (sapling→stub / cleared→old_ruin).
- **Blueprint tree** (`blueprint-tree.ts`) — the resolved blueprint as a live-editable collapsible tree (footprint, materials, palette, parts, features).
- **Stage dock** (`stage-dock.ts`) — every pipeline stage (compose buffers → img2img steps) as clickable thumbnails.
- **A/B compare** (`ab-section.ts`) — two img2img models on the same init, with cost/ms/IoU/gate verdicts.
- **Toolbar** (`toolbar.ts`) — solar/moon sky popover, display toggles, zoom, paid Render button, keyboard shortcuts.

**Implication:** this is an *extension + reframe*, not a rewrite. The blueprint tree and variant axes are keepers. What's missing is everything *above* a single object: the library, and the connectome that links blueprints into systems.

## 3. The gap, precisely

The studio today answers "show me **this one** resolved asset and its pipeline." It cannot answer:

- "Show me **the whole early-medieval library** — every blueprint, material, trade, constraint in the pack — as something I can navigate." (`src/catalogue/` `CatalogueRegistry` + `loadDefaultPacks()` hold this; nothing surfaces it.)
- "Show me this cottage as a **system**: its Zones, the Portals between them, its Fixtures, and the **derivation edges** — e.g. *hearth ⇒ smoke-egress ⇒ louver-not-chimney*." (`src/blueprint/connectome/` `expand()` + `deriveSmokeEgress()` produce exactly this graph, then discard it into geometry.)
- "Show me this exact placed instance **from a live world** — at these coords, in this ward, with its resolved variant + lifecycle state." (The `WorldRenderGraph`/`RenderGraph` seam exposes placed nodes; the studio only ever builds a synthetic one-entity world.)

## 4. The core idea — four lenses, one selection model

Not four browsers. **One connectome, one inspector, swappable lenses.** A selection in *any* lens resolves to a blueprint → renders in the viewport → reveals its neighbours. That single-selection-model discipline is the whole difference between "object browser + new tabs" and a real graph explorer.

| Lens | Question it answers | Backed by |
|------|---------------------|-----------|
| **Library** | "What's in the early-medieval box?" — every blueprint/material/trade/constraint as a navigable tree/grid | `src/catalogue/` `CatalogueRegistry`, `loadDefaultPacks()`; `assetCatalogue()` |
| **Blueprint** | "How is *this* asset built?" — parts, features, the resolve chain (preset→era→descriptor→lifecycle→seed), and the 4 compiler outputs (geometry/collision/anchors/brief) | existing `blueprint-tree.ts` + `synthesizeBlueprint()`/`resolveAsset()`, `registry.ts` `listPartTypes()`/`listFeatureTypes()` |
| **System** | "How do blueprints connect?" — the connectome drawn *as a graph*: Zones ⊃ Fixtures, Portals linking them, **derivation edges** highlighted | `src/blueprint/connectome/` `expand()`, `deriveSmokeEgress()`, `Zone`/`Portal`/`Fixture` types |
| **World** | "What does a *placed* instance look like?" — pull one entity from a generated world, with its real variant + lifecycle + neighbours | `RenderGraph`/`WorldRenderGraph` (`src/render/graph/`), a real bootstrapped world |

The **inspector** (right rail) is lens-agnostic: given any selected node it shows identity, the resolve chain, derivation provenance ("this vent exists *because* hearth + era"), and a jump-list of graph neighbours.

## 5. The viewport (Track B / R2)

The viewport renders whatever the selection resolves to. Today that's `createIsoRenderMap()` → terrain + Pixi lit layer. The overhaul points it at the **R2 WebGPU scene** behind the same `RenderGraph` seam:

- Studio builds a `RenderGraph` (one-node for Library/Blueprint/System lenses; a real region for World lens) and hands it to the R2 renderer — **identical seam the game uses**, so parity is by construction.
- **Canvas2D/Pixi stays the fallback** (no-WebGPU → unlit Canvas2D, never a black studio).
- The studio becomes R2's **proving ground**: controlled light (the existing solar/moon popover already drives `LightView`), one camera, no sim. Bugs surface here cheaply before the full game scene.

**This is the sequencing pin:** Track B cannot precede R2. So we build Track A against the *current* viewport, and graft the R2 viewport in as R2 lands.

## 6. Why this ordering (recommendation)

1. **Track A first, on the current viewport.** All data is merged; zero renderer dependency. Ships a real capability (library + system + world lenses) and de-risks the selection/inspector model.
2. **R2 in parallel** (renderer lane), with the studio as its first consumer.
3. **Track B** swaps the viewport once R2 exists — a localized change behind the seam, not a studio rewrite.

This keeps every step shippable and avoids a big-bang overhaul that's blocked on the renderer.

## 7. Proposed slices (Track A)

- **S0 — Graph-data plumbing.** A read-only `StudioGraph` facade that enumerates the library (catalogue registry), blueprints (presets), and expands a blueprint→connectome on demand. Pure data, fully testable, no UI. *Establishes the one selection model.*
- **S1 — Library lens.** Navigate the whole early-medieval pack; pick anything → it loads into the existing blueprint/viewport. Replaces "type a kind in the URL" with real discovery.
- **S2 — System lens (connectome).** Draw `expand()`'s Zone/Portal/Fixture graph; highlight derivation edges (hearth→louver). The headline "systems of blueprints" view.
- **S3 — Unified inspector.** Lens-agnostic right rail: identity + resolve chain + derivation provenance + neighbour jump-list. Folds the existing variant axes in.
- **S4 — World lens.** Bootstrap a real world; pick a placed instance; inspect its live variant/lifecycle/neighbours via `WorldRenderGraph`.
- **(Track B, post-R2) — WebGPU viewport.** Point the viewport at the R2 scene behind `RenderGraph`; Canvas2D fallback retained.

## 8. Open questions (resolve in the spec)

- **Graph drawing tech for the System lens** — hand-rolled Canvas2D/SVG node-graph vs a tiny dependency? Lean hand-rolled (small graphs, no new dep, matches the no-heavy-lib ethos).
- **Is the System lens read-only or editable?** Read-only first (it's a *derived* graph from `expand()`); editing the connectome is a separate, larger question.
- **World lens world source** — reuse `bootstrap-world` with a fixed seed, or load an autosave? Fixed seed is deterministic + testable.
- **Does Track A justify shipping before R2**, or hold the whole overhaul until the viewport can ship together? Recommendation: ship Track A independently — it's valuable without the GPU viewport.

## 9. Non-goals

- Not a connectome *editor* (read/browse only this pass).
- Not a rewrite of the blueprint tree, variant axes, stage dock, or A/B compare — those are kept and reframed under the lens model.
- Not the funded FLUX.2 library reseed (orthogonal; the library renders parametric until then).

## 10. Coordination

- Built in worktree `/Users/Morten/mcpui/small-gods-studio`, branch `feat/studio-graph-overhaul` off `main` @ `ffddf56`.
- The existing **`feat/studio-ux` lane may still be active** — do not commit into its checkout; reconcile `src/studio/**` with it before any merge. This brainstorm touches only a new doc.
- Held cross-cutting actions (push `main`, branch/worktree cleanup) remain blocked on the active connectome session — unaffected by this work.
