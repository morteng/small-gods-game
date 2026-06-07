const STYLE = `
.sg-compose { display: flex; gap: 6px; margin-top: 10px; }
.sg-whisper-input { flex: 1 1 auto; resize: none; height: 40px; background: var(--paper-2); border: 1px solid var(--line);
  border-radius: var(--r-2); color: var(--ink); font-family: var(--f-sans); font-size: var(--t-small); padding: 8px 10px; pointer-events: auto; }
.sg-whisper-input:focus { outline: none; border-color: var(--you-line); background: var(--paper); }
.sg-whisper-input::placeholder { color: var(--ink-4); }
.sg-whisper-send { all: unset; cursor: pointer; pointer-events: auto; padding: 0 16px; border-radius: var(--r-2);
  background: var(--faith-soft); border: 1px solid oklch(0.78 0.13 85 / 0.5); color: var(--faith); font-family: var(--f-sans); font-weight: 700; font-size: var(--t-small); display: flex; align-items: center; }
.sg-whisper-send:hover:not(:disabled) { filter: brightness(1.1); }
.sg-whisper-send:disabled { opacity: 0.35; cursor: default; }
`;

export interface WhisperInputDeps {
  onSend(text: string): void;
}

export interface WhisperInputHandle {
  /** Clear the field when the selected NPC changes. */
  setNpc(npcId: string): void;
  setSendEnabled(enabled: boolean): void;
  destroy(): void;
}

/**
 * The whisper compose row: a textarea + Send button under the mind reader.
 * Whisper is no longer a separate "mode" — sending one re-reads the NPC's
 * surface mind (handled by the orchestrator), so this widget only collects text.
 */
export function mountWhisperInput(host: HTMLElement, deps: WhisperInputDeps): WhisperInputHandle {
  while (host.firstChild) host.removeChild(host.firstChild);
  const style = document.createElement('style'); style.textContent = STYLE; host.appendChild(style);

  const compose = document.createElement('div'); compose.className = 'sg-compose';
  const input = document.createElement('textarea');
  input.className = 'sg-whisper-input'; input.dataset.sg = 'whisper-input';
  input.placeholder = 'whisper into their mind…';
  input.title = 'Whisper — plant a thought (costs 1 power). Enter to send, Shift+Enter for a newline.';
  const send = document.createElement('button');
  send.className = 'sg-whisper-send'; send.type = 'button'; send.dataset.sg = 'whisper-send';
  send.textContent = '↵';
  send.title = 'Send whisper (1 power)';
  compose.append(input, send);
  host.appendChild(compose);

  function doSend(): void {
    const text = input.value.trim();
    if (!text || send.disabled) return;
    input.value = '';
    deps.onSend(text);
  }
  send.addEventListener('click', (e) => { e.stopPropagation(); doSend(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); doSend(); }
  });

  return {
    setNpc() { input.value = ''; },
    setSendEnabled(enabled) { send.disabled = !enabled; input.disabled = !enabled; },
    destroy() { while (host.firstChild) host.removeChild(host.firstChild); },
  };
}
