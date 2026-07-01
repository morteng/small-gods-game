# Terrain-aware defensive walls — believable medieval fortification

**Status:** spec + in-flight implementation (2026-07-01)
**Motivation (user):** "defensive walls … must point the right way, outward all around;
gates for the roads (perhaps only one gate); the wooden structures they had in conjunction
with walls to help defenders; stairs for defenders to get up on walls, and inside towers.
Also replicate how they used terrain features (rivers, coast, hills) as part of defensive
building. Get this right, believable."

This doc is the investigation ("how did they really do it") + the plan that maps each
authentic principle onto our code (`enclosure.ts`, `linear.ts`, `tower-spec.ts`,
`parametric-barrier-source.ts`).

---

## 1. Investigation — how medieval builders actually did it

### 1.1 Orientation — everything faces the field
- The **crenellated parapet** (merlons = solid teeth, crenels = gaps) sits on the **outer
  (field) edge** of the wall-walk. Defenders stand on the walk, sheltered behind merlons,
  shooting through crenels *outward and down*. The inner edge has at most a low kerb/parados —
  never a second fighting face on a town wall.
- **Arrow-loops and machicolations face out/down.** **Towers project *outward*** beyond the
  curtain so archers can *enfilade* — rake along the wall face at attackers at its very foot.

### 1.2 Wall-walk (allure / chemin de ronde) + access
- A walkway runs along the top behind the parapet. On a palisade it's a raised **timber
  fighting platform** on posts behind the stakes.
- Reached from the **inner** side by **mural stairs**, timber stair-flights/ramps, or ladders
  (ladders let a breached stretch be isolated). Stairs cluster at **gates and towers** — the
  rally points.

### 1.3 The wooden structures that help defenders
- **Hoardings / hourds / brattices** — the key one. Temporary **timber galleries built out
  over the parapet** in wartime, overhanging the outer face. The floor has **openings (murder
  holes)** so defenders drop stones / quicklime / boiling water **straight down the wall base**,
  which a flush parapet can't reach. **Roofed** against plunging fire, carried on beams
  (putlogs) socketed into the wall (the surviving *putlog holes*). The **stone machicolation**
  later replaced them (we already model that as the tower corbel band).
- **Bretèche** — a small box-machicolation projecting over a **gate**.
- **Palisade / stockade** — the village-scale timber wall of vertical stakes on an earth
  rampart, walk behind (already modelled).

### 1.4 Towers — hollow, not solid
- A mural tower is a shell: **floors** joined by a **newel (spiral) stair** or ladders, an
  **arrow-loop** per level facing out, a **door on the inner side** at walk level onto the
  wall-walk, often a basement. It **projects forward** of the curtain for flanking fire.

### 1.5 Terrain-integrated siting — the biggest believability lever
Fortifiers were opportunists: **let nature be the wall.**

1. **Rivers & water (commonest).** A town in a **river bend/meander** gets 2–3 sides defended
   by water; the wall **hugs the bank** and is light there (a river-wall/quay), while the one
   approachable **landward neck** gets the **strongest wall + main gatehouse + most towers +
   a cross-ditch**. **Water-gates** admit boats. A dry **moat is flooded from the river**.
   (Besançon, Shrewsbury, Durham, Toledo, Bern.)
2. **Coast & cliffs.** A settlement on a **headland / sea-cliff** walls only the **landward**
   approach; the cliff/sea face is unassailable → light sea-wall or none. Harbour closed by a
   **mole + chain**.
3. **Hills & ridges.** **Keep / citadel on the highest point** (commands the ground, last
   refuge). Walls **follow the contours**; the **steep side** needs little wall, the **gentle
   approach** gets the gatehouse and concentrated towers.
4. **Marsh / bog / lake.** Natural obstacle — the wall skips it or fronts it with a
   causeway-gate.

> **The rule that ties it together:** *strength ∝ approachability*. The gate, the towers, the
> ditch go on the side the enemy can march up; the water/cliff/steep sides are thin or open.

---

## 2. Current code vs. the target

| Concern | Today | Target |
|---|---|---|
| Outward face | none — thin town wall (th=1) puts merlons on the **centreline**; thick walls symmetric on both edges | parapet+merlons on the **outer** edge only, low inner kerb, real walk between |
| Wall-walk | `walkZ` is only a z-level | a walkable deck reads behind the parapet |
| Stairs | none | inner-side stair flights at gates/corners |
| Hoardings | none | timber overhanging gallery on the outer face of defensive stone walls |
| Towers | solid mass, all-round merlons, no door | project outward, inner door, interior floor + newel stair |
| Gates | opened at **every** road/water/building crossing → many "gates" | one **main landward gate**; water crossings are gaps/water-gates, not gatehouses |
| Terrain siting | naive axis-aligned bbox rectangle; opens where it crosses water | classify each side by **approachability**; fortify weak sides, lighten/skip protected ones |

## 3. Slice plan (each independently verified offline + shipped)

- **A. Outward orientation** — carry an outward normal into the geometry: `centroid` on
  `BarrierRun` (set by `deriveSettlementRing`), `outwardSign` per chunk (set by
  `chunkBarrierRun`); `masonrySeg` builds parapet/merlons on the outer edge + a low inner
  kerb + a clear wall-walk. *The #1 fix; everything else references outward/inner.*
- **B. Wall-walk + stairs** — inner-side stair elements up to the walk at gates/corners.
- **C. Hoardings** — timber cantilevered gallery (roof + floor + murder-gaps) on the outer
  face of crenellated stone walls; a `hoarded?` flag (on by default for town walls).
- **D. Interior towers** — outward projection, inner door, floor, newel stair.
- **E. Terrain-aware siting + one-gate policy** — per-side approachability from the biome/water
  map; weak sides get towers + the main gate, protected (water/cliff/steep) sides get a light
  line or are skipped; single main gate on the primary landward road; (stretch) ditch/moat.

Verification: `scripts/barrier-world-preview.ts` (offline geometry render) for A–D; a
worldgen probe for E; then in-browser grab. Guard rails: `enclosure.test.ts`,
`assetgen-linear.test.ts`, `parametric-barrier-chunk.test.ts`, `barrier.test.ts`.
