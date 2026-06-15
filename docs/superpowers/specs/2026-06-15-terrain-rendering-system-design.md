# Terrain Rendering System — brainstorm / design

> Status: BRAINSTORM (2026-06-15). Consolidates the vision from the R2d terrain
> discussion into one sequenced system. Part of the unified-renderer epic
> (`project-unified-renderer-epic`); this is the terrain half of "one WebGPU
> renderer projecting one connectome graph."

## North star

The ground is a **continuous, dynamic, pixel-art surface** — smooth relief with
real height, regional climate that paints snow / ice / water / mud, everything
**blended** (no hard tile edges), integrated with sprites and roads, and fast
enough to stay buttery while zooming and scrubbing.

Reference: icegame's `iso_mesh.wgsl` (GPU heightfield, in-shader normals,
layered materials from per-cell state buffers). We adopt its **architecture**
but go **less nerdy on the physics** (banded art-directed blends, not
Beer-Lambert/Fresnel optics) and **more flexible** (our biome/connectome model,
screen-space iso to stay coherent with billboard sprites, our deformation
channel as the height source).

## The one principle: decouple the render surface from the sim grid

- **Sim grid stays discrete.** WFC, the connectome, placement, pathfinding, and
  interactions all run on the coarse tile grid. Gameplay is tile-based. Unchanged.
- **The render surface is continuous**, sampled finer than the grid. Height,
  climate, and material are **fields** the GPU samples + blends per fragment.
  The tile grid is the low-frequency source; the surface is its smooth projection.

## Architecture: buffer-driven GPU terrain

Not CPU-built vertex arrays. The terrain is **generated in the vertex shader**
from storage buffers, so the only per-frame CPU work is uploading changed fields.

**Field buffers (per cell, row-major `width×height`):**
- `height : f32` — normalised elevation `[0,1]`. **This is `heightAt = base ⊕
  deformations`** — the sibling sessions' deformation channel writes it; the GPU
  reads it. A motte/ditch/road-cut displaces the surface for free.
- `biome : u32` — biome / material id (or a packed base colour).
- `climate : … ` — regional temperature / moisture / weather (see below).
- material state derived in-shader from the above (snow/ice/water/mud).

**Vertex shader:** generates the grid from `@builtin(vertex_index)` with adaptive
subsample LOD, samples `height`, computes the **normal in-shader** from 4
neighbour heights (central differences → smooth, no skirts, no cracks), projects
**screen-space iso** (height lifts screen-y, so terrain shares the sprites'
space), writes a **spatial iso depth** so the lifted surface self-occludes (its
own depth pass, never mixed with the entity index-depth scheme).

**Fragment shader:** biome base colour, **banded** diffuse lighting (quantised
`n·sun`, pixel-art look matching the sprites), then material layers (later slice).

## Regional climate → materials (the user's model)

Temperature / moisture / weather are **regional fields that follow biome and
blend smoothly between biomes** — the same blend that should govern terrain
colour and vegetation. Climate is then **modulated by height** (lapse rate:
colder uphill → snow line in mountains) and **weather** (rain → puddles + mud;
freeze → ice).

**Derived material layers** (computed in-shader from height + climate, blended,
banded — NOT physical optics):
- **snow** — cold AND (high altitude OR recent precip). Snow line from the
  height×temperature field, blended (no hard ring).
- **ice** — cold AND standing water (frozen puddles/rivers/lakes).
- **water / puddles** — low spots / drainage + rain; small puddles via a detail
  heightmap texture (below). Becomes ice when cold.
- **mud** — wet ground that's been disturbed (near settlements/roads), banded.

**Everything blends.** A single biome-blend field drives terrain colour,
vegetation choice, AND material susceptibility, so biome transitions are smooth
across all three — the world reads as continuous, not tiled.

**Dynamic.** The sim updates the regional climate fields at low frequency
(weather fronts, seasons, day/night temperature). The renderer derives the
material layers per-frame, so puddles form in rain, freeze in a cold snap, snow
creeps down the mountains, mud dries — all from cheap field updates.

## Performance — "all the tricks"

- **Adaptive subsample LOD** in the vertex grid-gen (quad cap). Already in the R2d shader.
- **Precomputed zoom levels / field mip pyramid** — coarse mips of the height +
  climate fields so zoomed-out frames sample cheap low-res data (and read as
  smooth, not aliased).
- **Frustum culling** — chunk the terrain; generate/draw only chunks intersecting
  the camera. Pairs with the mip pyramid for zoomed-out wide views.
- **Detail heightmap textures** — small puddles / ripples / ice crackle as a
  tiling detail texture sampled in the fragment, gated by the water/ice field, so
  fine surface detail costs a texture fetch, not geometry.
- **Shadow-map LOD / cascades** — shadow resolution scales with zoom so zooming
  out never allocates a giant shadow map; cascades for the visible range.
- **Field-change uploads only** — height/biome/climate buffers re-upload only when
  they actually change (deformation, weather tick), not every frame.

## Camera

- **Clamp max zoom-in at 1:1** — never magnify past native pixel-art resolution
  (no blurry super-zoom). Zoom-out bounded by the field mip pyramid / cull range.

## Slice sequence

| Slice | Delivers |
|---|---|
| **T1 — buffer-driven heightfield** (in progress, was "R2d-smooth") | height+colour storage buffers, GPU grid-gen, in-shader normals, banded lighting, own depth pass. Smooth lit relief replaces flat diamonds. |
| **T2 — biome blend** | smooth biome colour/material blending across tile edges; height-aware tinting. The unified biome-blend field. |
| **T3 — regional climate + material layers** | temperature/moisture/weather fields (follow biome, blended, height-modulated) → snow/ice/water/mud layers, banded, dynamic from sim ticks. |
| **T4 — detail textures + camera 1:1** | puddle/ice/ripple detail heightmap textures; clamp zoom-in at native pixels. |
| **T5 — performance** | terrain chunking + frustum culling + field mip pyramid (precomputed zoom levels). |
| **T6 — shadow LOD** | shadow-map cascades / resolution-by-zoom. |
| **T7 — integration** | roads/rivers on the surface (`RenderEdge`), entity foot-z (sprites sit on terrain, shadows land on it). |

## Decisions (locked 2026-06-15)

1. **Climate authority → per-biome base + coarse weather field.** Each biome
   carries baseline temperature/moisture; a low-res, sim-ticked weather field
   (fronts, seasons, day/night) modulates it; height adds a lapse rate (colder
   uphill). Blended everywhere. `climate = blend(biome.temp, biome.moist) +
   weatherField − heightLapse(h)`. (Not static-only; not a full weather sim.)
2. **Material set v1 → snow + water/puddles + ice + mud (all four).** snow =
   cold & (high | precip); water/puddles = low spots/drainage + rain (detail
   texture for small ones); ice = cold & standing water; mud = wet & disturbed.
3. **Detail-texture art** (open) — procedural value-noise in-shader first
   (keyless), authored tiling textures later. Decide at T4.
4. **Sequencing vs merges** — T1 lands independent of the sibling branches;
   T3+ climate/materials benefit once the deformation channel is on main.

## What this supersedes

The committed R2d flat-diamond CPU mesh (`70c72c4`) and its planned skirts are
**superseded** by T1's buffer-driven surface. The GPU pipeline plumbing
(pass structure, view transform, frame integrate) is **kept**; only the mesh
source changes (CPU vertex arrays → GPU grid-gen from field buffers).
