# Runtime img2img Building Sprites — Design

**Status:** Approved (design), pending spec review → implementation plan.
**Date:** 2026-06-09
**Branch:** `feat/img2img-building-sprites`

## Goal

Buildings render in-game as real pixel-art sprites **generated from their own 3D
manifold geometry**: the grey massing render `composeStructure` already produces
becomes the **img2img init image** sent to an OpenRouter image model, which
returns a finished isometric pixel-art building sprite. Generation runs live in
the browser, is cached so each unique building is paid for **once, ever**, and
falls back to the existing grey parametric sprite whenever art isn't (yet)
available.

This restores — and supersedes — the deleted PixelLab `init_image` /
`renderMassingToImage` path. It is *not* a new idea: the project's standing
intent is "generated sprites based on the 3D models."

## Feasibility (validated 2026-06-09)

A throwaway spike (`tmp/or-img-spike.mjs`, `tmp/or-img-proxy-test.mjs`) proved
the whole runtime path end to end:

- **Model:** `google/gemini-2.5-flash-image` ("nano-banana"). The
  `…-flash-image-preview` slug 404s; enumerate image models via
  `GET /api/v1/models` filtered on `architecture.output_modalities` ∋ `'image'`.
- **Request:** chat-completions, `modalities: ['image','text']`, content
  `[{type:'text',text:prompt}, {type:'image_url',image_url:{url:dataUri}}]`.
- **Response:** image at `choices[0].message.images[0].image_url.url` (base64
  data-URI). `usage.cost` reports real USD.
- **Cost / latency:** ~**$0.039/image**, ~**10 s**.
- **Quality:** the grey cottage and barn massings became faithful, consistently
  styled half-timbered pixel-art sprites (same silhouette, roof pitch, chimney,
  door; transparent background; centered).
- **Dev proxy works:** the request was verified through
  `/api/llm/openrouter/api/v1/chat/completions` (the existing
  `vite-plugins/llm-proxy.ts`), which injects the key server-side and forwards
  the large base64 body + image response. Browsers cannot call OpenRouter
  directly (CORS — see `gotcha-llm-browser-cors`), so the proxy is the dev path.

## Locked decisions

| Decision | Choice |
|---|---|
| Backend | OpenRouter image model (`google/gemini-2.5-flash-image`) |
| Run location | Runtime, live in-browser, cached to IndexedDB |
| Trigger | Auto on world load, behind spend cap + toggle |
| Variety | **Identical per blueprint** (cache by blueprint identity) |
| Prompt | Auto from `buildingBrief`/`to-brief.ts`, **per-model-family** preamble |
| Spend cap | **$2 / session**; on cap, stop generating, keep grey fallback |
| Toggle | Setting `liveBuildingArt`, **default ON** |
| Fallback | Grey parametric sprite while generating / on any failure |

## Data flow

```
blueprint (entity.properties.blueprint.rb)
  → toGeometry(rb)                      [existing]
  → composeStructure(spec) → grey       [existing; the init image]
  → greyToPng(grey, size, bbox)         [PNG bytes for the API]
  → buildingImagePrompt(rb, model)      [model-aware text prompt]
  ── img2img via OpenRouter ──►  pixel-art PNG
  → crop to opaque bbox + downscale to footprint native width  [sprite canvas]
  → drawIsoBuildingSpriteGenerated      [existing blit]
```

While a building's art is missing/in-flight/failed, the renderer draws the
existing grey `ParametricBuildingSource` sprite (and `flat` as the last resort).

## Components

Each unit is small, single-purpose, and independently testable.

### 1. `src/llm/openrouter-image-client.ts`
- `generateBuildingImage(opts: { initPng: Uint8Array; prompt: string; signal?: AbortSignal }): Promise<Blob>`
- Builds the chat-completions request (model, `modalities`, text + image_url
  content). `baseUrl` comes from `provider-factory` (dev → proxy, prod → direct
  BYOK), mirroring the text `OpenRouterProvider`.
- Parses `choices[0].message.images[0].image_url.url` → `Blob`. Throws a typed
  error on non-200, missing image, or malformed data-URI.
- Optional `onUsage?: (usd: number) => void` hook fed from `usage.cost` for the
  CostTracker.
- **Model id** lives in one exported constant (`BUILDING_IMAGE_MODEL`).

### 2. `buildingImagePrompt(rb, model)` — **model-aware** (in `src/assetgen/`)
- Pure function: `ResolvedBlueprint + modelId → string`. A shared brief-derived
  **core description** (subject, era, materials, door, traits from `toBrief`) is
  wrapped by a **per-model-family preamble** chosen via `imageModelFamily(model)`
  (`gemini` | `openai` | `generic`): Gemini-image models want natural-language
  "redraw the reference as…" editing instructions; OpenAI gpt-image models want
  concise descriptive generation prompts. Adapt per *family*, not per exact id.
- Deterministic in `(rb, model)`. The **model id is part of the cache key** (§3/§4)
  so switching models never serves stale cross-model art. The selected model
  comes from one source — `BUILDING_IMAGE_MODEL` today, a settings model-picker
  later — and threads into both this builder and the image client.

### 3. `src/render/generated-building-art-source.ts`
- `GeneratedBuildingArtSource` mirroring `ParametricBuildingSource`'s
  `peek(e)/warm(e)/clear()` contract, so it slots into render-context the same way.
- `keyOf(rb) = ART_RECIPE_VERSION + model + hash(JSON.stringify(rb))` — model in
  the key so switching models doesn't serve stale art; prompt is derived from
  `(rb, model)` so it needn't be hashed separately.
- `warm(e)`:
  1. If `!enabled` → cache `null`, return.
  2. In-memory cache hit → return.
  3. IndexedDB hit → decode blob → opaque-crop + downscale → in-memory sprite.
  4. Miss: if `spendGuard.allows()` is false → cache `null` (grey fallback);
     else render grey init (`composeStructure`), call the image client, persist
     the blob to IndexedDB, then crop+downscale → in-memory sprite. Any
     failure → cache `null` + one-time `console.warn` (never throws on frame path).
- `peek(e)` → in-memory `SpriteCanvas | null`.
- **Sizing:** the returned image (~1024²) is cropped to its opaque bbox and
  downscaled so its opaque width equals the footprint's native diamond width;
  the existing `drawIsoBuildingSpriteGenerated` (centre/bottom anchor) then
  blits it 1:1. `imageSmoothingEnabled=false` to preserve crisp pixels.

### 4. IndexedDB cache (`src/render/generated-art-cache.ts`)
- Dedicated object store: `key → { blob: Blob; recipeVersion: string; model: string; prompt: string; targetWidth: number; createdAt: number }`.
- Persistent across reloads; shared across worlds (dedup by blueprint identity).
- `get(key) / put(key, blob, meta) / clear()`. A version mismatch on
  `ART_RECIPE_VERSION` is treated as a miss (and may be pruned).
- Reuses the project's existing IndexedDB helper style (see
  `project-game-persistence` / `project-generated-asset-library`); no new lib.

### 5. Spend guard + CostTracker (ported)
- Cherry-pick `src/llm/cost-tracker.ts` + `src/ui/spend-chip.ts` (+ their tests)
  from the stale `feat/openrouter-cost-latency` branch and re-integrate against
  current `main`.
- The image client's `onUsage` increments the tracker; the **text** narration
  client is also wired to it (it already has an `onUsage` seam on that branch).
- `SpendGuard`: `allows() = enabled && tracker.sessionUsd < SESSION_CAP_USD` with
  `SESSION_CAP_USD = 2`. Cache hits cost nothing and never consult the guard.

### 6. Settings toggle (`liveBuildingArt`, default ON)
- Add a `createToggleRow('Generate building art (uses your OpenRouter key)',
  'liveBuildingArt', true, opts)` to `createGameSettings` in
  `src/ui/settings-unified.ts`, plus a one-line cost note and the spend chip.
- Persisted with the other game settings; read at world-load to set the source's
  `enabled`. (A dedicated "proper settings screen" is a **separate** upcoming
  spec; this lands the control in the current panel.)

### 7. Render dispatch
- `pickBuildingSource` gains a `generated` source, ordered
  **`generated → parametric → flat`** (the v2-gated baked `asset` path remains
  but is effectively dormant). `render-context.ts` gets
  `resolveGeneratedBuildingArt(e)` (peek → else warm → null), exactly like the
  parametric resolver. `game.ts` owns one `GeneratedBuildingArtSource` and clears
  it on world reset.

## Error handling

Every failure path — toggle off, over cap, network error, non-200, no image in
response, malformed data-URI, jsdom (no canvas), abort — resolves to a cached
`null`, so the renderer falls back to the grey parametric sprite. The frame path
never throws and never blocks (`warm` is fire-and-forget; the sprite swaps in on
the first frame after it resolves).

## Scope / non-goals (v1)

- **Dev-focused via the proxy.** Production BYOK image-gen has the same
  unresolved browser-CORS question as *all* OpenRouter calls; out of scope here.
  The toggle exists and defaults ON, but the prod request path is a follow-up.
- **Identical-per-blueprint only** — no per-instance variety, no N-variants.
- **Buildings only** — not NPCs, vegetation, or decorations.
- **No "proper settings screen"** — that is its own brainstorm→spec next; here we
  only add one toggle + the spend chip to the existing panel.
- **No author-time baking** — generation is runtime; we do not regenerate
  `public/asset-library/` blobs in this work.

## Testing

Unit tests only; **no real API calls** in the suite.

- `buildingImagePrompt`: deterministic output; includes era/materials/kind;
  stable across runs (cache-key safety).
- `openrouter-image-client`: request body shape (model, modalities, content
  parts) via a mocked `fetch`; response parsing (image extraction, `onUsage`);
  typed errors on non-200 / missing image / bad data-URI.
- `generated-art-cache`: get/put/clear; version-mismatch = miss (fake IDB).
- `GeneratedBuildingArtSource`: peek/warm with a mocked client + fake cache —
  cache hit skips the client; miss under cap calls it once; over cap / disabled
  caches null; failure caches null; identical blueprints share one key.
- `pickBuildingSource`: ordering `generated → parametric → flat`.
- `SpendGuard`: blocks at the cap; cache hits don't consult it.
- Ported `cost-tracker` / `spend-chip` tests pass against `main`.

## Manual verification (post-build)

With the dev server up and the toggle on: New World → buildings start grey, then
swap to generated pixel-art within ~10 s each; the spend chip climbs and stops at
$2; reload → sprites load instantly from IndexedDB (no spend). Captured via
`scripts/e2e-smoke.mjs` / `__debug.grab()`.
