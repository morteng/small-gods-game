import { describe, it, expect } from 'vitest';
import { LLMClient, type LLMProvider, type LLMMessage, type LLMOptions, type LLMResponse } from '@/llm/llm-client';

class RecordingProvider implements LLMProvider {
  lastOpts?: LLMOptions;
  async generate(_m: LLMMessage[], opts?: LLMOptions): Promise<LLMResponse> {
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
