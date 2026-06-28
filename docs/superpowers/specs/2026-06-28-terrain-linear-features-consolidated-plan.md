# Terrain & Linear Features — Consolidated Plan (roads · rivers · water · crossings · grade)

**Status:** CONSOLIDATION (2026-06-28). This single doc is the canonical status + forward plan for the
terrain / linear-features system. It SUPERSEDES the scattered design docs listed in §5 as the navigation
entry point — those remain as historical design reference, but the live status and remaining work live
here (task #25: "consolidate the river/road docs into one plan").

---

## 1. The system in one paragraph

The overworld is a **noise heightfield → biomes → tiles** base, onto which **linear features** (roads,
rivers, and the grade-reconciliation structures — embankments, stairs, bridges, aqueducts) are carved and
massed. Roads and rivers share **one analytic feature-SDF** (`src/render/gpu/feature-geometry.ts`) that
both carves the terrain deformation channel and drives the surface; the per-cell composed height bake is
kept as the CPU/water/entity-lift datum. Crossings, stairs, bridges, aqueducts and entrance stoops **pop
out of the connectome** as entities, sited by terrain grade × class × hydrology — not authored.

## 2. SHIPPED (live on `main`)

- **Roads as a first-class graph + carved terrain.** Polyline promoted to a road graph; roads carve the
  shared deformation channel (no separate ribbon-render path). Dirt vs paved surface by traffic/usedness.
  *(roads-slice0, roads-as-carved-terrain, linear-features-vector-SDF §6 pragmatic patch.)*
- **River hydrology.** Flow-accumulation rivers; width-by-flow (Strahler); Kinoshita meander;
  **area-scaled flow threshold** (`areaScaledRiverThreshold` — large islands no longer web over,
  WORLD_CONTENT_VERSION 22). River channel as an analytic SDF shared with roads.
  *(water-s0-hydrology-data-model, river-channel-sdf, water-hydrology-biome-rendering.)*
- **Water render.** Painted render-water type (`buildRenderWaterType`, smooth — NOT the D8 raster);
  per-fragment biome colour (kills black river patches); depth-shaded plane; water/terrain mesh cull +
  drag-LOD coarsening.
- **Crossings as generative sites.** A road×river meeting is a PLACE: roads stop at banks, a sited bridge
  (ford → timber → dressed-stone arch, gated by the **buildability envelope** tech×economy) carries the
  span, with aprons bearing toll/guard/shrine/mill by need. *(river-crossings-generative-sites.)*
- **Grade reconciliation (G1–G6).** Per-class grade envelope in routing; embankment fill cross-section;
  parametric stairs sited on over-grade road runs (G3b); above-ground deck primitive (G4); bridges from
  crossings (G5); emergent aqueducts (G6) routed cut/surface/elevated, elevated runs as an arch arcade.
- **Outdoor-architectural stairs.** Entrance **perron/stoops** — a building proud of the grade it faces
  gets a flight from grade to its door (`entrance-stoops.ts`, WORLD_CONTENT_VERSION 23).
- **Connectome diagnostics.** `evaluateConnectome()` + `lint_world` (bus + MCP), crossing-overlap rule.

## 3. REMAINING work (the live forward plan)

| # | Item | Shape | Notes |
|---|------|-------|-------|
| #24 | **Road–river relationship + embankments** | worldgen | Roads that run beside/along a river want an embankment/levee treatment; couples the road carve with the river bank. Builds on G2 fill. |
| #26 | **Merge parallel/duplicate roads** | worldgen routing | Two near-parallel roads between the same places should merge into one corridor. Route-level corridor-proximity check; the graph today stores only per-edge endpoints, so this needs a corridor pass, not an edge tweak. |
| — | **Dirt roads read WIDE** | render | Carve footprint (brown) reads wider than the narrow paved band — a carve-vs-surface width asymmetry to reconcile. |
| — | **Flowing channel-water + cut-run trenching** | render | Aqueduct/channel water is a static plane; cut aqueduct runs aren't trenched (hug the surface). Deferred polish. |
| — | **True curved arches on elevated runs** | geometry | Elevated aqueduct arcades use the kit's curved arch now; remaining polish is the structural-parts-kit's job ([[project-structural-parts-kit]]). |
| #31 | **Deeper projection unification** | render | One forward projection + WGSL unification for picking/lift (see flat-picking-on-slopes follow-ups). |
| #30 | **Studio diagnostics overlay + Fate** | tooling | Surface `evaluateConnectome()` diagnostics in the studio + let Fate consume them. |

## 4. Invariants any future linear-feature work must hold

- **One packed feature buffer** — never add a GPU storage buffer (the water pass is at 8/8); reuse the
  packed channel / replace a binding.
- **Keep the per-cell composed height bake** — entity foot-z lift, camera framing and the water-plane datum
  all read it. Sharpness comes from the analytic surface + adaptive detail-patch height, not from dropping
  the bake.
- **CPU↔GPU SDF parity** — the feature evaluator has a CPU mirror; keep it bit-exact (pin with the
  river-channel-geometry parity test).
- **Determinism** — all worldgen randomness flows through seeded RNG; `src/sim/` stays `Math.random`-free.
- **Version on output change** — bump `WORLD_CONTENT_VERSION` whenever the worldgen tile/entity set changes
  (stale-autosave invalidation).

## 5. Superseded / consolidated source docs (historical reference)

These remain in `docs/superpowers/specs/` as design history; this doc is the live entry point:
- `2026-06-14-roads-linear-features-connectome-design.md`, `2026-06-14-roads-slice0-promote-polyline-spec.md`
- `2026-06-24-roads-as-carved-terrain-design.md`, `2026-06-25-linear-features-vector-sdf-adaptive-terrain.md`
- `2026-06-17-water-hydrology-biome-rendering-design.md`, `2026-06-17-water-s0-hydrology-data-model-spec.md`
- `2026-06-24-river-channel-sdf-design.md`, `2026-06-18-terrain-water-shader-system-research.md`
- `2026-06-20-river-crossings-generative-sites-brainstorm.md`, `2026-06-15-terrain-rendering-system-design.md`
- `2026-06-26-parametric-stairs-bridges-from-connectome-spec.md` (grade-reconciliation G1–G6)

See also `docs/ROADMAP.md` (the single forward plan) and the session memory for live epic state.
