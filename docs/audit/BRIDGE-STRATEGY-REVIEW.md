# Bridge Strategy Review

## What the player sees

> "the fucking bridges are placed wrong! to the side of the actual place they should be to properly cross a river. that kind of thing"

Deck beside the water instead of across it. Roads walk past the bridge. Three fix rounds (WCV 115b, 117a, 122) moved the aggregate bank→road distance from 1.40 → 1.37 tiles — zero decks went from missing the channel to crossing it. This document explains why.

---

## 1. Verified: How bridges are sited today

### Step 1 — The road routes first

`map-generator.ts:561` calls `buildRoadGraph()` (road-graph.ts), which for each `Connection` between POIs calls `walkRoad()` (road-walker.ts). The walker is an A* pathfinder over the tile grid.

**The walker's water truth is the tile grid only** (road-walker.ts:328):
```typescript
const isWaterAt = (x: number, y: number) => WATER_TYPES.has(tiles[y][x].type);
```

The walker has no reference to `getRenderWaterMask`, no import of `render-water.ts`, and no knowledge of the connectome river ribbon. It operates purely on `tiles[y][x].type`.

**Costs for water crossing** (road-walker.ts:72-73, 80-81):

| Water type | Tile type | Cost per cell | Meaning |
|---|---|---|---|
| Bridgeable | `river`, `shallow_water` | 5 | Cheap — bridge here |
| Standing | `water`, `deep_water`, `ocean` | 45 | Expensive — go around |
| Forbidden (no autoBridge) | any | 1000 | Impassable |

Where the walker steps into bridgeable water, it records the cell as a bridge cell. After each segment, `applyEdge()` (road-graph.ts:242) stamps `t.type = 'bridge'` onto those cells. The tile grid now says "bridge" where the walker crossed water.

**The tile river is already widened** — but to the ANALYTICAL half-width only (map-generator.ts:393):
```typescript
const r = Math.max(0.5, halfWidths[i] ?? REACH_CARVE[reach.klass].halfWidth);
```

Range: 0.5–3.2 tiles per side. This is the hydrology ribbon's half-width, with NO margin.

### Step 2 — The crossing detector runs on the road graph AFTER the road is settled

`map-generator.ts:716-717` calls `detectCrossings()` (detect-crossings.ts), passing `isWater: renderWaterAt, bridgeAt: renderWaterAt`.

`renderWaterAt` (map-generator.ts:416-419) uses `getRenderWaterMask()` (render-water.ts:55-68):
```typescript
return (x: number, y: number): boolean => {
  if (ribbon && ribbon[y * W + x] !== WaterType.Dry) return true; // ribbon FIRST
  return WATER_TYPES.has(map.tiles?.[y]?.[x]?.type ?? '');        // tile fallback
};
```

The render mask checks the connectome ribbon FIRST — a completely independent `Uint8Array` derived from the water network + reach half-widths. The tile fallback only fires when the ribbon says Dry.

**THE KEY: the render-water ribbon is WIDER than the tile river** (src/render/gpu/render-water-mask.ts:66):
```typescript
const r = Math.max(0.5, (halfWidths[i] ?? REACH_CARVE[reach.klass].halfWidth) + 0.7);
```

Added **+0.7 tiles per side** beyond what the tile stamp uses. So the rendered channel is 1.4 tiles wider than what the walker bridged.

| Reach class | Tile half-width (walker bridges) | Render half-width (paints) | Discrepancy |
|---|---|---|---|
| Brook | 0.5 | 1.2 | **+0.7** |
| Stream | 0.9 | 1.6 | **+0.7** |
| River | 1.4 | 2.1 | **+0.7** |
| Major river | 3.2 | 3.9 | **+0.7** |

The render water mask is ALSO immune to tile overwrites — it checks its own memoised Uint8Array, not the tile grid. So a `bridge` tile stamp on the grid has no effect on the render mask. A cell that was a river tile, got stamped `bridge` by the walker, is STILL wet in the render mask.

### Step 3 — The crossing detector tries to extend the run over render-wet cells

`detectCrossings()` (detect-crossings.ts) iterates each edge's polyline. For each contiguous run of `bridgeCells`, it:

1. Seeds the run from the walker's bridge cells (detect-crossings.ts:209-212)
2. Extends over adjacent render-wet cells (lines 213-223, bounded by `MAX_RUN_EXTEND = 5`)
3. Finds banks on the SMOOTHED ribbon (the road the game draws, not the raw staircase)
4. Seats banks by scanning outward from the wet run until dry ground (banksOnRibbon, lines 156-200)

### Step 4 — Banks are seated on the smoothed centreline

`banksOnRibbon()` (detect-crossings.ts:106-154) walks the smoothed Catmull-Rom ribbon (`smoothCenterline` of the raw polyline, with the `edge.pins` bow-reconciliation). It:

1. Scans the ribbon for render-wet cells near the crossing (±RIBBON_SCAN_PAD_TILES = 3)
2. Walks outward from the wet interval in 0.25-tile steps until dry ground (cap RIBBON_BANK_MAX_TILES = 6)
3. Returns the dry cell points — these are the "bank cells" (the shared opening)

If the walk runs off the ribbon's end while still wet (a road node sited IN the water), `nearestDry()` (detect-crossings.ts:186-213) tries to find the nearest dry cell by walking along the outward tangent, then falling back to an expanding ring search. If nothing is in reach, the crossing DECLINES.

### Step 5 — The bridge is built from those bank cells

`buildBridgeObject()` (crossing-structures.ts) takes the `CrossingSpec` (including `bankCells` and `axis`) and composes a deck, arches, abutments, and ancillary structures.

If `spec.bankCells` is present, it uses them as the definitive bank anchors (crossing-structures.ts:107-109). If absent (a declined crossing), it falls back to `spec.banks` — the raw walker polyline, snapped outward to dry ground via `snapBankToLand` (detect-crossings.ts:317-320, gated on `opts.isWater` which IS set at map-generator.ts:716).

---

## 2. Root-cause verdict

### The "causality is backwards" hypothesis — PARTIALLY SUPPORTED

The brief's suspicion — that bridges are retrofitted to wherever the road got wet, rather than the road being routed to a pre-sited crossing — is a real architectural constraint, but **it is not the primary cause of the measured defects**. The primary cause is a **width mismatch between the two water truths**, amplified by Catmull-Rom smoothing at bends.

### The primary cause: render-water channel is wider than what the walker bridges

**File:line:** `src/render/gpu/render-water-mask.ts:66` vs `src/map/map-generator.ts:393`

The road walker bridges a river at the analytical half-width (0.5–3.2 tiles per side, no margin). The render-water mask paints a channel **+0.7 tiles wider per side** (1.2–3.9 tiles). So:

- **The bridge deck sits on the narrow tile-river** — the walker's bridge cells end at the analytical half-width.
- **The renderer paints a wider channel** — the visible water extends 0.7 tiles past the last bridge cell.
- **The detector seats banks at the wider mask's edge** — but the bridge was already committed to the narrower crossing site.

The +0.7 margin is CONSCIOUS and documented at `src/render/gpu/render-water-mask.ts:62-64`: "the water SURFACE is drawn per-fragment from the continuous channel SDF (fringe cells whose CENTRE is dry still get water quads), but the bed colour is stamped per whole cell here. Without the margin those fringe cells kept full undarkened GRASS under the drawn ribbon — a green rim along every stream." It is a render-only visual artifact; the tile stamp was never adjusted to match.

This explains ALL three defect classes:

**Class 1: 6 decks span no visible water** (bridge over dry ground)
The walker bridged a tile-river cell that the render ribbon never widens to or meanders past. The +0.7 margin doesn't help because the bridge cells happen to be at a turn where the smoothed ribbon shifted away. Or: `banksOnRibbon` returned `no-wet-interval` (decline), and the fallback to raw polyline banks planted the deck on dry ground where the render mask sees no water. The deck sits on cells the render mask says are dry — water is a tile away.

**Class 2: 4 decks with both abutments IN the water**
The walker's bridge cells end at the narrow analytical half-width. The render mask extends 0.7 tiles past. So cells the walker considered "bank adjacent" (1 tile from the last bridge cell) are still inside the render water. `banksOnRibbon` walks outward from the wet interval on the RIBBON — but the ribbon's last dry cell may still be inside the render mask when the river is wider than the walker bridged.

**Class 3: 15 decks with a bank ≥2 tiles off the road ribbon** (the "successes")
The smoothed Catmull-Rom centreline corner-cuts at bends, shifting the ribbon up to ~1.5 tiles off the raw polyline. `banksOnRibbon` seats the bank on the smoothed ribbon — correct in principle — but the road was walked on the raw polyline. At a bend, the smoothed ribbon sits INSIDE the corner, while the raw road cells sit OUTSIDE. So the bank (on the smoothed ribbon) is 1-2 tiles from the nearest ribbon cell the road actually paints over. The bank is ON the smoothed ribbon, but the smoothed ribbon is NOT where the road walked — that cell was never visited by the walker. The road then has to bend BACK to reach the deck, or the deck sits off to the side.

### The "causality is backwards" hypothesis — when it bites

The ordering IS a problem, but not for the reason the brief suspected. The issue is:

1. **The road route is already committed** before any bridge geometry is considered. If the walker threads a bend at the water's edge, the smoothed ribbon corner-cuts across it, and the bridge (seated on the smoothed ribbon) ends up beside the water, not the road. Re-routing the road to meet the bridge is impossible at that point — the tiles are already carved.

2. **The walker cannot know the render-water width** because it reads only the tile grid. Where the tile river is 1 tile wide (a brook at analytical half-width), the walker lays down 1-2 bridge cells. The render ribbon is 2.4 tiles wide. The detector then extends the run by `MAX_RUN_EXTEND = 5` tiles — but the extension is along the polyline, not perpendicular to the channel. If the crossing is diagonal to the grid, the extension runs ALONG the channel instead of ACROSS it, and the extra cells lie in the water rather than covering the width.

3. **A pre-sited crossing would let the walker route THROUGH a known dry-bank pair** instead of detecting one after the road is already carved. It would also let the walker PRICE the crossing correctly — approaching a pre-sited bank cell on the correct side is cheap, bypassing it is expensive.

### Why the three previous fix rounds didn't work

- **WCV 115b** (smooth the centreline through pins) — correct fix for the right problem (the smoothed ribbon and the raw polyline disagree at bends), but it only addressed the geometry of the bridge-ribbon relationship, not the width mismatch. Banks moved closer to the road, but the channel was still wider than the deck.
- **WCV 117a** (nearestDry rescue) — fixed one narrow case (a road node in water), but the wider problem of banks seated at the narrow half-width while the render paints a wider ribbon was untouched.
- **WCV 122** (detection after centreline pins) — addressed detection running before pins existed. Moved some banks by 0.03 tiles mean. The road was still committed to the wrong path before the bridge code ran.

---

## 3. The plan — staged into independently shippable slices

### Slice 1: Make the walker price margin cells at bridge cost *(low risk, high impact)*

**Target:** Stop the fundamental width mismatch.

**What changes:**
- Add a `renderWaterAt?: (x:number, y:number) => boolean` option to `RoadWalkerOptions` (road-walker.ts).
- When supplied, use it **alongside** the tile-grid `isWaterAt` for a margin-cell test: any cell where `renderWaterAt(x,y)` is true but `!WATER_TYPES.has(tiles[y][x].type)` is a margin cell (tile-dry, render-wet). Price it at `bridgeCost x horiz` (same as `river`/`shallow_water`).
- Importantly: **do NOT substitute** the render mask for the tile-type check. The render mask's public API (`getRenderWaterMask`, src/world/render-water.ts:47-57) returns only a `boolean` (wet/dry), not a `WaterType`. Using it "instead of" the tile grid would lose the bridgeable-vs-standing-water distinction — a lake crossing would cost 5/cell instead of 45/cell, and roads would bridge lake arms.
- This is a PURE additive change: absent the option, byte-identical behaviour. Present, the walker bridges the margin cells at bridge cost, extending its deck to the FULL visible channel.

**Why this works:** The walker's bridge cells already cover the analytical half-width. The margin test adds the cells between the analytical half-width and the wider render boundary — the exact +0.7 tile per side that was missing. The detector's post-hoc run extension (`MAX_RUN_EXTEND`) becomes unnecessary for the width case.

**Acceptance criterion:** After this slice, on any seed, `deckCellKeys` (the cells the deck covers) is a SUPERSET of the render-wet cells on the deck axis between the two bank cells — no deck ends 0.7 tiles short of the render-water edge. This is measurable with existing code: `deckCellKeys` (crossing-openings.ts:119), `getRenderWaterMask` (render-water.ts:47), and the `bridge.seating` lint pattern (connectome-diagnostics.ts:602).

**What might break:** The walker becomes more conservative about water crossings on the margin. A road that hugged the tile-river edge might now read as standing-in-water and take a longer path. Road routes shift on any seed whose roads hugged the analytical half-width edge. The existing test suite (7000+ tests) captures these changes; expect some visual diffs on roads near rivers.

**Risk:** Low. The walker's cost model is unchanged; only the predicate that feeds it broadens.

### Slice 2: Forbid the walker from crossing water except at pre-sited crossing sites *(medium risk, architectural)*

**Target:** Fix the ordering — crossing site first, then road.

**What changes:**
- New module `src/world/connectome/ford-siting.ts`: pure function taking `(WaterNetwork, elevation: Float32Array, width, height) -> PooledCrossingSite[]`. Scans each reach for sites where:
  - Channel half-width is narrow (<=1.0 tile — a fordable width)
  - Both banks are firm (elevation drop from bank centre to channel edge <= threshold, no cliff)
  - The reach is locally straight (meander displacement small at that point)
  - The approach slopes are gentle (terrain doesn't rise steeply from the bank)
- Each `PooledCrossingSite` carries: `{ reachId, cellA: [x,y], cellB: [x,y] }` — the two bank cells.
- These sites are injected as waypoints into the `Connection.waypoints` array BEFORE `buildRoadGraph` runs.
- `buildRoadGraph`'s `waypoints` support already exists (road-graph.ts:279-294): for each waypoint, it walks `points[i] -> points[i+1]` as a separate A* segment. The crossing bank cells become intermediate A* goals.
- The walker (road-walker.ts) should treat ALL non-bridge-site water as impassable: the walk needs a `waterCrossings: Set<string>` option, and any water cell not in it is treated as `!autoBridge` (cost 1000, effectively forbidden).

**Why this works:** The road now passes THROUGH the pre-sited crossing's bank cells. The detector (which currently finds crossings from the road graph) is not needed for siting — it becomes a verification-only pass. Banks are guaranteed dry by the siting function. The road arrives at exactly the right approach.

**Acceptance criterion:** After this slice, 0 crossings have either bank >0.5 tiles off the nearest drawn road ribbon at the bank cell (measured at the bank cell's centre against the smoothed ribbon). The 6 decks on dry ground and the 4 decks in water must be eliminated entirely.

**What might break:**
- The water-crossing-set inversion: every existing road that crosses a river must now cross at a pre-sited ford. If the siting pass misses a reach (no ford-worthy site found), that road segment becomes impossible to route — the walker will return `cells: []` (no path found). The fallback: allow the walker to bridge ANY water at any cell when no crossing site was found for that reach, gated on a `allowAnyWater: true` override.
- The siting pass adds ~10-50ms to worldgen (one scan of the water network + elevation reads — negligible against the ~2 min total).
- Road routes shift on every seed with a river crossing, as they now pass through predetermined bank cells rather than wherever the walker happened to ford.

**Risk:** Medium. The water-network is available before roads (verified at map-generator.ts:375 vs 561). The injection into `Connection.waypoints` is straightforward. The walker's water-crossing-set logic is new code. The fallback path (allowAnyWater) prevents softlock but produces legacy-style crossings — the siting function must be aggressive enough to find crossings that all seeds can plausibly use. Measurement of crossing coverage across the 6 reference seeds is essential before shipping. The existing roads test suite must cover the new code path.

### Slice 3: Orient the bridge to the channel, not the road *(low risk, targeted)*

**Target:** Fix the remaining yaw/diagonal defects.

**What changes:**
- The `CrossingSpec.axis` already comes from the smoothed centreline's secant across the channel (detect-crossings.ts:246-250). This is correct.
- But the axis is only set when `banksOnRibbon` succeeds (ok: true). When it declines, the axis falls back to the chord of two independently-snapped raster points (crossing-structures.ts:115-116) — which a bend rotates into a diagonal under a perpendicular road.
- Fix: when `banksOnRibbon` declines but the crossing is still built (fallback path), derive the axis from the WATER NETWORK's channel direction at the crossing point rather than from the road's raw polyline. The water network has the river's centreline direction at every cell (the reach is a polyline with known tangent at each point).

**Acceptance criterion:** After this slice, no deck's yaw deviates >15 deg from the perpendicular to the river channel at the crossing midpoint (measured against the water network centreline). Currently this is violated for any declined crossing.

**What might break:** Nothing — the siting change is purely geometric and only affects the fallback path. The normal path (banksOnRibbon succeeds) is unchanged.

**Risk:** Very low. Small code change in `buildCrossingStructureEntities` or `buildBridgeObject`.

### Slice 4: Eliminate the dual water truth *(long-term, foundational)*

**Target:** One water mask, one width, everywhere.

**What changes:**
- Unify the tile river stamp (map-generator.ts:393) and the render-water mask (src/render/gpu/render-water-mask.ts:66) to use the SAME width formula. Historically the +0.7 margin existed because "the water SURFACE is drawn per-fragment from the continuous channel SDF (fringe cells whose CENTRE is dry still get water quads)." If the tile stamp also used the same +0.7 margin, the walker would bridge at the full render width, and the render mask and walker would agree.
- OR: Move the walker off the tile grid entirely and onto the render-water mask for water crossing decisions. The render mask is already a fast `Uint8Array` lookup — replacing the tile-type check with a render-mask check is `O(1)` and the mask is already computed.

**Acceptance criterion:** The walker's bridge cells match the set of cells that are water in the render mask along the walked path, within 1 cell tolerance. No bridge cell is on a render-dry cell, and no render-wet cell on the walked path lacks a bridge tile.

**What might break:** This is the highest-risk change. Every consumer of the tile grid's water types (settlement growth, pathfinding, brushes, building placer) reads `tiles[y][x].type` — changing the tile grid's water stamp width affects ALL of them. Moving the walker only would avoid that cascade, but then the walker decides to bridge cells the tile grid says are dry — and the stamp logic in `buildRoadGraph` (`applyEdge`) writes `bridge` on those cells anyway (it checks `WATER_TYPES.has(t.type)` at road-graph.ts:249). So the tile grid already cedes to the walker's decision. Unifying the width formula is the safer approach.

**Risk:** Medium-high due to number of consumers. Not needed if Slices 1 and 2 together eliminate the defect classes.

---

## 4. What I could not determine

### The `nearestDry` fallback's real-world failure rate

The brief notes that 4 of 46 decks have both abutments in water. `nearestDry` (detect-crossings.ts:186-213) is the code path that should prevent this: when the outward step walk runs off the ribbon end while still wet, it snaps to the nearest dry cell along the tangent, then falls back to an expanding-ring search. I could not verify whether those 4 failures are `nearestDry` returning `undefined` (the ring found no dry cell in `RIBBON_BANK_MAX_TILES = 6`), or `nearestDry` finding a cell but the cell is still inside the render-water mask (the ring found dry-land-but-still-inside-the-+0.7-margin), or the branch being taken at all versus the main `walk()` returning `{ reason: 'cap' }` (the water never cleared within 6 tiles). **INFERRED** — the measurement data shows mean bank->road distance 1.37 tiles, which is well within the 6-tile cap, so these are likely not cap failures but ring-search failures on wide rivers where the channel exceeds 6 tiles from channel centre to dry ground. A run against the bridge-seating lint on those specific seeds would confirm.

### Why the walker was never given the render-water mask

The historical rationale for the +0.7 margin in `src/render/gpu/render-water-mask.ts` is documented there: "fringe cells whose CENTRE is dry still get water quads." But the walker was developed before the render mask existed, and the gap was never closed. No design document or comment explains the choice. **INFERRED** — it was never a deliberate mismatch, just two subsystems built at different times.

### Ford siting on steep alpine rivers

The siting function for Slice 2 needs to distinguish a genuine ford (gentle banks, level ground) from a narrow gorge (steep banks, no dry approach). I could not verify what the elevation field looks like at a typical mountain brook's edge — the `valleySlope` computation (river-network.ts:244-258) provides the gradient ALONG the channel, not ACROSS it. A cross-section slope computation from the elevation field is feasible but I could not pre-compute the results across multiple seeds to know the expected distribution. The siting function would need tuning.

### Whether `bridgeCells` extension (`MAX_RUN_EXTEND = 5`) ever saves a crossing

The extension in detect-crossings.ts:213-223 grows the bridge run over adjacent render-wet road cells, bounded to 5 tiles. On a reach where the render-water margin is 0.7 tiles per side, the total extra width is 1.4 tiles. The extension should easily cover that. But the extension walks in TILES along the POLYLINE — if the river runs diagonally across the grid, the 1.4-tile width becomes a ~2-cell diagonal step, which the 5-tile extension should still cover. The fact that 10 decks still have a defect after WCV 122 suggests the extension is either never reached (the render-wet cells in the extended region are NOT adjacent along the polyline — the meander shifts the ribbon sideways), or the extension attaches to the wrong side (it extends along the polyline into open water on one side and onto land on the other). **INFERRED** — the extension walks along the polyline, which at a bend meanders the river, not widens it. The extra cells are along the shore, not across the channel. A `MAX_RUN_EXTEND` of 5 along the polyline at a 45 deg crossing covers 3.5 tiles of additional cross-channel width — enough for the 0.7 margin. But if the polyline runs parallel to the shore for a stretch (a road along a riverbank), the extension marches down the bank instead of across the channel. This needs a run-time trace to confirm.

---

## Summary

| Root cause | File:line | Impact |
|---|---|---|
| Walker bridges narrow analytical half-width, render paints +0.7 wider | `map-generator.ts:393` vs `src/render/gpu/render-water-mask.ts:66` | Primary: explains all three defect classes |
| Catmull-Rom corner-cut shifts smoothed ribbon 1-1.5 tiles off walked path at bends | `detect-crossings.ts` (full banksOnRibbon path) | Secondary: class 3 (bank >=2 tiles off road) |
| Crossing is retrofitted to where the road got wet, not the road directed to a crossing | order: map-generator.ts:561 (roads) -> 716 (crossings) | Architectural: prevents pre-siting fixes |

| Slice | What | Risk | Acceptance | Breaks? |
|---|---|---|---|---|
| 1 | Walker prices margin cells (tile-dry, render-wet) at bridge cost, alongside tile grid (NOT instead of — render mask returns boolean, not WaterType) | Low | Deck cells superset of render-wet cells on axis, measurable with deckLineCells + getRenderWaterMask | Road routes shift on margin-adjacent seeds |
| 2 | Pre-site crossings from water network; road passes through them via waypoints; other water crossings forbidden | Medium | 0 decks with bank >0.5 tiles off road ribbon | Every seed with a river crossing reroutes; fallback needed |
| 3 | Derive fallback axis from channel direction, not raw polyline | Very low | No deck yaw >15 deg from channel perpendicular | None (fallback path only) |
| 4 | Unify tile stamp and render-water widths | Medium-high | Walker bridge cells = render-wet cells on walked path, +/-1 cell | Tile water stamp changes affect many consumers |

### Recommended first step

Ship **Slice 1** alone. It is the smallest change that attacks the actual measured cause, it is pure additive (absent the option, byte-identical), and if the measurement data is correct it should eliminate the ~0.7-tile-per-side gap that I believe is the primary defect. After Slice 1, re-run the 46-deck measurement across the 6 reference seeds. If the deck-span-water metric moves from 0 to >20, the hypothesis is confirmed and Slice 2's pre-siting can wait for the full architectural rewrite. If it doesn't move, the primary cause is NOT the width mismatch but the road being at the wrong bend — and Slice 2 becomes the priority.

---

*Reviewed by: scout A (road router/water mask analysis), scout C (pre-siting feasibility), adversarial verifier (attacked 7 load-bearing claims, refuted 1 — render mask returns boolean not WaterType — leading to corrected Slice 1 design). Scout B (banksOnRibbon trace against defect classes) timed out mid-investigation; the bridge-over-dry-ground and both-abutments-in-water analyses are based on direct code reading of detect-crossings.ts rather than a live trace.*