# Canonical Wall Pieces — dial walls back to an 8-bearing piece vocabulary

**Date:** 2026-07-05 · **Status:** SPEC (commissioned by user)
**User direction:** "we have taken the walls too far. dial them back to canonical directions and
perhaps diagonal, then pre-generate the pieces through the same kind of pipeline as buildings,
with the eventual goal of pre-'rendering' them with our img2img path."

## Why (measured, 2026-07-05)

A fresh random-seed boot composes ~234 sprites at runtime (~36s main-thread CPU); **214 of them
are barrier elements** (17.1s). The cause is structural: `chunkBarrierRun` keys chunks on
`JSON.stringify(localRun)`, and `traceRing`'s RDP-simplified rings emit segments at *continuous*
bearings and lengths — so nearly every wall chunk in every world is a unique spec that can never
hit the vendored bundle or another world's IDB cache. Continuous geometry also forecloses the
img2img path: you cannot pre-style an unbounded vocabulary.

## Design

### Keep the round-6 siting intelligence; quantize only the expression

- **Siting stays:** terrain-seeking ray costs (`chooseTerrainRadius`), water snap, per-side
  `defends: open|water|steep`, coverage towers, ditch/killing-field, gate direction commits.
- **Expression changes:** the traced ring is re-emitted as a closed polygon whose every edge has
  a bearing in the **8 canonical directions** (4 cardinal + 4 diagonal) and a length that is an
  **integer multiple of the per-bearing piece length**, with vertices on integer tile coords.

### The piece grid

- Cardinal piece: **2 tiles** along-axis (respects `CHUNK_DEPTH_SPAN_MAX = 2`).
- Diagonal piece: **2 tile-steps** of (±1, ±1) (main diagonal is depth-critical: |dx+dy|·len ≤ 2
  holds at len = √2; anti-diagonal is depth-flat — same 2-step piece keeps ONE vocabulary).
- `MERLON_PERIOD_TILES` divides the cardinal piece and the diagonal piece's along-length is
  handled by phase-0 alignment: segments start on the piece grid ⇒ **merlonPhase is always 0**
  and drops out of the key.
- **Gates snap to piece slots.** A gate occupies whole piece slot(s); the gate piece *replaces*
  the curtain piece (no more `gateCut` boolean subtraction inside chunks) ⇒ `gates` drops out of
  chunk keys entirely. `repairGateHalfEdges` steps in piece units.

### Resulting finite vocabulary (pre-generatable, ~150–250 packs)

`chunk(bearing×8, outwardSign×2, rung material/height/crenellated/hoarded ~5) ≈ 80`
`+ gate/gateframe (8 bearings × width set) + towers (existing tags) + stairs (8) + posts`.
The seeder enumerates the vocabulary **directly** (no world layouts needed for barriers) →
the vendored bundle covers barriers on **every** seed, not just pinned ones.

### Ring tracing (WP-W1 core algorithm)

1. Run the existing smoothed 96-ray trace (unchanged) to get the target radius per bearing.
2. Trace the canonical ring around it: greedy 8-directional walk on the piece grid that stays
   ≥ the building-clearance floor (`coreS[k] + margin`) on every ray and tracks the terrain-
   preferred radius as closely as the grid allows. Closed, simple, ≥ 4 edges.
3. Enclosure invariant is a hard postcondition: every settlement building strictly inside
   (existing tests keep asserting it; they lose only the "arbitrary diagonal" phrasing).
4. Croft rect rings already comply (cardinal); snap their vertices to the piece grid.
   `wall-connections.ts` 2-point walls snap bearing to nearest canonical direction.

### Terrain

Unchanged mechanism, better fit: terrain already terraces UNDER walls
(`barrier-deformation.ts` stepped `level` footings, 4-tile spans). Align footing spans to piece
boundaries so every piece lands flush on its own level step — real curtain-wall coursing.

### What this deliberately gives up

Free-angle organic rings. Walls read as engineered 8-directional circuits (Watabou-style) that
step down slopes on level courses — the user judged the free-angle look "too far".

## Work packages

- **WP-W1 (worldgen):** canonical ring tracer in `enclosure.ts` + gate slot snap + croft/
  connection snap. Contracts (`defense.*`) must pass on both lint seeds. WCV bump.
- **WP-W2 (render):** `chunkBarrierRun` → piece cutter (fixed per-bearing lengths, no gate
  clipping, phase-0 merlons); finite keys; `linear.ts` composes only the 8 rotations. Update
  `parametric-barrier-chunk` + `enclosure` tests to the canonical contract; re-pin goldens.
- **WP-W3 (pipeline):** seeder enumerates the vocabulary; coverage test lays out ≥2 random
  seeds and asserts 100% of bar keys are vendored. Bundle regen (procedural, $0).
- **WP-W4 (deferred — reseed FROZEN):** img2img styling per piece through the building path
  (grey init → flux → chroma-key → quality gates → register), one styled pack per piece.

**Sequencing:** R10 WP-A (off-thread compose workers) lands first — it touches
`parametric-barrier-source.ts` and stays valuable regardless (buildings are 19s of fresh-seed
compose; residual misses become invisible). Then W1+W2 together (one branch — the piece grid is
one contract), then W3.
