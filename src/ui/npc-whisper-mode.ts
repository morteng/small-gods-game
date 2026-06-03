import type { NpcAttentionStore, WhisperTurn } from '@/llm/npc-attention-store';

const STYLE = `
.sg-thread { display: flex; flex-direction: column; gap: 6px; max-height: 220px; overflow-y: auto; padding: 4px 0; }
.sg-turn { display: flex; flex-direction: column; gap: 2px; }
.sg-whisper-line { align-self: flex-end; max-width: 85%; background: #1e2e1e; color: #cfeccf; padding: 4px 7px; border-radius: 7px 7px 1px 7px; font: 11px sans-serif; }
.sg-reaction-line { align-self: flex-start; max-width: 85%; background: #2a2150; color: #e8e0ff; padding: 4px 7px; border-radius: 7px 7px 7px 1px; font: 11px sans-serif; }
.sg-turn-meta { align-self: flex-end; font: 9px sans-serif; color: rgba(255,213,79,0.8); }
.sg-degraded { font: italic 10px sans-serif; color: rgba(255,255,255,0.4); align-self: flex-start; }
.sg-empty { font: italic 10px sans-serif; color: rgba(255,255,255,0.35); padding: 8px 0; }
.sg-compose { display: flex; gap: 4px; margin-top: 6px; }
.sg-whisper-input { flex: 1 1 auto; resize: none; height: 34px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.15);
  border-radius: 4px; color: #fff; font: 11px sans-serif; padding: 5px 7px; pointer-events: auto; }
.sg-whisper-send { all: unset; cursor: pointer; pointer-events: auto; padding: 0 12px; border-radius: 4px;
  background: rgba(255,213,79,0.15); color: #FFD54F; font: bold 11px sans-serif; display: flex; align-items: center; }
.sg-whisper-send:disabled { opacity: 0.35; cursor: default; }
`;

export interface WhisperModeDeps {
  store: NpcAttentionStore;
  onSend(text: string): void;
}

export interface WhisperModeHandle {
  setNpc(npcId: string): void;
  refresh(): void;
  refreshLast(): void;
  setSendEnabled(enabled: boolean): void;
  destroy(): void;
}

function turnNode(t: WhisperTurn): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'sg-turn'; wrap.dataset.sg = 'turn';
  const w = document.createElement('div'); w.className = 'sg-whisper-line'; w.textContent = t.whisper;
  wrap.appendChild(w);
  if (t.degraded) {
    const d = document.createElement('div'); d.className = 'sg-degraded';
    d.textContent = '…(the words land, but no vision comes)';
    wrap.appendChild(d);
  } else {
    const r = document.createElement('div'); r.className = 'sg-reaction-line'; r.textContent = t.dialogue;
    wrap.appendChild(r);
    if (typeof t.faithBonus === 'number' && t.faithBonus !== 0) {
      const m = document.createElement('div'); m.className = 'sg-turn-meta';
      m.textContent = `${t.faithBonus > 0 ? '+' : ''}${t.faithBonus.toFixed(2)} faith`;
      wrap.appendChild(m);
    }
  }
  return wrap;
}

export function mountWhisperMode(body: HTMLElement, deps: WhisperModeDeps): WhisperModeHandle {
  while (body.firstChild) body.removeChild(body.firstChild);
  const style = document.createElement('style'); style.textContent = STYLE; body.appendChild(style);

  const thread = document.createElement('div'); thread.className = 'sg-thread';
  const empty = document.createElement('div'); empty.className = 'sg-empty';
  empty.textContent = 'Whisper into their mind. Watch belief shift.';
  thread.appendChild(empty);

  const compose = document.createElement('div'); compose.className = 'sg-compose';
  const input = document.createElement('textarea');
  input.className = 'sg-whisper-input'; input.dataset.sg = 'whisper-input';
  input.placeholder = 'whisper…';
  const send = document.createElement('button');
  send.className = 'sg-whisper-send'; send.type = 'button'; send.dataset.sg = 'whisper-send';
  send.textContent = '↵';
  compose.append(input, send);

  body.append(thread, compose);

  let npcId: string | null = null;
  let renderedCount = 0;

  function doSend(): void {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    deps.onSend(text);
  }
  send.addEventListener('click', (e) => { e.stopPropagation(); doSend(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); doSend(); }
  });

  const handle: WhisperModeHandle = {
    setNpc(id) {
      if (id === npcId) return;
      npcId = id;
      while (thread.firstChild) thread.removeChild(thread.firstChild);
      renderedCount = 0;
      input.value = '';
      handle.refresh();
    },
    refresh() {
      if (!npcId) return;
      const turns = deps.store.getTranscript(npcId);
      if (turns.length === 0) {
        if (!thread.contains(empty)) thread.appendChild(empty);
        return;
      }
      if (thread.contains(empty)) thread.removeChild(empty);
      for (let i = renderedCount; i < turns.length; i++) thread.appendChild(turnNode(turns[i]));
      renderedCount = turns.length;
      thread.scrollTop = thread.scrollHeight;
    },
    refreshLast() {
      if (!npcId) return;
      const turns = deps.store.getTranscript(npcId);
      if (turns.length === 0) return;
      const nodes = thread.querySelectorAll('[data-sg=turn]');
      const last = nodes[nodes.length - 1];
      const fresh = turnNode(turns[turns.length - 1]);
      if (last) thread.replaceChild(fresh, last); else { thread.appendChild(fresh); renderedCount = turns.length; }
      thread.scrollTop = thread.scrollHeight;
    },
    setSendEnabled(enabled) { send.disabled = !enabled; input.disabled = !enabled; },
    destroy() { while (body.firstChild) body.removeChild(body.firstChild); },
  };
  return handle;
}
