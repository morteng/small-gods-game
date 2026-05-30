/**
 * LLM Configuration — persists API keys and model preferences.
 * 
 * Uses localStorage for simplicity. In production, this would be
 * replaced with a secure backend or electron-store.
 */

export type LLMProviderType = 'mock' | 'openai' | 'anthropic';

export interface LLMConfig {
  provider: LLMProviderType;
  openai?: {
    apiKey: string;
    baseUrl?: string;
    model?: string;
    orgId?: string;
  };
  anthropic?: {
    apiKey: string;
    model?: string;
  };
  /** Global settings */
  maxTokens: number;
  temperature: number;
  /** Enable/disable LLM features */
  enabled: boolean;
}

const STORAGE_KEY = 'small-gods-llm-config';
const DEFAULT_CONFIG: LLMConfig = {
  provider: 'mock',
  maxTokens: 200,
  temperature: 0.7,
  enabled: true,
};

/** Load config from localStorage */
export function loadLLMConfig(): LLMConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch (e) {
    console.warn('[LLM Config] Failed to load config:', e);
  }
  return { ...DEFAULT_CONFIG };
}

/** Save config to localStorage */
export function saveLLMConfig(config: LLMConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    console.warn('[LLM Config] Failed to save config:', e);
  }
}

/** Create an LLM provider from config */
export function createProviderFromConfig(config: LLMConfig) {
  const { createLLMClient, MockLLMProvider, OpenAIProvider } = require('@/llm/llm-client');
  
  switch (config.provider) {
    case 'openai':
      if (!config.openai?.apiKey) {
        console.warn('[LLM] No OpenAI API key configured, falling back to mock');
        return new MockLLMProvider(50);
      }
      return new OpenAIProvider({
        apiKey: config.openai.apiKey,
        baseUrl: config.openai.baseUrl,
        model: config.openai.model,
        orgId: config.openai.orgId,
      });
    
    case 'anthropic':
      // TODO: Implement AnthropicProvider
      console.warn('[LLM] Anthropic provider not yet implemented, using mock');
      return new MockLLMProvider(50);
    
    case 'mock':
    default:
      return new MockLLMProvider(50);
  }
}
