# Create Panel — Sub-project 1: LLM Tool-Calling Substrate (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenAI-style tool-calling to the LLM client layer (types + request serialization + `tool_calls` parsing) so the capable tier can request structured world edits. This is the gating, reusable substrate for both the Create panel (SP2/SP3) and the later Fate brain.

**Architecture:** Extend the existing provider abstraction in `src/llm/llm-client.ts` — no new files. `LLMOptions` gains `tools`/`toolChoice`; `LLMResponse` gains `toolCalls`; two new interfaces (`LLMTool`, `LLMToolCall`) describe the tool surface. A shared module-level `parseToolCalls()` helper maps the OpenAI-shaped `message.tool_calls` (with JSON-string `arguments`) into typed `LLMToolCall[]` and is used by both `OpenAIProvider` and `OpenRouterProvider`. `MockLLMProvider` returns canned tool calls when `opts.tools` is present, so SP2/SP3 are testable offline. A single-shot `LLMClient.generateWithTools()` wrapper is the entry point the capable tier calls.

**Tech Stack:** TypeScript ESM, Vitest (jsdom). Tests stub `fetch` via `vi.stubGlobal('fetch', vi.fn(...))` (matching `tests/unit/pixellab.test.ts`). No network in tests.

**Scope guard:** Single-shot only (one request → tool calls). No multi-turn read loop, no tool-result feedback round-trip — that is explicitly deferred to a later spec (design §3 SP1, §5).

---

## File Structure

- **Modify:** `src/llm/llm-client.ts` — all production changes land here:
  - new `LLMTool`, `LLMToolCall` interfaces
  - `LLMOptions.tools?`, `LLMOptions.toolChoice?`
  - `LLMResponse.toolCalls?`
  - module-level `toToolPayload()` (request serialization) + `parseToolCalls()` (response parsing) helpers
  - `MockLLMProvider` canned tool-call behavior + optional constructor config
  - `OpenAIProvider.generate` + `OpenRouterProvider.generate` wiring
  - `LLMClient.generateWithTools()` wrapper
- **Create:** `tests/unit/llm-tool-calling.test.ts` — all tests for this sub-project (no llm-client test file exists today).

---

## Task 1: Tool-calling types

**Files:**
- Modify: `src/llm/llm-client.ts` (interfaces near top: `LLMResponse` ~18-34, `LLMOptions` ~36-45)
- Test: `tests/unit/llm-tool-calling.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/llm-tool-calling.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  MockLLMProvider, OpenAIProvider, OpenRouterProvider, LLMClient,
  type LLMTool, type LLMToolCall, type LLMOptions, type LLMResponse,
} from '@/llm/llm-client';

const SPAWN_TOOL: LLMTool = {
  name: 'author_spawn_npc',
  description: 'Spawn one or more NPCs near a target.',
  parameters: {
    type: 'object',
    properties: { role: { type: 'string' }, count: { type: 'number' } },
    required: ['role'],
  },
};

describe('tool-calling types', () => {
  it('allows tools + toolChoice on LLMOptions and toolCalls on LLMResponse', () => {
    const opts: LLMOptions = { tools: [SPAWN_TOOL], toolChoice: 'auto' };
    const call: LLMToolCall = { id: 'c1', name: 'author_spawn_npc', arguments: { role: 'farmer' } };
    const resp: LLMResponse = { content: '', latencyMs: 0, toolCalls: [call] };
    expect(opts.tools?.[0].name).toBe('author_spawn_npc');
    expect(resp.toolCalls?.[0].arguments.role).toBe('farmer');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/llm-tool-calling.test.ts`
Expected: FAIL — TypeScript errors (`tools`/`toolChoice`/`toolCalls` do not exist; `LLMTool`/`LLMToolCall` are not exported).

- [ ] **Step 3: Add the types**

In `src/llm/llm-client.ts`, add after the `LLMMessage` interface (~line 16):

```ts
/** An OpenAI-style tool the model may call. `parameters` is a JSON Schema object. */
export interface LLMTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** A single tool call the model emitted. `arguments` is already parsed from JSON. */
export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}
```

In `LLMResponse`, add the field (after `cost?` ~line 33):

```ts
  /** Tool calls the model requested, when tools were supplied. */
  toolCalls?: LLMToolCall[];
```

In `LLMOptions`, add (after `model?` ~line 44):

```ts
  /** Tools the model may call (OpenAI-style). */
  tools?: LLMTool[];
  /** How the model should choose tools. Defaults to 'auto' when tools are present. */
  toolChoice?: 'auto' | 'required' | 'none';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/llm-tool-calling.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/llm/llm-client.ts tests/unit/llm-tool-calling.test.ts
git commit -m "$(cat <<'EOF'
feat(llm): tool-calling types (LLMTool/LLMToolCall, tools/toolCalls)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Request serialization + response parsing helpers

Two module-level helpers, shared by both real providers. Test them through their effects in later tasks, but unit-test `parseToolCalls` directly here since it has the tricky JSON-string-`arguments` guard.

**Files:**
- Modify: `src/llm/llm-client.ts` (add helpers above `MockLLMProvider`, ~line 57)
- Test: `tests/unit/llm-tool-calling.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/llm-tool-calling.test.ts`:

```ts
import { toToolPayload, parseToolCalls } from '@/llm/llm-client';

describe('toToolPayload', () => {
  it('wraps tools in OpenAI function shape', () => {
    const payload = toToolPayload([SPAWN_TOOL]);
    expect(payload).toEqual([{
      type: 'function',
      function: {
        name: 'author_spawn_npc',
        description: 'Spawn one or more NPCs near a target.',
        parameters: SPAWN_TOOL.parameters,
      },
    }]);
  });
});

describe('parseToolCalls', () => {
  it('parses tool_calls with JSON-string arguments', () => {
    const message = {
      tool_calls: [
        { id: 'abc', type: 'function', function: { name: 'author_spawn_npc', arguments: '{"role":"farmer","count":3}' } },
      ],
    };
    expect(parseToolCalls(message)).toEqual([
      { id: 'abc', name: 'author_spawn_npc', arguments: { role: 'farmer', count: 3 } },
    ]);
  });

  it('coerces unparseable arguments to an empty object (guard)', () => {
    const message = { tool_calls: [{ id: 'x', function: { name: 'f', arguments: 'not json' } }] };
    expect(parseToolCalls(message)).toEqual([{ id: 'x', name: 'f', arguments: {} }]);
  });

  it('returns undefined when there are no tool calls', () => {
    expect(parseToolCalls({ content: 'hi' })).toBeUndefined();
    expect(parseToolCalls(undefined)).toBeUndefined();
    expect(parseToolCalls({ tool_calls: [] })).toBeUndefined();
  });

  it('synthesizes an id when the provider omits one', () => {
    const message = { tool_calls: [{ function: { name: 'f', arguments: '{}' } }] };
    const calls = parseToolCalls(message)!;
    expect(calls[0].id).toBe('call_0');
    expect(calls[0].name).toBe('f');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/llm-tool-calling.test.ts`
Expected: FAIL — `toToolPayload` / `parseToolCalls` are not exported.

- [ ] **Step 3: Implement the helpers**

In `src/llm/llm-client.ts`, add after the `LLMProvider` interface (~line 56), before `MockLLMProvider`:

```ts
// ─── Tool-calling helpers (shared by OpenAI + OpenRouter) ────────────────

/** Serialize LLMTool[] into the OpenAI-compatible `tools` request array. */
export function toToolPayload(tools: LLMTool[]): Array<Record<string, unknown>> {
  return tools.map(t => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/**
 * Map a provider `message` object's `tool_calls` into typed LLMToolCall[].
 * `arguments` arrives as a JSON string; parse it and guard against malformed
 * JSON by falling back to an empty object. Returns undefined when there are
 * no calls (so callers can treat "no tools requested" uniformly).
 */
export function parseToolCalls(message: unknown): LLMToolCall[] | undefined {
  const raw = (message as { tool_calls?: unknown })?.tool_calls;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;

  return raw.map((tc, i) => {
    const fn = (tc as { function?: { name?: string; arguments?: string } }).function ?? {};
    const id = (tc as { id?: string }).id ?? `call_${i}`;
    const name = fn.name ?? '';
    let args: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(fn.arguments ?? '{}');
      if (parsed && typeof parsed === 'object') args = parsed as Record<string, unknown>;
    } catch {
      // Malformed arguments → empty object; the executor will reject on validation.
    }
    return { id, name, arguments: args };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/llm-tool-calling.test.ts`
Expected: PASS (all tests so far).

- [ ] **Step 5: Commit**

```bash
git add src/llm/llm-client.ts tests/unit/llm-tool-calling.test.ts
git commit -m "$(cat <<'EOF'
feat(llm): toToolPayload + parseToolCalls helpers (JSON-arg guard)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: MockLLMProvider canned tool calls

When `opts.tools` is present, the mock returns tool calls so SP2/SP3 work offline. Default: one call on the first tool with empty args. Optional constructor override for explicit canned calls.

**Files:**
- Modify: `src/llm/llm-client.ts` (`MockLLMProvider` ~lines 60-115)
- Test: `tests/unit/llm-tool-calling.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/llm-tool-calling.test.ts`:

```ts
describe('MockLLMProvider tool calls', () => {
  it('returns a default tool call on the first tool when tools are supplied', async () => {
    const mock = new MockLLMProvider(0);
    const resp = await mock.generate([{ role: 'user', content: 'spawn farmers' }], { tools: [SPAWN_TOOL] });
    expect(resp.toolCalls).toHaveLength(1);
    expect(resp.toolCalls![0].name).toBe('author_spawn_npc');
    expect(resp.toolCalls![0].arguments).toEqual({});
  });

  it('returns no tool calls when no tools are supplied (back-compat)', async () => {
    const mock = new MockLLMProvider(0);
    const resp = await mock.generate([{ role: 'user', content: 'hi' }]);
    expect(resp.toolCalls).toBeUndefined();
  });

  it('returns explicit canned tool calls when configured', async () => {
    const canned: LLMToolCall[] = [{ id: 'c1', name: 'author_remove_entity', arguments: { entityId: 'npc-7' } }];
    const mock = new MockLLMProvider(0, { cannedToolCalls: canned });
    const resp = await mock.generate([{ role: 'user', content: 'remove npc' }], { tools: [SPAWN_TOOL] });
    expect(resp.toolCalls).toEqual(canned);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/llm-tool-calling.test.ts`
Expected: FAIL — mock ignores `tools`, `toolCalls` is undefined; constructor rejects the 2nd arg.

- [ ] **Step 3: Implement**

In `src/llm/llm-client.ts`, change the `MockLLMProvider` constructor and add a config field:

```ts
export class MockLLMProvider implements LLMProvider {
  private delayMs: number;
  private cannedToolCalls?: LLMToolCall[];

  constructor(delayMs = 50, opts?: { cannedToolCalls?: LLMToolCall[] }) {
    this.delayMs = delayMs;
    this.cannedToolCalls = opts?.cannedToolCalls;
  }
```

In `generate`, after the `await new Promise(...)` delay and before computing `content`, add the tool-call branch:

```ts
    // Tool-calling path: when tools are supplied, return canned tool calls so
    // downstream consumers (Create panel, Fate) can be tested without a network.
    if (opts?.tools && opts.tools.length > 0) {
      const toolCalls = this.cannedToolCalls
        ?? [{ id: 'mock_call_0', name: opts.tools[0].name, arguments: {} }];
      return {
        content: '',
        toolCalls,
        usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
        latencyMs: Date.now() - start,
      };
    }
```

(`start` is already declared at the top of `generate`. Place this block right after `await new Promise(...)`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/llm-tool-calling.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the existing LLM tests to confirm no regression**

Run: `npx vitest run tests/unit/llm-backfill.test.ts tests/unit/llm-backfill-setclient.test.ts`
Expected: PASS (MockLLMProvider's no-tools path is unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/llm/llm-client.ts tests/unit/llm-tool-calling.test.ts
git commit -m "$(cat <<'EOF'
feat(llm): MockLLMProvider returns canned tool calls when tools supplied

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: OpenRouterProvider tool-calling wiring

Send `tools`/`tool_choice` in the request; parse `message.tool_calls` via `parseToolCalls`. Reuse the stubbed-fetch pattern from `tests/unit/pixellab.test.ts`.

**Files:**
- Modify: `src/llm/llm-client.ts` (`OpenRouterProvider.generate` ~lines 261-373)
- Test: `tests/unit/llm-tool-calling.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/llm-tool-calling.test.ts`:

```ts
afterEach(() => vi.unstubAllGlobals());

function stubFetchOnce(jsonBody: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => jsonBody,
    text: async () => JSON.stringify(jsonBody),
  })) as never);
}

describe('OpenRouterProvider tool-calling', () => {
  it('sends OpenAI-style tools + tool_choice and parses tool_calls', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        model: 'deepseek/deepseek-v4',
        choices: [{ message: { content: '', tool_calls: [
          { id: 'tc1', type: 'function', function: { name: 'author_spawn_npc', arguments: '{"role":"farmer","count":2}' } },
        ] } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchMock as never);

    const provider = new OpenRouterProvider({ apiKey: 'k', model: 'deepseek/deepseek-v4' });
    const resp = await provider.generate(
      [{ role: 'user', content: 'add 2 farmers' }],
      { tools: [SPAWN_TOOL], toolChoice: 'auto' },
    );

    const sentBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(sentBody.tools).toEqual(toToolPayload([SPAWN_TOOL]));
    expect(sentBody.tool_choice).toBe('auto');
    expect(resp.toolCalls).toEqual([
      { id: 'tc1', name: 'author_spawn_npc', arguments: { role: 'farmer', count: 2 } },
    ]);
  });

  it('omits tools from the request body when none are supplied', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: '{"narration":"ok"}' } }] }),
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchMock as never);

    const provider = new OpenRouterProvider({ apiKey: 'k' });
    const resp = await provider.generate([{ role: 'user', content: 'hi' }]);

    const sentBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect('tools' in sentBody).toBe(false);
    expect('tool_choice' in sentBody).toBe(false);
    expect(resp.toolCalls).toBeUndefined();
    expect(resp.parsed).toEqual({ narration: 'ok' });
  });
});
```

(`stubFetchOnce` is defined for reuse in Task 5; it is intentionally unused here.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/llm-tool-calling.test.ts -t OpenRouter`
Expected: FAIL — body has no `tools`/`tool_choice`; `resp.toolCalls` is undefined.

- [ ] **Step 3: Implement**

In `OpenRouterProvider.generate`, after the `body` object is built and after the `body.reasoning = ...` block (~line 279), add:

```ts
    if (opts?.tools && opts.tools.length > 0) {
      body.tools = toToolPayload(opts.tools);
      body.tool_choice = opts.toolChoice ?? 'auto';
    }
```

In the success branch, after `const content = filterProviderTokens(...)` (~line 321), capture the message and its tool calls:

```ts
        const message = data.choices?.[0]?.message;
        const toolCalls = parseToolCalls(message);
```

Add `toolCalls` to the returned object (in the `return { content, parsed, usage..., latencyMs, cost, model }` block ~line 344):

```ts
          toolCalls,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/llm-tool-calling.test.ts -t OpenRouter`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/llm/llm-client.ts tests/unit/llm-tool-calling.test.ts
git commit -m "$(cat <<'EOF'
feat(llm): OpenRouterProvider sends tools + parses tool_calls

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: OpenAIProvider tool-calling wiring + LLMClient.generateWithTools

Same request/parse wiring on `OpenAIProvider`, then the single-shot `generateWithTools` entry point on `LLMClient`.

**Files:**
- Modify: `src/llm/llm-client.ts` (`OpenAIProvider.generate` ~lines 171-222; `LLMClient` ~lines 119-153)
- Test: `tests/unit/llm-tool-calling.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/llm-tool-calling.test.ts`:

```ts
describe('OpenAIProvider tool-calling', () => {
  it('sends tools + tool_choice and parses tool_calls', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        choices: [{ message: { content: '', tool_calls: [
          { id: 'oa1', type: 'function', function: { name: 'author_move_entity', arguments: '{"entityId":"npc-3","to":{"x":5,"y":6}}' } },
        ] } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchMock as never);

    const provider = new OpenAIProvider({ apiKey: 'k' });
    const resp = await provider.generate(
      [{ role: 'user', content: 'move npc-3' }],
      { tools: [SPAWN_TOOL], toolChoice: 'required' },
    );

    const sentBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(sentBody.tools).toEqual(toToolPayload([SPAWN_TOOL]));
    expect(sentBody.tool_choice).toBe('required');
    expect(resp.toolCalls![0]).toEqual({
      id: 'oa1', name: 'author_move_entity', arguments: { entityId: 'npc-3', to: { x: 5, y: 6 } },
    });
  });
});

describe('LLMClient.generateWithTools', () => {
  it('forwards tools to the provider and returns its tool calls (single-shot)', async () => {
    const mock = new MockLLMProvider(0);
    const client = new LLMClient(mock);
    const resp = await client.generateWithTools(
      [{ role: 'user', content: 'spawn farmers' }],
      [SPAWN_TOOL],
    );
    expect(resp.toolCalls).toHaveLength(1);
    expect(resp.toolCalls![0].name).toBe('author_spawn_npc');
  });

  it('passes through toolChoice and other opts', async () => {
    const captured: LLMOptions[] = [];
    const spy: LLMProvider = {
      name: () => 'spy', isAvailable: () => true,
      async generate(_m, o) { captured.push(o ?? {}); return { content: '', latencyMs: 0 }; },
    };
    const client = new LLMClient(spy);
    await client.generateWithTools([{ role: 'user', content: 'x' }], [SPAWN_TOOL], { toolChoice: 'required', maxTokens: 2048 });
    expect(captured[0].tools).toEqual([SPAWN_TOOL]);
    expect(captured[0].toolChoice).toBe('required');
    expect(captured[0].maxTokens).toBe(2048);
  });
});
```

Add `LLMProvider` to the import at the top of the file:

```ts
import {
  MockLLMProvider, OpenAIProvider, OpenRouterProvider, LLMClient,
  toToolPayload, parseToolCalls,
  type LLMTool, type LLMToolCall, type LLMOptions, type LLMResponse, type LLMProvider,
} from '@/llm/llm-client';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/llm-tool-calling.test.ts -t "OpenAIProvider tool-calling|generateWithTools"`
Expected: FAIL — OpenAI body lacks tools; `generateWithTools` is not a function.

- [ ] **Step 3: Implement OpenAIProvider wiring**

In `OpenAIProvider.generate`, change `const body = {...}` to a typed mutable object so tools can be appended (it is currently a `const` object literal). Replace the `const body = { ... };` block (~lines 175-181) with:

```ts
    const body: Record<string, unknown> = {
      model: opts?.model ?? this.config.model ?? 'gpt-3.5-turbo',
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: opts?.maxTokens ?? 200,
      temperature: opts?.temperature ?? 0.7,
      stop: opts?.stop,
    };
    if (opts?.tools && opts.tools.length > 0) {
      body.tools = toToolPayload(opts.tools);
      body.tool_choice = opts.toolChoice ?? 'auto';
    }
```

After `const data = await resp.json();` (~line 202), capture the message + tool calls:

```ts
    const message = data.choices?.[0]?.message;
    const content = message?.content ?? '';
    const toolCalls = parseToolCalls(message);
```

(Remove the old `const content = data.choices?.[0]?.message?.content ?? '';` line — it is replaced by the two lines above.)

Add `toolCalls` to the return object (~line 212):

```ts
      toolCalls,
```

- [ ] **Step 4: Implement LLMClient.generateWithTools**

In `LLMClient`, add after `generateNpcBackfill` (~line 145):

```ts
  /**
   * Single-shot tool-calling for the capable tier (Create panel, Fate).
   * Sends the tool list and returns the model's tool calls. No multi-turn
   * read loop in v1 — one request, one set of tool calls.
   */
  async generateWithTools(
    messages: LLMMessage[],
    tools: LLMTool[],
    opts?: LLMOptions,
  ): Promise<LLMResponse> {
    return this.provider.generate(messages, {
      maxTokens: 1024,
      toolChoice: 'auto',
      ...opts,
      tools,
    });
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/llm-tool-calling.test.ts`
Expected: PASS (entire file).

- [ ] **Step 6: Typecheck + full suite**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm test`
Expected: all green (prior baseline 1019 + this file's tests).

- [ ] **Step 7: Commit**

```bash
git add src/llm/llm-client.ts tests/unit/llm-tool-calling.test.ts
git commit -m "$(cat <<'EOF'
feat(llm): OpenAIProvider tool-calling + LLMClient.generateWithTools

Single-shot tool-calling entry point for the capable tier (Create panel,
later Fate). Completes the SP1 tool-calling substrate.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage (design §3 SP1):** ✅ `LLMTool`/`LLMToolCall` (Task 1); `LLMOptions.tools`/`toolChoice` (Task 1); `LLMResponse.toolCalls` (Task 1); OpenRouter sends `tools`/`tool_choice` + parses `tool_calls` with JSON-string `arguments` guard (Tasks 2, 4); OpenAIProvider same (Task 5); MockLLMProvider canned calls (Task 3); `generateWithTools` single-shot helper (Task 5). No multi-turn loop — matches "Single-shot for v1".
- **Determinism:** No `src/sim/` code is touched, so `no-random-in-sim` is unaffected. The mock uses no randomness.
- **Type consistency:** `toToolPayload`/`parseToolCalls` names are used identically across Tasks 2/4/5. `generateWithTools(messages, tools, opts)` signature matches the spec and its callers in SP3.
- **Back-compat:** `MockLLMProvider(delayMs)` still works (new 2nd arg optional); no-tools paths on all providers return `toolCalls: undefined` and keep existing `parsed` JSON behavior — verified by the no-tools tests and the existing llm-backfill suite (Task 3 Step 5).
