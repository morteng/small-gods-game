import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  MockLLMProvider, OpenAIProvider, OpenRouterProvider, LLMClient,
  toToolPayload, parseToolCalls,
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
