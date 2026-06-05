/**
 * LLM Provider Factory
 *
 * Creates the appropriate LLM provider based on configuration.
 * Supports: mock, openai, openrouter
 */

import type { LLMProvider } from './llm-client';
import { MockLLMProvider, OpenAIProvider, OpenRouterProvider, type OpenAIConfig, type OpenRouterConfig } from './llm-client';
import { DEFAULT_CHAT_MODEL, DEFAULT_CAPABLE_MODEL, DEAD_MODEL_IDS } from './openrouter-catalog';

export type ProviderType = 'mock' | 'openai' | 'openrouter';

export interface ProviderConfig {
  type: ProviderType;
  // OpenAI
  openaiApiKey?: string;
  openaiModel?: string;
  openaiBaseUrl?: string;
  // OpenRouter
  openrouterApiKey?: string;
  openrouterModel?: string;
  openrouterModelCapable?: string;
  openrouterSiteUrl?: string;
  openrouterSiteName?: string;
  // Shared
  maxTokens?: number;
  temperature?: number;
}

/**
 * Create an LLM provider from config.
 */
export function createProvider(config: ProviderConfig): LLMProvider {
  switch (config.type) {
    case 'mock':
      return new MockLLMProvider(50); // 50ms delay

    case 'openai': {
      if (!config.openaiApiKey) {
        throw new Error('OpenAI API key required. Get one at https://platform.openai.com/api-keys');
      }
      const openaiConfig: OpenAIConfig = {
        apiKey: config.openaiApiKey,
        baseUrl: config.openaiBaseUrl,
        model: config.openaiModel,
      };
      return new OpenAIProvider(openaiConfig);
    }

    case 'openrouter': {
      if (!config.openrouterApiKey) {
        throw new Error('OpenRouter API key required. Get one at https://openrouter.ai/keys');
      }
      const orConfig: OpenRouterConfig = {
        apiKey: config.openrouterApiKey,
        model: config.openrouterModel ?? DEFAULT_CHAT_MODEL,
        siteUrl: config.openrouterSiteUrl,
        siteName: config.openrouterSiteName ?? 'Small Gods Game',
      };
      return new OpenRouterProvider(orConfig);
    }

    default:
      throw new Error(`Unknown provider type: ${(config as ProviderConfig).type}`);
  }
}

/**
 * Load provider config from localStorage.
 */
export function loadProviderConfig(): ProviderConfig {
  const saved = localStorage.getItem('small-gods-llm-provider');
  if (saved) {
    try {
      return migrateDeadModels(JSON.parse(saved) as ProviderConfig);
    } catch {
      // fall through
    }
  }

  // Check for OpenRouter key in env
  const env = (import.meta as unknown) as Record<string, unknown>;
  const envKey = (env.OPENROUTER_API_KEY ?? (env.env as Record<string, unknown>)?.OPENROUTER_API_KEY) as string | undefined;

  return {
    type: envKey ? 'openrouter' : 'mock',
    openrouterApiKey: envKey,
    openrouterModel: DEFAULT_CHAT_MODEL,
    openrouterModelCapable: DEFAULT_CAPABLE_MODEL,
    maxTokens: 200,
    temperature: 0.7,
  };
}

/**
 * Rewrite any persisted model ID that is no longer a valid OpenRouter ID
 * (see {@link DEAD_MODEL_IDS}) to the current default. A stale localStorage
 * entry pointing at a dead ID would otherwise keep 400-ing on every backfill
 * ("Their mind clouds over") with no way for the player to recover but to
 * clear storage. The rewrite is silent and idempotent.
 */
export function migrateDeadModels(config: ProviderConfig): ProviderConfig {
  if (config.openrouterModel && DEAD_MODEL_IDS.has(config.openrouterModel)) {
    config.openrouterModel = DEFAULT_CHAT_MODEL;
  }
  if (config.openrouterModelCapable && DEAD_MODEL_IDS.has(config.openrouterModelCapable)) {
    config.openrouterModelCapable = DEFAULT_CAPABLE_MODEL;
  }
  return config;
}

/**
 * Save provider config to localStorage.
 */
export function saveProviderConfig(config: ProviderConfig): void {
  localStorage.setItem('small-gods-llm-provider', JSON.stringify(config));
}

/**
 * Get a user-friendly provider display name.
 */
export function getProviderDisplayName(type: ProviderType): string {
  switch (type) {
    case 'mock': return 'Mock (No API Key)';
    case 'openai': return 'OpenAI';
    case 'openrouter': return 'OpenRouter (100+ Models)';
  }
}
