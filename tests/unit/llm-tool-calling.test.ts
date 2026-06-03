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
