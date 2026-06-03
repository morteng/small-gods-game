const STYLE = `
.sg-compose { display: flex; gap: 4px; margin-top: 6px; }
.sg-whisper-input { flex: 1 1 auto; resize: none; height: 34px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.15);
  border-radius: 4px; color: #fff; font: 11px sans-serif; padding: 5px 7px; pointer-events: auto; }
.sg-whisper-input::placeholder { color: rgba(255,255,255,0.35); }
.sg-whisper-send { all: unset; cursor: pointer; pointer-events: auto; padding: 0 12px; border-radius: 4px;
  background: rgba(255,213,79,0.15); color: #FFD54F; font: bold 11px sans-serif; display: flex; align-items: center; }
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
  const send = document.createElement('button');
  send.className = 'sg-whisper-send'; send.type = 'button'; send.dataset.sg = 'whisper-send';
  send.textContent = '↵';
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
