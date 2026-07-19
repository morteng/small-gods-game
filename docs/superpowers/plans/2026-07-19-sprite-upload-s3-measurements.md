# Sprite raw-upload (S2) — measurements + S3 atlas/compression decision (2026-07-19)

Branch `sprite-raw-upload`. Companion to
`docs/superpowers/plans/2026-07-19-sprite-prebake-formats-plan.md` (S2/S3), whose
plan doc lives in a sibling worktree — this file is the writable copy of the S3
inputs + recommendation.

## What S2 changed (architecture)

Cache-rehydrated parametric SpritePacks (`packFromPayload` — fed by both the IDB
tier and the vendored bundle, and by the off-thread compose worker) no longer
round-trip albedo/normal/emissive through a 2D canvas. Before, each of those three
maps went `raw bytes → rgbaToCanvas(putImageData) → copyExternalImageToTexture`
purely to premultiply + mint a `CanvasImageSource` identity for `texCache`; the
material map already took the good path (raw bytes → `writeTexture`).

Now all four maps rehydrate as typed arrays:

- **albedo / emissive** — premultiplied in the typed array at rehydration
  (`premultiplyRgba`, a shared 256×256 round-half-up LUT), byte-matching what the
  canvas copy produced to within ±1 (unit-tested).
- **normal / material** — carried raw and UN-premultiplied (normal's alpha is a
  flat-normal flag, material is a DATA map — the premultiplied canvas would zero
  their RGB where alpha is low).
- All four upload via `writeTexture`; `texCache`/`bindCache` key off the backing
  **object identity** (`WeakMap<object>`, RawMap or canvas).

The AI-art library sources and the compose-direct/studio path still produce
canvas-backed packs (`structureResultToPack`) — untouched, so `SpritePack.albedo`
became optional (exactly one of `albedo` / `albedoData` is set). The geometry
ground-shadow mask is the one remaining canvas (out of the four-map scope), now
built in its own try/catch so a canvas-less backend drops only the shadow.

## Measurements (real Chrome, WebGPU, foregrounded tab)

Diagnostics added (behaviour-neutral, retained): `__packRehydrateStats`
(rehydration CPU), `__gpuTexStats` (canvas-vs-raw texture count/bytes + per-frame
entity batch/bind count).

### (b) Entity batches / bind-group switches per frame — UNCHANGED

| | batches = bind-group switches / frame |
|---|---|
| before (canvas path, settled) | **171** |
| after (raw path, settled) | **171** |

The change is upload-path only: bucketing (`buildInstanceBatches`, one bucket per
source-object identity) and the instanced draw-call count are identical. Each
bucket still collapses all instances of one sprite texture into a single instanced
draw.

### (c) Sprite-texture VRAM — total UNCHANGED, split shifts canvas → raw

Textures are `rgba8unorm` at the same crop dims either way, so the technique does
not change total VRAM — it moves bytes from the `copyExternalImageToTexture`
(canvas) path to the `writeTexture` (raw) path.

| | canvas textures | raw textures | canvas MB | raw MB | raw share |
|---|---|---|---|---|---|
| before (canvas path) | 555 | 139 | 154.5 | 14.0 | 8% |
| after (raw path) | 250 | 437 | 67.7 | 41.6 | 38%+ |

(Before = a fully-settled default world ≈ **168 MB** total sprite VRAM; after = a
pinned seed-7 world still mid-compose, so its absolute total is lower, but the
**count shift is the signal**: ~all parametric maps — albedo/normal/emissive that
were 3 canvas uploads/pack — are now raw uploads. The residual 250 canvas textures
are NPC/paperdoll sheets, decorations, AI-art library sprites and the material
exemplar atlas, none of which are on the parametric-cache path.)

### (a) Rehydration CPU — `packFromPayload`

| | ms / pack |
|---|---|
| before (canvas path, early boot, low contention) | ~2.8 |
| before (canvas path, under heavy cold-boot contention) | ~11.9 |
| after (raw path, cold JIT + contention) | ~7.5 |
| after (raw path, JIT-warm) | **~3.67** |

**Important caveat — this metric is not a like-for-like total.** The canvas path's
`putImageData` is a native memcpy and *defers* the premultiply to the later
`copyExternalImageToTexture` (counted in `uploadTexture`, during rendering, and
only for sprites that actually become visible). The raw path front-loads that
premultiply into `packFromPayload` (eager, for every rehydrated pack). So
`__packRehydrateStats` charges the raw path for premultiply work the canvas path
hasn't done yet at that point. An isolated same-machine/same-data micro-bench of
the two rehydration loops (JIT-warm) came out roughly even — raw up to ~2.7× faster
at small crops (canvas is dominated by per-pack `OffscreenCanvas` create/getContext
overhead), tying at ~220² crops on worst-case all-partial-alpha data (real sprites
are hard-alpha, so the LUT fast-paths dominate and raw wins). The LUT drops the
warm per-pack cost from ~7.5 → ~3.67 ms.

**Net CPU:** approximately a wash on visible sprites (both premultiply once on the
CPU — the browser does `copyExternalImageToTexture`'s premultiply on the CPU too);
the raw path additionally **eliminates 3 canvas allocations per pack** (~0.5 MB of
canvas backing store churn per building-sized pack → GC pressure) and the
`copyExternalImageToTexture` driver overhead, and it works under Node/headless
(the old path returned null without a 2D canvas). The one measured cost is that
premultiply is eager (paid for rehydrated-but-never-rendered packs too); bounded
and small.

### Visual parity

Same pinned world (`?genseed=7`), noon (`solarhour=12`): buildings render with
correct normal-mapped directional shading on roofs/walls, AO (material.G) in the
masonry recesses, cast shadows, correct albedo, and clean hard sprite edges (no
premultiply fringing). Trees/rocks lit + contact-shadowed as before. Emissive
window-glow verified at night (`solarhour=0`). Byte-level premultiply parity is
unit-pinned (`tests/unit/sprite-raw-upload.test.ts`, ±1 vs a reference canvas
premultiply); normal/material are now strictly *more* faithful (the canvas path
zeroed their RGB where alpha was low — the very corruption the material map's raw
path already existed to avoid).

## S3 recommendation

### (a) Entity-sprite atlasing — **DEFER**

At 171 buckets/frame the entity pass already issues 171 *instanced* draws (one per
distinct visible sprite texture, each covering all its instances) — not thousands
of per-sprite draws; instancing was the big lever and it is already in. Atlasing
would collapse 171 → a handful of `setBindGroup` switches, but:

- the sprites are wildly variable-sized (NPC 32-ish sheets, trees, 236²-ish
  buildings) → a bin-packer + per-instance UV rewrite, and atlas pages large
  enough to hold building crops waste space on the small ones;
- it breaks the clean per-object `texCache`/`bindCache` identity and complicates
  the streaming compose→cache→upload→incremental-texture pipeline (packs land
  one-at-a-time across boot; an atlas wants them batched);
- the payoff is bounded — 171 `setBindGroup` calls is not obviously the
  bottleneck at 34 fps px1 with terrain/water/shadow passes also running.

Recommendation: **do not atlas now.** Gate it on `__renderProfile` ablation
actually showing the entity pass CPU-encode-bound (draw-call/bind-switch bound); if
it is, atlas only the *homogeneous small* set (NPC/flora sheets) where crops are
uniform and packing is trivial, and leave building crops as individual textures.

### (b) GPU-compressed textures (BC7 / ASTC) — **REJECT for this art**

Total sprite VRAM tops out around **168 MB** on a settled default world. BC7 would
cut albedo ~4× (~42 MB), but:

- the albedo is **palette-quantized pixel art** (Oklab + Bayer4 dither); BC7/ASTC
  are 4×4-block interpolating codecs — they smear the crisp palette edges and turn
  the ordered dither into block mush, a direct hit to the 1:1 pixel-perfect art
  direction;
- normal/material/emissive are **DATA maps** (encoded normal, AO/roughness/metallic,
  self-illum) — block compression corrupts the stored *values*, not just
  appearance; this is exactly why material already avoids the premultiplied canvas.

168 MB is comfortably within budget: the floor hardware (gen-8 iGPU) shares system
RAM, and desktop discrete GPUs have GBs. The number does not scream. If VRAM ever
does become the constraint, the art-safe levers are tighter opaque-bbox crops,
mip-dropping for far LOD, or capping the resident set — **not** block compression
of palette pixel art or of the DATA maps.

## Follow-ups / residuals

- The geometry ground-shadow mask is still a canvas in `packFromPayload` (a small
  alpha mask, only on shadowed building/barrier packs; out of the four-map scope).
  Converting it to raw is a clean future step (the shadow pass reads only alpha and
  already accepts a RawMap source end-to-end).
- Premultiply is eager per rehydrated pack. If boot main-thread time regresses
  measurably on the floor hardware, move it behind the off-thread compose worker's
  payload (premultiply in the worker before it crosses back) — the payload already
  crosses that boundary.
