# OpenRouter Cost / Latency Optimizations — Design

**Date:** 2026-06-06
**Status:** Design (pre-plan)
**Scope:** One spec, three slices, confined to the LLM provider layer, provider config, and a small settings/HUD addition. Motivated by surveying recent OpenRouter releases (response caching, auto-router `cost_quality_tradeoff`) plus a user request for real-money spend visibility.

## Motivation

Small Gods runs client-side BYOK against OpenRouter. Two recent OpenRouter features and one user concern converge on cost/latency:

1. **Response caching** — identical requests return free ($0, zero tokens) in 80–300ms. Directly cuts spend and latency on repeat narration.
2. **Auto-router `cost_quality_tradeoff`** — a 0–10 knob letting the router pick a model along the cost/quality curve. Offered as an *additive* option, not a replacement for the existing two-tier model-ID seam.
3. **Real-money spend tracking** — a glanceable corner readout of actual USD spent (session / month), for player peace of mind. Caching reduces spend; this makes spend *visible*.

All new fields are optional. Default behavior is unchanged except where called out (NPC backfill + whisper become cache-eligible; a spend chip appears for OpenRouter users).

## Verified API facts (canonical OpenRouter docs, 2026-06-06)

**Response caching** ([docs](https://openrouter.ai/docs/guides/features/response-caching)):
- Enable per-request: header `X-OpenRouter-Cache: true` (`false` disables, overriding presets).
- TTL: header `X-OpenRouter-Cache-TTL: <seconds>`, range 1–86400, default 300.
- Bust: header `X-OpenRouter-Cache-Clear: true`.
- Cache key = API key + model + endpoint type + streaming mode + **SHA-256 of the normalized request body**. Property ordering and presence/absence of optional fields both change the key.
- Hits are **free**: zero tokens, all billable counters reported `0`, no provider rate-limit consumption.
- Response headers: `X-OpenRouter-Cache-Status: HIT|MISS`, `X-OpenRouter-Cache-Age`, `X-OpenRouter-Cache-TTL`.
- Limitations: disabled under account-level ZDR; concurrent identical requests both MISS (no coalescing); entries may evict before TTL under memory pressure.
- Supported endpoints include `/api/v1/chat/completions` (our path).

**Auto router** ([docs](https://openrouter.ai/docs/guides/routing/routers/auto-router)):
- Pass `model: "openrouter/auto"`.
- Config goes in a plugin object:
  ```json
  "plugins": [{ "id": "auto-router", "cost_quality_tradeoff": 7, "allowed_models": ["..."] }]
  ```
- `cost_quality_tradeoff`: integer 0–10 (0 = always most capable, 10 = cheapest).
- Response `model` field reports the actually-selected model (we already capture `data.model`).
- Standard features (tool calling) work with the selected model.

**Usage / cost accounting** ([docs](https://openrouter.ai/docs/cookbook/administration/usage-accounting)):
- `usage: { include: true }` and `stream_options: { include_usage: true }` are **deprecated no-ops**; usage (including cost) is returned automatically on every response. No body change needed for cost — read it from the response `usage`.

## Decisions locked in brainstorming

- **Cache control lives per-call** (a `cache` field on `LLMOptions`), with a single provider-level `cacheEnabled` global kill-switch. Default off per call; callers opt in deliberately.
- **Auto-router is additive**: keep the two-tier model-ID seam; add `openrouter/auto` as a selectable model with a 0–10 slider, choosable per tier.
- **Spend chip**: bottom-left, subtle; shows session + month; click → popover with all-time + call/cache-hit counts; shown only for the OpenRouter provider.

---

## Slice 1 — Response caching (per-call opt-in)

### Types (`src/llm/llm-client.ts`)

```ts
// LLMOptions additions
cache?: boolean | { ttlSeconds?: number; clear?: boolean };

// LLMResponse additions
cacheStatus?: 'HIT' | 'MISS';
```

A truthy `cache` marks the call cache-eligible. The object form carries TTL / clear.

### `OpenRouterProvider.generate()`

- Resolve effective caching: `enabled = !!opts.cache && this.config.cacheEnabled !== false`.
- When enabled, set headers:
  - `X-OpenRouter-Cache: true`
  - `X-OpenRouter-Cache-TTL: <ttlSeconds>` when provided
  - `X-OpenRouter-Cache-Clear: true` when `clear` is set
- Detect hits robustly:
  - Read `resp.headers.get('x-openrouter-cache-status')` if present (best-effort; cross-origin JS only sees it if OpenRouter lists it in `Access-Control-Expose-Headers`).
  - **Fallback (authoritative for us):** on a cache-eligible call, infer `HIT` when `usage.totalTokens === 0` (a hit reports zero usage). A hit also yields `cost: 0` through existing usage parsing, so spend telemetry is correct without the header.
  - Set `response.cacheStatus` accordingly (`'MISS'` otherwise).

### Cache-key stability invariant

Because the body is hashed, **identical logical calls must serialize byte-identically**. Current body is already stable: `model`, `messages`, `max_tokens`, `temperature`, `stop`, `reasoning` are always present; `undefined` fields are dropped by `JSON.stringify`. The plugins array (Slice 2) is emitted **only** for `openrouter/auto`, so non-auto callers' bodies are unchanged.

> **Invariant (must hold for caching to work):** never add a nondeterministic field to the request body (timestamps, random IDs, per-call nonces). A test guards this (see Testing).

### Who opts in (v1)

- `src/game/llm-backfill.ts` (`generateNpcBackfill`) → `cache: { ttlSeconds: 300 }`
- `src/game/whisper-orchestrator.ts` → `cache: { ttlSeconds: 300 }`
- **Not cached:** Fate-brain decisions, Create-panel tool calls (Create-preview is *eligible* but deferred; noted out-of-scope below).

Rationale: backfill returns a cached line only when the prompt is byte-identical, which means nothing in the sim changed (paused/scrubbed re-focus) — the same inner thought is *correct*, not stale. Once the sim ticks, the prompt differs → MISS → fresh narration.

---

## Slice 2 — Auto-router as an additive option

### Types

```ts
// LLMOptions additions
costQualityTradeoff?: number;   // 0–10
allowedModels?: string[];

// OpenRouterConfig additions
costQualityTradeoff?: number;
cacheEnabled?: boolean;         // default treated as true
```

### `OpenRouterProvider.generate()`

- When `effectiveModel === 'openrouter/auto'`, emit:
  ```ts
  body.plugins = [{
    id: 'auto-router',
    ...(tradeoff != null ? { cost_quality_tradeoff: tradeoff } : {}),
    ...(allowed?.length ? { allowed_models: allowed } : {}),
  }];
  ```
  with `tradeoff = opts.costQualityTradeoff ?? this.config.costQualityTradeoff`, `allowed = opts.allowedModels`.
- Non-auto models: **no `plugins` key** (preserves cache-key stability for everyone else).
- `data.model` (actual picked model) is already returned via `OpenRouterResponse.model`.

### Config + tiers (`src/llm/provider-factory.ts`, `src/game.ts`)

- `ProviderConfig` additions: `openrouterCostQualityTradeoff` (chat tier), `openrouterCostQualityTradeoffCapable` (capable tier), `cacheEnabled`.
- `createProvider` maps `openrouterCostQualityTradeoff` → `OpenRouterConfig.costQualityTradeoff` and `cacheEnabled` → `OpenRouterConfig.cacheEnabled`.
- `Game.buildCapableClient` already spreads config + overrides `openrouterModel`; it additionally overrides the tradeoff with the capable value:
  ```ts
  createProvider({ ...config,
    openrouterModel: config.openrouterModelCapable,
    openrouterCostQualityTradeoff: config.openrouterCostQualityTradeoffCapable });
  ```
- Result: each tier can independently be a fixed model **or** `openrouter/auto` with its own knob (e.g. chat→10 cheapest, capable→0 most-capable).
- `migrateDeadModels` is unaffected — `openrouter/auto` is a valid ID, not in `DEAD_MODEL_IDS`.

### Settings UI (`src/ui/llm-settings-new.ts`)

- Add `openrouter/auto` as a pinned, selectable entry in both model pickers (chat + capable).
- Show a 0–10 tradeoff slider for a tier **only when** `openrouter/auto` is selected for that tier; persist into the corresponding `ProviderConfig` field.
- Add a single "Response caching" checkbox bound to `cacheEnabled` (default on) with a one-line explanation.
- Keep the dialog clean/simple, consistent with existing scoped `.sg-theme-dark` styling.

---

## Slice 3 — Real-money spend tracker

### Data: `CostTracker` (`src/llm/cost-tracker.ts`)

A small, framework-free accumulator of real USD spend.

```ts
interface SpendBuckets {
  sessionUsd: number;     // in-memory, resets on reload
  monthUsd: number;       // persisted; auto-rolls when month changes
  allTimeUsd: number;     // persisted
  calls: number;          // session call count (paid)
  cacheHits: number;      // session free-hit count
  month: string;          // 'YYYY-MM' the persisted buckets belong to
}

class CostTracker {
  record(r: { cost?: number; cacheStatus?: 'HIT' | 'MISS' }): void;
  snapshot(): SpendBuckets;
  subscribe(fn: (s: SpendBuckets) => void): () => void;
}
```

- Persistence: localStorage key `small-gods-llm-spend` holds `{ month, monthUsd, allTimeUsd }`. On `record`, if the current calendar month ≠ stored `month`, reset `monthUsd` to 0 and update `month` before adding (all-time keeps accumulating).
- `record`: a `cacheStatus === 'HIT'` (or `cost` of 0) increments `cacheHits` and adds nothing; a paid call adds `cost` to all three USD buckets and increments `calls`.
- Determining "current month": uses real wall-clock (`new Date()`), which is fine here — this is UI telemetry, **not** sim code (the `no-random-in-sim` / determinism rules apply only to `src/sim/`).
- Pub/sub notifies the UI after each record.

### Wiring (`src/llm/llm-client.ts`, `src/game.ts`)

- `LLMClient` gains an optional `onUsage?: (r: LLMResponse) => void` callback (constructor or setter), invoked after each `generate*` resolves.
- `Game` constructs one shared `CostTracker` and wires it as `onUsage` on **both** `llmClient` and `llmClientCapable` (and on rebuild via `applyLlmConfig` / `setClient`). One hook, both tiers, all callers — no per-call-site changes.
- Audit: confirm all LLM calls route through `LLMClient` methods (not raw `provider.generate`). Any raw-provider path is routed through the client or reports to the tracker directly.

### UI: spend chip (`src/ui/spend-chip.ts`, mounted via `src/game/game-ui.ts`)

- A subtle fixed-position chip in the bottom-left of the game container (not `document.body` — respects the embeddable constraint). Uses existing design tokens (muted ink, paper, small type).
- Content: `$0.012 session · $0.21 month` (format to a sensible precision; sub-cent shows more decimals).
- Click → small popover: all-time total, session call count, "N cached (free)".
- Visibility: shown only when the active provider is `openrouter` (the only path with real cost). Hidden for Mock/OpenAI. Re-evaluated when the provider changes (live-apply).
- Subscribes to the `CostTracker`; updates live as calls complete.

---

## Testing

Unit tests (Vitest), mocking global `fetch`:

**Caching (Slice 1)**
- `cache: true` + `cacheEnabled !== false` → request carries `X-OpenRouter-Cache: true`; absent when `cache` unset or `cacheEnabled: false`.
- `cache: { ttlSeconds: 600 }` → `X-OpenRouter-Cache-TTL: 600`; `{ clear: true }` → `X-OpenRouter-Cache-Clear: true`.
- Zero-usage response on a cache-eligible call → `response.cacheStatus === 'HIT'` and `cost === 0`.
- **Body-stability test:** two identical `generate()` calls produce identical serialized request bodies (guards the cache-key invariant).

**Auto-router (Slice 2)**
- `model: 'openrouter/auto'` → `body.plugins` contains `{ id: 'auto-router', cost_quality_tradeoff }` with the resolved value (opts over config); `allowed_models` present only when supplied.
- Non-auto model → no `plugins` key.
- `data.model` from the response is surfaced on `response.model`.
- `buildCapableClient` maps the capable tradeoff (config-level test).

**Spend tracker (Slice 3)**
- `record` of a paid call adds to session/month/all-time and increments `calls`.
- `record` of a hit (cacheStatus HIT or cost 0) increments `cacheHits`, adds nothing.
- Month rollover: stored `month` differs from current → `monthUsd` resets, `allTimeUsd` preserved. (Inject the "now"/month via a parameter or a tiny seam so the test is deterministic without faking `Date` globally.)
- localStorage round-trip (persist + reload).
- `subscribe` fires on `record`.

MockProvider behavior unchanged. Full suite (currently ~1341/1358) stays green.

## Files touched

- `src/llm/llm-client.ts` — `LLMOptions`/`LLMResponse` fields; `OpenRouterProvider` cache headers + auto-router plugins + hit detection; `LLMClient.onUsage`.
- `src/llm/provider-factory.ts` — `ProviderConfig` fields + `createProvider` mapping.
- `src/llm/cost-tracker.ts` — **new**.
- `src/ui/spend-chip.ts` — **new**.
- `src/game.ts` — shared `CostTracker`, `onUsage` wiring on both tiers + on rebuild, capable-tier tradeoff mapping.
- `src/game/game-ui.ts` — mount/destroy the spend chip; show/hide on provider change.
- `src/game/llm-backfill.ts`, `src/game/whisper-orchestrator.ts` — opt into caching.
- `src/ui/llm-settings-new.ts` — `openrouter/auto` option, tradeoff slider, caching checkbox.
- Tests under `tests/unit/` for each slice.

## Out of scope (YAGNI)

- TTS / audio APIs, Model Fusion, image-generation models (awaiting the in-flight Riverflow deep-research report before any asset-gen work).
- `/embeddings` caching, request coalescing, the `/api/v1/generation` async cost endpoint.
- Caching Create-panel preview and Fate-brain calls (eligible later; v1 caches only backfill + whisper).
- Formalizing the existing `reasoning`-via-cast smell in `OpenRouterProvider` (separate cleanup).
- Per-call hard budget caps / spend limits (the chip is informational only in v1).
