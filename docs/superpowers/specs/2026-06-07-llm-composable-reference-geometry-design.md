# LLM-Composable Reference-Geometry System — Design

> **Status:** design / awaiting review · **Date:** 2026-06-07 · **Track:** G (geometry/asset-gen)
> Supersedes the throwaway spike in `scripts/openrouter-probe.ts` + `scripts/pixelize.ts` + `tmp/`.
> Sibling track (its own spec, later): **Track R** — WebGL-2D (PixiJS) normal-lit renderer that consumes this system's baked normal maps.

## 1. Purpose

Turn an **agent-authored declarative structure description** into three aligned artifacts:

1. a **grey massing reference** (the silhouette + shaded facets the generative model conditions on),
2. a **baked normal map** (screen-space, pixel-aligned to the grey),
3. **metadata anchors** normalized to the structure's bounding box (survive repaint + downscale).

These feed the existing image pipeline — OpenRouter massing-conditioned generation on a magenta field → chroma-key → pixelize/quantize → 1-bit alpha — yielding a finished pixel-art sprite that ships with its baked normals and tagged anchors. The anchors give gameplay its hooks (smoke at an `emitter`, birds at a `perch`, a road meeting a `door`), and the normals give the renderer dynamic lighting.

The system is **not building-specific.** Buildings are one recipe. The same primitive vocabulary composes walls, barriers, gates, towers, trees, boulders, and stone circles — so the agent can request a *stonehenge tile* on the fly and get it fully rendered.

### Non-goals (v1)

- True 3D in-game rendering (Track R lights 2D sprites; this system only *bakes* normals).
- Interiors, windows-that-open, room layout (that's the "Structure" tool's territory — out of scope).
- Multi-tile spanning structures (a wall that crosses many tiles) — deferred to v2; v1 composes within one tile footprint.
- A heavyweight CSG kernel — see §6.

## 2. Where it lives

New module **`src/assetgen/`**, productionizing the spike. Constraints:

- **Pure TypeScript, runs in both Node and the browser** — the same code path serves vendored dev-time regeneration *and* on-the-fly agent tool calls in the static BYOK client.
- **No `three` / no `gl` in the bundle path.** The system is a headless geometry + raster module: its own 2:1 dimetric projection and a pure-array scanline rasterizer (already proven in the spike). PNG encoding is the only platform seam (§7).
- **Deterministic.** All scatter jitter flows through a seeded RNG (`mulberry32(seed)`), never `Math.random` — mirroring the `src/sim/` discipline.

```
src/assetgen/
  geometry/
    primitives.ts      — box, prism, cylinder/frustum, ellipsoid, cone, arch, extrusion
    roof-skeleton.ts    — straight-skeleton roof faces over an arbitrary footprint
    scatter.ts          — ring | grid | line | cluster placement (seeded jitter)
    facets.ts           — Facet { pts, normal, albedo, tags }; depth-sort + hidden-face cull
    transform.ts        — place/rotate(about up)/scale into tile-local space
  render/
    projection.ts       — 2:1 dimetric screen basis (RIGHT/DOWN/VIEW), normalRGB
    rasterize.ts        — pure-array scanline fill → RGBA; albedo + normal modes
    fit.ts              — two-pass measure→fit-and-centre (FILL_FRAC)
    png.ts              — RGBA → PNG; Node (pngjs) | browser (OffscreenCanvas) adapter
  compose.ts            — composeStructure(spec) → StructureResult (the substrate, §4)
  macros/
    index.ts            — registry: name → (params) => Part[]
    buildings.ts        — cottage/tavern/longhouse/l_house/t_hall/cross_chapel
    megaliths.ts        — menhir, trilithon, stone_circle
    barriers.ts         — wall_run, gatehouse, tower
    nature.ts           — tree (conifer | round), boulder, grove, boulder_field
  anchors.ts            — AnchorTag taxonomy + auto-derivation + bbox normalization
  pipeline.ts           — compose → generate (OpenRouter) → pixelize → register (AssetLibrary)
  agent-tools.ts        — compose_structure / generate_structure_sprite verbs + JSON schema + vocabulary doc
  types.ts              — StructureSpec, Part, RoofSpec, Mat, StructureResult, StructureMeta
```

## 3. Interface (locked)

**Declarative scene-graph as the substrate, a macro library on top, one tool call per structure.** (Approach "C built on A" from brainstorming.) This is the most token-efficient surface, atomic and replayable (it fits the existing command-channel/authoring-verb pattern), lets the LLM reason about a whole structure in one shot, and stays fully general via the primitive fallback. Macros encode period-correct defaults so the common case is a one-liner (`stone_circle{count:9, radius:0.4, stone:'menhir'}`) instead of nine hand-placed boxes.

## 4. Data model

All coordinates are **tile-local**: `x,y` in tile-units across the footprint (default tile `1×1`), `z` up in cube-units (one cube-unit of height == one tile-run in the 2:1 projection, so `pitch` IS `tan(roofAngle)` — carried over from the spike).

```ts
type Vec2 = [number, number];
type Vec3 = [number, number, number];
type Mat  = 'stone' | 'timber' | 'plaster' | 'thatch' | 'tile' | 'foliage' | 'bark' | 'earth' | 'metal';

interface StructureSpec {
  id?: string;                     // stable key for AssetLibrary; else hashed from spec
  tile?: { w: number; h: number }; // footprint extent in tile-units (default 1×1)
  seed?: number;                   // scatter jitter determinism (default 0)
  parts: Part[];
  palette?: Partial<Record<Mat, [number, number, number]>>; // overrides the default palette → gen color_image hint
}

type Part =
  | { prim: 'box';       at: Vec3; size: Vec3; rot?: number; material?: Mat; anchors?: AnchorTag[] }
  | { prim: 'prism';     at: Vec3; size: Vec3; sides: number; rot?: number; material?: Mat; anchors?: AnchorTag[] }
  | { prim: 'cylinder';  at: Vec3; radius: number; height: number; taper?: number; sides?: number; material?: Mat; anchors?: AnchorTag[] }
  | { prim: 'ellipsoid'; at: Vec3; radii: Vec3; material?: Mat; anchors?: AnchorTag[] }
  | { prim: 'cone';      at: Vec3; radius: number; height: number; sides?: number; material?: Mat; anchors?: AnchorTag[] }
  | { prim: 'arch';      at: Vec3; span: number; height: number; thickness: number; rot?: number; material?: Mat; anchors?: AnchorTag[] } // post+lintel
  | { prim: 'extrusion'; footprint: Vec2[]; height: number; roof?: RoofSpec; material?: Mat; roofMaterial?: Mat; anchors?: AnchorTag[] }
  | { macro: string; params: Record<string, unknown> }     // expands via macros/index.ts
  | { scatter: { of: Part; pattern: 'ring' | 'grid' | 'line' | 'cluster'; count: number;
                 radius?: number; spacing?: Vec2; jitter?: number } };

interface RoofSpec { kind: 'flat' | 'gable' | 'hip' | 'skeleton'; pitch?: number; ridgeAxis?: 'long' | 'short' }

interface StructureResult { grey: ImgRef; normal: ImgRef; meta: StructureMeta; bbox: BBox }
// ImgRef = { dataUri: string } in browser, { path: string } in Node.
```

`extrusion` is the building/gatehouse path: author **one footprint polygon** (wings and notches are just vertices), extrude the walls, and let the straight-skeleton produce the roof (§6). This kills the spike's "model confused by overlapping boxes" problem — there are no overlapping boxes, the silhouette is correct by construction.

## 5. Anchor taxonomy

Anchors are normalized to the structure's opaque bbox (`0–1`), so `px = frac × spriteSize` after any repaint/downscale.

**Auto-derived (geometric, computed from facets):** `corner`, `edge`, `top`, `ridge`, `apex`, `eave`.

**Agent-taggable (semantic, declared on a part via `anchors`):**
- `door` / `interaction` — base-centre threshold (connect to road, click target).
- `perch` — top points: roof gavels, chimney caps, standing-stone tops (birds, banners).
- `emitter` — smoke/fire/steam origin (runtime particles; **never baked** into the sprite).
- `attach` — a join point to a neighbouring structure (wall-segment ends, gate-in-wall).
- `base` — ground-contact point for placement/anchoring.

`StructureMeta` carries `footprint`/`eaves` polylines, `ridges` segments, and point arrays per anchor type, all normalized. (Generalizes the spike's `RawMeta`/`norm()`.)

## 6. Geometry core decision

Two genuinely different needs:

- **Roofs over arbitrary footprints** (L/T/cross/notched) are the one hard algorithm. Use **`straight-skeleton`** (StrandedKitty, npm, TS, browser-ready; CGAL-via-WASM robust path + pure-TS fast path). Hip = raise all skeleton edges; gable = collapse chosen skeleton edges to a ridge. This is the biggest crib and replaces per-wing roof casing.
- **Everything else** (walls, towers, stones, trees) is independent solids placed in tile space. For a grey *reference* + silhouette we do **not** need true CSG: a depth-sorted facet emitter with hidden-face culling (already in the spike) produces a correct merged silhouette when solids abut, and footprint-polygon authoring removes the in-building union entirely.

**Decision:** depend on `straight-skeleton` for roofs + our own facet emitter/rasterizer for the rest. **`manifold-3d` (WASM) is a documented optional escalation** — lazy-loaded only if a future part flags `boolean:'union'` *and* two solids interpenetrate such that depth-sorting leaves a visible seam. YAGNI for v1: keeps the bundle light and browser-friendly. (Full rationale and the rejected alternatives — three-bvh-csg requires `three` and trips the bundle guard; @jscad/modeling is BSP and doesn't carry face tags — live in the memory note `project-openrouter-building-pipeline`.)

> **Revision (2026-06-07, during Slice 2 planning):** The `straight-skeleton` library is **deferred, not adopted.** Two blockers surfaced on inspection: it requires an async `SkeletonBuilder.init()` WASM step (fights the pure/synchronous/deterministic/testable design and complicates the browser path), and its README does not document how to read per-vertex roof *height* — the one output we need. Since every building footprint is **rectilinear** (a union of unit grid cells) and the spike's per-wing gable/hip roofs were validated as accurate ("t_hall, cross_chapel, l_house worked great"), Slice 2 instead ports that proven rectilinear roof model into **world-space facet emitters** — no WASM, no new runtime dependency, fully deterministic — and additionally **closes the gable ends** (fixing the open-silhouette notch). General **non-rectilinear** straight-skeleton roofs (curved/diagonal footprints) become a documented future escalation alongside `manifold-3d`. The `extrusion` part in §4 is therefore realized in v1 as a rectilinear **`building`** part taking a set of wing rectangles rather than an arbitrary polygon.

> **Revision 2 (2026-06-08): pivot to `manifold-3d` for geometry construction.** The hand-rolled rectilinear roof (`roof-unified.ts`) hit the predicted wall: multi-wing junctions (L/T/cross) produced a **striped z-fighting triangle** in the central valley that survived three successive hand-patches (per-pixel z-buffer, single-triangle gable runs, outward-nudge EPS). The root cause is fundamental — two roof surfaces meeting at a valley is a **boolean-union problem**, and approximating it with a height field + manually-closed gable faces keeps generating coincident/near-coincident geometry. After researching the June-2026 landscape (manifold-3d vs three-bvh-csg vs trueform vs hand-rolled), we adopt **`manifold-3d`** (v3.5, robust watertight WASM CSG kernel; OpenSCAD's kernel) for geometry **construction**, and **keep the entire render pipeline** (2:1 projection, the per-pixel z-buffer rasterizer, fit, compose, the `StructureSpec`/`Part`/macro structure). Decision recorded against the user's "reconsider the whole future stack" prompt:
>
> - **CSG kernel: `manifold-3d`.** Standalone WASM, **does not pull in `three`** (so the `no-three-in-bundle` guard stays green; three-bvh-csg was rejected precisely because it requires `three` and is less robust). Bundle cost is `manifold.js` (~75 KB glue) + `manifold.wasm` (541 KB), lazy-loaded; the package's heavy `@gltf-transform` deps belong only to its CAD/glTF exports and are **not** reached by the root `manifold-3d` import. Determinism is preserved (operations are deterministic; we pin tessellation via `setCircularSegments`). The only new cost is an **async** WASM `init()` — acceptable, since asset-gen is already an async/paid operation.
> - **Baking stays on the CPU.** manifold emits a plain watertight mesh (`getMesh()` → `vertProperties` + `triVerts`) that feeds our existing CPU projection + rasterizer. We deliberately do **not** move baking to GPU render-to-texture: that would need a GPU/3D engine in CI and break pure-vitest determinism, for marginal gain (the bug was CSG, never rasterization).
> - **Future in-game render stack (Track R) stays decoupled and deferred.** The eventual 2D normal-lit shader layer remains its own slice; the leading candidate is **PixiJS** (2D-native, WebGL2-now/WebGPU-ready), *not* a 3D engine — the art direction (2D pixel-art sprites lit by baked normals) rules out rendering geometry live. The `three` ban is **kept**, reframed as "no heavyweight 3D scene engine in the bundle"; manifold-3d (a CSG kernel, not an engine) is exempt.
>
> **New architecture (replaces `roof-unified.ts` + the hand-rolled solid math in `primitives.ts`/`building.ts`):**
> - `geometry/manifold-runtime.ts` — `getManifold(): Promise<ManifoldToplevel>`, a cached lazy singleton (`await Module(); setup(); setCircularSegments(32)`).
> - `geometry/solids.ts` — each `Part` primitive builds a closed `Manifold` solid (`Manifold.cube/cylinder/sphere/extrude` + `translate`/`rotate`/`scale`/`union`). A **building** = `union(wing wall-boxes)` and `union(wing roof-prisms)` as **two separate solids** (walls and roof are disjoint in z, so each carries its own material with no per-triangle provenance bookkeeping). *The union of crossed roof prisms yields correct hips/valleys by construction — this is what eliminates the stripe.* `manifoldToFacets(mesh, mat)` walks `triVerts`/`vertProperties` and emits one flat-normal `WorldFacet` per triangle.
> - Closed solids replace the old "emit only the 3 camera-facing faces" hack — `projectFacets` already back-face-culls and the z-buffer resolves overlaps, so full watertight meshes are correct and simpler.
> - `composeStructure(spec)` becomes **async** (`Promise<StructureResult>`); `scripts/assetgen-preview.ts` and all assetgen tests `await` it.
>
> **Scope kept tight (this slice):** asset-gen continues to run **Node-side only** (vitest + the preview script + the future seed pipeline); in Node the Emscripten module locates `manifold.wasm` automatically. **Browser/Vite wasm-URL plumbing for on-the-fly client gen is explicitly deferred** to the pipeline/agent-tools slices — `src/assetgen/` stays out of the game bundle graph until then. §6's "manifold-3d is an optional escalation" is now realized as the **primary** construction path.

## 7. Rendering & projection

Reuse the spike's validated machinery, generalized from "buildings" to "parts":
- 2:1 dimetric screen basis `RIGHT=[0.7071,-0.7071,0]`, `DOWN=[0.4082,0.4082,-0.8165]`, `VIEW=[0.5774,0.5774,0.5774]`; `normalRGB` packs R=screen-right, G=screen-up (−sy), B=toward-camera. (Validated by the Track-R lighting proof.)
- Per-part facets → one geometry pass → rasterized **twice**: grey uses `albedo`, normal map uses `normalRGB(normal)`. Identical polygon set → pixel-perfect alignment.
- Two-pass **measure→fit-and-centre** (`FILL_FRAC ≈ 0.88`) so every structure fills the same frame fraction regardless of footprint (stops the generative model over/under-shooting small footprints).
- **PNG seam:** pure rasterizer emits an RGBA buffer; `png.ts` encodes via `pngjs` in Node and `OffscreenCanvas.convertToBlob`/`toDataURL` in the browser.

## 8. Pipeline & integration

```
composeStructure(spec)  → { grey, normal, meta, bbox }          [free, instant, deterministic]
        ↓ (paid, user-authorized)
OpenRouter massing-conditioned gen on magenta  → image
        ↓
chroma-key magenta → crop → area-downscale → quantize → 1-bit alpha    (existing pixelize)
        ↓
finished sprite + dim-matched normal map + normalized meta
        ↓
register in AssetLibrary (IndexedDB live cache), keyed by spec id/hash
        ↓
ArtResolver serves it by entity kind/id; Track-R renderer lights it
```

`AssetLibrary` / `ArtResolver` already exist; this adds a structure-keyed entry shape carrying `{ sprite, normal, meta }`.

## 9. Agent tool surface (the LLM-facing part)

Two verbs registered in the existing **command-channel / capability registry** (the same introspectable, drift-guarded, replay-safe surface Fate and the Create panel already use):

- **`compose_structure(spec)`** — geometry only. Free, instant. Returns `{ grey, normal, meta, bbox }` for preview. The agent (or a human in the Create panel) can iterate the spec with zero cost before paying.
- **`generate_structure_sprite(spec)`** — the full paid pipeline (§8); registers the finished sprite in `AssetLibrary` and returns its key. Cost-gated and user-authorized like all paid gen.

The LLM is given the `Part` JSON schema **and** a compact **vocabulary doc** listing the primitives and the macro names with their params, so it knows it may write `{macro:'stone_circle', params:{count:9, radius:0.4, stone:'menhir'}}` or drop to primitives for a novel form. Args are declarative JSON → replayable on the command channel.

## 10. Determinism & testing

- Seeded scatter (`mulberry32(seed)`); a `no-random-in-assetgen` guard test mirrors `no-random-in-sim`.
- **Macro golden tests:** expansion → expected part count, bbox, and anchor count (e.g. `square→4 corners`, `L→6`, `T→8`, `cross→12`; `stone_circle(9)→9 trilithons`).
- **Skeleton-roof tests:** `square → single apex`; `L-footprint → branched ridge`; `rectangle → ridge along long axis`.
- **Raster snapshot:** hash the grey + normal RGBA for a fixed seed/spec to catch projection regressions.
- **Alignment test:** grey and normal opaque masks are identical pixel sets.
- **No-three/no-gl bundle guards** continue to pass (assetgen pulls neither).

## 11. Implementation slices (for the plan)

1. **Geometry core** — `types.ts`, primitives (box/prism/cylinder/ellipsoid/cone/arch), `facets.ts`, `projection.ts`, `rasterize.ts`, `fit.ts`, `png.ts`, `compose.ts` for a hand-written spec of plain primitives. Tests. *(No roofs, no macros, no LLM, no gen.)*
2. **Extrusion + straight-skeleton roofs** — `roof-skeleton.ts`, `extrusion` part; the 6 buildings expressed as single-footprint extrusions. Tests.
3. **Macros + scatter** — `scatter.ts`, `macros/*`, anchor taxonomy wired through. Megaliths/barriers/nature recipes. Golden tests.
4. **Pipeline** — `pipeline.ts`: productionized chroma-key/pixelize + `AssetLibrary` registration keyed by spec hash; dim-matched normal.
5. **Agent tools** — `agent-tools.ts`: `compose_structure` + `generate_structure_sprite` on the command channel; JSON schema + vocabulary doc exposed to the LLM; Create-panel preview.

Each slice produces working, testable software on its own. Slice 1 alone replaces the spike's core; the system is agent-usable at slice 5.
