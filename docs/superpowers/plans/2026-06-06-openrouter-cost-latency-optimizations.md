# OpenRouter Cost / Latency Optimizations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenRouter response caching (per-call opt-in), an additive `openrouter/auto` cost/quality router option, and a real-money spend tracker with a bottom-left chip — all confined to the LLM provider layer, provider config, and a small settings/HUD addition.

**Architecture:** Three slices. (1) `OpenRouterProvider` gains cache headers + hit detection driven by a new `cache` field on `LLMOptions`; a provider-level `cacheEnabled` master switch. (2) `OpenRouterProvider` emits an `auto-router` plugin only for `model: 'openrouter/auto'`, driven by `costQualityTradeoff`/`allowedModels`; config + settings UI expose it per tier. (3) A framework-free `CostTracker` (session/month/all-time, month rollover, free-hit count) is fed by a single `onUsage` hook on `LLMClient` wired to both tiers, and rendered by a subtle bottom-left `spend-chip` shown only for OpenRouter.

**Tech Stack:** TypeScript ES modules, Vitest (jsdom), Canvas2D game. `@/` path alias → `src/`. All new fields optional; default behavior unchanged except NPC backfill + whisper become cache-eligible and a spend chip appears for OpenRouter users.

**Reference spec:** `docs/superpowers/specs/2026-06-06-openrouter-cost-latency-optimizations-design.md`

---

## File Structure

**Modified:**
- `src/llm/llm-client.ts` — `LLMOptions` (+`cache`, `costQualityTradeoff`, `allowedModels`), `LLMResponse` (+`cacheStatus`), `OpenRouterConfig` (+`costQualityTradeoff`, `cacheEnabled`); `OpenRouterProvider.generate()` cache headers + auto-router plugin + hit detection; `LLMClient` constructor `onUsage` hook.
- `src/llm/provider-factory.ts` — `ProviderConfig` (+`openrouterCostQualityTradeoff`, `openrouterCostQualityTradeoffCapable`, `cacheEnabled`); `createProvider` mapping.
- `src/game/llm-backfill.ts` — opt into caching on the backfill call.
- `src/game/whisper-orchestrator.ts` — opt into caching on the whisper call.
- `src/ui/llm-settings-new.ts` — `openrouter/auto` option, per-tier tradeoff sliders, caching checkbox, save fields.
- `src/game.ts` — shared `CostTracker`, `onUsage` wiring on both tiers at boot + rebuild, capable-tier tradeoff mapping, mount/destroy spend chip + visibility.

**Created:**
- `src/llm/cost-tracker.ts` — `CostTracker` class + `SpendSnapshot`.
- `src/ui/spend-chip.ts` — `mountSpendChip(host, tracker)` → `{ setVisible, destroy }`.
- `tests/unit/openrouter-caching.test.ts`
- `tests/unit/openrouter-auto-router.test.ts`
- `tests/unit/provider-factory-routing.test.ts`
- `tests/unit/llm-client-onusage.test.ts`
- `tests/unit/cost-tracker.test.ts`
- `tests/unit/spend-chip.test.ts`

---

# Slice 1 — Response caching (per-call opt-in)

### Task 1: Cache headers + hit detection in OpenRouterProvider

**Files:**
- Modify: `src/llm/llm-client.ts` (LLMOptions, LLMResponse, OpenRouterConfig, `OpenRouterProvider.generate`)
- Test: `tests/unit/openrouter-caching.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/openrouter-caching.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenRouterProvider } from '@/llm/llm-client';

interface RecordedCall { url: string; init: RequestInit }

function fakeResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function stubFetch(calls: RecordedCall[], body: unknown, headers: Record<string, string> = {}): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return fakeResponse(body, headers);
  }));
}

const OK_BODY = {
  choices: [{ message: { content: '{"ok":true}' } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  model: 'deepseek/deepseek-v4-flash',
};

describe('OpenRouterProvider response caching', () => {
  let calls: RecordedCall[];
  beforeEach(() => { calls = []; stubFetch(calls, OK_BODY); });

  it('sends cache headers when cache requested with ttl', async () => {
    const p = new OpenRouterProvider({ apiKey: 'k', model: 'deepseek/deepseek-v4-flash' });
    await p.generate([{ role: 'user', content: 'hi' }], { cache: { ttlSeconds: 600 } });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['X-OpenRouter-Cache']).toBe('true');
    expect(headers['X-OpenRouter-Cache-TTL']).toBe('600');
  });

  it('sends clear header when cache.clear is set', async () => {
    const p = new OpenRouterProvider({ apiKey: 'k' });
    await p.generate([{ role: 'user', content: 'hi' }], { cache: { clear: true } });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['X-OpenRouter-Cache-Clear']).toBe('true');
  });

  it('omits cache headers when cache not requested', async () => {
    const p = new OpenRouterProvider({ apiKey: 'k' });
    await p.generate([{ role: 'user', content: 'hi' }]);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['X-OpenRouter-Cache']).toBeUndefined();
  });

  it('omits cache headers when cacheEnabled is false even if cache requested', async () => {
    const p = new OpenRouterProvider({ apiKey: 'k', cacheEnabled: false });
    await p.generate([{ role: 'user', content: 'hi' }], { cache: true });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['X-OpenRouter-Cache']).toBeUndefined();
  });

  it('infers HIT from zero total_tokens on a cache-eligible call', async () => {
    calls = [];
    stubFetch(calls, { choices: [{ message: { content: '{}' } }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
    const p = new OpenRouterProvider({ apiKey: 'k' });
    const res = await p.generate([{ role: 'user', content: 'hi' }], { cache: true });
    expect(res.cacheStatus).toBe('HIT');
  });

  it('prefers the cache-status header when present', async () => {
    calls = [];
    stubFetch(calls, { choices: [{ message: { content: '{}' } }], usage: { total_tokens: 15 } }, { 'x-openrouter-cache-status': 'MISS' });
    const p = new OpenRouterProvider({ apiKey: 'k' });
    const res = await p.generate([{ role: 'user', content: 'hi' }], { cache: true });
    expect(res.cacheStatus).toBe('MISS');
  });

  it('leaves cacheStatus undefined when caching not requested', async () => {
    const p = new OpenRouterProvider({ apiKey: 'k' });
    const res = await p.generate([{ role: 'user', content: 'hi' }]);
    expect(res.cacheStatus).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- openrouter-caching`
Expected: FAIL — `cache` not accepted in options / `cacheStatus` undefined / headers absent.

- [ ] **Step 3: Add the type fields**

In `src/llm/llm-client.ts`, inside `interface LLMOptions` (after `toolChoice`):

```ts
  /** Mark this call cache-eligible (OpenRouter response caching). Object form sets TTL/clear. */
  cache?: boolean | { ttlSeconds?: number; clear?: boolean };
  /** Auto-router cost/quality knob (0–10) — only used when model is 'openrouter/auto'. */
  costQualityTradeoff?: number;
  /** Auto-router allowed model ids/globs — only used when model is 'openrouter/auto'. */
  allowedModels?: string[];
```

In `interface LLMResponse` (after `toolCalls`):

```ts
  /** Cache outcome for OpenRouter response caching, when known. */
  cacheStatus?: 'HIT' | 'MISS';
```

In `interface OpenRouterConfig` (after `defaultHeaders`):

```ts
  /** Default auto-router cost/quality tradeoff (0–10) for 'openrouter/auto'. */
  costQualityTradeoff?: number;
  /** Master switch for response caching; when false, cache headers are never sent. Default treated as true. */
  cacheEnabled?: boolean;
```

- [ ] **Step 4: Emit cache headers + detect status in `OpenRouterProvider.generate()`**

In `src/llm/llm-client.ts`, after the `headers` object is built (the block ending with `...this.config.defaultHeaders,` and its closing `};`), insert:

```ts
    // Response caching (opt-in per call; cacheEnabled is a provider master switch).
    const cacheOpt = opts?.cache;
    const cacheEnabled = !!cacheOpt && this.config.cacheEnabled !== false;
    if (cacheEnabled) {
      headers['X-OpenRouter-Cache'] = 'true';
      if (typeof cacheOpt === 'object') {
        if (cacheOpt.ttlSeconds != null) headers['X-OpenRouter-Cache-TTL'] = String(cacheOpt.ttlSeconds);
        if (cacheOpt.clear) headers['X-OpenRouter-Cache-Clear'] = 'true';
      }
    }
```

Then, inside the success branch where the response is parsed (after `const data = await resp.json();` and the existing `usage`/`cost` extraction, just before the `return {` statement), insert:

```ts
        // Cache status: trust the header if CORS-exposed, else infer a HIT from
        // zero usage on a call we marked cache-eligible (a hit reports 0 tokens).
        let cacheStatus: 'HIT' | 'MISS' | undefined;
        const headerStatus = resp.headers.get('x-openrouter-cache-status');
        if (headerStatus === 'HIT' || headerStatus === 'MISS') {
          cacheStatus = headerStatus;
        } else if (cacheEnabled) {
          cacheStatus = (data.usage?.total_tokens ?? 0) === 0 ? 'HIT' : 'MISS';
        }
```

Add `cacheStatus,` to the returned object (alongside `cost`, `model`):

```ts
          latencyMs: Date.now() - start,
          cost,
          cacheStatus,
          model: data.model,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- openrouter-caching`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/llm/llm-client.ts tests/unit/openrouter-caching.test.ts
git commit -m "feat(llm): OpenRouter response caching headers + hit detection

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Body-stability guard test (cache-key invariant)

**Files:**
- Test: `tests/unit/openrouter-caching.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('OpenRouterProvider response caching', ...)` block in `tests/unit/openrouter-caching.test.ts`:

```ts
  it('produces byte-identical request bodies for identical calls (cache-key stability)', async () => {
    const p = new OpenRouterProvider({ apiKey: 'k', model: 'deepseek/deepseek-v4-flash' });
    await p.generate([{ role: 'user', content: 'hi' }], { cache: true });
    await p.generate([{ role: 'user', content: 'hi' }], { cache: true });
    expect(calls[0].init.body).toBe(calls[1].init.body);
  });
```

- [ ] **Step 2: Run test to verify it passes immediately**

Run: `npm test -- openrouter-caching`
Expected: PASS. The body has no nondeterministic fields, so two identical calls serialize identically. If this ever FAILS, a nondeterministic field (timestamp, random id) leaked into the request body and would break OpenRouter's SHA-256 cache key — fix that, do not weaken the test.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/openrouter-caching.test.ts
git commit -m "test(llm): guard cache-key stability (identical bodies for identical calls)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Opt into caching at backfill + whisper call sites

**Files:**
- Modify: `src/game/llm-backfill.ts:66`
- Modify: `src/game/whisper-orchestrator.ts:60`
- Test: `tests/unit/llm-client-onusage.test.ts` (new — also reused in Task 8)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/llm-client-onusage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { LLMClient, type LLMProvider, type LLMOptions, type LLMResponse } from '@/llm/llm-client';

class RecordingProvider implements LLMProvider {
  lastOpts?: LLMOptions;
  async generate(_m: unknown, opts?: LLMOptions): Promise<LLMResponse> {
    this.lastOpts = opts;
    return { content: '{"dialogue":"hi"}', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, latencyMs: 1 };
  }
  isAvailable(): boolean { return true; }
  name(): string { return 'rec'; }
}

describe('LLMClient option forwarding', () => {
  it('generateNpcBackfill forwards a cache option to the provider', async () => {
    const rec = new RecordingProvider();
    const client = new LLMClient(rec);
    await client.generateNpcBackfill('sys', 'user', { cache: { ttlSeconds: 300 } });
    expect(rec.lastOpts?.cache).toEqual({ ttlSeconds: 300 });
  });
});
```

- [ ] **Step 2: Run test to verify it passes (forwarding already works)**

Run: `npm test -- llm-client-onusage`
Expected: PASS — `generateNpcBackfill` already spreads `...opts` after its defaults, so `cache` forwards. This test locks that contract before the call-site edits rely on it.

- [ ] **Step 3: Add the cache opt-in at the backfill call site**

In `src/game/llm-backfill.ts`, change line 66 from:

```ts
      const response = await this.client.generateNpcBackfill(prompt.system, prompt.user, { maxTokens: 200, temperature: 0.7 });
```

to:

```ts
      const response = await this.client.generateNpcBackfill(prompt.system, prompt.user, { maxTokens: 200, temperature: 0.7, cache: { ttlSeconds: 300 } });
```

- [ ] **Step 4: Add the cache opt-in at the whisper call site**

In `src/game/whisper-orchestrator.ts`, change line 60 from:

```ts
    const res = await deps.llm.generateNpcBackfill(prompt.system, prompt.user);
```

to:

```ts
    const res = await deps.llm.generateNpcBackfill(prompt.system, prompt.user, { cache: { ttlSeconds: 300 } });
```

- [ ] **Step 5: Run the full suite + typecheck**

Run: `npm test`
Expected: PASS (no regressions; previously-green count + the new tests).
Run: `npm run build`
Expected: TypeScript clean.

- [ ] **Step 6: Commit**

```bash
git add src/game/llm-backfill.ts src/game/whisper-orchestrator.ts tests/unit/llm-client-onusage.test.ts
git commit -m "feat(llm): cache-eligible NPC backfill + whisper calls (5-min TTL)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# Slice 2 — Auto-router as an additive option

### Task 4: Emit the auto-router plugin for `openrouter/auto`

**Files:**
- Modify: `src/llm/llm-client.ts` (`OpenRouterProvider.generate` body construction)
- Test: `tests/unit/openrouter-auto-router.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/openrouter-auto-router.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenRouterProvider } from '@/llm/llm-client';

interface RecordedCall { url: string; init: RequestInit }
function fakeResponse(body: unknown): Response {
  return {
    ok: true, status: 200,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}
const OK = { choices: [{ message: { content: '{}' } }], usage: { total_tokens: 5 }, model: 'google/gemini-2.5-flash' };

describe('OpenRouterProvider auto-router', () => {
  let calls: RecordedCall[];
  beforeEach(() => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return fakeResponse(OK); }));
  });

  function bodyOf(i = 0): Record<string, unknown> {
    return JSON.parse(calls[i].init.body as string);
  }

  it('emits the auto-router plugin with the config tradeoff', async () => {
    const p = new OpenRouterProvider({ apiKey: 'k', model: 'openrouter/auto', costQualityTradeoff: 3 });
    await p.generate([{ role: 'user', content: 'hi' }]);
    expect(bodyOf().plugins).toEqual([{ id: 'auto-router', cost_quality_tradeoff: 3 }]);
  });

  it('opts.costQualityTradeoff overrides the config value', async () => {
    const p = new OpenRouterProvider({ apiKey: 'k', model: 'openrouter/auto', costQualityTradeoff: 3 });
    await p.generate([{ role: 'user', content: 'hi' }], { costQualityTradeoff: 9 });
    expect((bodyOf().plugins as Array<Record<string, unknown>>)[0].cost_quality_tradeoff).toBe(9);
  });

  it('includes allowed_models when supplied', async () => {
    const p = new OpenRouterProvider({ apiKey: 'k', model: 'openrouter/auto' });
    await p.generate([{ role: 'user', content: 'hi' }], { allowedModels: ['google/*'] });
    expect((bodyOf().plugins as Array<Record<string, unknown>>)[0].allowed_models).toEqual(['google/*']);
  });

  it('omits the plugins key for non-auto models', async () => {
    const p = new OpenRouterProvider({ apiKey: 'k', model: 'deepseek/deepseek-v4-flash' });
    await p.generate([{ role: 'user', content: 'hi' }]);
    expect(bodyOf().plugins).toBeUndefined();
  });

  it('surfaces the router-selected model from the response', async () => {
    const p = new OpenRouterProvider({ apiKey: 'k', model: 'openrouter/auto' });
    const res = await p.generate([{ role: 'user', content: 'hi' }]);
    expect(res.model).toBe('google/gemini-2.5-flash');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- openrouter-auto-router`
Expected: FAIL — no `plugins` key emitted.

- [ ] **Step 3: Implement the plugin emission**

In `src/llm/llm-client.ts`, `OpenRouterProvider.generate()`, the body is currently built as:

```ts
    const body: Record<string, unknown> = {
      model: opts?.model ?? this.config.model ?? 'openai/gpt-3.5-turbo',
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: opts?.maxTokens ?? 200,
      temperature: opts?.temperature ?? 0.7,
      stop: opts?.stop,
    };
```

Replace it with (hoist `effectiveModel`, then add the plugin block after the existing `tools` block):

```ts
    const effectiveModel = opts?.model ?? this.config.model ?? 'openai/gpt-3.5-turbo';
    const body: Record<string, unknown> = {
      model: effectiveModel,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: opts?.maxTokens ?? 200,
      temperature: opts?.temperature ?? 0.7,
      stop: opts?.stop,
    };
```

Then, immediately after the existing `if (opts?.tools && opts.tools.length > 0) { ... }` block, add:

```ts
    // Auto-router: when targeting 'openrouter/auto', attach the cost/quality plugin.
    // Emitted ONLY for the auto model so non-auto callers' bodies (and thus their
    // cache keys) stay byte-stable.
    if (effectiveModel === 'openrouter/auto') {
      const tradeoff = opts?.costQualityTradeoff ?? this.config.costQualityTradeoff;
      const allowed = opts?.allowedModels;
      const plugin: Record<string, unknown> = { id: 'auto-router' };
      if (tradeoff != null) plugin.cost_quality_tradeoff = tradeoff;
      if (allowed && allowed.length) plugin.allowed_models = allowed;
      body.plugins = [plugin];
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- openrouter-auto-router`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/llm/llm-client.ts tests/unit/openrouter-auto-router.test.ts
git commit -m "feat(llm): additive openrouter/auto cost-quality router plugin

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: ProviderConfig fields + createProvider mapping

**Files:**
- Modify: `src/llm/provider-factory.ts` (`ProviderConfig`, `createProvider`)
- Test: `tests/unit/provider-factory-routing.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/provider-factory-routing.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createProvider } from '@/llm/provider-factory';

interface RecordedCall { init: RequestInit }
function fakeResponse(body: unknown): Response {
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}
const OK = { choices: [{ message: { content: '{}' } }], usage: { total_tokens: 5 } };

describe('createProvider OpenRouter routing/caching mapping', () => {
  let calls: RecordedCall[];
  beforeEach(() => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { calls.push({ init }); return fakeResponse(OK); }));
  });

  it('maps openrouterCostQualityTradeoff into auto-router requests', async () => {
    const p = createProvider({ type: 'openrouter', openrouterApiKey: 'k', openrouterModel: 'openrouter/auto', openrouterCostQualityTradeoff: 4 });
    await p.generate([{ role: 'user', content: 'x' }]);
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.plugins[0].cost_quality_tradeoff).toBe(4);
  });

  it('maps cacheEnabled:false so cache headers are suppressed', async () => {
    const p = createProvider({ type: 'openrouter', openrouterApiKey: 'k', cacheEnabled: false });
    await p.generate([{ role: 'user', content: 'x' }], { cache: true });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['X-OpenRouter-Cache']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- provider-factory-routing`
Expected: FAIL — type error / fields not mapped (tradeoff not emitted).

- [ ] **Step 3: Add the ProviderConfig fields**

In `src/llm/provider-factory.ts`, inside `interface ProviderConfig`, under the `// OpenRouter` group (after `openrouterSiteName?`):

```ts
  openrouterCostQualityTradeoff?: number;
  openrouterCostQualityTradeoffCapable?: number;
  cacheEnabled?: boolean;
```

- [ ] **Step 4: Map them in `createProvider` (openrouter case)**

In `src/llm/provider-factory.ts`, in the `case 'openrouter':` block, change the `orConfig` object from:

```ts
      const orConfig: OpenRouterConfig = {
        apiKey: config.openrouterApiKey,
        model: config.openrouterModel ?? DEFAULT_CHAT_MODEL,
        siteUrl: config.openrouterSiteUrl,
        siteName: config.openrouterSiteName ?? 'Small Gods Game',
      };
```

to:

```ts
      const orConfig: OpenRouterConfig = {
        apiKey: config.openrouterApiKey,
        model: config.openrouterModel ?? DEFAULT_CHAT_MODEL,
        siteUrl: config.openrouterSiteUrl,
        siteName: config.openrouterSiteName ?? 'Small Gods Game',
        costQualityTradeoff: config.openrouterCostQualityTradeoff,
        cacheEnabled: config.cacheEnabled,
      };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- provider-factory-routing`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/llm/provider-factory.ts tests/unit/provider-factory-routing.test.ts
git commit -m "feat(llm): ProviderConfig fields for auto-router tradeoff + cache switch

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Capable-tier tradeoff mapping in game.ts

**Files:**
- Modify: `src/game.ts:443-448` (`buildCapableClient`)

- [ ] **Step 1: Map the capable tradeoff when building the capable client**

In `src/game.ts`, change `buildCapableClient` from:

```ts
  private buildCapableClient(config: ProviderConfig): LLMClient | null {
    return config.openrouterModelCapable
      ? new LLMClient(createProvider({ ...config, openrouterModel: config.openrouterModelCapable }))
      : null;
  }
```

to:

```ts
  private buildCapableClient(config: ProviderConfig): LLMClient | null {
    return config.openrouterModelCapable
      ? new LLMClient(createProvider({
          ...config,
          openrouterModel: config.openrouterModelCapable,
          openrouterCostQualityTradeoff: config.openrouterCostQualityTradeoffCapable,
        }))
      : null;
  }
```

> Note: the `onUsage` argument is added to both `new LLMClient(...)` constructors in Task 9 — leave the single-argument form here for now; Task 9 edits this same method.

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: TypeScript clean (new field already exists from Task 5).

- [ ] **Step 3: Commit**

```bash
git add src/game.ts
git commit -m "feat(llm): route capable-tier auto-router tradeoff through buildCapableClient

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Settings UI — auto option, tradeoff sliders, caching checkbox

**Files:**
- Modify: `src/ui/llm-settings-new.ts`

- [ ] **Step 1: Add the AUTO model constant + extend the saved-state reads**

In `src/ui/llm-settings-new.ts`, after the imports, add:

```ts
const AUTO_MODEL: CuratedModel = { id: 'openrouter/auto', name: 'Auto (cost/quality router)' };
```

Inside `createLLMSettings`, after the existing `let capableModelId = ...` line (≈45), add:

```ts
  let chatTradeoff = saved.openrouterCostQualityTradeoff ?? 7;
  let capableTradeoff = saved.openrouterCostQualityTradeoffCapable ?? 7;
  let cacheEnabled = saved.cacheEnabled !== false; // default on
```

- [ ] **Step 2: Offer `openrouter/auto` in both pickers**

In `src/ui/llm-settings-new.ts`, change the two `createModelField(...)` calls (≈139-149) to prepend `AUTO_MODEL` to each verified list:

```ts
  const chatField = createModelField(
    'sg-llm-model-row', 'Model', [AUTO_MODEL, ...VERIFIED_CHAT_MODELS],
    () => chatModelId, (id) => { chatModelId = id; updateAutoRows(); },
  );
  container.appendChild(chatField.row);

  const capableField = createModelField(
    'sg-llm-capable-row', 'Capable model (key moments)', [AUTO_MODEL, ...VERIFIED_CAPABLE_MODELS],
    () => capableModelId, (id) => { capableModelId = id; updateAutoRows(); },
  );
  container.appendChild(capableField.row);
```

- [ ] **Step 3: Add a reusable tradeoff-slider builder + the two rows**

In `src/ui/llm-settings-new.ts`, immediately after the `capableField` block from Step 2, add:

```ts
  // ─── Auto-router tradeoff sliders (shown only when a tier uses openrouter/auto) ──
  function createTradeoffRow(
    labelText: string, get: () => number, set: (v: number) => void,
  ): { row: HTMLElement } {
    const row = document.createElement('div');
    row.className = 'sg-field';
    const label = document.createElement('div');
    label.className = 'sg-field__label';
    const valueText = document.createElement('span');
    const setLabel = (v: number) => { valueText.textContent = ` — ${v === 0 ? 'most capable' : v >= 10 ? 'cheapest' : String(v)}`; };
    label.textContent = labelText;
    label.appendChild(valueText);
    row.appendChild(label);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0'; slider.max = '10'; slider.step = '1';
    slider.value = String(get());
    slider.className = 'sg-input';
    setLabel(get());
    slider.addEventListener('input', () => { const v = parseInt(slider.value, 10); set(v); setLabel(v); });
    row.appendChild(slider);
    return { row };
  }

  const chatTradeoffRow = createTradeoffRow('Cost ↔ quality (Model)', () => chatTradeoff, (v) => { chatTradeoff = v; });
  const capableTradeoffRow = createTradeoffRow('Cost ↔ quality (Capable)', () => capableTradeoff, (v) => { capableTradeoff = v; });
  container.appendChild(chatTradeoffRow.row);
  container.appendChild(capableTradeoffRow.row);

  function updateAutoRows(): void {
    const showModels = providerSelect.value === 'openrouter';
    chatTradeoffRow.row.style.display = (showModels && chatModelId === AUTO_MODEL.id) ? '' : 'none';
    capableTradeoffRow.row.style.display = (showModels && capableModelId === AUTO_MODEL.id) ? '' : 'none';
  }
```

- [ ] **Step 4: Add the caching checkbox into the Advanced disclosure**

In `src/ui/llm-settings-new.ts`, after the `advanced.appendChild(tempRow);` line (≈193) and before `container.appendChild(advanced);`, add:

```ts
  const cacheRow = document.createElement('label');
  cacheRow.className = 'sg-field';
  cacheRow.style.flexDirection = 'row';
  cacheRow.style.alignItems = 'center';
  cacheRow.style.gap = '8px';
  const cacheCheckbox = document.createElement('input');
  cacheCheckbox.type = 'checkbox';
  cacheCheckbox.checked = cacheEnabled;
  cacheCheckbox.addEventListener('change', () => { cacheEnabled = cacheCheckbox.checked; });
  const cacheLabel = document.createElement('span');
  cacheLabel.className = 'sg-field__label';
  cacheLabel.textContent = 'Response caching (free repeats of identical requests)';
  cacheRow.append(cacheCheckbox, cacheLabel);
  advanced.appendChild(cacheRow);
```

- [ ] **Step 5: Toggle the auto rows from updateVisibility + on load**

In `src/ui/llm-settings-new.ts`, inside `function updateVisibility()` add a final line before its closing brace:

```ts
    updateAutoRows();
```

(The existing call `updateVisibility();` at ≈219 now also initializes the auto rows.)

- [ ] **Step 6: Persist the new fields on Save**

In `src/ui/llm-settings-new.ts`, in the save handler's `else if (type === 'openrouter') { ... }` block (≈254-258), add the three fields:

```ts
    } else if (type === 'openrouter') {
      config.openrouterApiKey = keyInput.value;
      config.openrouterModel = chatModelId;
      config.openrouterModelCapable = capableModelId;
      config.openrouterCostQualityTradeoff = chatTradeoff;
      config.openrouterCostQualityTradeoffCapable = capableTradeoff;
      config.cacheEnabled = cacheEnabled;
    }
```

- [ ] **Step 7: Typecheck + full suite**

Run: `npm run build`
Expected: TypeScript clean.
Run: `npm test`
Expected: PASS (existing settings tests still green).

- [ ] **Step 8: Commit**

```bash
git add src/ui/llm-settings-new.ts
git commit -m "feat(ui): openrouter/auto option, per-tier tradeoff sliders, caching toggle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# Slice 3 — Real-money spend tracker

### Task 8: CostTracker

**Files:**
- Create: `src/llm/cost-tracker.ts`
- Test: `tests/unit/cost-tracker.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/cost-tracker.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { CostTracker } from '@/llm/cost-tracker';

const JUNE = () => new Date(2026, 5, 6); // month is 0-indexed → June

beforeEach(() => localStorage.clear());

describe('CostTracker', () => {
  it('accumulates paid cost across session/month/all-time and counts calls', () => {
    const t = new CostTracker(JUNE);
    t.record({ cost: 0.01 });
    t.record({ cost: 0.02 });
    const s = t.snapshot();
    expect(s.sessionUsd).toBeCloseTo(0.03);
    expect(s.monthUsd).toBeCloseTo(0.03);
    expect(s.allTimeUsd).toBeCloseTo(0.03);
    expect(s.calls).toBe(2);
  });

  it('counts cache hits without adding cost or calls', () => {
    const t = new CostTracker(JUNE);
    t.record({ cacheStatus: 'HIT' });
    const s = t.snapshot();
    expect(s.cacheHits).toBe(1);
    expect(s.sessionUsd).toBe(0);
    expect(s.calls).toBe(0);
  });

  it('rolls over the month bucket but preserves all-time', () => {
    let now = new Date(2026, 5, 30); // June 30
    const t = new CostTracker(() => now);
    t.record({ cost: 0.05 });
    now = new Date(2026, 6, 1); // July 1
    t.record({ cost: 0.02 });
    const s = t.snapshot();
    expect(s.monthUsd).toBeCloseTo(0.02);
    expect(s.allTimeUsd).toBeCloseTo(0.07);
    expect(s.month).toBe('2026-07');
  });

  it('persists month + all-time across instances; session does not persist', () => {
    const t1 = new CostTracker(JUNE);
    t1.record({ cost: 0.04 });
    const t2 = new CostTracker(JUNE);
    const s = t2.snapshot();
    expect(s.allTimeUsd).toBeCloseTo(0.04);
    expect(s.monthUsd).toBeCloseTo(0.04);
    expect(s.sessionUsd).toBe(0);
  });

  it('notifies subscribers on record', () => {
    const t = new CostTracker(JUNE);
    const seen: number[] = [];
    t.subscribe((s) => seen.push(s.sessionUsd));
    t.record({ cost: 0.01 });
    expect(seen).toEqual([0.01]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- cost-tracker`
Expected: FAIL — module `@/llm/cost-tracker` not found.

- [ ] **Step 3: Implement CostTracker**

Create `src/llm/cost-tracker.ts`:

```ts
/**
 * CostTracker — accumulates real USD spend reported by the LLM provider.
 *
 * Three buckets: session (in-memory, resets on reload), month (persisted,
 * auto-rolls when the calendar month changes), and all-time (persisted). Cache
 * hits cost nothing and are counted separately. UI telemetry only — this is NOT
 * sim code, so wall-clock `new Date()` is fine here (the determinism rules apply
 * to src/sim/ alone). The `now` seam exists purely for deterministic tests.
 */

export interface SpendSnapshot {
  sessionUsd: number;
  monthUsd: number;
  allTimeUsd: number;
  calls: number;
  cacheHits: number;
  month: string; // 'YYYY-MM'
}

const SPEND_KEY = 'small-gods-llm-spend';
interface Persisted { month: string; monthUsd: number; allTimeUsd: number }

export class CostTracker {
  private sessionUsd = 0;
  private calls = 0;
  private cacheHits = 0;
  private monthUsd = 0;
  private allTimeUsd = 0;
  private month: string;
  private subs = new Set<(s: SpendSnapshot) => void>();

  constructor(private now: () => Date = () => new Date()) {
    const p = this.load();
    const m = this.monthKey(this.now());
    this.month = m;
    if (p) {
      this.allTimeUsd = p.allTimeUsd;
      this.monthUsd = p.month === m ? p.monthUsd : 0;
      if (p.month !== m) this.persist(); // rebaseline the rolled-over month
    }
  }

  record(r: { cost?: number; cacheStatus?: 'HIT' | 'MISS' }): void {
    this.rollover();
    if (r.cacheStatus === 'HIT') { this.cacheHits++; this.notify(); return; }
    this.calls++;
    const cost = r.cost ?? 0;
    if (cost > 0) {
      this.sessionUsd += cost;
      this.monthUsd += cost;
      this.allTimeUsd += cost;
      this.persist();
    }
    this.notify();
  }

  snapshot(): SpendSnapshot {
    return {
      sessionUsd: this.sessionUsd,
      monthUsd: this.monthUsd,
      allTimeUsd: this.allTimeUsd,
      calls: this.calls,
      cacheHits: this.cacheHits,
      month: this.month,
    };
  }

  subscribe(fn: (s: SpendSnapshot) => void): () => void {
    this.subs.add(fn);
    return () => { this.subs.delete(fn); };
  }

  private rollover(): void {
    const m = this.monthKey(this.now());
    if (m !== this.month) { this.month = m; this.monthUsd = 0; this.persist(); }
  }

  private monthKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  private notify(): void {
    const s = this.snapshot();
    this.subs.forEach((fn) => fn(s));
  }

  private load(): Persisted | null {
    try {
      const raw = localStorage.getItem(SPEND_KEY);
      return raw ? (JSON.parse(raw) as Persisted) : null;
    } catch {
      return null;
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(SPEND_KEY, JSON.stringify({ month: this.month, monthUsd: this.monthUsd, allTimeUsd: this.allTimeUsd }));
    } catch {
      // ignore unavailable/quota-exceeded storage
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- cost-tracker`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/llm/cost-tracker.ts tests/unit/cost-tracker.test.ts
git commit -m "feat(llm): CostTracker — session/month/all-time USD with rollover

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: LLMClient onUsage hook

**Files:**
- Modify: `src/llm/llm-client.ts` (`LLMClient`)
- Test: `tests/unit/llm-client-onusage.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/llm-client-onusage.test.ts` inside the `describe('LLMClient option forwarding', ...)` block:

```ts
  it('invokes onUsage with the response from generateNpcBackfill', async () => {
    const rec = new RecordingProvider();
    const seen: LLMResponse[] = [];
    const client = new LLMClient(rec, (r) => seen.push(r));
    await client.generateNpcBackfill('s', 'u');
    expect(seen).toHaveLength(1);
    expect(seen[0].content).toContain('hi');
  });

  it('invokes onUsage from generateWithTools', async () => {
    const rec = new RecordingProvider();
    const seen: LLMResponse[] = [];
    const client = new LLMClient(rec, (r) => seen.push(r));
    await client.generateWithTools([{ role: 'user', content: 'u' }], [{ name: 't', description: 'd', parameters: {} }]);
    expect(seen).toHaveLength(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- llm-client-onusage`
Expected: FAIL — `LLMClient` constructor takes only one argument.

- [ ] **Step 3: Add the onUsage hook**

In `src/llm/llm-client.ts`, change the `LLMClient` constructor from:

```ts
export class LLMClient {
  private provider: LLMProvider;

  constructor(provider: LLMProvider) {
    this.provider = provider;
  }
```

to:

```ts
export class LLMClient {
  private provider: LLMProvider;
  private onUsage?: (r: LLMResponse) => void;

  constructor(provider: LLMProvider, onUsage?: (r: LLMResponse) => void) {
    this.provider = provider;
    this.onUsage = onUsage;
  }
```

In `generateNpcBackfill`, change the final `return this.provider.generate(...)` to capture and report:

```ts
    const res = await this.provider.generate(messages, {
      maxTokens: 200,
      temperature: 0.7,
      ...opts,
    });
    this.onUsage?.(res);
    return res;
```

In `generateWithTools`, likewise:

```ts
    const res = await this.provider.generate(messages, {
      maxTokens: 1024,
      toolChoice: 'auto',
      ...opts,
      tools,
    });
    this.onUsage?.(res);
    return res;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- llm-client-onusage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/llm/llm-client.ts tests/unit/llm-client-onusage.test.ts
git commit -m "feat(llm): LLMClient onUsage hook for spend telemetry

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Spend chip UI

**Files:**
- Create: `src/ui/spend-chip.ts`
- Test: `tests/unit/spend-chip.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/spend-chip.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mountSpendChip } from '@/ui/spend-chip';
import { CostTracker } from '@/llm/cost-tracker';

beforeEach(() => localStorage.clear());

describe('mountSpendChip', () => {
  it('renders session + month spend and updates on record', () => {
    const host = document.createElement('div');
    const t = new CostTracker(() => new Date(2026, 5, 6));
    const chip = mountSpendChip(host, t);
    t.record({ cost: 0.0123 });
    expect(host.textContent).toContain('session');
    expect(host.textContent).toContain('month');
    expect(host.textContent).toContain('$0.01');
    chip.destroy();
    expect(host.querySelector('.sg-spend')).toBeNull();
  });

  it('hides when setVisible(false)', () => {
    const host = document.createElement('div');
    const t = new CostTracker(() => new Date(2026, 5, 6));
    const chip = mountSpendChip(host, t);
    chip.setVisible(false);
    const el = host.querySelector('.sg-spend') as HTMLElement;
    expect(el.style.display).toBe('none');
    chip.destroy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- spend-chip`
Expected: FAIL — module `@/ui/spend-chip` not found.

- [ ] **Step 3: Implement the spend chip**

Create `src/ui/spend-chip.ts`:

```ts
/**
 * Spend chip — a subtle bottom-left readout of real USD spent on the LLM.
 * Shown only for the OpenRouter provider (the path with real cost data); the
 * caller toggles visibility via setVisible. Click expands a small popover with
 * all-time spend and call / cache-hit counts.
 */

import type { CostTracker, SpendSnapshot } from '@/llm/cost-tracker';

export interface SpendChipHandle {
  setVisible(visible: boolean): void;
  destroy(): void;
}

const STYLE = `
.sg-spend {
  position: absolute; left: 12px; bottom: 12px; z-index: 40;
  font-family: var(--f-sans, system-ui, sans-serif); font-size: var(--t-tiny, 11px);
  color: var(--ink-3); background: var(--paper, #fff); border: 1px solid var(--line);
  border-radius: var(--r-pill, 999px); padding: 5px 10px; cursor: pointer;
  font-variant-numeric: tabular-nums; box-shadow: var(--lift-1, 0 1px 2px rgba(0,0,0,0.1));
  user-select: none; white-space: nowrap;
}
.sg-spend:hover { color: var(--ink-2); border-color: var(--line-2); }
.sg-spend__pop {
  position: absolute; left: 0; bottom: calc(100% + 6px);
  background: var(--paper); border: 1px solid var(--line); border-radius: var(--r-2, 6px);
  padding: 8px 10px; box-shadow: var(--lift-2); color: var(--ink-2);
  display: none; flex-direction: column; gap: 3px; min-width: 150px;
}
.sg-spend.is-open .sg-spend__pop { display: flex; }
.sg-spend__pop-row { display: flex; justify-content: space-between; gap: 12px; }
.sg-spend__pop-row span:last-child { color: var(--ink); }
`;

function fmt(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function injectStyle(): void {
  if (document.querySelector('#sg-spend-styles')) return;
  const el = document.createElement('style');
  el.id = 'sg-spend-styles';
  el.textContent = STYLE;
  document.head.appendChild(el);
}

export function mountSpendChip(host: HTMLElement, tracker: CostTracker): SpendChipHandle {
  injectStyle();

  const chip = document.createElement('div');
  chip.className = 'sg-spend';

  const label = document.createElement('span');
  chip.appendChild(label);

  const pop = document.createElement('div');
  pop.className = 'sg-spend__pop';
  chip.appendChild(pop);

  function popRow(k: string, v: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'sg-spend__pop-row';
    const a = document.createElement('span'); a.textContent = k;
    const b = document.createElement('span'); b.textContent = v;
    row.append(a, b);
    return row;
  }

  function render(s: SpendSnapshot): void {
    label.textContent = `${fmt(s.sessionUsd)} session · ${fmt(s.monthUsd)} month`;
    pop.innerHTML = '';
    pop.append(
      popRow('This session', fmt(s.sessionUsd)),
      popRow('This month', fmt(s.monthUsd)),
      popRow('All time', fmt(s.allTimeUsd)),
      popRow('Calls', String(s.calls)),
      popRow('Cached (free)', String(s.cacheHits)),
    );
  }

  render(tracker.snapshot());
  const unsub = tracker.subscribe(render);

  chip.addEventListener('click', () => chip.classList.toggle('is-open'));

  host.appendChild(chip);

  return {
    setVisible(visible: boolean): void { chip.style.display = visible ? '' : 'none'; },
    destroy(): void { unsub(); chip.remove(); },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- spend-chip`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/spend-chip.ts tests/unit/spend-chip.test.ts
git commit -m "feat(ui): bottom-left spend chip with all-time/call/cache popover

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: Wire the shared CostTracker + spend chip into Game

**Files:**
- Modify: `src/game.ts` (field, boot wiring, `buildCapableClient`, `applyLlmConfig`, mount, destroy)

- [ ] **Step 1: Add imports + the CostTracker field + chip handle field**

In `src/game.ts`, add imports near the other `@/llm` / `@/ui` imports:

```ts
import { CostTracker } from '@/llm/cost-tracker';
import { mountSpendChip, type SpendChipHandle } from '@/ui/spend-chip';
```

Add fields near the other private fields (e.g. after the `llmClientCapable` field at ≈90):

```ts
  private costTracker = new CostTracker();
  private spendChip: SpendChipHandle | null = null;
```

- [ ] **Step 2: Wire onUsage at boot**

In `src/game.ts`, in the constructor LLM section, change:

```ts
    this.llmClient = new LLMClient(provider);
```

to:

```ts
    this.llmClient = new LLMClient(provider, (r) => this.costTracker.record(r));
```

- [ ] **Step 3: Wire onUsage in buildCapableClient**

In `src/game.ts`, update `buildCapableClient` (already edited in Task 6) so the capable client reports usage too:

```ts
  private buildCapableClient(config: ProviderConfig): LLMClient | null {
    return config.openrouterModelCapable
      ? new LLMClient(createProvider({
          ...config,
          openrouterModel: config.openrouterModelCapable,
          openrouterCostQualityTradeoff: config.openrouterCostQualityTradeoffCapable,
        }), (r) => this.costTracker.record(r))
      : null;
  }
```

- [ ] **Step 4: Wire onUsage + chip visibility in applyLlmConfig**

In `src/game.ts`, change `applyLlmConfig` from:

```ts
  private applyLlmConfig(config: ProviderConfig): void {
    try {
      this.llmClient = new LLMClient(createProvider(config));
      this.llmBackfill.setClient(this.llmClient);
      this.llmClientCapable = this.buildCapableClient(config);
    } catch (err) {
      console.warn('[llm] config not applied:', err);
    }
  }
```

to:

```ts
  private applyLlmConfig(config: ProviderConfig): void {
    try {
      this.llmClient = new LLMClient(createProvider(config), (r) => this.costTracker.record(r));
      this.llmBackfill.setClient(this.llmClient);
      this.llmClientCapable = this.buildCapableClient(config);
      this.spendChip?.setVisible(config.type === 'openrouter');
    } catch (err) {
      console.warn('[llm] config not applied:', err);
    }
  }
```

- [ ] **Step 5: Mount the chip after the UI is built**

In `src/game.ts`, after `this.ui = new GameUi(...)` finishes (i.e. after the closing `});` of the `new GameUi(...)` call near the end of the constructor wiring — locate the line after `this.input = ...` is set, or directly after the GameUi assignment), add:

```ts
    this.spendChip = mountSpendChip(this.container, this.costTracker);
    this.spendChip.setVisible(providerConfig.type === 'openrouter');
```

> `providerConfig` is the local from the constructor's LLM section (≈181). If it is out of scope at the mount point, replace the second line with `this.spendChip.setVisible(loadProviderConfig().type === 'openrouter');` (`loadProviderConfig` is already imported).

- [ ] **Step 6: Destroy the chip in Game.destroy()**

In `src/game.ts`, in `destroy()` (≈590), after `this.ui.destroy();` add:

```ts
    this.spendChip?.destroy();
```

- [ ] **Step 7: Typecheck + full suite**

Run: `npm run build`
Expected: TypeScript clean.
Run: `npm test`
Expected: PASS — full suite green (all prior counts + the new tests).

- [ ] **Step 8: Commit**

```bash
git add src/game.ts
git commit -m "feat(game): shared CostTracker wired to both tiers + bottom-left spend chip

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: Manual verification + final sweep

**Files:** none (verification only)

- [ ] **Step 1: Full suite + build**

Run: `npm test`
Expected: PASS, no regressions.
Run: `npm run build`
Expected: TypeScript clean, Vite build clean.

- [ ] **Step 2: Manual smoke (dev server on port 3000)**

Run: `npm run dev` (serves on **port 3000**, not 5173).
Verify in-browser:
- With provider = Mock: **no** spend chip in the bottom-left.
- Switch provider to OpenRouter (⚙ LLM settings), save: spend chip appears bottom-left reading `$0 session · $0 month`.
- Select `openrouter/auto` for either Model or Capable: the matching "Cost ↔ quality" slider appears; non-auto hides it.
- "Response caching" checkbox is present in Advanced, checked by default.
- Focus an NPC with a real key: the chip increments after a paid call; the click popover shows All time / Calls / Cached (free).

- [ ] **Step 3: Confirm no stray nondeterminism in the request body**

Run: `npm test -- openrouter-caching`
Expected: the "byte-identical request bodies" test passes (re-confirms the cache-key invariant after all edits).

- [ ] **Step 4: Final commit (only if any doc/cleanup changes were made)**

```bash
git add -A
git commit -m "chore: finalize OpenRouter cost/latency optimizations

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **Dev server runs on port 3000** (`vite.config.ts` `server.port`), not Vite's default 5173.
- **Cache-key stability is load-bearing**: never add a timestamp, nonce, or random id to the OpenRouter request body. The Task 2 test guards this.
- The capable-tier tradeoff mapping (Task 6) and the Game wiring (Task 11) are exercised end-to-end by the manual smoke (Step 2 of Task 12) rather than a heavy Game unit test — `Game` requires a full DOM container + world bring-up, so a focused unit test there is not worth its setup cost.
- Occasional flaky timing/DOM tests (`replay-speed`, `game-ui`) can fail singly and pass on re-run — a lone 1-test failure that passes on re-run is a flake, not a regression.
