# Layered connectome expression — a building (and the connectome over it) expressed from primitives

**Status:** design spine (2026-06-28). Foundational direction agreed with the user. Supersedes the
"add a `stable` preset" path of the establishments epic ([[project-establishments-site-connectome]]):
auxiliaries fall out of a *query*, not a frozen tuple.

## The idea (user)

> "Building architecture type, construction and its intended use are different things altogether, and
> vary with time and culture. Different building types can share the same stonework and wood structures,
> or not."
>
> "Can we generalise a building (and over that, a connectome of stuff relating to intended purpose) to
> basic things like size, construction materials, architecture, design, and have systems that build on
> each other to build a whole connectome?"
>
> "Or, maybe saying we *express* a connectome by layering subsystems and information?"

**The reframing that unlocks it:** a connectome is not *built up* by a one-way pipeline. It is **one
graph that successive pure subsystems annotate**. Each subsystem reads the graph's current state and
writes more information onto it; the geometry/render is a *projection* of the fully-annotated graph.
This is already how the **world** scale works ("the renderer is a projection of one connectome"). This
epic brings the **building** scale into the same discipline.

**The goal (user):** *infinite variety of buildings with REAL architecture and construction.* The variety
is the **product space × seed**: `function × form × fabric × material × size × era × wealth × culture ×
seed` is continuous — one function (dwelling) sweeps cottage → cruck hall → box-frame townhouse → stone
manor as the fabric/wealth/era axes move, and *within* a point the seed varies bay count, footprint, roof
and fenestration. The "real" is the **inter-layer constraints**: Structure gates Form gates Fabric, so
every point is a *plausible* building (a stone box can't jetty; a cruck cottage keeps its bay rhythm) — it
is grounded variety, not random noise. Therefore every subsystem is built **generative + seeded**, not a
fixed lookup; a named preset is just one pinned point in the space.

## The four primitives (orthogonal authoring axes)

| Primitive | User's word | What it is | Lives in |
|---|---|---|---|
| **Design / program** | "intended use" | function → rooms → requirement tokens | catalogue `buildingType.roomProgram` + `functions`/`requires` (E1 ✅) |
| **Construction / fabric** | "stonework and wood structures" | the load-bearing system + materials | catalogue `frameType` (authored, **dead**) + `material` ladder (✅ floats free) |
| **Architecture / form** | "architecture type" | massing idiom (longhouse, hall+wing, tower, cella, court) | catalogue `topology` (drives interior graph; **massing hardcoded in presets**) |
| **Size** | "size" | footprint extent, storeys, span | scattered in presets |

…all conditioned by **culture × era**: which (form, fabric, materials) a function may take *here and now*.

## The layered model — one graph, subsystems annotate, then project

`ConnectomeScale` is already `niche → room → building → site → district → settlement → region → world`.
Every scale **above** the building already composes. The break is *inside* the building: Structure and
Form are frozen into named presets. The epic makes the building a *projection of an annotated graph*:

```
Layer 7  WORLD        settlements + roads/rivers/regions        ✅ unified-world-connectome
Layer 6  SETTLEMENT   sites on a road graph, lots, civics       ✅ planSettlement / placeSettlement
Layer 5  SITE         building + yard + aux + fixtures + wall    ✅ expandSite (E1, data)
Layer 4  BUILDING     zones(rooms) + portals(doors) + hearth     ✅ expand() room-graph
──────────────────────────────────────────────────────────────  ← the seam this epic closes
Layer 3  FABRIC       bay rhythm, opening policy, vents          ⚠️ openings/smoke only
Layer 2  FORM         massing: plan/levels/roof/span/jetty       ❌ HARDCODED in preset
Layer 1  STRUCTURE    frameType → load constraints               ❌ authored, dead   ← FIRST BRICK
Layer 0  PROGRAM      function → rooms + requirements            ✅ E1 functions/requires
```

Each subsystem is a **pure function** `(connectome, ctx) → connectome'` (annotate) and a **projector**
`(connectome, base, ctx) → BlueprintPatch`, exactly mirroring the existing `connectomeToBlueprint`
(smoke) and `connectomeOpenings` (doors/windows) precedent in `src/blueprint/connectome/`.

### The expression pipeline (target)

```
expressBuilding({ type|function, era, culture, wealth, size, seed })
  → expand(type, ctx)                       // Layer 0: program graph (zones/portals/hearth)
  → annotateStructure(con, ctx)             // Layer 1: select frameType, write load constraints
  → annotateForm(con, ctx)                  // Layer 2: derive massing under those constraints
  → annotateFabric(con, ctx)                // Layer 3: bay rhythm, opening policy
  → projectToBlueprint(con, base, ctx)      // Layers 1–3 each emit a BlueprintPatch
  → resolveBlueprint([...patches], seed)    // existing deterministic resolve
```

A **preset becomes a pinned shortcut** — a named fixed point in the space, kept for back-compat. It is
no longer the *authoring unit*; new buildings are new function tags + the grammar realizes them.

## Where each axis bites the geometry (grounded in recon, 2026-06-28)

- **Structure (Layer 1)** gates: **jetty** (`solids.ts:storeyRect` grows upper storeys — a *timber-frame*
  phenomenon: box-frame only), **storeys** (`body.levels`, era-capped in `resolve.ts:applyPartValidity`),
  and **opening policy** (`connectomeOpenings` `FENESTRATION{maxPerFace:3, spacing:1.6}`). Wall *thickness*
  is not a geometry lever today (façade is painted), so the live structural levers are **jetty-ability,
  max storeys, and fenestration density/size**. `frameType.fields` currently carries only `regionAffinity`;
  this epic adds the structural fields.
- **Form (Layer 2)** owns `plan` / `levels` / `roof` / `footprint` / `jetty` — today hardcoded per preset;
  derived from `topology` + size under Structure's caps.
- **Material** already floats: `eras.ts` era-restyles `walls/roof/ground` independently; the ladder is in
  the catalogue `material` facts (`rank`, `wealthLadder`, `regionAffinity`).

## Structural realism the model must carry (user)

These are not extra features bolted on — each is a *facet of the structure axis*, which is exactly why
Structure is Layer 1: "load-bearing" is meaningless until the frame is a real annotation, and once it is,
all of these become expressible as reads off it.

| Concern | Where it lives | Rule it encodes |
|---|---|---|
| **Foundations & footings** | Structure (sub-grade) | the frame's below-grade member; ties to the existing building-pad terrain deformation (the pad IS the footing). A mass-wall foots wider than a cruck. |
| **Cellars / undercrofts** | a zone at `level:-1` | the connectome already carries `Zone.level` (0 = ground). A cellar is a sub-grade zone; its walls are always load-bearing (they retain earth). The townhouse "over a stone undercroft" is exactly this. |
| **Hearth placement** | Structure-gated fixture | an **open hearth** sits central in the hall (no flue, smoke to a ridge louvre); a **wall-fireplace/chimney** must back onto a **load-bearing (mass) wall** — so the smoke subsystem's `'ridge'` vs `'wall'` choice is *gated by the frame* (a cruck cottage can't take a wall-chimney; a mass-wall hall can). |
| **Load-bearing vs partition internals** | Structure → Fabric | the frame fixes which internal divisions are **structural** (box-frame cross-frames / spine wall, cruck trusses on the `bayModule`) vs free **partitions**. Structural lines define bays and **cannot be freely pierced**; partitions can. |
| **Door placement** | Fabric, consuming Structure | doors sit in **framed panels / between posts / in partitions** — never through a structural post or a cruck blade. The `bayModule` is what door/window slots must respect (this generalizes today's `FENESTRATION` slot policy to be bay-aware). |

Sequencing: Layer 1 (this slice) makes the frame + its load-bearing lines real. Cellars (`level:-1`
zones) and structure-gated hearth placement are a near follow-on; bay-aware door/partition placement is the
Fabric slice (Layer 3) once Form derives the bay grid. None of it needs new primitives — `Zone.level`,
`Fixture`, and the frame annotation already carry it.

## Slices (each pure, seeded, tested, deployable)

- **S0 — Spine doc** (this file). ✅
- **S1 — Structure axis live.** Add structural fields to `FrameTypeFields` (maxStoreys, jetty cap,
  fenestration caps, bay module, roof affinity). New content-free subsystem `connectome/structure.ts`:
  `selectFrame(buildingType, ctx)` (era×wealth×region×wall-material → frameType) + `annotateStructure`
  (writes the choice + constraints onto `con.source`/zone attrs) + `connectomeStructure(con, base, ctx)`
  projector (caps jetty/levels, exposes the frame's fenestration policy). Pack: fill the structural fields
  on the 4 medieval frames + a `frame` selection rule. **Constrains geometry ⇒ re-pin goldens + bump
  `ART_RECIPE_VERSION`.** Tests: selection by era/wealth/region, constraint projection, determinism.
- **S2 — Form derivation.** `connectome/form.ts` derives massing from topology + size under Structure
  caps; presets lose hardcoded body params (become pinned shortcuts / seeds). Golden re-pin.
  - **S2a SHIPPED** (`gen-form` opt-in, ART v14→v15): `connectomeForm` derives the VERTICAL massing
    (plan/levels/jetty/storeyM) from program + structure, footprint/roof held (placement unchanged, ART
    only). Migrated the dwelling family (cottage/tavern/townhouse): a box-frame dwelling stacks a jettied
    upper storey (levels 2, jetty = frame's full 0.15), a cruck one stays a single low range (levels 1,
    jetty 0). Cottage's derived form == authored (byte-identical, golden unchanged) = the fidelity anchor.
  - **S2b (next):** per-instance seed + footprint/bay variety (the "infinite variety" half) → shifts
    placement ⇒ `WORLD_CONTENT_VERSION` bump + per-instance art-cache. User chose to STAGE this after S2a.
- **S3 — expressBuilding() pipeline.** Compose Layers 0–3 into one entry; wire `synthesizeBlueprint` /
  `resolveAsset` onto it; named presets resolve as fixed points (byte-identical where possible). Culture
  selector stays **identity** for the single medieval pack (no over-engineering ahead of a 2nd culture).
- **S4 — Site/aux fall out of the grammar.** `stable` and the establishment auxiliaries are expressed
  (function `stabling` + frame + form), not authored. Unblocks E2 (route placer through `expandSite`,
  `WORLD_CONTENT_VERSION` bump + save-gate).

## Disciplines (what keeps it valid, not noisy)

1. **Inter-layer constraints** — Structure *gates* Form *gates* Fabric (mass-wall caps storeys/openings,
   box-frame permits jetty). This is why Structure is the first brick: it's the gate the rest hang off.
2. **Pure + seeded + cached** — every subsystem deterministic; same `(inputs, seed)` → identical graph.
   No `Math.random` (the `no-random-in-sim` discipline; the blueprint layer is already seed-driven).
3. **Preset = pinned shortcut** — existing named presets keep resolving; they stop being the unit of
   authoring. Back-compat is a hard requirement; intentional geometry shifts re-pin goldens + bump
   `ART_RECIPE_VERSION` (geometry recipe), NOT `WORLD_CONTENT_VERSION` (that gates worldgen output —
   only S4's placement change bumps it).
4. **Engine purity** — `src/blueprint/connectome/` stays content-free (no content-id literals; the
   engine-purity guard enforces it). Frame selection *rules* and structural numbers live in the pack;
   the subsystem only queries `catalogue.get('frameType', id)`.
5. **YAGNI on culture** — one pack ⇒ the culture selector is identity. Build the seam, not a matrix with
   one row.

## Files (anticipated)

| Concern | File |
|---|---|
| Structural fields on the frame fact | `src/catalogue/types.ts` (`FrameTypeFields`) |
| Frame numbers + selection rule (content) | `src/catalogue/packs/medieval-europe/frame-types.ts` |
| Structure subsystem (engine, content-free) | `src/blueprint/connectome/structure.ts` (new) |
| Form subsystem (engine, content-free) | `src/blueprint/connectome/form.ts` (new, S2) |
| Expression entry | `src/blueprint/presets/index.ts` (`expressBuilding`, wires `synthesizeBlueprint`/`resolveAsset`) |
| Geometry levers (consume the caps) | `src/blueprint/parts/body.ts`, `src/assetgen/geometry/solids.ts`, `connectome/openings.ts` |
| Version gates | `src/core/content-version.ts` (`ART_RECIPE_VERSION`, and `WORLD_CONTENT_VERSION` at S4) |
| Golden pins | `tests/unit/assetgen-golden.test.ts` |

## Verification

Per-slice `npm test` + `npm run build` green; golden re-pin is deliberate per geometry slice. The decisive
check is **visual** ("a render catches geometry bugs no assertion does"): a box-frame town house jetties and
glazes; a mass-wall church/keep stays tall, thick-set, sparsely-opened; a stave/cruck reads its bay rhythm —
all from the *same* function expressed through different fabric. Capture via `__debug.grab()` / `grabFile`,
not `page.screenshot`. Buildings render GREY massing under the reseed freeze (acceptable — geometry is the
subject here, not paint).
