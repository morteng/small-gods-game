/**
 * CreatePanel — natural-language world authoring (god-mode).
 *
 * The author types a request; the capable LLM returns editor tool calls; the
 * panel previews each as a human-readable line (validated read-only via
 * previewCommand) and, on Confirm, emits the valid ones as source:'author'
 * editor commands onto the command channel (SP2 applies + records them).
 *
 * NOT Fate: this is out-of-character god-mode authoring, by design.
 */
import type { GameState } from '@/core/state';
import type { CommandQueue } from '@/sim/command/command-queue';
import type { Command, CommandCtx, CommandVerb } from '@/sim/command/types';
import { previewCommand } from '@/sim/command/command-system';
import { getCapability } from '@/sim/command/registry';
import { editorToolList } from '@/llm/editor-tools';
import { buildWorldSummary } from '@/llm/world-summary';
import type { LLMClient, LLMToolCall } from '@/llm/llm-client';
import { createFloatingPanel } from '@/dev/FloatingPanel';
import type { DockManager } from '@/dev/dock-manager';

export interface CreatePanelDeps {
  container: HTMLElement;
  getState: () => GameState;
  queue: CommandQueue;
  getLlmCapable: () => LLMClient | null;
  dock?: DockManager;
}

export interface CreatePanelHandle {
  element: HTMLElement;
  send(): Promise<void>;
  show(): void; hide(): void; toggle(): void; isVisible(): boolean;
  destroy(): void;
}

const SYSTEM_PROMPT =
  'You are the world-authoring assistant for a god-game, operating in out-of-character god-mode. ' +
  'Translate the author\'s request into concrete world edits by calling the provided tools. ' +
  'Resolve references like "the northern village" or a person\'s name using the WORLD SUMMARY — ' +
  'prefer explicit entity ids and coordinates from it. Only call tools; do not narrate. ' +
  'If a request is ambiguous, make a reasonable concrete choice.';

interface PreviewItem { cmd: Command; label: string; reason: string | null; }

export function mountCreatePanel(deps: CreatePanelDeps): CreatePanelHandle {
  const fp = createFloatingPanel({
    container: deps.container, id: 'create', title: '✨ Create', dock: deps.dock,
    width: 380, anchor: { top: '60px', left: '320px' },
  });

  const col = document.createElement('div');
  col.style.cssText = 'display:flex; flex-direction:column; width:100%; padding:12px; gap:10px; box-sizing:border-box; overflow:auto;';
  fp.body.appendChild(col);

  const prompt = document.createElement('textarea');
  prompt.placeholder = 'e.g. add three farmers near Northvale; make n1 a devout priest; make this an arctic world';
  prompt.style.cssText = 'width:100%; min-height:64px; resize:vertical; background:#1a1a2e; color:#e0e0e0; border:1px solid #555; border-radius:4px; padding:8px; font-size:12px; box-sizing:border-box;';
  col.appendChild(prompt);

  const sendBtn = document.createElement('button');
  sendBtn.className = 'sg-dev-btn';
  sendBtn.textContent = '▶ Send';
  col.appendChild(sendBtn);

  const status = document.createElement('div');
  status.style.cssText = 'font-size:11px; color:#8cf; min-height:14px;';
  col.appendChild(status);

  const previewBox = document.createElement('div');
  previewBox.style.cssText = 'display:flex; flex-direction:column; gap:4px;';
  col.appendChild(previewBox);

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex; gap:8px;';
  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'sg-dev-btn';
  confirmBtn.textContent = '✓ Confirm';
  const discardBtn = document.createElement('button');
  discardBtn.className = 'sg-dev-btn';
  discardBtn.textContent = '✕ Discard';
  actions.appendChild(confirmBtn);
  actions.appendChild(discardBtn);
  actions.style.display = 'none';
  col.appendChild(actions);

  let pending: PreviewItem[] = [];
  let inFlight = false;

  /** Sync the Send button to whether a capable client is configured + idle. */
  function syncSendBtn(): void {
    sendBtn.disabled = inFlight || deps.getLlmCapable() === null;
  }

  function refreshAvailability(): void {
    syncSendBtn();
    if (deps.getLlmCapable() === null) {
      status.textContent = 'Configure an OpenRouter capable model in LLM settings to use Create.';
    }
  }

  function clearPreview(): void {
    pending = [];
    previewBox.replaceChildren();
    actions.style.display = 'none';
  }

  function toPreviewItem(tc: LLMToolCall, ctx: CommandCtx): PreviewItem {
    const def = getCapability(tc.name as CommandVerb);
    const cmd: Command = { verb: tc.name as CommandVerb, source: 'author', target: { kind: 'none' }, payload: tc.arguments, seq: 0 };
    if (!def) return { cmd, label: `unknown verb: ${tc.name}`, reason: 'invalid_target' };
    const reason = previewCommand(cmd, ctx);
    return { cmd, label: def.describe(cmd), reason };
  }

  function renderPreview(): void {
    previewBox.replaceChildren();
    for (const item of pending) {
      const row = document.createElement('div');
      row.style.cssText = `font-size:12px; padding:4px 6px; border-radius:3px; background:${item.reason ? '#3a1a1a' : '#1a2e1a'};`;
      row.textContent = item.reason ? `⚠ ${item.label} — rejected: ${item.reason}` : `• ${item.label}`;
      previewBox.appendChild(row);
    }
    const okCount = pending.filter(i => !i.reason).length;
    confirmBtn.disabled = okCount === 0;
    confirmBtn.textContent = `✓ Confirm (${okCount})`;
    actions.style.display = pending.length ? 'flex' : 'none';
  }

  async function send(): Promise<void> {
    if (inFlight) return;                       // public method — guard re-entry beyond the disabled button
    const client = deps.getLlmCapable();
    if (!client) { refreshAvailability(); return; }
    const text = prompt.value.trim();
    if (!text) { status.textContent = 'Type a request first.'; return; }

    clearPreview();
    inFlight = true;
    syncSendBtn();
    status.textContent = 'Thinking…';
    try {
      const state = deps.getState();
      const messages = [
        { role: 'system' as const, content: `${SYSTEM_PROMPT}\n\nWORLD SUMMARY:\n${buildWorldSummary(state)}` },
        { role: 'user' as const, content: text },
      ];
      const resp = await client.generateWithTools(messages, editorToolList());
      const calls = resp.toolCalls ?? [];
      if (!calls.length) { status.textContent = 'No edits proposed.'; return; }

      const ctx: CommandCtx = { world: state.world!, spirits: state.spirits, log: state.eventLog };
      pending = calls.map(tc => toPreviewItem(tc, ctx));
      status.textContent = `${pending.length} edit(s) proposed — review and confirm.`;
      renderPreview();
    } catch (err) {
      status.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      inFlight = false;
      syncSendBtn();                            // restore button without clobbering the status text
    }
  }

  sendBtn.addEventListener('click', () => { void send(); });
  discardBtn.addEventListener('click', () => { clearPreview(); status.textContent = 'Discarded.'; });
  confirmBtn.addEventListener('click', () => {
    const valid = pending.filter(i => !i.reason);
    for (const i of valid) {
      deps.queue.emit({ verb: i.cmd.verb, source: 'author', target: i.cmd.target, payload: i.cmd.payload });
    }
    status.textContent = `Emitted ${valid.length} edit(s).`;
    clearPreview();
    prompt.value = '';
  });

  refreshAvailability();

  return {
    element: fp.element,
    send,
    show: () => { refreshAvailability(); fp.show(); },
    hide: fp.hide, toggle: fp.toggle, isVisible: fp.isVisible,
    destroy: () => fp.destroy(),
  };
}
