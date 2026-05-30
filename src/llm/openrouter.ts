/**
 * OpenRouter Provider for Small Gods
 *
 * OpenRouter provides access to hundreds of AI models through a single
 * OpenAI-compatible API endpoint. This implementation adds:
 * - Automatic retries with exponential backoff
 * - Cost tracking from OpenRouter's usage data
 * - Support for reasoning models (DeepSeek R1, etc.)
 * - Proper error handling for common OpenRouter errors
 *
 * Learnings from pikkolo-cms-mvp:
 * - Use HTTP-Referer and X-Title headers for OpenRouter rankings
 * - Extract cost from usage.model_extra.cost
 * - Support extra_body for model-specific params (reasoning, etc.)
 */

import type { LLMMessage, LLMResponse, LLMOptions } from './llm-client';
import { LLMProvider } from './llm-client';

// ─── Configuration ───────────────────────────────────────

export interface OpenRouterConfig {
  apiKey: string;
  model?: string; // e.g. 'anthropic/claude-3-haiku', 'openai/gpt-4o-mini'
  siteUrl?: string; // Optional: your site URL for OpenRouter rankings
  siteName?: string; // Optional: your site name for OpenRouter rankings
  defaultHeaders?: Record<string, string>; // Optional: additional headers
}

// ─── Response Types ──────────────────────────────────────

interface OpenRouterUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost?: number; // OpenRouter-specific: cost in USD
}

interface OpenRouterResponse {
  id: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: OpenRouterUsage;
  model: string; // Actual model used (OpenRouter may route)
}

// ─── Provider Implementation ─────────────────────────────

export class OpenRouterProvider implements LLMProvider {
  private config: OpenRouterConfig;
  private baseUrl = 'https://openrouter.ai/api/v1';

  constructor(config: OpenRouterConfig) {
    this.config = config;
  }

  /**
   * Generate text using OpenRouter API.
   * Includes retry logic and cost tracking.
   */
  async generate(messages: LLMMessage[], opts?: LLMOptions): Promise<LLMResponse> {
    const start = Date.now();
    const url = `${this.baseUrl}/chat/completions`;

    const body: Record<string, unknown> = {
      model: opts?.model ?? this.config.model ?? 'openai/gpt-4o-mini',
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: opts?.maxTokens ?? 200,
      temperature: opts?.temperature ?? 0.7,
      stop: opts?.stop,
    };

    // Add reasoning support for models that support it (e.g., DeepSeek R1)
    // OpenRouter-specific: pass via extra_body
    if (opts && 'reasoning' in opts) {
      body.extra_body = { reasoning: (opts as Record<string, unknown>).reasoning };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
      'HTTP-Referer': this.config.siteUrl ?? window.location?.href ?? 'http://localhost',
      'X-Title': this.config.siteName ?? 'Small Gods Game',
      ...this.config.defaultHeaders,
    };

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
            throw new Error(
              `OpenRouter API key invalid or missing. Get one at https://openrouter.ai/keys`,
            );
          } else if (resp.status === 404) {
            throw new Error(
              `Model not found: ${body.model}. See https://openrouter.ai/models for available models.`,
            );
          } else if (resp.status === 429) {
            // Rate limited - wait and retry
            if (attempt < maxRetries - 1) {
              const waitMs = 1000 * Math.pow(2, attempt); // Exponential backoff
              await new Promise((resolve) => setTimeout(resolve, waitMs));
              continue;
            }
          }

          throw new Error(`OpenRouter API error ${resp.status}: ${errText}`);
        }

        const data: OpenRouterResponse = await resp.json();
        const content = data.choices?.[0]?.message?.content ?? '';

        let parsed: Record<string, unknown> | undefined;
        try {
          parsed = JSON.parse(content);
        } catch {
          // Not JSON
        }

        // Extract cost from OpenRouter's usage data
        let cost: number | undefined;
        if (data.usage) {
          cost = data.usage.cost;
        }

        return {
          content,
          parsed,
          usage: data.usage
            ? {
                promptTokens: data.usage.prompt_tokens,
                completionTokens: data.usage.completion_tokens,
                totalTokens: data.usage.total_tokens,
                cost: data.usage.cost,
              }
            : undefined,
          latencyMs: Date.now() - start,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Don't retry on auth/errors
        if (err instanceof Error && (err.message.includes('API key') || err.message.includes('Model not found'))) {
          throw err;
        }

        // Retry on network errors or 5xx
        if (attempt < maxRetries - 1) {
          const waitMs = 1000 * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
      }
    }

    throw lastError ?? new Error('OpenRouter request failed after retries');
  }

  /**
   * Check if the provider is available/configured.
   */
  isAvailable(): boolean {
    return !!this.config.apiKey;
  }

  /**
   * Get provider name for logging.
   */
  name(): string {
    return `OpenRouter(${this.config.model ?? 'openai/gpt-4o-mini'})`;
  }
}

// ─── Factory Function ──────────────────────────────────────

/**
 * Create an OpenRouter provider from config.
 * Convenience function for game.ts integration.
 */
export function createOpenRouterProvider(config: OpenRouterConfig): OpenRouterProvider {
  return new OpenRouterProvider(config);
}

// ─── Model Presets ──────────────────────────────────────

/**
 * Popular OpenRouter model presets for Small Gods.
 * These are optimized for different use cases:
 * - NPC dialogue: Fast, cheap models (GPT-4o Mini, Claude Haiku)
 * - DM agent: Higher quality models (GPT-4o, Claude Sonnet)
 * - Reasoning: Step-by-step thinking (DeepSeek R1)
 */
export const OPENROUTER_MODEL_PRESETS = {
  // Fast & cheap (good for NPC backfill)
  FAST_CHEAP: 'openai/gpt-4o-mini',
  CLAUDE_HAIKU: 'anthropic/claude-3-haiku',

  // Balanced (good for most gameplay)
  GPT4O: 'openai/gpt-4o',
  CLAUDE_SONNET: 'anthropic/claude-3-sonnet',

  // Reasoning (good for complex decisions)
  DEEPSEEK_R1: 'deepseek/deepseek-r1',

  // Free options
  GEMINI_FLASH: 'google/gemini-flash-1.5',
} as const;

export type OpenRouterModel = (typeof OPENROUTER_MODEL_PRESETS)[keyof typeof OPENROUTER_MODEL_PRESETS];
