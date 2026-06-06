/**
 * LLM Client Interface — abstraction for different LLM providers.
 *
 * Small Gods uses a two-tier LLM strategy:
 *   - Tier 1 (NPC backfill): Fast, cheap model (<200ms target)
 *   - Tier 2 (DM agent): Larger model for story direction
 *
 * This interface allows swapping providers (local, cloud, mock for tests).
 */

import { filterProviderTokens } from './filter-provider-tokens';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

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

export interface LLMResponse {
  /** The generated text content */
  content: string;
  /** Parsed JSON if the response was valid JSON */
  parsed?: Record<string, unknown>;
  /** Raw token usage if available */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost?: number; // Cost in USD if available (e.g., from OpenRouter)
  };
  /** Latency in ms */
  latencyMs: number;
  /** Cost in USD (convenience, same as usage.cost) */
  cost?: number;
  /** Tool calls the model requested, when tools were supplied. */
  toolCalls?: LLMToolCall[];
  /** Cache outcome for OpenRouter response caching, when known. */
  cacheStatus?: 'HIT' | 'MISS';
}

export interface LLMOptions {
  /** Max tokens to generate */
  maxTokens?: number;
  /** Temperature (0-2, lower = more deterministic) */
  temperature?: number;
  /** Stop sequences */
  stop?: string[];
  /** Provider-specific model ID */
  model?: string;
  /** Tools the model may call (OpenAI-style). */
  tools?: LLMTool[];
  /** How the model should choose tools. Defaults to 'auto' when tools are present. */
  toolChoice?: 'auto' | 'required' | 'none';
  /** Mark this call cache-eligible (OpenRouter response caching). Object form sets TTL/clear. */
  cache?: boolean | { ttlSeconds?: number; clear?: boolean };
  /** Auto-router cost/quality knob (0–10) — only used when model is 'openrouter/auto'. */
  costQualityTradeoff?: number;
  /** Auto-router allowed model ids/globs — only used when model is 'openrouter/auto'. */
  allowedModels?: string[];
}

export interface LLMProvider {
  /** Generate text from a prompt */
  generate(messages: LLMMessage[], opts?: LLMOptions): Promise<LLMResponse>;

  /** Check if the provider is available/configured */
  isAvailable(): boolean;

  /** Get provider name for logging */
  name(): string;
}

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
      // Malformed arguments → empty object; the executor will reject on
      // validation. Warn so the real cause (garbled model JSON) is diagnosable
      // rather than surfacing later as a confusing missing-field rejection.
      console.warn('[llm] tool-call arguments were not valid JSON', { name, raw: fn.arguments });
    }
    return { id, name, arguments: args };
  });
}

// ─── Mock Provider (for testing) ─────────────────────────────────────────

/**
 * A sensible default tool call for the mock, so no-key/dev mode renders readable
 * content instead of empty args. emit_mind_page gets a short canned page; every
 * other tool keeps the empty-args default (Create panel / Fate paths rely on it).
 */
function defaultMockToolCall(tool: LLMTool): LLMToolCall {
  if (tool.name === 'emit_mind_page') {
    return {
      id: 'mock_call_0',
      name: 'emit_mind_page',
      arguments: {
        prose: 'A chore left undone, the smell of rain coming, a half-remembered slight.',
        links: [
          { label: 'an old fear', kind: 'concept' },
          { label: 'tomorrow', kind: 'concept' },
        ],
      },
    };
  }
  return { id: 'mock_call_0', name: tool.name, arguments: {} };
}

export class MockLLMProvider implements LLMProvider {
  private delayMs: number;
  private cannedToolCalls?: LLMToolCall[];

  constructor(delayMs = 50, opts?: { cannedToolCalls?: LLMToolCall[] }) {
    this.delayMs = delayMs;
    this.cannedToolCalls = opts?.cannedToolCalls;
  }

  async generate(messages: LLMMessage[], opts?: LLMOptions): Promise<LLMResponse> {
    const start = Date.now();
    await new Promise(resolve => setTimeout(resolve, this.delayMs));

    // Tool-calling path: when tools are supplied, return canned tool calls so
    // downstream consumers (Create panel, Fate) can be tested without a network.
    if (opts?.tools && opts.tools.length > 0) {
      const toolCalls = this.cannedToolCalls
        ?? [defaultMockToolCall(opts.tools[0])];
      return {
        content: '',
        toolCalls,
        usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
        latencyMs: Date.now() - start,
      };
    }

    // Simple mock: return a generic response
    const lastUser = messages.filter(m => m.role === 'user').pop();
    const content = lastUser ? this.mockResponse(lastUser.content) : '{"narration": "Nothing happens."}';

    let parsed: Record<string, unknown> | undefined;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Not JSON, that's fine
    }

    return {
      content,
      parsed,
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      },
      latencyMs: Date.now() - start,
    };
  }

  isAvailable(): boolean {
    return true;
  }

  name(): string {
    return 'MockLLM';
  }

  private mockResponse(userPrompt: string): string {
    // Check if it looks like an NPC prompt
    if (userPrompt.includes('=== NPC CARD ===')) {
      return JSON.stringify({
        dialogue: "I'm just a simple villager, trying to get by.",
        inner_thought: 'Wonders if the gods notice folk like them.',
        belief_delta: { faith: 0.02 },
        mood_delta: 0.01,
      });
    }

    return '{"narration": "The scene continues uneventfully."}';
  }
}

// ─── LLM Client (high-level wrapper) ───────────────────────────────────

export class LLMClient {
  private provider: LLMProvider;
  private onUsage?: (r: LLMResponse) => void;

  constructor(provider: LLMProvider, onUsage?: (r: LLMResponse) => void) {
    this.provider = provider;
    this.onUsage = onUsage;
  }

  /**
   * Generate NPC backfill narration from a built prompt.
   * Target latency: <200ms for Tier 1 (NPC backfill).
   */
  async generateNpcBackfill(
    systemPrompt: string,
    userPrompt: string,
    opts?: LLMOptions,
  ): Promise<LLMResponse> {
    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const res = await this.provider.generate(messages, {
      maxTokens: 200,
      temperature: 0.7,
      ...opts,
    });
    this.onUsage?.(res);
    return res;
  }

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
    const res = await this.provider.generate(messages, {
      maxTokens: 1024,
      toolChoice: 'auto',
      ...opts,
      tools,
    });
    this.onUsage?.(res);
    return res;
  }

  /**
   * Check if the LLM service is available.
   */
  isAvailable(): boolean {
    return this.provider.isAvailable();
  }
}

// ─── OpenAI-Compatible Provider ──────────────────────────────

export interface OpenAIConfig {
  apiKey: string;
  baseUrl?: string; // Defaults to 'https://api.openai.com/v1'
  model?: string; // Defaults to 'gpt-3.5-turbo'
  orgId?: string;
}

export class OpenAIProvider implements LLMProvider {
  private config: OpenAIConfig;

  constructor(config: OpenAIConfig) {
    this.config = config;
  }

  async generate(messages: LLMMessage[], opts?: LLMOptions): Promise<LLMResponse> {
    const start = Date.now();
    const url = `${this.config.baseUrl ?? 'https://api.openai.com/v1'}/chat/completions`;

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

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
    };
    if (this.config.orgId) {
      headers['OpenAI-Organization'] = this.config.orgId;
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`OpenAI API error ${resp.status}: ${errText}`);
    }

    const data = await resp.json();
    const message = data.choices?.[0]?.message;
    const content = message?.content ?? '';
    const toolCalls = parseToolCalls(message);

    let parsed: Record<string, unknown> | undefined;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Not JSON
    }

    return {
      content,
      parsed,
      toolCalls,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
      latencyMs: Date.now() - start,
    };
  }

  isAvailable(): boolean {
    return !!this.config.apiKey;
  }

  name(): string {
    return `OpenAI(${this.config.model ?? 'gpt-3.5-turbo'})`;
  }
}

// ─── OpenRouter Provider ──────────────────────────────
// OpenRouter provides access to hundreds of models through OpenAI-compatible API
// Docs: https://openrouter.ai/docs
// Learnings from pikkolo-cms-mvp:
//   - Use HTTP-Referer and X-Title headers for OpenRouter rankings
//   - Extract cost from usage.model_extra.cost
//   - Support extra_body for model-specific params (reasoning, etc.)

export interface OpenRouterConfig {
  apiKey: string;
  model?: string; // e.g. 'anthropic/claude-3-haiku', 'openai/gpt-3.5-turbo', 'google/gemini-flash-1.5'
  siteUrl?: string; // Optional: your site URL for OpenRouter rankings
  siteName?: string; // Optional: your site name for OpenRouter rankings
  defaultHeaders?: Record<string, string>; // Optional: additional headers
  /** Default auto-router cost/quality tradeoff (0–10) for 'openrouter/auto'. */
  costQualityTradeoff?: number;
  /** Master switch for response caching; when false, cache headers are never sent. Default treated as true. */
  cacheEnabled?: boolean;
}

export interface OpenRouterResponse extends LLMResponse {
  cost?: number; // Cost in USD if available from OpenRouter
  model?: string; // Actual model used (OpenRouter may route to different model)
}

export class OpenRouterProvider implements LLMProvider {
  private config: OpenRouterConfig;

  constructor(config: OpenRouterConfig) {
    this.config = config;
  }

  async generate(messages: LLMMessage[], opts?: LLMOptions): Promise<OpenRouterResponse> {
    const start = Date.now();
    const url = 'https://openrouter.ai/api/v1/chat/completions';

    const effectiveModel = opts?.model ?? this.config.model ?? 'openai/gpt-3.5-turbo';

    const body: Record<string, unknown> = {
      model: effectiveModel,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: opts?.maxTokens ?? 200,
      temperature: opts?.temperature ?? 0.7,
      stop: opts?.stop,
    };

    // Reasoning/thinking control (OpenRouter top-level `reasoning` param).
    // Default to MINIMUM thinking — disabled — to keep latency and cost down for
    // hybrid models like DeepSeek V4. Overridable per-call via opts.reasoning
    // (e.g. the capable Fate tier may opt back in at key moments).
    body.reasoning = (opts && 'reasoning' in opts)
      ? (opts as Record<string, unknown>).reasoning
      : { enabled: false };

    if (opts?.tools && opts.tools.length > 0) {
      body.tools = toToolPayload(opts.tools);
      body.tool_choice = opts.toolChoice ?? 'auto';
    }

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

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
      'HTTP-Referer': this.config.siteUrl ?? window.location?.href ?? 'http://localhost',
      'X-Title': this.config.siteName ?? 'Small Gods Game',
      ...this.config.defaultHeaders,
    };

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

    let lastError: Error | null = null;
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });

        if (!resp.ok) {
          const errText = await resp.text();
          
          // Check for specific error types
          if (resp.status === 401) {
            throw new Error(`OpenRouter API key invalid or missing. Get one at https://openrouter.ai/keys`);
          } else if (resp.status === 404) {
            throw new Error(`Model not found: ${body.model}. See https://openrouter.ai/models for available models.`);
          } else if (resp.status === 429) {
            // Rate limited - wait and retry
            if (attempt < maxRetries - 1) {
              const waitMs = 1000 * Math.pow(2, attempt); // Exponential backoff
              await new Promise(resolve => setTimeout(resolve, waitMs));
              continue;
            }
          }
          
          throw new Error(`OpenRouter API error ${resp.status}: ${errText}`);
        }

        const data = await resp.json();
        const message = data.choices?.[0]?.message;
        const content = filterProviderTokens(message?.content ?? '');
        const toolCalls = parseToolCalls(message);

        let parsed: Record<string, unknown> | undefined;
        try {
          parsed = JSON.parse(content);
        } catch {
          // Not JSON
        }

        // Extract cost from OpenRouter's usage data
        // OpenRouter includes cost in usage.model_extra.cost
        let cost: number | undefined;
        if (data.usage) {
          const modelExtra = data.usage.model_extra;
          if (modelExtra && typeof modelExtra === 'object' && 'cost' in modelExtra) {
            cost = Number(modelExtra.cost);
          }
          // Also check top-level cost field (some OpenRouter responses)
          if (cost === undefined && 'cost' in data.usage) {
            cost = Number(data.usage.cost);
          }
        }

        // Cache status: trust the header if CORS-exposed, else infer a HIT from
        // zero usage on a call we marked cache-eligible (a hit reports 0 tokens).
        let cacheStatus: 'HIT' | 'MISS' | undefined;
        const headerStatus = resp.headers?.get('x-openrouter-cache-status');
        if (headerStatus === 'HIT' || headerStatus === 'MISS') {
          cacheStatus = headerStatus;
        } else if (cacheEnabled && data.usage) {
          cacheStatus = (data.usage.total_tokens ?? 0) === 0 ? 'HIT' : 'MISS';
        }

        return {
          content,
          parsed,
          toolCalls,
          usage: data.usage ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          } : undefined,
          latencyMs: Date.now() - start,
          cost,
          cacheStatus,
          model: data.model, // Actual model used (OpenRouter may route)
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        
        // Don't retry on auth/errors)
        if (err instanceof Error && (err.message.includes('API key') || err.message.includes('Model not found'))) {
          throw err;
        }
        
        // Retry on network errors or 5xx
        if (attempt < maxRetries - 1) {
          const waitMs = 1000 * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, waitMs));
        }
      }
    }

    throw lastError ?? new Error('OpenRouter request failed after retries');
  }

  isAvailable(): boolean {
    return !!this.config.apiKey;
  }

  name(): string {
    return `OpenRouter(${this.config.model ?? 'openai/gpt-3.5-turbo'})`;
  }
}
