# Unified renderer over the connectome graph — brainstorm

**Date:** 2026-06-14 · **Status:** brainstorm (pre-spec) · **Branch:** `feat/unified-renderer`
(worktree `/Users/Morten/mcpui/small-gods-render`)

**Relates to:**
[world prop/vegetation rendering](2026-06-13-world-prop-vegetation-rendering-design.md) ·
[fact catalogue + connectome](2026-06-14-fact-catalogue-connectome-slice01-spec.md) ·
[PBR sprite stack] (memory) · [render trees Slice 2](2026-06-13-render-trees-slice2-spec.md)

---

## 1. The question this answers

> "Take a good look at the rendering engine. Can we improve it? Rewrite in Rust?
> We'll be doing a lot of shader work and an advanced terrain model. Should we be
> writing WASM?"

…now refined by the session vision: **one unified renderer drawing one unified
connectome graph that defines the entire world**, while sibling sessions build the
connectome (the graph) and the modeling systems (node types — trees, etc.).

## 2. The headline answer

**Do not rewrite the renderer in Rust.** It solves a problem we don't have (CPU
host speed) and worsens several we do (iteration velocity, a polyglot build, a
JS↔WASM marshaling boundary at the hottest per-frame interface, and the project's
standing goal of an LLM-agent-friendly TypeScript codebase).

**The reason is simple and load-bearing:** the shader work the user wants runs on
the **GPU** — it is GLSL/WGSL regardless of the host language. The "advanced
terrain" we want to render is GPU geometry + a fragment program. Rust on the CPU
makes none of that better; the host just uploads buffers and sets uniforms. We
already host a custom GPU shader from TypeScript today (`pixi/lit-shader.ts`).

**What is actually blocking shaders + terrain is architectural, not linguistic:**

1. **Terrain lives on Canvas2D** (`iso/iso-terrain.ts`, a per-tile diamond-fill
   loop) while entities live on a **WebGL layer with a real PBR shader**
   (`pixi/pixi-entity-layer.ts` + `lit-shader.ts`). They are two separate canvases
   composited by a `drawImage`. You cannot do terrain self-shadowing, water,
   fog, atmospherics, or receive entity shadows onto ground while the ground is
   CPU-rasterized 2D.
2. **There is no elevation.** `Tile` has no `z`; `worldToScreen()` *accepts* a `z`
   it is never given. "Advanced terrain" has nothing to attach to yet.
3. **Lighting is static per session** — uniforms are hand-fed once
   (`DEFAULT_LIGHTING`). The day/night driver already exists (`studio/solar.ts`)
   but has no live consumer.

**The move:** consolidate terrain + entities into **one GPU scene under one
camera**, in TypeScript, keeping Canvas2D as the documented parity fallback (the
entity layer already degrades this way). Then the shader future is wide open.

**WASM has a real but narrow place:** CPU-heavy **compute kernels**, not the
renderer. If "advanced terrain" means real erosion / hydrology / large noise
fields and those profile hot at worldgen time, port *those specific kernels* to
Rust→wasm. `manifold-3d` (CSG) is already wasm and stays author-time. That is the
correct, surgical use of wasm — no boundary in the frame loop.

## 3. The architecture: renderer = pure projection of the graph

The vision is a clean one and worth stating as a first principle:

> **The connectome graph is the single source of truth. The renderer is a pure,
> stateless projection of (a view of) that graph onto a GPU scene. No render
> state flows back into the graph.**

This is already half-true: `RenderFn(ctx, RenderContext)` takes world state in and
emits pixels out, with no side-effects on sim/world. We harden that into a
contract and widen its input from "world entities" to "a render-facing view of the
connectome."

```
 connectome graph (Session A)          modeling systems (Session B)
   Zone/Portal/Fixture nodes,            node TYPES: building blueprints,
   district/trade edges,                 plant blueprints, props, …
   terrain field, entity nodes                  │
            │                                    │  (each resolves to a SpritePack:
            │   project to render view           │   albedo + normal + material)
            ▼                                    ▼
   ┌─────────────────────  RenderGraph (the seam)  ─────────────────────┐
   │  what the RENDERER reads — a stable, narrow projection:            │
   │   • placed nodes: id, worldPos(x,y,z), footprint, kind→assetKey    │
   │   • terrain: heightfield + per-tile material/biome ids             │
   │   • linear edges that draw (roads/rivers/walls): polylines + kind  │
   │   • light/atmosphere state (time, season → solar.ts)              │
   └────────────────────────────────────────────────────────────────────┘
            │
            ▼
   ONE GPU scene (this epic) ── terrain mesh + entity quads + linear ribbons,
            │                    one camera, one lighting pass, one shadow pass
            ▼
        pixels
```

**Why the seam matters for three parallel sessions:** the connectome's *internal*
model (how rooms wire, how trades edge together) can churn freely without touching
the renderer, as long as it keeps exposing the narrow `RenderGraph` projection.
And the renderer can ship terrain-on-GPU **before the world-graph exists** by
projecting today's `World`/`Tile` data into the same `RenderGraph` shape. The seam
is the contract; everything behind it on either side is each session's business.

## 4. What the renderer needs FROM the graph (the contract to negotiate)

This is the one thing I should *not* invent alone — it's the inter-session API.
Proposed minimal `RenderGraph` read interface (renderer-owned types, graph-side
adapter):

- **Nodes (drawable):** `{ id, x, y, z, footprint, kind, assetKey?, variantKey?,
  facing?, lifecycleStage? }`. `kind`+`variantKey` already map to a SpritePack via
  the existing asset cache key (`generatedArtKey`). Trees ride this exact path
  (Session B's Slice 2) — per-species pack, not per-instance.
- **Terrain:** `{ width, height, heightAt(x,y) | Float32 heightfield,
  materialAt(x,y) | tile-material ids, water level }`. **Open question: who owns
  elevation?** (see §8). The renderer needs a heightfield; the graph/worldgen
  should produce it. Today `src/terrain/` generates elevation/moisture fields that
  are then *discarded* into flat tiles — that field is exactly what we resurface.
- **Linear features:** `{ kind: 'road'|'river'|'wall'|…, polyline, width }` — drawn
  as GPU ribbons (splines), with the sim's derived grid mask unchanged. (Matches
  the roadmap's "Track V vector roads/rivers + bridges".)
- **Lighting/atmosphere:** `{ time, season, lat, moonPhase } → LightingState` via
  the existing `solar.ts` model.

The renderer holds **no** knowledge of rooms, trades, beliefs, or sim internals —
only placed drawables + terrain + light. That keeps the projection cheap and the
sessions decoupled.

## 5. The unified GPU renderer — what we build (this epic)

Keep the clean `RenderFn`/`RenderContext` seam; add a third renderer behind it
(`?render=gpu`) alongside `iso` (current) and `topdown` (legacy), so we develop
with instant A/B fallback and never break `main`.

1. **Elevation in the data model.** Add `z`/heightfield to the terrain the renderer
   reads (resurface the already-generated `src/terrain/` elevation field). Nothing
   renders height until data carries it — this is step zero.
2. **Terrain onto the GPU.** A heightmapped mesh (or screen-space iso tiles with
   per-vertex z), textured by per-tile material/biome, lit by the *same*
   directional sun + ambient as entities. Retire the Canvas2D terrain blit on this
   path (keep it as the parity fallback).
3. **One scene, one camera.** Terrain mesh + entity quads (already lit) + linear
   ribbons in a single GPU pass under a shared camera, so depth, shadows, and fog
   are mutually consistent. Entities already travel as lit unit-quads — they slot
   in directly.
4. **Dynamic lighting / day-night.** Wire `solar.ts` → `LightingState` into the
   live frame (already proven in the studio). Sun + ambient + cast-shadow direction
   animate together with `state.clock`. This is roadmap "PBR Slice 4".
5. **Then the shader playground opens** — terrain receiving entity shadows, water
   with a reflection/refraction shader, height fog, AO on slopes, emissive windows
   at night, weather. Each its own slice.

## 6. The real fork: WebGL2 vs WebGPU (decide in the spec)

This is the decision actually hiding inside "a lot of shader work." It is **not**
the host language; both are TypeScript-hosted.

| | WebGL2 (GLSL) | WebGPU (WGSL) |
|---|---|---|
| Pixi v8 support | yes (default) | yes (backend flag) |
| Shaders today | already on it (`lit-shader.ts`) | port needed |
| Compute shaders | no (fragment tricks only) | **yes** — GPU erosion, terrain LOD, particle sim |
| Maturity 2026 | universal | broadly shipped; some older devices fall back |
| Forward-looking | plateaued | the modern target |

**Spike result (2026-06-14) — WebGPU PASSED.** A self-contained capability +
instancing spike (`public/webgpu-spike.html`) ran clean in-browser: `navigator.gpu`
present → real hardware adapter (**Intel gen-8 integrated**, not a software
fallback) → device + canvas context (`bgra8unorm`) → **an instanced WGSL pipeline
drew 9 per-instance-attributed quads in one draw call.** Limits generous (2 GB max
buffer, 16384 max texture dim, BC compression + depth32float-stencil8). The
"does WebGPU even work here / can we instance in WGSL" risk is **retired** — even
the low-end integrated GPU handles it.

**Revised lean: WebGPU-first, greenfield.** Because the GPU scene is new, there are
no GLSL shaders to port — writing them once in WGSL is cheaper than GLSL-now-then-
port, and it puts us directly on the path for the heavy shader + compute future
(GPU erosion/hydrology, GPU-driven indirect culling for massive vegetation). The
one remaining tradeoff is **player reach**, resolved by the fallback chain:
- **Via Pixi v8's WebGPU backend** (`preference:'webgpu'`) we get WebGPU-when-
  available with **automatic WebGL2 fallback** — *but only for Pixi's own
  rendering*; a fully-portable **custom** shader must be authored in BOTH WGSL and
  GLSL for Pixi to target both backends.
- **Or WGSL-only custom shaders** + **Canvas2D as the sole fallback** (already our
  parity path): simplest to build (one shader language), and a no-WebGPU player
  still renders — just the existing unlit Canvas2D look. Defensible for an
  experimental GitHub-Pages god-game; the long tail without WebGPU is small + shrinking in 2026.

**DECIDED (2026-06-14, user):** **WGSL-only custom shaders on WebGPU, with the
existing Canvas2D parity path as the sole fallback.** One shader language; a
no-WebGPU player renders via the unlit Canvas2D path (degraded, never a black
screen). Seam-protected — a GLSL/WebGL2 twin can be added later *only if* telemetry
shows real players bouncing on no-WebGPU. This is the spec's backend architecture.

## 6b. GPU acceleration: instancing, indirect, atlases

Yes — and one of these is a *real* win we should bank early, because the current
lit path has a known inefficiency.

**Today's hot spot:** each lit sprite is its own Pixi `Mesh` with its own `Shader`
+ uniform group, re-uploaded per frame (`pixi/lit-shader.ts` + CLAUDE.md note).
That's one draw call + one uniform upload **per building**, and trees are about to
arrive in the *hundreds–thousands* (Session B). That does not scale.

**Instanced rendering — adopt (WebGL2 has it; the right tool here).**
- One shader, one bound geometry (the unit quad), **per-instance attributes**:
  transform (x,y,z,scale), atlas-layer index, variant/tint, foot-lift. Draw 2000
  oaks in **one** `drawElementsInstanced`, not 2000 meshes.
- Group instances by SpritePack (species/type) — the asset cache key already
  collapses identical kinds to one pack, so the instance buckets fall out for free.
- Sun/ambient/bands are **shared uniforms** (same for all instances); only the
  per-instance transform + atlas index vary. Pixi v8 supports instanced geometry
  (`Geometry` + `instanceCount` + instanced attrs), so we stay inside Pixi.
- **Pixel-art makes this easier, not harder:** sprites are hard-alpha **cutouts**.
  Use alpha-test + a real depth buffer instead of strict back-to-front y-sort →
  instances within a layer can draw **unsorted**, which is what makes big instanced
  batches legal. (Soft-alpha edges from AA need care; the banded/snapped look keeps
  edges crisp, so cutout is a good fit.)

**Texture arrays — pair with instancing (WebGL2 `TEXTURE_2D_ARRAY`).** Pack the
SpritePack channels (albedo / normal / material) as array-texture layers so an
instanced batch binds **one** texture and selects its layer per-instance. Removes
the per-sprite texture bind that would otherwise re-fragment the batch.

**Indirect draw (GPU-buffer-sourced draw params) — defer; it's a WebGPU feature.**
- True `drawIndexedIndirect` / multi-draw-indirect (the GPU reads instance counts &
  offsets from a buffer a **compute shader** wrote — GPU-driven culling, CPU never
  touches the draw list) is **WebGPU-only**. WebGL2 has only `WEBGL_multi_draw`
  (params from CPU arrays, no GPU-sourced indirect).
- It pays off at **hundreds of thousands–millions** of instances (open-world
  foliage). We have thousands, and we already cull CPU-side via the `World` spatial
  region query. So indirect is **premature** — but it is a concrete, legitimate
  reason to keep **WebGPU on the table** (§6) for a future massive-vegetation world,
  not a reason to adopt it now.

**Already in place / cheap:** CPU frustum-ish culling (spatial region query),
Pixi's automatic batcher for the *unlit* path. The gap is the *lit* path → that's
what instancing closes.

**Net:** instancing + texture arrays in WebGL2 is the high-value, in-reach
acceleration and should be a named slice (folds naturally into R2 "terrain + lit
entities on the GPU"). Indirect / GPU-driven culling is a WebGPU-era luxury we
design the seam to *allow* but don't build.

## 7. Where WASM belongs (and where it doesn't)

- **Renderer:** no. Shaders are GPU; the host stays TS.
- **Worldgen compute kernels:** yes, *if/when* they profile hot. `src/terrain/`
  (`erosion.ts`, `hydrology.ts`, `terrain-generator.ts`) is per-world-gen CPU work.
  An "advanced terrain model" could make these expensive; those specific kernels
  are clean candidates for Rust→wasm (pure number-crunching, no DOM, no per-frame
  boundary). Or, later, WebGPU compute does the same on the GPU.
- **CSG:** already wasm (`manifold-3d`), author-time. Unchanged.

Rule of thumb: **wasm for batch compute with a coarse call boundary; never for the
per-frame render loop.**

## 8. Open questions (carry into the spec)

- **Who owns elevation?** Worldgen already computes an elevation field
  (`terrain-generator.ts`) then flattens it. Options: (a) renderer resurfaces it
  read-only; (b) it becomes a first-class part of the connectome's terrain node;
  (c) sim needs it too (pathfinding cost, settlement placement). **Lean:** terrain
  heightfield is graph-owned world data (so sim can read it), renderer consumes
  read-only. Needs sign-off from Session A.
- **`RenderGraph` projection ownership.** Renderer-owned interface + graph-side
  adapter (my lean — keeps the renderer's types independent), vs graph exposes it
  natively. Negotiate with Session A.
- **Terrain representation.** True heightmap mesh vs per-vertex-z iso tiles. Iso
  tiles preserve the current art language + pixel-snapped look; a mesh is more
  general (cliffs, smooth slopes). **Lean:** start with per-vertex-z iso tiles
  (minimal disruption), keep the door open to a mesh.
- **WebGL2 vs WebGPU** (§6) — lean WebGL2-now, seam-protected.
- **Pixel-art fidelity under 3D terrain.** The game's identity is pixel-snapped
  1:1 iso sprites. Height + perspective must not break that. Banded lighting +
  snapped vertices preserve it; verify early with an in-browser eyeball.

## 9. Session boundaries (avoid the three-way collision)

- **Me (renderer):** `src/render/**`, the new GPU scene, the `RenderGraph` read
  interface, lighting/terrain rendering. Worktree `feat/unified-renderer` (own dev
  port, e.g. :3002). I do **not** edit `src/catalogue/**`, `src/blueprint/connectome/**`,
  or the modeling presets — I consume their output.
- **Session A (connectome):** the graph + catalogue. Owns the *internal* model;
  owes the renderer the `RenderGraph` projection + (likely) the terrain heightfield.
- **Session B (modeling):** node *types* (trees/props/buildings → SpritePacks).
  Already feeds the existing lit-quad path; no renderer change needed per new type.
- **Shared contract:** the `RenderGraph` interface is the negotiated API. Land it
  early as a tiny typed seam both sides import, so the three branches integrate by
  construction rather than by merge-conflict.

## 10. Recommended sequence

1. **Spec this** (incl. the WebGL2/WebGPU call + the `RenderGraph` contract draft
   to hand to Session A).
2. **Slice R0 — the seam.** Define `RenderGraph`; adapt today's `World`/`Tile` into
   it; current iso renderer reads through it (no visual change — pure refactor,
   guard with golden frame test). De-risks everything; integrates the three lanes.
3. **Slice R1 — elevation data.** Resurface the worldgen heightfield onto the
   terrain the renderer reads. Still Canvas2D (flat-shaded by height = free win).
4. **Slice R2 — terrain on the GPU.** Per-vertex-z iso tiles in the WebGL layer,
   one scene with entities, parity fallback retained.
5. **Slice R3 — dynamic day/night.** `solar.ts` → live `LightingState`.
6. **Slice R4+ — the shader playground:** terrain-receives-shadows, water, fog,
   emissive night windows, weather — each its own slice.
7. **WASM kernels** only when worldgen profiles hot.

---

### TL;DR

Not Rust. Shaders are GPU code; the host language is irrelevant to them. The win is
**unifying terrain + entities into one GPU scene under one camera in TypeScript**,
behind the existing renderer seam, with the renderer as a **pure projection of the
connectome graph**. Reserve WASM for hot worldgen compute kernels, never the frame
loop. The one decision worth making deliberately is **WebGL2 (now) vs WebGPU
(later)** — lean WebGL2, seam-protected so the swap stays cheap. The critical
cross-session artifact is the narrow **`RenderGraph`** read interface — land it
first.
