import { describe, it, expect, beforeEach } from 'vitest';
import { loadProviderConfig, saveProviderConfig, type ProviderConfig } from '@/llm/provider-factory';

describe('provider config — capable-tier field', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips valid model ids through save/load', () => {
    const config: ProviderConfig = {
      type: 'openrouter',
      openrouterApiKey: 'sk-or-test',
      openrouterModel: 'google/gemini-2.5-flash-lite',
      openrouterModelCapable: 'google/gemini-2.5-pro',
    };
    saveProviderConfig(config);
    const loaded = loadProviderConfig();
    expect(loaded.openrouterModelCapable).toBe('google/gemini-2.5-pro');
    expect(loaded.openrouterModel).toBe('google/gemini-2.5-flash-lite');
  });

  it('defaults the fast model to deepseek-v4-flash when no config saved', () => {
    const loaded = loadProviderConfig();
    expect(loaded.openrouterModel).toBe('deepseek/deepseek-v4-flash');
  });

  it('defaults the capable model to deepseek-v4-pro when no config saved', () => {
    const loaded = loadProviderConfig();
    expect(loaded.openrouterModelCapable).toBe('deepseek/deepseek-v4-pro');
  });

  it('migrates a persisted dead model id to the current default on load', () => {
    // deepseek/deepseek-v4 and anthropic/claude-sonnet-4.6 are not valid
    // OpenRouter ids — a stale localStorage entry holding one must be rewritten
    // so backfill stops 400-ing ("Their mind clouds over").
    saveProviderConfig({
      type: 'openrouter',
      openrouterApiKey: 'sk-or-test',
      openrouterModel: 'anthropic/claude-sonnet-4.6',
      openrouterModelCapable: 'deepseek/deepseek-v4',
    });
    const loaded = loadProviderConfig();
    expect(loaded.openrouterModel).toBe('deepseek/deepseek-v4-flash');
    expect(loaded.openrouterModelCapable).toBe('deepseek/deepseek-v4-pro');
  });
});
