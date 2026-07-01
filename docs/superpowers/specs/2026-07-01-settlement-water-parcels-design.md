# Settlements as Water-Partitioned Land Parcels — Design

**Status:** design / brainstorm (2026-07-01). Origin: user — *"why do we always end up with towns and fortifications spanning rivers? would they not have kept to one side of a river?"* → *"we need a holistic system how to achieve this?"*

**Thesis.** Settlements straddle rivers because **no stage of worldgen holds a shared model of which land the settlement occupies**. Placement, wards, walls, and crossings each re-derive geometry from raw tiles and none of them agree about banks. The fix is not a reject in `fitsAt` — it is to introduce that shared model (a **land-parcel graph**, water-partitioned) and make every stage read it. A river then becomes a *first-class boundary the settlement is organized around*, not an accident the wall papers over.

---

## 1. Verified root cause (2026-07-01)

Two systems generate independently and never consult each other:

1. **Rivers are topographic and settlement-blind.** `generateHydrology(fields, config)` (`terrain/hydrology.ts:70`) takes only elevation + config — no POI input. Runs at `map-generator.ts:178`, before `placeSettlement` (`:292`). Water tiles exist when buildings place, but…
2. **Placement ignores rivers.** Centre is the authored POI position (`building-placer.ts:294`). Buildings scatter in a radius; the only water gate is `fitsAt` (`building-placer.ts:475`) rejecting a footprint *on* a water tile (`footprintOnTerrain` vs `BUILDABLE_TERRAIN`). **Grass on the far bank is buildable and passes.** `siteFitness` (`site-fitness.ts:137`) scores prominence/sun/shelter/flatness — **no water/bank term**. So buildable land on both banks → dwellings on both banks.
3. **The wall encloses the whole straddling cluster.** `traceRing` (`enclosure.ts:171`) casts rays from the *centroid of all buildings*; if buildings straddle, the ring spans the river (only opening a gap where the line crosses water). It has no "primary bank" concept.

Correct single-bank logic *exists* but is dev-only and unwired: `site-studio.ts:67` (`riverside()`, commented "straddle the river"). Worldgen has no equivalent.

**Conclusion:** the building cluster is the upstream culprit; the wall merely inherits it. Fix belongs at the shared spatial model that placement consumes.

---

## 2. The primitive — a settlement land-parcel graph

At siting, compute the **developable area** partitioned by water into **parcels**:

- **Parcel** = a connected component of non-water, in-reach land (flood-fill over the tiles the placer already sees, using `WATER_TYPES`/`BUILDABLE_TERRAIN` from `core/constants.ts` / `settlement-plan.ts`).
- **Home parcel** = the component containing the settlement centre `(cx,cy)`.
- **Adjacent parcels** = other components within reach, tagged with the **crossing points** where they come within a short hop (candidate bridge/ford sites).
- Computed **once** and **persisted on the settlement plan** — every downstream stage reads it, none re-derives.

This is a connectome layer, not a rivers special-case: it is the scale-free "developable ground, partitioned by barriers" model. It composes with [[project-unified-world-connectome]], slots into [[project-establishments-site-connectome]], and embodies [[project-spatial-coordination-epic]]'s "one shared spatial authority" thesis (cf. `OccupancyGrid`).

```ts
// src/world/settlement-parcels.ts  (Slice 1 ships computeHomeParcel; graph fields follow)
interface LandParcel { id: number; cells: Set<string>; centroid: {x:number;y:number}; }
interface SettlementParcels {
  home: LandParcel;                 // the centre's bank — the only owned parcel by default
  adjacent: LandParcel[];           // across-water components in reach
  crossings: { from:number; to:number; at:{x:number;y:number} }[];
}
```

---

## 3. The rule — a settlement owns parcels; it annexes across water only via a crossing

- **Default: own the home parcel only** → single-bank town, automatically. Placement restricted to owned parcels.
- **Growth annexes an adjacent parcel only after a crossing is placed** (bridge/ford) — the real historical sequence (town → bridge → suburb). No crossing, no far-bank buildings.

---

## 4. Every stage reads the parcel model (holistic consumption)

| Stage | Today | With parcels |
|---|---|---|
| Placement (`building-placer.fitsAt`) | rejects footprints *on* water only | require footprint cells ∈ owned parcels |
| Site fitness (`site-fitness.ts`) | no water term | (optional) penalize/forbid off-parcel |
| Wards (`settlement-plan.assignWards:713`) | radius bands | label lots by parcel → far-bank ward = "bridge ward" |
| Enclosure (`enclosure.traceRing`) | one ring over all buildings | **one ring per owned parcel**; gates at crossings; river is the moat |
| Crossings (`connectome/crossing-builder.ts`) | independent | the sanctioned links between parcels |

---

## 5. Slices (each ships value; determinism preserved — same rng draw order)

- **Slice 1 — Parcel model + single-bank placement.** `computeHomeParcel(cx,cy,tiles,reach)` (4-connected flood-fill over non-water, bounded by reach); `fitsAt` requires the footprint inside the home parcel. Degenerate mask (centre on water / no water near) ⇒ no restriction (behaviour-preserving). *This alone kills river-straddling* — the wall follows for free (it encloses the now single-bank cluster). `WORLD_CONTENT_VERSION` bump. **← implement now.**
- **Slice 2 — Persist the parcel graph + per-parcel enclosure.** Stash `SettlementParcels` on the plan; `deriveSettlementRing` runs per owned parcel; gates land at crossing points.
- **Slice 3 — Bridge-gated annexation + bridge-wards.** Growth (`settlement-growth-system`) annexes an adjacent parcel only after a crossing; `assignWards` labels the far-bank ward; ring per parcel joined by the bridge.

**Non-goals (now):** rerouting rivers around settlements (rivers stay topographic); moving authored POI centres onto banks (siting anchor unchanged); multi-parcel cities beyond one bridge-ward (Slice 3+).

---

## 6. Risks / edge cases

- **Diagonal leak across a 1-tile river.** Use **4-connectivity** for the fill so a thin diagonal river can't leak the mask to the far bank (conservative: a genuine 1-tile diagonal isthmus reads as separate — acceptable, keeps to one bank).
- **Reach too tight → fewer buildings.** Bound the fill generously (`reach = radius + 8`, clamped to map) so same-bank fallback-spiral lots aren't rejected.
- **Centre on water** (POI on a lake): flood-fill yields empty → skip the check (don't break placement).
- **Determinism:** the mask is a pure function of `(tiles, cx, cy, reach)`; it only *filters* candidates, never reorders rng draws → snapshot/replay identical for water-free sites; byte-identical for any site with no reachable water.

---

## 7. Cross-links

[[project-unified-world-connectome]] (parcel graph = a connectome layer) · [[project-establishments-site-connectome]] (scale-free site layer) · [[project-spatial-coordination-epic]] (one shared spatial authority) · [[project-parametric-defensive-walls]] (`enclosure.ts` consumer, Slice 2) · [[project-connectome-world-layout]] (crossings) · [[project-river-crossings-generative-sites]] (`crossing-builder.ts`, Slice 3).
