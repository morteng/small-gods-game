# Span structures follow the polyline — terrain-following stairs & multi-segment bridges

**User direction (2026-06-26):** *"go through the code for stairs and bridges. research similar
solutions online — how can we improve?"* → after research + analysis, *"yes"* to: spec a plan and
start on the **shared spline-follow core**, then the structure-specific pieces.

Continues the stairs/bridges epic
(`2026-06-26-parametric-stairs-bridges-from-connectome-spec.md`, G3/G4/G5 shipped) and the
`RoadSpan` unification (`src/world/connectome/road-span.ts`, shipped `5095666`).

## The finding (code recon + 2026 external research)

Both structures already pop out of the connectome and render as parametric grey massing. But each
**throws away the road's actual curved centerline** (`RoadEdge.polyline` — the spline we already
have) and instead picks two endpoints, snaps the whole structure to a single cardinal
(`cardinalOf`/`axisOf`), and emits **one** element at **one** terrain height. That single decision
is the root of the biggest defect class for *both*:

| Defect | Stairs | Bridges |
|---|---|---|
| Diagonal road → cardinal-snapped, visually misaligned | ✓ | ✓ |
| One static terrain lift → sinks/floats mid-run | ✓ (`liftElev` at foot) | ✓ (`liftElev`=max bank) |
| Long climb / wide river handled as ONE element | ✓ (1 flight, rest of climb unhandled) | ✓ (1 deck, pier-count only) |
| No switchbacks / no multi-arch bays | ✓ (landing part orphaned) | ✓ (arch part orphaned) |

**2026 practice converges on spline-driven modular instancing** (Unreal PCG 5.5+, Houdini arch-
bridge tool, commercial bridge kits): a structure *follows a curve*, and modular pieces (arch bays,
piers, treads, landings) are **instanced along the spline at sampled points**, each piece riding the
sampled ground; straight approach sections at the ends, the span/arched part in the middle.

**Engine constraint (verified):** there is **no per-entity rotation** and `liftElev` is a **single
scalar per entity** (`entity-draw-list.ts:200`, `terrain-lift.ts:72`, `iso-building.ts:71` — no
yaw). So "follow the curve + ride terrain" is *necessarily* **multi-entity instancing**: a sequence
of short cardinal-oriented pieces, each with its own `liftElev`. This is exactly the segmented-
SpritePack design the G3/G5 spec already chose — we just make the SITING walk the polyline.

## Approach — a shared `sampleSpanSegments` core, both structures instance per-segment

Add the path-follow core to `road-span.ts` (the shared start/stop vocabulary): walk a polyline
sub-path and chunk it into **segments**, breaking on a cardinal-direction change OR a max length, so
a curved/zigzag road becomes a run of short cardinal pieces (the iso-correct way to climb a
diagonal), and a long straight climb becomes stacked flights with implied landings between.

```ts
interface SpanSegment {
  from, to: SpanPoint;        // tile endpoints (the lower end is `from` after orientUphill)
  dir: 'north'|'south'|'east'|'west';   // cardinal of from→to (each piece's own bearing)
  runTiles: number;           // straight-line length of this segment
  fromElev, toElev: number;   // sampled normalised elevation at each end
  riseM: number;              // |Δelev|·reliefM
}
sampleSpanSegments(path: SpanPoint[], opts:{ elevAt, reliefM, maxSegTiles }): SpanSegment[]
```

### Slice 1 — shared core + retrofit STAIRS ✅ (shipped `5095666`, `6a0dbb7`)
- `sampleSpanSegments` in `road-span.ts` + unit tests (chunking, direction-break, elevation).
- `stair-structures.ts`: replace the "one flight per steepest window" siter with **one flight per
  over-grade segment** along the polyline. Each segment that exceeds its class walkability grade
  (and clears `MIN_RISE_M`) gets a `stair_flight` placed at its foot tile, `dir`=segment cardinal,
  `liftElev`=render elev at the foot, treads fitted to *that segment's* run+rise. Consecutive
  over-grade segments form a continuous stepped climb; a direction change is a natural switchback/
  landing; flat stretches break the run. Fixes diagonal-snap + static-lift + long-climb for stairs.
- Keep `usedTiles` dedupe; keep `cellBlocked` foot check (extend to each segment foot).
- Bump `WORLD_CONTENT_VERSION` (entity output changes). Re-pin any golden. Visual verify on a steep
  world (`__debug.grabFile`).

### Slice 2 — retrofit BRIDGES ✅ (shipped `60401ef`, `5aa062f`)
**2a — geometry fixes (`60401ef`).** Fixed the EW-deck **parapet** layout (it was hardcoded for an
ns span, capping an ew deck's short ENDS instead of lining its long sides — verified by reading the
geometry, locked by a new orientation test). Derived pier **batter** from the crossing material
(masonry tapers hard with a cutwater feel; timber piles stand near-vertical) instead of a flat 0.15.

**2c — arches wired (`5aa062f`).** The `arch_span` part was orphaned (builder computed `arches`,
nothing instantiated them → stone bridges were a flat slab on piers). Now arches pop out of the
connectome end to end: `crossing-builder` emits one `arch_span` node per bay, `realize-crossing`
lays them at the bay midpoints between piers (new `'arch'` category), `crossing-structures` spawns a
`bridge_arch` entity sized to the bay and as deep as the traffic width. A single arch spans a brook
bank-to-bank (packhorse bridge); a long masonry span marches a row of them. `solidArch` gained an
optional **yaw** so the Π-frame springs ALONG the deck's travel axis (ns decks turn it 90°; default
0 keeps existing geometry byte-identical — golden unchanged). `WORLD_CONTENT_VERSION 17→18`. Verified
live: 7 arched crossings; deck+arch orientation tracks per crossing, arch fills its bay.

**2b — multi-segment deck bays: DEFERRED to G6 (aqueduct/viaduct), with rationale.** A river
crossing's deck is a *straight, level* bank-to-bank surface — segmenting it into bays adds visible
seam risk for marginal gain. Per-segment terrain-lift (the "approach ramp" win) only pays off on a
long *sloped* span, which is aqueduct/viaduct territory (G6), not a simple river bridge. The
"marching modular pieces along the span" outcome the research identified is already delivered by the
**arch bays** (2c). The shared start/stop vocabulary is honored: the deck rests on its two bank
anchors and deck/arch orient through the shared `road-span` quantizers. Revisit when a long sloped
deck (aqueduct) actually needs to follow terrain.

### Slice 3 — polish (later)
- Approach/abutment end-segments (straight ramp from road grade to deck/first-tread), per the
  Houdini "straight approach, arched middle" rule. **Low payoff** — the road's own surface carve
  already eases grade into the structure foot; revisit only if a render shows a visible step.
- Elastic landing entity (wire the orphaned stair `landing` part) at switchback turns. **NOT a
  clean orphan-wire (finding 2026-06-26):** `sampleSpanSegments` emits *contiguous* segments, so at
  a switchback the upper flight's foot tile IS the lower flight's head tile — there is no spare tile
  between them, and `usedTiles` already claims it. A correct landing needs the flights *shortened*
  to reserve a dedicated turn tile (a real siting redesign, not a part-wire). Combined with
  switchbacks being rare in grade-minimizing worldgen, this is deliberately deferred until a
  reproducible steep-switchback test world exists to verify against.

## Critical files
| Concern | File |
|---|---|
| Shared span vocabulary + new path-follow core | `src/world/connectome/road-span.ts` |
| Stair siting (Slice 1) | `src/world/connectome/stair-structures.ts` |
| Bridge siting (Slice 2) | `src/world/connectome/crossing-structures.ts`, `realize-crossing.ts` |
| Parts (orphans to wire) | `src/blueprint/parts/stair.ts` (landing), `bridge.ts` (arch/batter) |
| Wiring | `src/map/map-generator.ts` (Siting stairs / crossings) |
| Version gate | `src/core/content-version.ts` |

## Verification
- `npm test` green (new `sampleSpanSegments` tests; stair/crossing/road-span suites; re-pin golden).
- `tsc --noEmit` clean.
- Visual (decisive): steep world, clear IDB `small-gods-saves`, `__debug.grabFile` — a diagonal
  steep road climbs as a stepped run that *follows* the road and rides the slope (no cardinal
  billboard, no tower into the air); a wide river gets segmented deck + regular piers.

Branch: continue on `feat/parametric-stairs-bridges`. Not pushed without explicit ask. Commit
explicit paths.
