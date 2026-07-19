# Sprite pre-bake + format efficiency round — plan (2026-07-19)

**Goal:** every fresh install (web or desktop dev build) boots with ~zero runtime sprite
compose, and the sprite byte path from disk → GPU is as cheap as we can honestly make it
without hurting the 1:1 pixel-perfect art direction.

**Survey basis:** full pipeline audit 2026-07-19 (agent report; key facts inlined below so
this doc stands alone).

## Current reality (verified)

- Pre-bake EXISTS: `scripts/seed-parametric-sprites.ts` composes headlessly under
  Node/tsx and writes the vendored bundle `public/data/parametric-sprites/v34/`
  (190 packs, 28 MB, deflate-raw shards of raw RGBA — no PNG, material map raw).
  Runtime tiering: memory → IDB → vendored bundle → compose
  (`src/render/parametric-sprite-cache.ts`, `vendored-sprite-bundle.ts`).
- **Gap 1 (box):** plant (`plt`) cache keys are derived in headless *Chromium*
  (Playwright + dev server) because V8 transcendental results differ Node↔Chromium
  (28/48 plant specs diverge). Building/barrier keys are Node-safe. So the seeder
  can't run pure-Node on ci-eph without mis-keying plants.
- **Gap 2 (coverage):** cold default-world boot queues ~376 compose jobs vs 190
  vendored packs — roughly half still compose at runtime on a fresh machine.
  `__spriteCacheMissedKeys` records exactly what misses.
- **Gap 3 (formats):** rehydration pushes albedo/normal/emissive through a canvas
  `putImageData` round-trip purely for premultiply, then `copyExternalImageToTexture`;
  the material map already takes the better path (raw bytes → `writeTexture`).
  GPU side: one uncompressed `rgba8unorm` texture per sprite map, no atlas, no
  entity-sprite mips, no compressed formats.

## Slices

### S1 — seeder on ci-eph + coverage sweep (branch `sprite-prebake-round`)
1. Investigate the 376-vs-190 miss set: which namespaces/keys, and whether specs are
   genSeed-dependent (if per-seed spec variation makes the key space unbounded,
   coverage strategy must enumerate spec *generators*, not observed keys).
2. Make the seeder runnable on the box: preferred = Playwright-capable container
   image via `ci-on-server.sh --image=` (flag exists on `dev-build-epic`, cherry-pick
   5fdfc004) + dev server inside the container for plant keys; alternative (evaluate,
   don't gold-plate) = deterministic transcendental shim in plant spec generation
   (costs an ART bump — likely reject).
3. Sweep coverage to ~zero cold-boot misses on the default world across ≥2 genSeeds;
   verify with `verify-sprite-bundle` + a real-browser boot on the Mac reading
   `__spriteCacheStats` / `__spriteCacheMissedKeys`.
4. No ART bump for pure coverage growth (same recipe, more packs).

#### S1 findings (2026-07-19 — investigation)

**The ~186 miss set is almost entirely PLANTS, and it was a seeder enumeration bug —
not a coverage-breadth problem.** Runtime `ParametricPlantSource` composes, per species:
`FLORA_VARIANTS` (=3) seeded silhouettes (v0..v2, seed `floraVariantSeed(kind,v)`) PLUS a
bare-crown slot (variant-0 skeleton, `branch_plant.bare=1`). The seeder baked only
`synthesizeBlueprint(kind)` (seed = `hashKind`) — which matches NEITHER runtime variant-0
(seed **0**, `??` keeps 0) for 50/60 species, NOR any higher variant, NOR bare. Measured:

- runtime requests **199** unique `plt` keys (60 presets × {v0,v1,v2,bare}, deduped from 240);
- old seeder produced **60** `plt` keys, only **10** of which a runtime client ever asks for
  → **189 plant packs cold-composed** on every boot (variant-0 seed mismatch = 50/60 alone).
- `prewarmAll` warms variant-0 of ALL 60 presets at the loading screen (so 50 miss there),
  the rest warm lazily as the camera meets flora / snow (bare).

Plants are **world- and seed-INDEPENDENT** (preset-derived), so enumerating the true variant
set fully covers them on ANY seed. Fix: seeder now enumerates v0..v2 + bare with the exact
`floraVariantSeed` the runtime uses (Node + Chromium passes both).

**Are building/barrier specs genSeed-dependent? YES — strongly.** Building blueprints are
per-INSTANCE seeded (`building-placer` `instSeed()` = `poiSeed ^ imul(++seq, …)`, `poiSeed`
derived from the genSeed), and a fresh boot uses `seed = Date.now()` (`bootstrap-world.ts`;
only `?genseed=N` pins it). Measured over 5 seeds (`--plan`, default.json):

| ns  | per-seed keys        | union(5) | in ALL 5 | cumulative union growth |
|-----|----------------------|----------|----------|-------------------------|
| bld | 56,60,54,46,36       | 136      | **11**   | 56→95→117→133→136       |
| bar | 75,56,74,62,94       | 131      | **19**   | 75→95→111→119→131       |

Only ~11 `bld` / ~19 `bar` keys are universal; the union keeps growing with each seed (no
convergence at 5). So **per-key pre-bake of buildings/barriers for arbitrary `Date.now()`
seeds is unbounded** — a real first visit's world shares almost nothing with any pre-baked
seed. Widening the seed set (the author already measured +200 bld/+234 bar / ~55 MB for one
extra seed) buys real first visits ~nothing and only bloats the Pages artifact. Quantizing
the `instSeed` jitter into a finite key space is a compose-recipe-semantics change (ART bump
+ full reseed) — out of scope, rejected for this slice.

**Coverage decision (S1):** fully enumerate plants (seed-independent, kills the 189-pack miss
set on EVERY boot); keep bld/bar at the pinned seed 12345 (covers the canonical dev/e2e/
`?genseed=12345` boot to ~0 compose). Real random-seed first visits still compose their
world's ~50 bld + ~65 bar — irreducible without a boot-seed pin (product change) or the
rejected quantization. No ART bump (same recipe, more/correct packs).

#### S1 box-seeder proof + a workflow gotcha

Ran the WHOLE seeder on ci-eph in the Playwright image and byte-verified it against a
Mac run:

```
./scripts/ci-on-server.sh \
  --run='vite --port 3033 & wait-for-ready; npx tsx scripts/seed-parametric-sprites.ts; kill vite' \
  --out=public/data/parametric-sprites \
  --image=mcr.microsoft.com/playwright:v1.60.0-jammy
```

Box worldgen 16s + compose 31s (16-vCPU); output identical to the Mac reseed — same
330 keys, same meta, **same shard SHA-256s** (compose is IEEE-deterministic across
Node/Linux + macOS, plant keys from Chromium 148 both sides). Needed: `--no-sandbox`
on the headless key browser (root in the container), and NO named inner function in
`page.evaluate` (esbuild's `__name` helper is undefined in the page).

**GOTCHA (box, native modules):** `ci-on-server.sh` caches `node_modules` on the box
keyed on the lockfile hash ALONE, reused across `--image=`. The seeder run's first
`npm ci` (in the Playwright image) built the native `canvas` module for THAT image's
node ABI; the subsequent default-`node:22-bookworm` test run reused it, and the ABI
mismatch made jsdom's `getContext('2d')` return null → `tests/dom/pause-banner`
failed with `Cannot read properties of null (reading 'setTransform')` (green in
isolation on the Mac; failed even ALONE on the box). Fix: `./scripts/ci-on-server.sh
--clean` then a fresh run rebuilds `canvas` for node 22 → full suite green
(4833/4833). Durable fix (future): key the box node_modules cache on image too, or
run the seeder in its own REMOTE_DIR.

### S2 — raw-upload rehydration (branch `sprite-raw-upload`)
1. Baseline numbers FIRST: per-pack rehydration CPU (`packFromPayload`), entity batch
   + bind-group counts per frame, estimated sprite VRAM.
2. Kill the canvas round-trip: premultiply albedo/normal/emissive in typed arrays at
   rehydration and upload all maps via `writeTexture` (the material-map path,
   generalized). `texCache` identity keying moves to the RawMap object.
3. Scope: parametric pack path first; AI-art library decode second only if clean.
4. After: re-measure, confirm visual parity (a render catches what assertions don't).

### S3 — atlas / compression decision (report, not code)
From S2's measurements: recommend for/against entity-sprite atlasing with numbers.
Standing position: GPU-compressed formats (BC/ASTC) are art-hostile for palette-
quantized pixel art — reject for albedo unless VRAM numbers scream.

### Ties to dev-build epic
The vendored bundle lives in `public/` → desktop builds inherit it. Once S1 lands,
`dev-build.sh` builds carry near-zero-compose boots to invited testers.

## Non-goals
- No paid generation (parametric compose is free; AI-art reseed stays frozen).
- No ART_RECIPE_VERSION bump unless geometry/recipe actually changes.
- No atlas implementation this round — decision only.
