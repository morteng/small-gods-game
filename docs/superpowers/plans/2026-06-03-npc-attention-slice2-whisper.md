# NPC Attention Surface — Slice 2: Whisper Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Whisper body of the attention panel into a multi-turn conversational thread: each send emits the deterministic `whisper` command (the floor), renders the mechanical result immediately, then calls the LLM for the NPC's spoken reaction + a clamped ±0.10 soft belief bonus, persisting the exchange in `NpcAttentionStore`.

**Architecture:** The deterministic floor already exists — `whisper()` (`src/sim/divine-actions.ts:40-67`) is registered as the divine `whisper` verb (`src/sim/command/registry.ts:59-67`) and applies `faith += 0.15·signResponse(understanding)`, `understanding += 0.03`, spends 1 power, sets a 5-tick cooldown. Slice 2 keeps that command as the single source of deterministic truth (one send = one `whisper` command) and layers soft narration on top: a new `buildWhisperPrompt` produces the LLM request, `LLMClient.generateNpcBackfill` returns dialogue + a `belief_bonus`, and a small extension to `state-writeback.ts` applies the clamped bonus *separately* from the floor. All generated text + the bonus live only in `NpcAttentionStore` (never snapshotted). The in-thread cooldown is lifted by having the panel emit a `whisper` command regardless of the displayed cooldown — the command's own precondition is relaxed for conversational player sends so the deterministic effect per send is unchanged.

**Tech Stack:** TypeScript ESM, Vite, Vitest (jsdom for DOM tests), `@/`→`src/` alias, `MockLLMProvider` for LLM tests.

---

## File Structure

- **Create** `src/llm/whisper-prompt-builder.ts` — `buildWhisperPrompt(ctx): BuiltPrompt`. Compact NPC card + last-N transcript turns + understanding-driven comprehension note.
- **Modify** `src/llm/state-writeback.ts` — add `applyWhisperBonus(npc, bonus, spiritId)`: applies a single faith delta clamped to `±WHISPER_BONUS_CLAMP` (0.10), returns the applied value.
- **Create** `src/ui/npc-whisper-mode.ts` — `mountWhisperMode(body, deps): WhisperModeHandle`. Owns the persistent thread DOM + input; `setNpc(npcId)` rebinds; `refresh()` re-reads the store transcript; `onSend` callback hands the typed whisper text up.
- **Modify** `src/ui/npc-attention-panel.ts` — host the whisper-mode handle in the whisper body (replace the Slice 1 placeholder); thread the store + an `onWhisperSend(text)` dep through.
- **Modify** `src/sim/command/registry.ts` — relax the `whisper` precondition so a player conversational send is not blocked by `whisperCooldown` (cooldown still set, still throttles the legacy one-shot button path if that remains; see Task 4 for the exact mechanism).
- **Modify** `src/game/frame-renderer.ts` / `src/game/game-ui.ts` — wire the send path: panel `onWhisperSend(text)` → emit `whisper` command via the command queue (carrying the text in `payload`) → after executor applies, call the LLM → write bonus + append transcript turn → `whisperMode.refresh()`.
- **Create** tests: `tests/unit/whisper-prompt-builder.test.ts`, `tests/unit/state-writeback-whisper-bonus.test.ts`, `tests/unit/npc-whisper-mode.test.ts` (jsdom).

---

### Task 1: `applyWhisperBonus` — clamped soft belief bonus

**Files:**
- Modify: `src/llm/state-writeback.ts`
- Test: `tests/unit/state-writeback-whisper-bonus.test.ts`

The soft bonus is a single faith nudge reflecting how *apt* the whisper was, clamped to ±0.10, applied to `props.beliefs[spiritId].faith` and re-clamped to [0,1]. It is separate from `applyLLMWriteback` (which handles full backfill deltas) so the whisper path stays narrow and the bonus magnitude is explicit.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/state-writeback-whisper-bonus.test.ts
import { describe, it, expect } from 'vitest';
import { applyWhisperBonus, WHISPER_BONUS_CLAMP } from '@/llm/state-writeback';
import type { Entity } from '@/core/types';

function npcWith(faith: number): Entity {
  return {
    id: 'npc1', kind: 'npc', x: 0, y: 0,
    properties: { beliefs: { player: { faith, understanding: 0.2, devotion: 0.1 } } },
  } as unknown as Entity;
}

describe('applyWhisperBonus', () => {
  it('exposes a 0.10 clamp constant', () => {
    expect(WHISPER_BONUS_CLAMP).toBeCloseTo(0.10, 5);
  });

  it('applies a positive bonus to faith', () => {
    const npc = npcWith(0.4);
    const applied = applyWhisperBonus(npc, 0.07, 'player');
    expect(applied).toBeCloseTo(0.07, 5);
    expect((npc.properties as any).beliefs.player.faith).toBeCloseTo(0.47, 5);
  });

  it('clamps a too-large bonus to ±0.10', () => {
    const npc = npcWith(0.4);
    const applied = applyWhisperBonus(npc, 0.5, 'player');
    expect(applied).toBeCloseTo(0.10, 5);
    expect((npc.properties as any).beliefs.player.faith).toBeCloseTo(0.50, 5);
  });

  it('clamps a negative bonus to -0.10 and keeps faith ≥ 0', () => {
    const npc = npcWith(0.05);
    const applied = applyWhisperBonus(npc, -0.9, 'player');
    expect(applied).toBeCloseTo(-0.10, 5);
    expect((npc.properties as any).beliefs.player.faith).toBe(0); // clamped to [0,1]
  });

  it('initializes belief if the spirit is unknown to the npc', () => {
    const npc = { id: 'n', kind: 'npc', x: 0, y: 0, properties: { beliefs: {} } } as unknown as Entity;
    const applied = applyWhisperBonus(npc, 0.08, 'player');
    expect(applied).toBeCloseTo(0.08, 5);
    expect((npc.properties as any).beliefs.player.faith).toBeCloseTo(0.08, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/state-writeback-whisper-bonus.test.ts`
Expected: FAIL — `applyWhisperBonus`/`WHISPER_BONUS_CLAMP` not exported.

- [ ] **Step 3: Add the implementation to `src/llm/state-writeback.ts`**

```ts
import type { SpiritId } from '@/core/types'; // if not already imported

/** Maximum magnitude of the soft, LLM-judged whisper faith bonus (never snapshotted). */
export const WHISPER_BONUS_CLAMP = 0.10;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Apply the soft, clamped (±0.10) whisper belief bonus to an NPC's faith in a spirit.
 * This is narration-layer sugar on top of the deterministic whisper floor: it is
 * overwritten on snapshot restore, so replay reproduces only the floor.
 *
 * @returns the actual faith delta applied (after ±0.10 clamp), for transcript display.
 */
export function applyWhisperBonus(npc: Entity, bonus: number, spiritId: SpiritId): number {
  const props = npc.properties as unknown as { beliefs: Record<string, { faith: number; understanding: number; devotion: number }> };
  let belief = props.beliefs[spiritId];
  if (!belief) { belief = { faith: 0, understanding: 0, devotion: 0 }; props.beliefs[spiritId] = belief; }
  const delta = clamp(bonus, -WHISPER_BONUS_CLAMP, WHISPER_BONUS_CLAMP);
  belief.faith = clamp(belief.faith + delta, 0, 1);
  return delta;
}
```

(Use the file's existing `Entity` import / `clamp01` helper if present rather than re-declaring; match local style.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/state-writeback-whisper-bonus.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/llm/state-writeback.ts tests/unit/state-writeback-whisper-bonus.test.ts
git commit -m "feat(attention): applyWhisperBonus — clamped ±0.10 soft faith bonus

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `buildWhisperPrompt`

**Files:**
- Create: `src/llm/whisper-prompt-builder.ts`
- Test: `tests/unit/whisper-prompt-builder.test.ts`

Builds the LLM request for a whisper reaction. Reuses the compact NPC-card style of `npc-prompt-builder.ts`. Includes: NPC identity/personality/beliefs/needs/mood, the **last ~6 transcript turns** for continuity, the **new whisper text**, and an explicit comprehension instruction keyed to `understanding` (low understanding → confused/garbled reaction; high → clear grasp). Asks for strict JSON: `{ dialogue, mood_delta, belief_bonus }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/whisper-prompt-builder.test.ts
import { describe, it, expect } from 'vitest';
import { buildWhisperPrompt } from '@/llm/whisper-prompt-builder';
import type { Entity } from '@/core/types';
import type { WhisperTurn } from '@/llm/npc-attention-store';

function npc(understanding: number): Entity {
  return {
    id: 'npc1', kind: 'npc', x: 3, y: 4,
    properties: {
      name: 'Maeve', role: 'farmer',
      personality: { assertiveness: 0.3, skepticism: 0.6, piety: 0.4, sociability: 0.5 },
      beliefs: { player: { faith: 0.4, understanding, devotion: 0.1 } },
      needs: { safety: 0.5, prosperity: 0.4, community: 0.6, meaning: 0.3 },
      mood: 0.5, activity: 'idle', homePoiId: 'poi_east', recentEventIds: [],
    },
  } as unknown as Entity;
}

describe('buildWhisperPrompt', () => {
  it('includes the new whisper text and the NPC name', () => {
    const p = buildWhisperPrompt({ npc: npc(0.5), whisperText: 'Heed the river', recentTurns: [], playerSpiritId: 'player' });
    expect(p.user).toContain('Heed the river');
    expect(p.user).toContain('Maeve');
  });

  it('asks for dialogue, mood_delta and belief_bonus JSON', () => {
    const p = buildWhisperPrompt({ npc: npc(0.5), whisperText: 'x', recentTurns: [], playerSpiritId: 'player' });
    expect(p.system + p.user).toMatch(/belief_bonus/);
    expect(p.system + p.user).toMatch(/dialogue/);
  });

  it('includes the last turns (capped at 6) for continuity', () => {
    const turns: WhisperTurn[] = Array.from({ length: 9 }, (_, i) => ({ whisper: `w${i}`, dialogue: `d${i}`, tick: i }));
    const p = buildWhisperPrompt({ npc: npc(0.5), whisperText: 'now', recentTurns: turns, playerSpiritId: 'player' });
    expect(p.user).toContain('w8');       // most recent kept
    expect(p.user).not.toContain('w2');   // older than last 6 dropped
  });

  it('flags low comprehension when understanding is low', () => {
    const p = buildWhisperPrompt({ npc: npc(0.05), whisperText: 'x', recentTurns: [], playerSpiritId: 'player' });
    expect(p.user.toLowerCase()).toMatch(/confus|garbl|barely|cannot|can't|unclear/);
  });

  it('flags clear comprehension when understanding is high', () => {
    const p = buildWhisperPrompt({ npc: npc(0.9), whisperText: 'x', recentTurns: [], playerSpiritId: 'player' });
    expect(p.user.toLowerCase()).toMatch(/clear|grasp|understands/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/whisper-prompt-builder.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/llm/whisper-prompt-builder.ts
import type { Entity, SpiritId, NpcProperties } from '@/core/types';
import type { WhisperTurn } from '@/llm/npc-attention-store';

export interface WhisperPromptContext {
  npc: Entity;
  whisperText: string;
  recentTurns: WhisperTurn[];
  playerSpiritId: SpiritId;
}

export interface BuiltPrompt {
  system: string;
  user: string;
  estimatedTokens: number;
}

const MAX_TURNS = 6;

const SYSTEM = [
  'You are narrating a mortal\'s reaction to a god\'s whisper in a world inspired by Terry Pratchett\'s Small Gods.',
  'The god speaks directly into the mortal\'s mind; the mortal does not see the god.',
  'Reply ONLY with strict JSON: {"dialogue": string, "mood_delta": number, "belief_bonus": number}.',
  'dialogue: the mortal\'s spoken or inner reaction (1-2 sentences, in-character).',
  'mood_delta: -0.2..0.2, how the whisper shifts their mood.',
  'belief_bonus: -0.1..0.1, how APT the whisper was for this mortal right now (a fitting, well-timed whisper earns more; a jarring or irrelevant one can be negative).',
].join(' ');

function comprehensionNote(understanding: number): string {
  if (understanding < 0.2) {
    return 'This mortal barely comprehends divine signals — the whisper arrives confused and garbled, words they cannot quite place.';
  }
  if (understanding < 0.6) {
    return 'This mortal partially comprehends divine signals — the whisper lands as a strong intuition, half-understood.';
  }
  return 'This mortal clearly grasps divine signals — the whisper is understood almost as plain speech.';
}

export function buildWhisperPrompt(ctx: WhisperPromptContext): BuiltPrompt {
  const p = ctx.npc.properties as unknown as NpcProperties;
  const b = p.beliefs[ctx.playerSpiritId] ?? { faith: 0, understanding: 0, devotion: 0 };
  const recent = ctx.recentTurns.slice(-MAX_TURNS);

  const lines: string[] = [];
  lines.push(`Mortal: ${p.name}, a ${p.role}.`);
  lines.push(`Personality — assertiveness ${p.personality.assertiveness.toFixed(2)}, skepticism ${p.personality.skepticism.toFixed(2)}, piety ${p.personality.piety.toFixed(2)}, sociability ${p.personality.sociability.toFixed(2)}.`);
  lines.push(`Belief in you — faith ${b.faith.toFixed(2)}, understanding ${b.understanding.toFixed(2)}, devotion ${b.devotion.toFixed(2)}.`);
  lines.push(`Needs — safety ${p.needs.safety.toFixed(2)}, prosperity ${p.needs.prosperity.toFixed(2)}, community ${p.needs.community.toFixed(2)}, meaning ${p.needs.meaning.toFixed(2)}.`);
  lines.push(`Mood ${p.mood.toFixed(2)}; currently ${p.activity}.`);
  lines.push(comprehensionNote(b.understanding));
  if (recent.length) {
    lines.push('Recent whisper exchanges (oldest first):');
    for (const t of recent) lines.push(`  you whispered: "${t.whisper}" → they reacted: "${t.dialogue}"`);
  }
  lines.push(`You now whisper: "${ctx.whisperText}"`);
  lines.push('Return the mortal\'s reaction as JSON.');

  const user = lines.join('\n');
  return { system: SYSTEM, user, estimatedTokens: Math.ceil((SYSTEM.length + user.length) / 4) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/whisper-prompt-builder.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/llm/whisper-prompt-builder.ts tests/unit/whisper-prompt-builder.test.ts
git commit -m "feat(attention): buildWhisperPrompt — last-N turns + understanding-keyed comprehension

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Whisper-mode thread view

**Files:**
- Create: `src/ui/npc-whisper-mode.ts`
- Test: `tests/unit/npc-whisper-mode.test.ts`

A persistent thread: scrollable transcript (your whisper / their reaction pairs) + a text input + send button. It reads turns from `NpcAttentionStore` via `refresh()`, appends new turns without wiping (preserving scroll), and calls `deps.onSend(text)` when the user submits. It does **not** itself emit commands or call the LLM — that orchestration is the caller's job (Task 5), keeping the view dumb and testable.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/npc-whisper-mode.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mountWhisperMode } from '@/ui/npc-whisper-mode';
import { NpcAttentionStore } from '@/llm/npc-attention-store';

describe('mountWhisperMode', () => {
  let body: HTMLElement;
  let store: NpcAttentionStore;
  beforeEach(() => { body = document.createElement('div'); store = new NpcAttentionStore(); });

  it('renders existing transcript turns on refresh', () => {
    store.appendTurn('npc1', { whisper: 'heed the river', dialogue: 'a voice?', tick: 1 });
    const h = mountWhisperMode(body, { store, onSend: () => {} });
    h.setNpc('npc1');
    h.refresh();
    expect(body.textContent).toContain('heed the river');
    expect(body.textContent).toContain('a voice?');
  });

  it('calls onSend with trimmed input text and clears the input', () => {
    let sent = '';
    const h = mountWhisperMode(body, { store, onSend: (t) => { sent = t; } });
    h.setNpc('npc1');
    const input = body.querySelector('[data-sg=whisper-input]') as HTMLTextAreaElement;
    input.value = '  flee north  ';
    (body.querySelector('[data-sg=whisper-send]') as HTMLButtonElement).click();
    expect(sent).toBe('flee north');
    expect(input.value).toBe('');
  });

  it('does not call onSend for empty/whitespace input', () => {
    let calls = 0;
    const h = mountWhisperMode(body, { store, onSend: () => { calls++; } });
    h.setNpc('npc1');
    const input = body.querySelector('[data-sg=whisper-input]') as HTMLTextAreaElement;
    input.value = '   ';
    (body.querySelector('[data-sg=whisper-send]') as HTMLButtonElement).click();
    expect(calls).toBe(0);
  });

  it('appends a new turn on refresh without removing prior DOM nodes', () => {
    store.appendTurn('npc1', { whisper: 'a', dialogue: 'b', tick: 1 });
    const h = mountWhisperMode(body, { store, onSend: () => {} });
    h.setNpc('npc1'); h.refresh();
    const first = body.querySelector('[data-sg=turn]');
    store.appendTurn('npc1', { whisper: 'c', dialogue: 'd', tick: 2 });
    h.refresh();
    expect(body.querySelectorAll('[data-sg=turn]').length).toBe(2);
    expect(body.querySelector('[data-sg=turn]')).toBe(first); // first node preserved
  });

  it('shows a degraded marker when a turn is flagged degraded', () => {
    store.appendTurn('npc1', { whisper: 'x', dialogue: '', tick: 1, degraded: true });
    const h = mountWhisperMode(body, { store, onSend: () => {} });
    h.setNpc('npc1'); h.refresh();
    expect(body.textContent?.toLowerCase()).toMatch(/no vision|the words land/);
  });

  it('switches transcript when setNpc changes', () => {
    store.appendTurn('a', { whisper: 'alpha', dialogue: 'A', tick: 1 });
    store.appendTurn('b', { whisper: 'beta', dialogue: 'B', tick: 1 });
    const h = mountWhisperMode(body, { store, onSend: () => {} });
    h.setNpc('a'); h.refresh();
    expect(body.textContent).toContain('alpha');
    h.setNpc('b'); h.refresh();
    expect(body.textContent).toContain('beta');
    expect(body.textContent).not.toContain('alpha');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/npc-whisper-mode.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/ui/npc-whisper-mode.ts
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
  /** Re-read the store transcript and render any new turns (preserving existing DOM + scroll). */
  refresh(): void;
  /** Enable/disable the send affordance (e.g. while a send is in flight or power is 0). */
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
  let renderedCount = 0; // how many turns are already in the DOM

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

  return {
    setNpc(id) {
      if (id === npcId) return;
      npcId = id;
      // Rebuild from scratch for the new NPC.
      while (thread.firstChild) thread.removeChild(thread.firstChild);
      renderedCount = 0;
      input.value = '';
      this.refresh();
    },
    refresh() {
      if (!npcId) return;
      const turns = deps.store.getTranscript(npcId);
      if (turns.length === 0) {
        if (!thread.contains(empty)) { thread.appendChild(empty); }
        return;
      }
      if (thread.contains(empty)) thread.removeChild(empty);
      // Append only turns not yet rendered (preserves scroll + earlier nodes).
      for (let i = renderedCount; i < turns.length; i++) thread.appendChild(turnNode(turns[i]));
      renderedCount = turns.length;
      thread.scrollTop = thread.scrollHeight;
    },
    setSendEnabled(enabled) { send.disabled = !enabled; input.disabled = !enabled; },
    destroy() { while (body.firstChild) body.removeChild(body.firstChild); },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/npc-whisper-mode.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/npc-whisper-mode.ts tests/unit/npc-whisper-mode.test.ts
git commit -m "feat(attention): whisper-mode thread view (store-backed, append-only, degraded marker)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Relax the whisper cooldown for conversational sends

**Files:**
- Modify: `src/sim/command/registry.ts` (the `whisper` capability `precondition`)
- Modify: `src/sim/divine-actions.ts` (allow a conversational whisper to bypass the cooldown precondition while keeping every other effect identical)
- Test: `tests/unit/whisper-conversational.test.ts`

The spec's invariant: **one send = one deterministic `whisper` command**, and the in-thread cooldown is lifted so power is the only throttle. Implement this by carrying a flag in the command `payload` (`conversational: true`) that the precondition honors: a conversational whisper is not rejected for `whisperCooldown > 0`. Power gating is unchanged (the executor still checks `cost` against spirit power). The cooldown is still *set* by `whisper()` so the legacy one-shot button path (if any remains) is unaffected. No randomness; deterministic; replay-safe (the flag is part of the recorded command).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/whisper-conversational.test.ts
import { describe, it, expect } from 'vitest';
import { CAPABILITY_REGISTRY } from '@/sim/command/registry';
import type { Command } from '@/sim/command/types';
// Build a minimal CommandCtx with one npc that has whisperCooldown > 0 and a player spirit with power.
// (Reuse the existing test helper that constructs a CommandCtx if one exists in tests/unit/command-*.test.ts;
//  otherwise construct world+spirits inline as those tests do.)

function ctxWithCooldownNpc() {
  // ...mirror the construction used in tests/unit/command-system.test.ts / registry tests...
  // returns { ctx, npcId } where npcProps(npc).whisperCooldown = 5
}

describe('whisper conversational cooldown bypass', () => {
  it('rejects a normal whisper while cooldown > 0', () => {
    const { ctx, npcId } = ctxWithCooldownNpc();
    const cmd: Command = { verb: 'whisper', source: 'player', target: { kind: 'npc', npcId }, seq: 1 };
    expect(CAPABILITY_REGISTRY.whisper.precondition!(cmd, ctx)).toBe('precondition_failed');
  });

  it('allows a conversational whisper while cooldown > 0', () => {
    const { ctx, npcId } = ctxWithCooldownNpc();
    const cmd: Command = { verb: 'whisper', source: 'player', target: { kind: 'npc', npcId }, payload: { conversational: true }, seq: 1 };
    expect(CAPABILITY_REGISTRY.whisper.precondition!(cmd, ctx)).toBeNull();
  });
});
```

> The implementer must first read `tests/unit/command-system.test.ts` (or the nearest registry test) to reuse its `CommandCtx` construction helper verbatim, since `CommandCtx` shape (spirits map, world, log) is non-trivial. Do not invent the ctx shape.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/whisper-conversational.test.ts`
Expected: FAIL — conversational whisper currently returns `'precondition_failed'` (cooldown not bypassed).

- [ ] **Step 3: Update the `whisper` precondition in `src/sim/command/registry.ts`**

```ts
whisper: {
  verb: 'whisper', tier: 'divine', cost: WHISPER_COST, targetKind: 'npc', implemented: true,
  precondition(cmd, ctx) {
    const npc = npcOf(cmd, ctx);
    if (!npc) return 'invalid_target';
    // Conversational (thread) sends are throttled only by power, not the 5-tick cooldown.
    if (cmd.payload?.conversational === true) return null;
    return npcProps(npc).whisperCooldown > 0 ? 'precondition_failed' : null;
  },
  apply(cmd, ctx) {
    return whisper(ctx.spirits.get(cmd.source)!, npcOf(cmd, ctx)!, ctx.log, cmd.payload?.conversational === true);
  },
  describe: (cmd) => `whisper to ${targetLabel(cmd)}`,
},
```

- [ ] **Step 4: Update `whisper()` in `src/sim/divine-actions.ts` to accept the flag**

Add a final optional param; when `conversational`, skip the internal cooldown guard but keep all belief/power/event effects identical:

```ts
export function whisper(spirit: Spirit, npc: Entity, log: EventLog, conversational = false): boolean {
  const p = npcProps(npc);
  if (spirit.power < WHISPER_COST) return false;
  if (!conversational && p.whisperCooldown > 0) return false;
  // ...unchanged: deduct power, apply faith += 0.15·signResponse(u), understanding += 0.03,
  //    set p.whisperCooldown = WHISPER_COOLDOWN, append whisper event, push recentEventIds...
  return true;
}
```

(Preserve the exact existing body; only the guard line gains the `!conversational &&` condition. The cooldown is still *set* so it remains meaningful for non-conversational callers.)

- [ ] **Step 5: Run the test + existing whisper/divine-action suite**

Run: `npx vitest run tests/unit/whisper-conversational.test.ts && npx vitest run tests/unit/divine-actions.test.ts`
Expected: PASS; no regression in existing whisper tests (the default `conversational=false` preserves old behavior).

- [ ] **Step 6: Commit**

```bash
git add src/sim/command/registry.ts src/sim/divine-actions.ts tests/unit/whisper-conversational.test.ts
git commit -m "feat(attention): conversational whisper bypasses 5-tick cooldown (power-throttled), replay-safe via payload flag

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Orchestrate send → command → LLM → bonus → transcript

**Files:**
- Modify: `src/ui/npc-attention-panel.ts` (replace the whisper-body placeholder with `mountWhisperMode`; accept `store` + `onWhisperSend` in deps/opts; expose `refreshWhisper()` and `setSendEnabled` passthroughs; call `whisperMode.refresh()` from `update()`)
- Modify: `src/game/game-ui.ts` + `src/game/frame-renderer.ts` (provide `attentionStore`; implement the send orchestrator: emit `whisper` command with `payload:{conversational:true, text}`; after the command applies, call the LLM and write the bonus + append the turn)
- Test: `tests/unit/whisper-orchestration.test.ts`

The orchestrator is the only place that touches both the command channel and the LLM. Flow per send:
1. Read current power; if `< WHISPER_COST`, ignore (panel also gates the button).
2. Emit `whisper` command (`source:'player'`, `target:{kind:'npc',npcId}`, `payload:{conversational:true, text}`). The executor applies the deterministic floor on the next tick (or synchronously if the test drains the queue).
3. Append a provisional transcript turn `{ whisper: text, dialogue: '', tick }` and `refresh()` so the player sees their whisper immediately.
4. Call `LLMClient.generateNpcBackfill(system, user)` from `buildWhisperPrompt`. Parse `{ dialogue, mood_delta, belief_bonus }` via the existing `parseLLMJson`/`response.parsed` path.
5. On success: `applyWhisperBonus(npc, belief_bonus, 'player')`, apply `mood_delta` (clamp ±0.2), update the provisional turn's `dialogue` + `faithBonus`, `refresh()`.
6. On LLM error/unavailable: mark the turn `degraded: true`, `refresh()`. The floor already applied — belief still moved.

Because step 4 is async and the store is mutated in place, the orchestrator updates the last transcript turn object then calls `refresh()`. To keep `refresh()`'s append-only contract valid when mutating an existing turn, `refresh()` re-renders the *last* turn if its backing object changed — simplest: give the orchestrator a `whisperMode.refreshLast()` that re-renders only the final turn node. Add that method.

- [ ] **Step 1: Add `refreshLast()` to the whisper-mode handle (TDD)**

Add to `tests/unit/npc-whisper-mode.test.ts`:

```ts
it('refreshLast() re-renders the final turn after its dialogue is filled in', () => {
  const store = new NpcAttentionStore();
  const body = document.createElement('div');
  store.appendTurn('npc1', { whisper: 'heed', dialogue: '', tick: 1 });
  const h = mountWhisperMode(body, { store, onSend: () => {} });
  h.setNpc('npc1'); h.refresh();
  expect(body.textContent).not.toContain('a voice');
  // simulate async LLM fill:
  store.getTranscript('npc1')[0].dialogue = 'a voice?';
  h.refreshLast();
  expect(body.textContent).toContain('a voice?');
  expect(body.querySelectorAll('[data-sg=turn]').length).toBe(1); // still one turn
});
```

Implement `refreshLast()` in `npc-whisper-mode.ts`: replace the last `[data-sg=turn]` node with a fresh `turnNode(lastTurn)` (re-reading from the store); keep `renderedCount` unchanged.

```ts
refreshLast() {
  if (!npcId) return;
  const turns = deps.store.getTranscript(npcId);
  if (turns.length === 0) return;
  const nodes = thread.querySelectorAll('[data-sg=turn]');
  const last = nodes[nodes.length - 1];
  const fresh = turnNode(turns[turns.length - 1]);
  if (last) thread.replaceChild(fresh, last); else thread.appendChild(fresh);
  thread.scrollTop = thread.scrollHeight;
},
```

Run: `npx vitest run tests/unit/npc-whisper-mode.test.ts` → PASS (7 tests). Commit.

- [ ] **Step 2: Host whisper-mode inside the attention panel**

In `src/ui/npc-attention-panel.ts`:
- Extend `NpcAttentionPanelDeps` with `store: NpcAttentionStore` and `onWhisperSend: (npcId: string, text: string) => void`.
- In the constructor, after building `whisperBody`, remove the placeholder and `const whisperMode = mountWhisperMode(whisperBody, { store: deps.store, onSend: (text) => { if (currentNpcId) deps.onWhisperSend(currentNpcId, text); } });`
- In `setNpc(npcId)`: call `whisperMode.setNpc(npcId)`.
- In `update(...)`: call `whisperMode.refresh()` and `whisperMode.setSendEnabled((opts.power ?? 0) >= 1)`.
- Expose `refreshWhisper()` and `refreshWhisperLast()` on the handle that delegate to the whisper-mode handle (the orchestrator calls these after async LLM completion).
- In `destroy()`: `whisperMode.destroy()`.

(Update Slice 1's `npc-attention-panel.test.ts` to pass a `store` + `onWhisperSend: () => {}` in its `mountNpcAttentionPanel(host, {...})` deps, since deps are now required.)

- [ ] **Step 3: Write the orchestrator + its test**

Create the orchestrator as a small function (e.g. in `src/game/whisper-orchestrator.ts`) so it's unit-testable without the whole Game:

```ts
// src/game/whisper-orchestrator.ts
import type { Entity, SpiritId } from '@/core/types';
import type { CommandQueue } from '@/sim/command/command-queue';
import type { LLMClient } from '@/llm/llm-client';
import type { NpcAttentionStore } from '@/llm/npc-attention-store';
import { buildWhisperPrompt } from '@/llm/whisper-prompt-builder';
import { applyWhisperBonus } from '@/llm/state-writeback';
import { parseLLMJson } from '@/llm/llm-client'; // use the existing parse helper; adjust import to its real location

export interface WhisperOrchestratorDeps {
  queue: CommandQueue;
  llm: LLMClient;
  store: NpcAttentionStore;
  playerSpiritId: SpiritId;
  now(): number;            // current sim tick
  onTurnUpdated(npcId: string): void; // → panel.refreshWhisperLast()
  onTurnAppended(npcId: string): void; // → panel.refreshWhisper()
}

export async function sendWhisper(npc: Entity, text: string, deps: WhisperOrchestratorDeps): Promise<void> {
  const npcId = npc.id;
  // 1. Deterministic floor: one command.
  deps.queue.emit({ verb: 'whisper', source: deps.playerSpiritId, target: { kind: 'npc', npcId }, payload: { conversational: true, text } });
  // 2. Provisional turn shown immediately.
  const recentBefore = deps.store.getTranscript(npcId);
  deps.store.appendTurn(npcId, { whisper: text, dialogue: '', tick: deps.now() });
  deps.onTurnAppended(npcId);
  // 3. Soft narration.
  const turns = deps.store.getTranscript(npcId);
  const turn = turns[turns.length - 1];
  try {
    const prompt = buildWhisperPrompt({ npc, whisperText: text, recentTurns: recentBefore, playerSpiritId: deps.playerSpiritId });
    const res = await deps.llm.generateNpcBackfill(prompt.system, prompt.user);
    const parsed = (res.parsed ?? parseLLMJson(res.content)) as { dialogue?: string; mood_delta?: number; belief_bonus?: number } | null;
    if (!parsed || typeof parsed.dialogue !== 'string') { turn.degraded = true; deps.onTurnUpdated(npcId); return; }
    turn.dialogue = parsed.dialogue;
    if (typeof parsed.belief_bonus === 'number') turn.faithBonus = applyWhisperBonus(npc, parsed.belief_bonus, deps.playerSpiritId);
    if (typeof parsed.mood_delta === 'number') {
      const props = npc.properties as unknown as { mood: number };
      props.mood = Math.max(0, Math.min(1, props.mood + Math.max(-0.2, Math.min(0.2, parsed.mood_delta))));
    }
    deps.onTurnUpdated(npcId);
  } catch {
    turn.degraded = true;
    deps.onTurnUpdated(npcId);
  }
}
```

Test `tests/unit/whisper-orchestration.test.ts` using `MockLLMProvider` + a real `CommandQueue` + `NpcAttentionStore`:

```ts
import { describe, it, expect } from 'vitest';
import { sendWhisper } from '@/game/whisper-orchestrator';
import { CommandQueue } from '@/sim/command/command-queue';
import { NpcAttentionStore } from '@/llm/npc-attention-store';
import { LLMClient, MockLLMProvider } from '@/llm/llm-client';
import type { Entity } from '@/core/types';

function npc(): Entity {
  return { id: 'npc1', kind: 'npc', x: 0, y: 0, properties: {
    name: 'Maeve', role: 'farmer',
    personality: { assertiveness: 0.3, skepticism: 0.5, piety: 0.4, sociability: 0.5 },
    beliefs: { player: { faith: 0.4, understanding: 0.3, devotion: 0.1 } },
    needs: { safety: 0.5, prosperity: 0.5, community: 0.5, meaning: 0.5 },
    mood: 0.5, activity: 'idle', recentEventIds: [],
  } } as unknown as Entity;
}

function deps(store: NpcAttentionStore, queue: CommandQueue, llm: LLMClient) {
  const updated: string[] = []; const appended: string[] = [];
  return { d: {
    queue, llm, store, playerSpiritId: 'player' as const, now: () => 100,
    onTurnUpdated: (id: string) => updated.push(id),
    onTurnAppended: (id: string) => appended.push(id),
  }, updated, appended };
}

describe('sendWhisper orchestration', () => {
  it('emits exactly one whisper command per send', async () => {
    const store = new NpcAttentionStore(); const queue = new CommandQueue();
    const llm = new LLMClient(new MockLLMProvider(0));
    const { d } = deps(store, queue, llm);
    await sendWhisper(npc(), 'heed the river', d);
    const drained = queue.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0].verb).toBe('whisper');
    expect(drained[0].payload).toMatchObject({ conversational: true, text: 'heed the river' });
  });

  it('appends a provisional turn then fills dialogue from the LLM', async () => {
    const store = new NpcAttentionStore(); const queue = new CommandQueue();
    const llm = new LLMClient(new MockLLMProvider(0)); // mock returns dialogue in its canned JSON
    const { d } = deps(store, queue, llm);
    const e = npc();
    await sendWhisper(e, 'x', d);
    const t = store.getTranscript('npc1');
    expect(t).toHaveLength(1);
    expect(t[0].whisper).toBe('x');
    expect(t[0].dialogue.length).toBeGreaterThan(0); // filled by mock
    expect(t[0].degraded).not.toBe(true);
  });

  it('marks the turn degraded when the LLM throws', async () => {
    const store = new NpcAttentionStore(); const queue = new CommandQueue();
    const throwing = new LLMClient({ async generate() { throw new Error('offline'); } } as any);
    const { d } = deps(store, queue, throwing);
    await sendWhisper(npc(), 'x', d);
    expect(store.getTranscript('npc1')[0].degraded).toBe(true);
  });

  it('clamps the applied faith bonus to ±0.10', async () => {
    const store = new NpcAttentionStore(); const queue = new CommandQueue();
    const big = new LLMClient(new MockLLMProvider(0, undefined));
    // Force a large belief_bonus via a stub provider returning parsed JSON:
    const stub = new LLMClient({ async generate() { return { content: JSON.stringify({ dialogue: 'ok', belief_bonus: 0.9, mood_delta: 0 }), latencyMs: 0 }; } } as any);
    const { d } = deps(store, queue, stub);
    const e = npc();
    const before = (e.properties as any).beliefs.player.faith;
    await sendWhisper(e, 'x', d);
    const after = (e.properties as any).beliefs.player.faith;
    expect(after - before).toBeCloseTo(0.10, 5);
  });
});
```

> The implementer must verify the real name/location of the JSON-parse helper (`parseLLMJson`) and `MockLLMProvider`'s canned-JSON shape (it returns `{ narration, dialogue, belief_delta, mood_delta }` per the explore digest — note it returns `belief_delta`, not `belief_bonus`). Adjust: the orchestrator should read `belief_bonus` from the parsed JSON; for the mock-driven "fills dialogue" test, only `dialogue` presence is asserted (the mock provides it). The clamp test uses an explicit stub returning `belief_bonus`. If `MockLLMProvider`'s canned JSON lacks `dialogue`, extend the mock minimally or use a stub in that test too — do not assert on `belief_bonus` from the default mock.

- [ ] **Step 4: Wire the orchestrator into the panel send path**

In `game-ui.ts`/`frame-renderer.ts`, build the panel deps with:
```ts
store: this.attentionStore,
onWhisperSend: (npcId, text) => {
  const entity = getNpc(this.deps.state.world!, npcId);
  if (!entity) return;
  void sendWhisper(entity, text, {
    queue: this.deps.commandQueue,
    llm: this.deps.llmClient,            // the live NPC-tier client
    store: this.deps.attentionStore,
    playerSpiritId: 'player',
    now: () => this.deps.state.clock.now(),
    onTurnAppended: () => this.deps.ui.npcAttentionPanel.refreshWhisper(),
    onTurnUpdated: () => this.deps.ui.npcAttentionPanel.refreshWhisperLast(),
  });
},
```
(Confirm the real accessors for the command queue, the NPC-tier `LLMClient`, and the player spirit id from `game.ts`. The `divine.whisper(entity)` footer button can stay as the legacy one-shot path or be removed; keeping it is fine — it emits a non-conversational `whisper`.)

- [ ] **Step 5: Full build + test + manual smoke**

Run: `npm run build` → clean.
Run: `npm test` → all green.
Manual: select an NPC, switch to 🗣️ Whisper, type "heed the river", send. Confirm: your line appears immediately; the NPC reaction fills in shortly after; faith bar ticks up; you can send again without waiting for a cooldown (only power gates). Disconnect the LLM (set provider to a broken key) and confirm the degraded line shows while faith still moves. Scrub time → transcript clears.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(attention): whisper conversation — send→floor→LLM reaction→clamped bonus→transcript

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage (§3, §7 Slice 2, §8):** Thread UI + input → emit `whisper` ✓ (Task 3 + 5). Deterministic floor unchanged, one send = one command ✓ (Task 4 + 5 Step 1 test). Render result immediately then LLM reaction ✓ (Task 5 provisional turn → refreshLast). `buildWhisperPrompt` with last-N turns + understanding ✓ (Task 2). Clamped ±0.10 soft bonus ✓ (Task 1, asserted in Task 5). Transcript in store ✓; clears on scrub ✓ (inherited from Slice 1's `clearAll` wiring — add an explicit assertion in Task 5 manual smoke / or a unit test scrubbing the store). Low-understanding garble flag in prompt ✓ (Task 2). LLM-unavailable fallback ✓ (Task 5 degraded path).
- **Cooldown invariant:** Resolved per spec §6/§10 — conversational sends carry `payload.conversational` and bypass only the cooldown precondition; power gating and all belief/event effects are unchanged, and the flag is part of the recorded command so replay reproduces the same floor. One send = one `whisper` command holds.
- **Placeholder scan:** The two `>` notes direct the implementer to read real helper names (`parseLLMJson`, `MockLLMProvider` canned shape, `CommandCtx` construction) rather than trusting guessed signatures — these are explicit verification instructions, not deferred work.
- **Type consistency:** `WhisperTurn.faithBonus`/`degraded` (defined Slice 1) are written by the orchestrator and read by `turnNode`. `buildWhisperPrompt` returns `BuiltPrompt {system,user,estimatedTokens}` consumed via `generateNpcBackfill(system, user)`. `applyWhisperBonus(npc, bonus, spiritId)` signature is identical in Task 1 and Task 5. The panel handle gains `refreshWhisper()`/`refreshWhisperLast()` used by the orchestrator callbacks.
- **Determinism guard:** the soft bonus + dialogue live only in `NpcAttentionStore`; the floor is the command. A scrub-then-replay test (store empty, faith reflects only floor deltas) is the explicit determinism guard — fold it into Slice 3's combined guard test (spec §8) which scrubs past both whisper and probe activity.
