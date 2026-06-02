import { describe, it, expect } from 'vitest';
import { LlmBackfillService } from '@/game/llm-backfill';
import { LLMClient, MockLLMProvider } from '@/llm/llm-client';
import { createState } from '@/core/state';

function fakeDisplay() {
  return { showBoth() {}, showDialogue() {}, showNarration() {}, hide() {} } as any;
}

describe('LlmBackfillService.setClient', () => {
  it('swaps the active client', () => {
    const svc = new LlmBackfillService({ state: createState(), llmDisplay: fakeDisplay() });
    const next = new LLMClient(new MockLLMProvider(1));
    svc.setClient(next);
    // @ts-expect-error — reach into private for the assertion
    expect(svc.client).toBe(next);
  });
});
