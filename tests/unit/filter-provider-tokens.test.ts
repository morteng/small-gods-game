import { describe, it, expect } from 'vitest';
import { filterProviderTokens } from '@/llm/filter-provider-tokens';

describe('filterProviderTokens', () => {
  it('strips the bare ｜DSML｜tool_calls> leak (the exact prod shape)', () => {
    expect(filterProviderTokens('｜DSML｜tool_calls>Hei Morten!')).toBe('Hei Morten!');
  });
  it('strips the fullwidth-pipe-closed ｜DSML｜tool_calls｜ variant', () => {
    expect(filterProviderTokens('før｜DSML｜tool_calls｜etter')).toBe('føretter');
  });
  it('strips the bracketed Kimi <|tool_calls_begin|> form', () => {
    expect(filterProviderTokens('<|tool_calls_begin|>hello')).toBe('hello');
  });
  it('strips ASCII-rewritten _tool_calls> delimiters', () => {
    expect(filterProviderTokens('text_tool_calls>more')).toBe('textmore');
  });
  it('leaves a lone decorative ｜word｜ untouched', () => {
    expect(filterProviderTokens('the ｜word｜ stays')).toBe('the ｜word｜ stays');
  });
  it('leaves ordinary prose and JSON untouched', () => {
    expect(filterProviderTokens('{"faith": 0.2}')).toBe('{"faith": 0.2}');
  });
  it('returns empty string for empty input', () => {
    expect(filterProviderTokens('')).toBe('');
  });
});
