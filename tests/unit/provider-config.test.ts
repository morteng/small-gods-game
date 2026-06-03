import { describe, it, expect, beforeEach } from 'vitest';
import { loadProviderConfig, saveProviderConfig, type ProviderConfig } from '@/llm/provider-factory';

describe('provider config — capable-tier field', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips openrouterModelCapable through save/load', () => {
    const config: ProviderConfig = {
      type: 'openrouter',
      openrouterApiKey: 'sk-or-test',
      openrouterModel: 'google/gemini-2.5-flash-lite',
      openrouterModelCapable: 'anthropic/claude-sonnet-4.6',
    };
    saveProviderConfig(config);
    const loaded = loadProviderConfig();
    expect(loaded.openrouterModelCapable).toBe('anthropic/claude-sonnet-4.6');
    expect(loaded.openrouterModel).toBe('google/gemini-2.5-flash-lite');
  });

  it('defaults the fast model to deepseek-v4-flash when no config saved', () => {
    const loaded = loadProviderConfig();
    expect(loaded.openrouterModel).toBe('deepseek/deepseek-v4-flash');
  });

  it('defaults the capable model to deepseek-v4 when no config saved', () => {
    const loaded = loadProviderConfig();
    expect(loaded.openrouterModelCapable).toBe('deepseek/deepseek-v4');
  });
});
