import { describe, it, expect, beforeEach } from 'vitest';
import { mountWhisperInput } from '@/ui/npc-whisper-mode';

describe('mountWhisperInput', () => {
  let body: HTMLElement;
  beforeEach(() => { body = document.createElement('div'); });

  it('calls onSend with trimmed text and clears the input', () => {
    let sent = '';
    const h = mountWhisperInput(body, { onSend: (t) => { sent = t; } });
    const input = body.querySelector('[data-sg=whisper-input]') as HTMLTextAreaElement;
    input.value = '  flee north  ';
    (body.querySelector('[data-sg=whisper-send]') as HTMLButtonElement).click();
    expect(sent).toBe('flee north');
    expect(input.value).toBe('');
    h.destroy();
  });

  it('does not call onSend for empty/whitespace input', () => {
    let calls = 0;
    const h = mountWhisperInput(body, { onSend: () => { calls++; } });
    const input = body.querySelector('[data-sg=whisper-input]') as HTMLTextAreaElement;
    input.value = '   ';
    (body.querySelector('[data-sg=whisper-send]') as HTMLButtonElement).click();
    expect(calls).toBe(0);
    h.destroy();
  });

  it('setSendEnabled(false) disables the send button and textarea', () => {
    const h = mountWhisperInput(body, { onSend: () => {} });
    h.setSendEnabled(false);
    expect((body.querySelector('[data-sg=whisper-send]') as HTMLButtonElement).disabled).toBe(true);
    expect((body.querySelector('[data-sg=whisper-input]') as HTMLTextAreaElement).disabled).toBe(true);
    h.destroy();
  });

  it('setNpc clears the field', () => {
    const h = mountWhisperInput(body, { onSend: () => {} });
    const input = body.querySelector('[data-sg=whisper-input]') as HTMLTextAreaElement;
    input.value = 'half-typed';
    h.setNpc('npc2');
    expect(input.value).toBe('');
    h.destroy();
  });
});
