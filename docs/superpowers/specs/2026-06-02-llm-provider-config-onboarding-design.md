# LLM Provider Config + Onboarding — Design Spec

**Date:** 2026-06-02
**Status:** Approved (brainstorming)
**Goal:** Let a player set their OpenRouter key and pick models from inside the game, have that take effect immediately, and meet new players with a welcome modal that invites a key (or lets them skip). Add a capable second-tier model slot (plumbing only) and stop DeepSeek delimiter tokens leaking into narration.

---

## Context / what already exists

The provider layer is **already built** and must be reused, not rebuilt:

- `src/llm/llm-client.ts` — `LLMProvider` interface, `MockLLMProvider`, `OpenAIProvider`, and a solid `OpenRouterProvider` (retries, 401/404/429 handling, cost extraction, `HTTP-Referer`/`X-Title` headers).
- `src/llm/provider-factory.ts` — `ProviderConfig`, `createProvider(config)`, `loadProviderConfig()` (reads `localStorage['small-gods-llm-provider']`, falls back to env key, else mock), `saveProviderConfig(config)`, `getProviderDisplayName(type)`.
- `src/ui/llm-settings-new.ts` — `createLLMSettings()`: a full form (provider select, model select, API-key input, max-tokens, temperature, **Save** + **Test**). It reads/writes config through the factory. **Does not** accept or fire a save callback.
- `src/ui/settings-unified.ts` — mounts `createLLMSettings()` as an "LLM" tab. `SettingsOptions` declares an unused `onLLMConfigChange?: (config: OpenAIConfig) => void` hook.
- `src/game/game-ui.ts` — a `⚙ LLM` toolbar button toggles the unified settings panel.
- `src/game.ts` — at construction builds `provider = createProvider(loadProviderConfig())`, `this.llmClient = new LLMClient(provider)`, and passes `client: this.llmClient` into `LlmBackfillService` (game.ts:178–183).

**Two facts that shape the work:**

1. `LlmBackfillService` already receives the real configured client. The `CLAUDE.md` "LLM backfill is stubbed — hardcodes `MockLLMProvider(100)`" note is **stale** (the service only falls back to mock when no client is passed; game.ts always passes one). This spec includes correcting that note.
2. The provider is built **once** at construction. Saving new settings writes localStorage but never rebuilds `this.llmClient`, so changes need a page reload today. Closing that gap is the core of this work.

### The model catalog is stale

`OPENROUTER_MODELS` in `llm-settings-new.ts` lists 2024-era models (gpt-4o-mini, claude-3-haiku, deepseek-chat, gemini-flash-1.5). Verified-live OpenRouter IDs (fetched 2026-06-02, `/api/v1/models`, prices USD per 1M prompt/completion):

**Fast / cheap (Tier 1 — NPC backfill, <200 ms target):**
| ID | $/1M in | $/1M out | Notes |
|----|--------:|---------:|-------|
| `google/gemini-2.5-flash-lite` | 0.10 | 0.40 | **Default** — clean JSON, no delimiter leak |
| `deepseek/deepseek-v4-flash` | 0.10 | 0.20 | Cheapest; **leaks `｜DSML｜` delimiter tokens** — needs the filter |
| `google/gemini-2.5-flash` | 0.30 | 2.50 | A notch up |

**Capable (Tier 2 — "key moments" planning aid, infrequent):**
| ID | $/1M in | $/1M out | Notes |
|----|--------:|---------:|-------|
| `anthropic/claude-sonnet-4.6` | 3.00 | 15.00 | **Default** — strongest narrative/reasoning |
| `deepseek/deepseek-v4-pro` | 0.44 | 0.87 | Cheap capable option |
| `google/gemini-2.5-pro` | 1.25 | 10.00 | Large-context option |

Each tier dropdown also offers a **"Custom model ID…"** entry that reveals a free-text field, so any model not in the curated list still works without a code change.

---

## Scope

In scope (all three the user asked for):
1. **Tier-1 polish** — refresh the catalog, make Save apply live (no reload), port the DeepSeek delimiter-token guard.
2. **Two-tier config** — a "capable model (key moments)" slot stored in config and a client built ready for use. **Its invocation is deferred** to Track 4 (Fate).
3. **First-run welcome modal** — invites a key, or skip to Mock.

Out of scope (deferred): actually *calling* the capable model (Track 4 / Fate); local / non-OpenRouter providers beyond what already exists; live model-list fetching (a curated list + custom-ID field covers it).

---

## Design

### 1. Config shape (`provider-factory.ts`)

Add one optional field to `ProviderConfig`:

```ts
openrouterModelCapable?: string;   // Tier-2 "key moments" model
```

`loadProviderConfig()` defaults it to `'anthropic/claude-sonnet-4.6'` when constructing a fresh OpenRouter config. `saveProviderConfig` is unchanged (it serializes the whole object). Tier-1 stays `openrouterModel` (default → `'google/gemini-2.5-flash-lite'`, updated from the stale `'openai/gpt-4o-mini'`).

### 2. Model catalog + capable dropdown + custom-ID (`llm-settings-new.ts`)

- Replace `OPENROUTER_MODELS` with the curated **fast-tier** list above; default selection `google/gemini-2.5-flash-lite`.
- Add a second dropdown, **Capable model (key moments)**, populated from the **capable-tier** list; bound to `openrouterModelCapable`; default `anthropic/claude-sonnet-4.6`. Visible only when provider is OpenRouter (same `updateVisibility` rule as the model row).
- Each dropdown gets a trailing `Custom model ID…` option. Selecting it reveals a sibling text input; its value overrides the dropdown when non-empty. On load, if the saved model isn't in the list, the custom field is pre-filled and the dropdown set to custom.
- The DeepSeek fast option's label notes it needs no extra setup (the filter is automatic): `DeepSeek V4 Flash (cheapest)`.

### 3. Live-apply via save callback

`createLLMSettings()` gains an options arg:

```ts
export function createLLMSettings(opts?: { onSave?: (config: ProviderConfig) => void }): LLMSettingsHandle
```

The existing **Save** handler, after `saveProviderConfig(config)`, calls `opts?.onSave?.(config)`.

Thread it through:
- `settings-unified.ts` — `createUnifiedSettings` passes its `onLLMConfigChange` down: `createLLMSettings({ onSave: (c) => opts.onLLMConfigChange?.(c) })`. Retype `onLLMConfigChange` from `OpenAIConfig` to `ProviderConfig` (the honest type).
- `game-ui.ts` — where it constructs the unified settings, forward a new `cb.onLLMConfigChange`.
- `game.ts` — implement `onLLMConfigChange: (config) => this.applyLlmConfig(config)`.

`Game.applyLlmConfig(config: ProviderConfig)`:
```ts
private applyLlmConfig(config: ProviderConfig): void {
  this.llmClient = new LLMClient(createProvider(config));
  this.llmBackfill.setClient(this.llmClient);
  this.llmClientCapable = config.openrouterModelCapable
    ? new LLMClient(createProvider({ ...config, openrouterModel: config.openrouterModelCapable }))
    : null;
}
```
- Add `setClient(client: LLMClient)` to `LlmBackfillService` (replaces `this.client`).
- Add `private llmClientCapable: LLMClient | null = null;` to `Game`, built at construction the same way and on every save. **It has no caller yet** — a documented Track-4 seam. A one-line comment marks it.
- `createProvider` throws if an OpenRouter key is missing. `applyLlmConfig` wraps the build in try/catch: on failure it logs a console warning and leaves the previous client in place (so a bad save can't break a running game). `mock` type always succeeds.

### 4. Delimiter-token guard (`src/llm/filter-provider-tokens.ts`)

Port pikkolo's `filterProviderTokens` verbatim (it's a pure `(string) => string`). Apply it inside `OpenRouterProvider.generate`, to `content` immediately after extraction and **before** `JSON.parse`, so leaked `｜DSML｜tool_calls>` / `<|tool_calls_begin|>` / ASCII `_tool_calls>` runs reach neither narration nor the delta JSON.

```ts
const content = filterProviderTokens(data.choices?.[0]?.message?.content ?? '');
```

Source to mirror (keep comments):
```ts
export function filterProviderTokens(text: string): string {
  if (!text) return '';
  text = text.replace(/<\s*｜[^\n>]*?｜\s*[>～]/g, '');
  text = text.replace(/<\s*\|[^\n>]*?\|\s*>/g, '');
  text = text.replace(/<\/\s*｜[A-Za-z][A-Za-z0-9_]{0,30}(?:｜[A-Za-z0-9_]*){1,3}\s*[>～]/g, '');
  text = text.replace(/｜[A-Za-z][A-Za-z0-9_]{1,30}(?:｜[A-Za-z0-9_]*){1,3}\s*[>～]/g, '');
  text = text.replace(/\|[A-Za-z][A-Za-z0-9_]{1,30}(?:\|[A-Za-z0-9_]*){1,3}\s*>/g, '');
  text = text.replace(/｜[A-Za-z0-9_]*▁[A-Za-z0-9_▁]*[｜>～]/g, '');
  text = text.replace(/<?\/?｜DSML｜[A-Za-z0-9_]*[｜>～]/g, '');
  text = text.replace(/<?\/?_?tool_(?:calls?|sep|outputs?)(?:_(?:begin|end|sep))?>/g, '');
  return text;
}
```

### 5. Welcome modal (`src/ui/welcome-modal.ts`)

A small, self-contained component, styled with existing tokens (reuse the overlay/scale-in pattern from `settings-unified.ts`).

- **Shown when:** `localStorage['small-gods-llm-onboarded']` is unset. (A successful save through the real settings panel also sets this flag, so a returning configured player never sees it.)
- **Layout:** centered card over a dimming overlay (`inset:0`, semi-opaque). Title "Welcome, small god". One line of copy. An API-key password input. A fast-model dropdown (same curated Tier-1 list, default Gemini Flash-Lite). Two buttons: **Begin** and **Skip — no AI**.
- **Begin:** if the key is blank, highlight the field and do nothing. Otherwise save `{ type:'openrouter', openrouterApiKey, openrouterModel, openrouterModelCapable: <default>, maxTokens:200, temperature:0.7 }`, set the onboarded flag, call `onComplete(config)`, dismiss.
- **Skip — no AI:** save `{ type:'mock' }`, set the onboarded flag, call `onComplete(config)`, dismiss.
- **API:** `createWelcomeModal(container, { onComplete: (config: ProviderConfig) => void }): { destroy(): void }`.
- **Wiring:** in `game.ts`, after UI mount, if not onboarded, show it; `onComplete` runs `applyLlmConfig(config)`. Modal is registered for disposal in the existing teardown path.

---

## Data flow

```
Welcome modal / Settings "Save"
        │ saveProviderConfig(config)  → localStorage
        │ onComplete / onSave(config)
        ▼
Game.applyLlmConfig(config)
        ├─ llmClient        = new LLMClient(createProvider(config))        → llmBackfill.setClient(...)
        └─ llmClientCapable = LLMClient(createProvider({…capable}))  // ready, uncalled (Track 4)

NPC focus → LlmBackfillService.trigger → llmClient.generateNpcBackfill
        → OpenRouterProvider.generate → filterProviderTokens(content) → parse → writeback
```

## Error handling

- Missing key on an OpenRouter save: `createProvider` throws; `applyLlmConfig` catches, warns to console, keeps the prior working client. The form's existing **Test** button remains the player's feedback path for a bad key.
- Welcome **Begin** with blank key: no save, field highlighted.
- Filter is a pure no-op on clean text (a lone decorative `｜word｜` survives by design — see pikkolo notes).

## Testing

- `tests/unit/filter-provider-tokens.test.ts` — mirror pikkolo's cases: strips bare `｜DSML｜tool_calls>`, fullwidth-pipe-closed variant, `<|tool_calls_begin|>`, ASCII `_tool_calls>`; leaves a lone `｜word｜` and ordinary prose untouched.
- `tests/unit/provider-config.test.ts` — `loadProviderConfig`/`saveProviderConfig` round-trips the new `openrouterModelCapable`; default is populated for a fresh OpenRouter config.
- `tests/dom/welcome-modal.test.ts` — renders when not onboarded; **Skip** persists `type:'mock'` + sets the onboarded flag + calls `onComplete`; **Begin** with a key persists `type:'openrouter'` + the key + calls `onComplete`; **Begin** with blank key does not save.
- `tests/dom/llm-settings.test.ts` (or extend existing) — Save fires `onSave` with the chosen config; capable dropdown and custom-ID field persist; selecting Custom reveals the text input.

## Documentation

- Update `CLAUDE.md`: correct the stale "LLM backfill is stubbed / hardcodes MockLLMProvider" gotcha (backfill uses the configured client; the mock is only the no-arg fallback), and note the new live-apply + welcome-modal + capable-tier seam.

## File summary

| File | Change |
|------|--------|
| `src/llm/provider-factory.ts` | add `openrouterModelCapable`; refresh defaults |
| `src/llm/filter-provider-tokens.ts` | **new** — ported pure filter |
| `src/llm/llm-client.ts` | apply filter in `OpenRouterProvider.generate` |
| `src/game/llm-backfill.ts` | add `setClient()` |
| `src/ui/llm-settings-new.ts` | refresh catalog, capable dropdown, custom-ID, `onSave` |
| `src/ui/settings-unified.ts` | retype + forward `onLLMConfigChange` → `onSave` |
| `src/ui/welcome-modal.ts` | **new** — first-run modal |
| `src/game/game-ui.ts` | forward `onLLMConfigChange` callback |
| `src/game.ts` | `applyLlmConfig`, `llmClientCapable`, mount welcome modal |
| `CLAUDE.md` | correct stale gotcha; note new seams |
| tests (4 files) | as above |
