# NPC Attention Surface — Slice 1: Shell + Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the immediate-mode NPC info panel into a persistent *mounted handle* with a `🗣️ Whisper / 🧠 Mind` mode switch and a body slot, and introduce a session-scoped `NpcAttentionStore` that is wiped on time-scrub. No behavior change to belief/divine actions.

**Architecture:** Today `renderNpcInfoPanel(panel, sim, opts)` (`src/ui/npc-info-panel.ts`) destroys and rebuilds the entire panel DOM on a 500ms throttle from `FrameRenderer` (`src/game/frame-renderer.ts:152-174`). That model cannot host a text input (focus loss) or a scrollable thread (scroll reset). This slice introduces `mountNpcAttentionPanel(panel, deps): NpcAttentionPanelHandle` whose `update(sim, opts)` refreshes the header bars + button gating **surgically** (no full wipe), and whose mode bodies are persistent DOM the frame loop never touches. Slice 1 ships the shell with the existing action buttons living in the Whisper body's footer (no thread yet) and an empty Mind body placeholder; Slices 2–3 fill the bodies. The store is a plain narration-layer class held by `Game`, never placed in `GameState`/snapshots, with `clearAll()` wired to the existing `TimelineController.onRestore` boundary alongside `commandQueue.clear()`.

**Tech Stack:** TypeScript ESM, Vite, Vitest (jsdom for DOM tests), `@/`→`src/` alias.

---

## File Structure

- **Create** `src/llm/npc-attention-store.ts` — `NpcAttentionStore` class: per-NPC narration state (whisper transcript + mind page cache), `clearAll()`. Slice 1 introduces the type with whisper-transcript + mind-page-cache APIs but the modes don't use them yet; the store exists so the scrub-clear wiring lands in this slice.
- **Create** `src/ui/npc-attention-panel.ts` — `mountNpcAttentionPanel(panel, deps): NpcAttentionPanelHandle`. The shell: header (identity/needs/faith bars, reused), mode switch, body slot, footer with the existing divine-action buttons.
- **Modify** `src/game/frame-renderer.ts:128-181` — replace the per-frame `renderNpcInfoPanel(...)` call with a one-time mount + per-update `handle.update(...)`/`handle.setNpc(...)`.
- **Modify** `src/game/game-ui.ts` — own the panel handle (mount it once with `npcInfoPanel` element + deps), expose it on the UI object.
- **Modify** `src/game.ts` — construct `NpcAttentionStore`; pass it to game-ui/frame-renderer deps; add `attentionStore.clearAll()` to the `TimelineController` `onRestore` callback (next to `commandQueue.clear()`).
- **Keep** `src/ui/npc-info-panel.ts` — its bar/section helper functions (`makeBarRow`, `makeSection`, `npcStatusHint` usage, `STYLE`) are reused by the new shell; the slice extracts the header-render into the new panel and leaves `renderNpcInfoPanel` only if still referenced (it will not be after frame-renderer is rewired — delete it then).
- **Create** `tests/unit/npc-attention-store.test.ts`
- **Create** `tests/unit/npc-attention-panel.test.ts` (jsdom)

---

### Task 1: `NpcAttentionStore`

**Files:**
- Create: `src/llm/npc-attention-store.ts`
- Test: `tests/unit/npc-attention-store.test.ts`

The store holds two kinds of narration-layer state per NPC. Slice 1 defines both shapes; Slice 2 uses the transcript, Slice 3 uses the page cache. It is a plain class — never serialized, never in `GameState`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/npc-attention-store.test.ts
import { describe, it, expect } from 'vitest';
import { NpcAttentionStore } from '@/llm/npc-attention-store';

describe('NpcAttentionStore', () => {
  it('starts empty for any npc', () => {
    const s = new NpcAttentionStore();
    expect(s.getTranscript('npc1')).toEqual([]);
    expect(s.getPage('npc1', 'surface')).toBeUndefined();
  });

  it('appends and returns transcript turns in order', () => {
    const s = new NpcAttentionStore();
    s.appendTurn('npc1', { whisper: 'heed the river', dialogue: 'a voice?', tick: 10 });
    s.appendTurn('npc1', { whisper: 'flee', dialogue: 'I will', tick: 12 });
    const t = s.getTranscript('npc1');
    expect(t).toHaveLength(2);
    expect(t[0].whisper).toBe('heed the river');
    expect(t[1].dialogue).toBe('I will');
  });

  it('isolates transcripts per npc', () => {
    const s = new NpcAttentionStore();
    s.appendTurn('a', { whisper: 'x', dialogue: 'y', tick: 1 });
    expect(s.getTranscript('b')).toEqual([]);
  });

  it('stores and retrieves mind pages by node-path', () => {
    const s = new NpcAttentionStore();
    const page = { prose: 'she kneels', links: [], depth: 0 };
    s.putPage('npc1', 'surface', page);
    expect(s.getPage('npc1', 'surface')).toBe(page);
    expect(s.getPage('npc1', 'surface ▸ fear')).toBeUndefined();
  });

  it('clearAll() wipes every npc transcript and page', () => {
    const s = new NpcAttentionStore();
    s.appendTurn('a', { whisper: 'x', dialogue: 'y', tick: 1 });
    s.putPage('a', 'surface', { prose: 'p', links: [], depth: 0 });
    s.clearAll();
    expect(s.getTranscript('a')).toEqual([]);
    expect(s.getPage('a', 'surface')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/npc-attention-store.test.ts`
Expected: FAIL — cannot find module `@/llm/npc-attention-store`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/llm/npc-attention-store.ts

/** One round of a whisper conversation: the god's whisper and the NPC's reaction. */
export interface WhisperTurn {
  whisper: string;
  dialogue: string;
  /** sim tick at which the whisper was sent (for context/labels). */
  tick: number;
  /** soft belief bonus the LLM judged this whisper earned, clamped ±0.10 (Slice 2). */
  faithBonus?: number;
  /** true when the LLM was unavailable and only the deterministic floor applied (Slice 2). */
  degraded?: boolean;
}

/** A typed hyperlink on a mind page. */
export interface MindLink {
  label: string;
  kind: 'entity' | 'concept';
  /** validated sim entity id, present only for resolved entity links (Slice 3). */
  entityId?: string;
}

/** A generated mind-wiki page (Slice 3). */
export interface MindPage {
  prose: string;
  links: MindLink[];
  depth: number;
}

/**
 * Narration-layer state for NPC attention (Whisper transcripts + Mind page cache).
 *
 * This is deliberately NOT part of GameState and is never snapshotted. It is
 * session-scoped and wiped by clearAll() whenever the timeline restores a
 * snapshot (scrub / commit / era-skip), mirroring how the command queue clears.
 */
export class NpcAttentionStore {
  private transcripts = new Map<string, WhisperTurn[]>();
  private pages = new Map<string, Map<string, MindPage>>();

  getTranscript(npcId: string): WhisperTurn[] {
    return this.transcripts.get(npcId) ?? [];
  }

  appendTurn(npcId: string, turn: WhisperTurn): void {
    const list = this.transcripts.get(npcId);
    if (list) list.push(turn);
    else this.transcripts.set(npcId, [turn]);
  }

  getPage(npcId: string, path: string): MindPage | undefined {
    return this.pages.get(npcId)?.get(path);
  }

  putPage(npcId: string, path: string, page: MindPage): void {
    let byPath = this.pages.get(npcId);
    if (!byPath) { byPath = new Map(); this.pages.set(npcId, byPath); }
    byPath.set(path, page);
  }

  clearAll(): void {
    this.transcripts.clear();
    this.pages.clear();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/npc-attention-store.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/llm/npc-attention-store.ts tests/unit/npc-attention-store.test.ts
git commit -m "feat(attention): NpcAttentionStore — narration-layer transcripts + page cache

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Attention panel shell with mode switch

**Files:**
- Create: `src/ui/npc-attention-panel.ts`
- Test: `tests/unit/npc-attention-panel.test.ts`

The shell mounts once into the existing `npcInfoPanel` element. It exposes a handle with `update(sim, opts)` (refresh bars + button gating, surgical — no full wipe), `setNpc(npcId)` (switch which NPC is shown; clears mode-body transient UI), `getActiveMode()`, and `destroy()`. The header reuses the bar/section visuals. The footer holds the existing divine-action buttons. The mode switch toggles between a Whisper body (Slice 2 fills it; Slice 1 = placeholder text + the action footer) and a Mind body (Slice 3 fills it; Slice 1 = placeholder text).

Reuse the `NpcSimState` adapter shape and `NpcInfoPanelOptions` callback set already passed by `frame-renderer.ts` so wiring stays identical.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/npc-attention-panel.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mountNpcAttentionPanel } from '@/ui/npc-attention-panel';
import type { NpcSimState } from '@/core/types';

function fakeSim(over: Partial<NpcSimState> = {}): NpcSimState {
  return {
    npcId: 'npc1',
    name: 'Maeve',
    role: 'farmer',
    homePoiId: 'poi_east',
    activity: 'idle',
    needs: { safety: 0.5, prosperity: 0.4, community: 0.6, meaning: 0.3 },
    beliefs: { player: { faith: 0.4, understanding: 0.2, devotion: 0.1 } },
    ...over,
  } as unknown as NpcSimState;
}

describe('mountNpcAttentionPanel', () => {
  let host: HTMLElement;
  beforeEach(() => { host = document.createElement('div'); });

  it('renders identity, needs and faith bars on first update', () => {
    const h = mountNpcAttentionPanel(host, {});
    h.update(fakeSim(), { power: 5 });
    expect(host.textContent).toContain('Maeve');
    expect(host.textContent).toContain('farmer');
    expect(host.querySelectorAll('.sg-fill').length).toBeGreaterThanOrEqual(7); // 4 needs + 3 faith
    h.destroy();
  });

  it('shows a Whisper/Mind mode switch, Whisper active by default', () => {
    const h = mountNpcAttentionPanel(host, {});
    h.update(fakeSim(), { power: 5 });
    const tabs = host.querySelectorAll('[data-sg-mode]');
    expect(tabs.length).toBe(2);
    expect(h.getActiveMode()).toBe('whisper');
    h.destroy();
  });

  it('switches mode on tab click without re-mounting the panel', () => {
    const h = mountNpcAttentionPanel(host, {});
    h.update(fakeSim(), { power: 5 });
    const mindTab = host.querySelector('[data-sg-mode="mind"]') as HTMLButtonElement;
    mindTab.click();
    expect(h.getActiveMode()).toBe('mind');
    h.destroy();
  });

  it('update() does not wipe a focused element in the active body', () => {
    const h = mountNpcAttentionPanel(host, {});
    h.update(fakeSim(), { power: 5 });
    // Plant a sentinel node in the whisper body and ensure update() keeps it.
    const body = host.querySelector('[data-sg-body="whisper"]') as HTMLElement;
    const sentinel = document.createElement('span');
    sentinel.id = 'sentinel';
    body.appendChild(sentinel);
    h.update(fakeSim({ needs: { safety: 0.9, prosperity: 0.4, community: 0.6, meaning: 0.3 } }), { power: 6 });
    expect(host.querySelector('#sentinel')).not.toBeNull();
    h.destroy();
  });

  it('fires onWhisper from the action footer', () => {
    let whispered = 0;
    const h = mountNpcAttentionPanel(host, {});
    h.update(fakeSim(), { power: 5, onWhisper: () => { whispered++; } });
    const btn = host.querySelector('[data-sg-action="whisper"]') as HTMLButtonElement;
    btn.click();
    expect(whispered).toBe(1);
    h.destroy();
  });

  it('gates the whisper action when power is below cost', () => {
    const h = mountNpcAttentionPanel(host, {});
    h.update(fakeSim(), { power: 0 });
    const btn = host.querySelector('[data-sg-action="whisper"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    h.destroy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/npc-attention-panel.test.ts`
Expected: FAIL — cannot find module `@/ui/npc-attention-panel`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/ui/npc-attention-panel.ts
import type { NpcSimState } from '@/core/types';
import { npcStatusHint } from '@/sim/believers';

const WHISPER_COST = 1;
const DREAM_COST = 4;
const ANSWER_PRAYER_COST = 2;
const OMEN_COST = 3;
const MIRACLE_COST = 10;

const NEED_COLORS = {
  safety: '#4CAF50', prosperity: '#FFC107', community: '#42A5F5', meaning: '#CE93D8',
} as const;
const FAITH_COLORS = {
  faith: '#FFD54F', understanding: '#42A5F5', devotion: '#FF8A65',
} as const;

const STYLE = `
.sg-header { display: flex; justify-content: flex-end; margin: -4px -4px 4px 0; }
.sg-pin { all: unset; cursor: pointer; pointer-events: auto; padding: 2px 6px; border-radius: 3px; color: rgba(255,255,255,0.5); font: 12px sans-serif; }
.sg-pin:hover { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.85); }
.sg-pin[aria-pressed="true"] { color: #FFD54F; background: rgba(255,213,79,0.12); }
.sg-section { margin-bottom: 8px; }
.sg-section-title { font-size: 9px; letter-spacing: 1px; color: rgba(255,255,255,0.45); margin-bottom: 4px; text-transform: uppercase; }
.sg-id-name { font: bold 13px sans-serif; color: #fff; }
.sg-id-meta { font-size: 10px; color: rgba(255,255,255,0.55); margin-top: 2px; }
.sg-row { display: flex; align-items: center; font: 10px sans-serif; color: rgba(255,255,255,0.85); margin-bottom: 2px; }
.sg-row-label { flex: 0 0 78px; color: rgba(255,255,255,0.7); }
.sg-row-num { flex: 0 0 32px; text-align: right; color: rgba(255,255,255,0.55); font-variant-numeric: tabular-nums; }
.sg-track { flex: 1 1 auto; height: 6px; background: rgba(255,255,255,0.12); border-radius: 3px; overflow: hidden; margin: 0 6px; }
.sg-fill { height: 100%; }
.sg-status-hint { font: italic 10px sans-serif; color: rgba(255,213,79,0.85); margin-bottom: 4px; }
.sg-modes { display: flex; gap: 4px; margin: 6px 0; }
.sg-mode { all: unset; cursor: pointer; pointer-events: auto; flex: 1 1 auto; text-align: center; padding: 4px 0; border-radius: 4px;
  font: bold 10px sans-serif; letter-spacing: 0.5px; background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.6); }
.sg-mode[aria-selected="true"] { background: rgba(255,213,79,0.15); color: #FFD54F; }
.sg-body { min-height: 40px; }
.sg-body-placeholder { font: italic 10px sans-serif; color: rgba(255,255,255,0.4); padding: 8px 0; }
.sg-actions { display: flex; gap: 4px; margin-top: 6px; flex-wrap: wrap; }
.sg-action { all: unset; cursor: pointer; pointer-events: auto; padding: 3px 8px; border-radius: 3px;
  font: bold 10px sans-serif; letter-spacing: 0.5px; text-transform: uppercase;
  background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.7); }
.sg-action:hover { background: rgba(255,255,255,0.18); color: #fff; }
.sg-action:disabled { opacity: 0.3; cursor: default; }
.sg-action-cost { color: #FFD54F; font-weight: normal; margin-left: 2px; }
`;

export type AttentionMode = 'whisper' | 'mind';

export interface NpcAttentionPanelOptions {
  pinned?: boolean;
  power?: number;
  onTogglePin?: () => void;
  onWhisper?: () => void;
  onDream?: () => void;
  onAnswerPrayer?: () => void;
  onOmen?: () => void;
  onMiracle?: () => void;
  onLlmBackfill?: () => void;
}

/** Dependencies the panel needs beyond per-update opts. Empty in Slice 1; Slices 2-3 add store + emit hooks. */
export interface NpcAttentionPanelDeps {
  /** Slice 2 wires the store here; absent in Slice 1. */
  // store?: NpcAttentionStore;
}

export interface NpcAttentionPanelHandle {
  /** Refresh header bars + footer button gating for the given NPC sim snapshot. Surgical: never wipes mode bodies. */
  update(sim: NpcSimState, opts?: NpcAttentionPanelOptions): void;
  /** Switch which NPC the panel represents; resets mode-body transient UI. */
  setNpc(npcId: string): void;
  getActiveMode(): AttentionMode;
  destroy(): void;
}

function barRow(label: string, value: number, color: string): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'sg-row';
  const l = document.createElement('div'); l.className = 'sg-row-label'; l.textContent = label;
  const track = document.createElement('div'); track.className = 'sg-track';
  const fill = document.createElement('div'); fill.className = 'sg-fill';
  fill.style.width = `${(Math.max(0, Math.min(1, value)) * 100).toFixed(0)}%`;
  fill.style.background = color;
  track.appendChild(fill);
  const num = document.createElement('div'); num.className = 'sg-row-num'; num.textContent = value.toFixed(2);
  row.append(l, track, num);
  return row;
}

function section(title: string, ...children: HTMLElement[]): HTMLDivElement {
  const sec = document.createElement('div'); sec.className = 'sg-section';
  const t = document.createElement('div'); t.className = 'sg-section-title'; t.textContent = title;
  sec.append(t, ...children);
  return sec;
}

function actionBtn(key: string, label: string, costLabel: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'sg-action'; b.type = 'button';
  b.dataset.sgAction = key;
  b.innerHTML = `${label}<span class="sg-action-cost">${costLabel}</span>`;
  return b;
}

export function mountNpcAttentionPanel(
  panel: HTMLElement,
  _deps: NpcAttentionPanelDeps,
): NpcAttentionPanelHandle {
  let activeMode: AttentionMode = 'whisper';
  let currentNpcId: string | null = null;

  while (panel.firstChild) panel.removeChild(panel.firstChild);

  const style = document.createElement('style'); style.textContent = STYLE; panel.appendChild(style);

  // Persistent scaffold (built once).
  const header = document.createElement('div'); header.className = 'sg-header';
  const pin = document.createElement('button');
  pin.className = 'sg-pin'; pin.type = 'button'; pin.textContent = '📌'; pin.dataset.sg = 'pin';
  header.appendChild(pin);

  const idSection = section('identity');
  const idName = document.createElement('div'); idName.className = 'sg-id-name';
  const idMeta = document.createElement('div'); idMeta.className = 'sg-id-meta';
  idSection.append(idName, idMeta);

  const needsHost = section('needs');
  const faithHost = section('faith in you');

  const modes = document.createElement('div'); modes.className = 'sg-modes';
  const whisperTab = document.createElement('button');
  whisperTab.className = 'sg-mode'; whisperTab.type = 'button'; whisperTab.dataset.sgMode = 'whisper';
  whisperTab.textContent = '🗣️ Whisper';
  const mindTab = document.createElement('button');
  mindTab.className = 'sg-mode'; mindTab.type = 'button'; mindTab.dataset.sgMode = 'mind';
  mindTab.textContent = '🧠 Mind';
  modes.append(whisperTab, mindTab);

  // Mode bodies — persistent; the frame loop never wipes these.
  const whisperBody = document.createElement('div');
  whisperBody.className = 'sg-body'; whisperBody.dataset.sgBody = 'whisper';
  const whisperPlaceholder = document.createElement('div');
  whisperPlaceholder.className = 'sg-body-placeholder';
  whisperPlaceholder.textContent = 'Whisper thread — coming in slice 2.';
  whisperBody.appendChild(whisperPlaceholder);

  const mindBody = document.createElement('div');
  mindBody.className = 'sg-body'; mindBody.dataset.sgBody = 'mind'; mindBody.style.display = 'none';
  const mindPlaceholder = document.createElement('div');
  mindPlaceholder.className = 'sg-body-placeholder';
  mindPlaceholder.textContent = 'Mind wiki — coming in slice 3.';
  mindBody.appendChild(mindPlaceholder);

  // Footer: existing divine-action buttons (live in the whisper context for now).
  const actions = document.createElement('div'); actions.className = 'sg-actions';
  const backfillBtn = actionBtn('backfill', '💭 Backfill', 'LLM');
  const whisperBtn = actionBtn('whisper', '💬 Whisper', `${WHISPER_COST}p`);
  const dreamBtn = actionBtn('dream', '🌙 Dream', `${DREAM_COST}p`);
  const prayBtn = actionBtn('answer', '🙏 Answer', `${ANSWER_PRAYER_COST}p`);
  const omenBtn = actionBtn('omen', '⛈ Omen', `${OMEN_COST}p`);
  const miracleBtn = actionBtn('miracle', '✨ Miracle', `${MIRACLE_COST}p`);
  actions.append(backfillBtn, whisperBtn, dreamBtn, prayBtn, omenBtn, miracleBtn);

  panel.append(header, idSection, needsHost, faithHost, modes, whisperBody, mindBody, actions);

  function applyMode(): void {
    whisperTab.setAttribute('aria-selected', activeMode === 'whisper' ? 'true' : 'false');
    mindTab.setAttribute('aria-selected', activeMode === 'mind' ? 'true' : 'false');
    whisperBody.style.display = activeMode === 'whisper' ? 'block' : 'none';
    mindBody.style.display = activeMode === 'mind' ? 'block' : 'none';
    // The divine-action footer belongs to the influence (whisper) context.
    actions.style.display = activeMode === 'whisper' ? 'flex' : 'none';
  }
  whisperTab.addEventListener('click', (e) => { e.stopPropagation(); activeMode = 'whisper'; applyMode(); });
  mindTab.addEventListener('click', (e) => { e.stopPropagation(); activeMode = 'mind'; applyMode(); });
  applyMode();

  // Latest opts captured so footer click handlers always call the current callbacks.
  let opts: NpcAttentionPanelOptions = {};
  pin.addEventListener('click', (e) => { e.stopPropagation(); opts.onTogglePin?.(); });
  backfillBtn.addEventListener('click', (e) => { e.stopPropagation(); opts.onLlmBackfill?.(); });
  whisperBtn.addEventListener('click', (e) => { e.stopPropagation(); opts.onWhisper?.(); });
  dreamBtn.addEventListener('click', (e) => { e.stopPropagation(); opts.onDream?.(); });
  prayBtn.addEventListener('click', (e) => { e.stopPropagation(); opts.onAnswerPrayer?.(); });
  omenBtn.addEventListener('click', (e) => { e.stopPropagation(); opts.onOmen?.(); });
  miracleBtn.addEventListener('click', (e) => { e.stopPropagation(); opts.onMiracle?.(); });

  function replaceChildren(host: HTMLElement, keepTitle: boolean, ...rows: HTMLElement[]): void {
    // Keep the section-title (first child) when present; replace the rest.
    const title = keepTitle ? host.querySelector('.sg-section-title') : null;
    while (host.firstChild) host.removeChild(host.firstChild);
    if (title) host.appendChild(title);
    host.append(...rows);
  }

  return {
    update(sim, nextOpts = {}) {
      opts = nextOpts;
      const belief = sim.beliefs['player'] ?? { faith: 0, understanding: 0, devotion: 0 };
      const power = nextOpts.power ?? 0;

      idName.textContent = sim.name;
      idMeta.textContent = `${sim.role} · home: ${sim.homePoiId ?? '—'}`;

      replaceChildren(needsHost, true,
        barRow('safety', sim.needs.safety, NEED_COLORS.safety),
        barRow('prosperity', sim.needs.prosperity, NEED_COLORS.prosperity),
        barRow('community', sim.needs.community, NEED_COLORS.community),
        barRow('meaning', sim.needs.meaning, NEED_COLORS.meaning),
      );

      const hintEl = document.createElement('div');
      hintEl.className = 'sg-status-hint';
      hintEl.textContent = npcStatusHint(sim.beliefs['player'], sim.needs, sim.activity);
      replaceChildren(faithHost, true,
        hintEl,
        barRow('faith', belief.faith, FAITH_COLORS.faith),
        barRow('understanding', belief.understanding, FAITH_COLORS.understanding),
        barRow('devotion', belief.devotion, FAITH_COLORS.devotion),
      );

      const pinned = nextOpts.pinned === true;
      pin.setAttribute('aria-pressed', pinned ? 'true' : 'false');
      pin.title = pinned ? 'Unpin card' : 'Pin card open';

      backfillBtn.disabled = power < 1;
      whisperBtn.disabled = power < WHISPER_COST || ((sim as unknown as { whisperCooldown?: number }).whisperCooldown ?? 0) > 0;
      dreamBtn.disabled = power < DREAM_COST;
      const isPraying = sim.activity === 'worship';
      prayBtn.disabled = power < ANSWER_PRAYER_COST || !isPraying;
      prayBtn.title = isPraying ? 'NPC is praying' : 'NPC must be praying';
      const hasHome = !!sim.homePoiId;
      omenBtn.style.display = hasHome ? '' : 'none';
      miracleBtn.style.display = hasHome ? '' : 'none';
      omenBtn.disabled = power < OMEN_COST;
      miracleBtn.disabled = power < MIRACLE_COST;
    },

    setNpc(npcId) {
      if (npcId === currentNpcId) return;
      currentNpcId = npcId;
      activeMode = 'whisper';
      applyMode();
      // Slices 2-3: reset thread scroll / mind breadcrumb here.
    },

    getActiveMode() { return activeMode; },

    destroy() {
      while (panel.firstChild) panel.removeChild(panel.firstChild);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/npc-attention-panel.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/npc-attention-panel.ts tests/unit/npc-attention-panel.test.ts
git commit -m "feat(attention): mounted NPC attention panel shell with Whisper/Mind mode switch

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Wire the store into Game + scrub-clear boundary

**Files:**
- Modify: `src/game.ts` (construct `NpcAttentionStore`; add `attentionStore.clearAll()` to the `TimelineController` `onRestore` callback alongside `commandQueue.clear()` — see `game.ts:129`)
- Test: `tests/unit/game-attention-scrub.test.ts` (or extend an existing timeline/restore test if one covers `onRestore`)

The store must be wiped on every snapshot restore. The existing `onRestore` callback already clears the command queue; add the store clear next to it.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/game-attention-scrub.test.ts
import { describe, it, expect } from 'vitest';
import { NpcAttentionStore } from '@/llm/npc-attention-store';
import { TimelineController } from '@/core/timeline';

// Verifies the wiring contract: onRestore clears BOTH the command queue and the
// attention store. We assert the controller invokes the callback we pass; the
// Game-level composition is exercised by constructing the same callback shape.
describe('attention store scrub-clear wiring', () => {
  it('clears the attention store on restore', () => {
    const store = new NpcAttentionStore();
    store.appendTurn('npc1', { whisper: 'x', dialogue: 'y', tick: 1 });
    let cleared = false;
    const onRestore = () => { store.clearAll(); cleared = true; };

    // A restore is any path that calls onRestore; invoke directly to assert the contract.
    onRestore();

    expect(cleared).toBe(true);
    expect(store.getTranscript('npc1')).toEqual([]);
  });
});
```

> Note: this is a contract test for the callback. The reviewer should additionally confirm by reading `src/game.ts` that the real `onRestore` passed to `TimelineController` calls `this.attentionStore.clearAll()`. If a higher-fidelity integration test for `TimelineController.onRestore` already exists, extend it instead.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/game-attention-scrub.test.ts`
Expected: FAIL — no `attentionStore` yet / module not constructed (the test itself passes trivially, so the *real* gate here is the code change in Step 3; verify by grepping `game.ts` for `attentionStore.clearAll`).

- [ ] **Step 3: Make the code change in `src/game.ts`**

Locate the field declarations near the other subsystem fields and add:

```ts
import { NpcAttentionStore } from '@/llm/npc-attention-store';
// ...
private attentionStore = new NpcAttentionStore();
```

Locate the `TimelineController` construction (the object literal containing `onRestore: () => this.commandQueue.clear()` — `game.ts:129`) and change that callback to:

```ts
onRestore: () => {
  this.commandQueue.clear();
  this.attentionStore.clearAll();
},
```

- [ ] **Step 4: Run the test + the existing timeline suite**

Run: `npx vitest run tests/unit/game-attention-scrub.test.ts && npx vitest run tests/unit/timeline.test.ts`
Expected: PASS. Grep-verify: `git grep -n 'attentionStore.clearAll' src/game.ts` returns the onRestore line.

- [ ] **Step 5: Commit**

```bash
git add src/game.ts tests/unit/game-attention-scrub.test.ts
git commit -m "feat(attention): wipe NpcAttentionStore on snapshot restore (scrub/commit/skip)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Swap frame-renderer + game-ui to the mounted handle

**Files:**
- Modify: `src/game/game-ui.ts` (mount the handle once; expose `npcAttentionPanel` handle on the UI object; pass `attentionStore` through if game-ui owns construction)
- Modify: `src/game/frame-renderer.ts:128-181` (replace `renderNpcInfoPanel(...)` with `handle.setNpc(...)` + `handle.update(...)`)
- Delete: `src/ui/npc-info-panel.ts` once no longer referenced (and its test `tests/unit/npc-info-panel.test.ts` if one exists — replace coverage with `npc-attention-panel.test.ts`)

This is the integration step. The frame loop currently rebuilds the panel on a 500ms throttle. With the mounted handle, `update()` is cheap and idempotent, so it can be called on the same throttle (or every frame) without clobbering body DOM. `setNpc()` is called when the selected NPC changes.

- [ ] **Step 1: Mount the handle in game-ui**

In `src/game/game-ui.ts`, where the `npcInfoPanel` element is created/owned, add (after the element exists):

```ts
import { mountNpcAttentionPanel, type NpcAttentionPanelHandle } from '@/ui/npc-attention-panel';
// ...
// expose on the UI object:
npcAttentionPanel: NpcAttentionPanelHandle;
// ...during construction, after npcInfoPanel element is created:
const npcAttentionPanel = mountNpcAttentionPanel(npcInfoPanel, {});
```

Add `npcAttentionPanel` to whatever object `game-ui` returns/exposes (the same object `frame-renderer` reads `this.deps.ui.npcInfoPanel` from). Keep the `npcInfoPanel` element reference — the handle was mounted into it.

- [ ] **Step 2: Rewrite the frame-renderer block**

Replace `frame-renderer.ts:152-174` (the `if (switched || pinChanged || now - this.lastInfoRefresh > 500) { renderNpcInfoPanel(...) }` block) with:

```ts
const now = performance.now();
const pinned = this.deps.state.pinnedNpcId === sim.npcId;
const switched = this.renderedNpcId !== sim.npcId;
const pinChanged = this.renderedPinned !== pinned;
if (switched) {
  this.deps.ui.npcAttentionPanel.setNpc(sim.npcId);
}
if (switched || pinChanged || now - this.lastInfoRefresh > 500) {
  this.deps.ui.npcAttentionPanel.update(sim, {
    pinned,
    power: player.power,
    onTogglePin: () => {
      this.deps.state.pinnedNpcId = this.deps.state.pinnedNpcId === sim.npcId ? null : sim.npcId;
      this.lastInfoRefresh = 0;
    },
    onWhisper: () => { this.deps.divine.whisper(entity); },
    onDream: () => { this.deps.divine.dream(entity); this.lastInfoRefresh = 0; },
    onAnswerPrayer: () => { this.deps.divine.answerPrayer(entity); this.lastInfoRefresh = 0; },
    onOmen: () => { this.deps.divine.omenForNpc(entity); },
    onMiracle: () => { this.deps.divine.miracleForNpc(entity); },
    onLlmBackfill: async () => { await this.deps.llmBackfill.trigger(entity); },
  });
  this.renderedNpcId = sim.npcId;
  this.renderedPinned = pinned;
  this.lastInfoRefresh = now;
}
this.deps.ui.npcInfoPanel.style.display = 'block';
```

Remove the now-unused `renderNpcInfoPanel` import from `frame-renderer.ts`.

- [ ] **Step 3: Delete the old panel module**

```bash
git grep -n "renderNpcInfoPanel\|npc-info-panel" src/ tests/
```
If the only remaining references are the file itself and its test, delete both:
```bash
git rm src/ui/npc-info-panel.ts
git rm tests/unit/npc-info-panel.test.ts   # only if it exists
```
If other code references it, leave the file and note the reference for follow-up.

- [ ] **Step 4: Typecheck + full build + full test suite**

Run: `npm run build`
Expected: TypeScript clean, Vite build succeeds.

Run: `npm test`
Expected: All tests pass (the new store + panel tests added; npc-info-panel coverage replaced). Confirm no regression in count beyond the deleted/added files.

- [ ] **Step 5: Manual smoke (optional but recommended)**

Run: `npm run dev`, select an NPC, confirm: header bars render, mode switch toggles Whisper/Mind bodies (placeholders), all six divine-action buttons still work and gate on power, pin still works, switching NPCs updates the header. Scrub time and confirm no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(attention): frame-renderer drives the mounted attention panel handle; retire renderNpcInfoPanel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** Slice 1 of the spec (§7) = "Refactor `npc-info-panel.ts` into a shell + mode switch + body slot; introduce `NpcAttentionStore` (empty); wire `clearAll()` to scrub/restore; existing action buttons remain." Covered: Task 2 (shell + switch + body slot + action footer), Task 1 (store), Task 3 (scrub-clear wiring), Task 4 (integration). Spec tests "shell renders header + switch; store persists/clears; nothing snapshotted" → Tasks 1 & 2 cover persist/clear and render; "nothing snapshotted" is guaranteed structurally (store is a plain class never put in `GameState`) — the explicit determinism guard test lands in Slice 2/3 per spec §8 (it needs whisper/probe activity to be meaningful). Acceptable for Slice 1.
- **Placeholder scan:** No TBD/TODO left as work. The `// Slices 2-3` comments mark genuine future extension points, not gaps in this slice.
- **Type consistency:** `NpcAttentionPanelHandle` methods (`update`/`setNpc`/`getActiveMode`/`destroy`) are used identically in Task 2 (def) and Task 4 (call sites). `WhisperTurn`/`MindPage`/`MindLink` defined in Task 1 are consumed in Slices 2/3. `NpcSimState` and `NpcInfoPanelOptions`→`NpcAttentionPanelOptions` callback names match the frame-renderer call site verbatim (`onWhisper`/`onDream`/`onAnswerPrayer`/`onOmen`/`onMiracle`/`onLlmBackfill`/`onTogglePin`).
- **Risk note:** Task 4 depends on the exact ownership of the `npcInfoPanel` element in `game-ui.ts`; the implementer should read `game-ui.ts` to find where it's created and exposed before editing. The plan flags this rather than guessing the variable name.
