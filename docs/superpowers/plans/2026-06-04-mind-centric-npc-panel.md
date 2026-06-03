# Mind-Centric NPC Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the NPC panel always show the mortal's mind; fold whisper into a small input under it, and re-read the surface after each whisper so it visibly reflects what was whispered.

**Architecture:** The deterministic command/spend floor is untouched. The panel drops its Mind/Whisper tab model: the mind reader is always the body; a whisper input lives in the footer. After `sendWhisper` resolves, `game.ts` invalidates the surface mind page and re-reads it (free, depth 0) with the recent whisper turns as context, then pushes the regenerated page to the panel. Soft content stays in `NpcAttentionStore` (never snapshotted).

**Tech Stack:** TypeScript ESM, Vite, Vitest (jsdom), `@/`→`src/`.

**Spec:** `docs/superpowers/specs/2026-06-04-mind-centric-npc-panel-design.md`

**Branch:** continue on `feat/npc-attention-surface`.

---

## File Structure

- `src/llm/npc-attention-store.ts` — add `invalidatePage`.
- `src/llm/mind-prompt-builder.ts` — surface (depth 0) prompt gains whisper context.
- `src/game/mind-orchestrator.ts` — pass whisper context at depth 0; suppress `probe_mind` when cost is 0.
- `src/ui/npc-whisper-mode.ts` — shrink to `mountWhisperInput` (textarea + Send + gating); delete thread view.
- `src/game/whisper-orchestrator.ts` — drop the thread-refresh callbacks.
- `src/ui/npc-attention-panel.ts` — remove tabs/modes; mind body always visible; whisper input footer; trimmed handle.
- `src/game.ts` — whisper resolves → re-read surface → `showMindPage`; drop thread callbacks.
- `src/game/game-ui.ts` — drop `store` from panel deps mount.
- `src/game/frame-renderer.ts` — drop the `onWhisper` divine-button option.
- Tests updated alongside each.

---

## Task 1: Store — `invalidatePage`

**Files:**
- Modify: `src/llm/npc-attention-store.ts`
- Test: `tests/unit/npc-attention-store.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/npc-attention-store.test.ts` inside the top-level `describe`:

```ts
  it('invalidatePage removes a cached page so it regenerates', () => {
    const s = new NpcAttentionStore();
    s.putPage('npc1', 'surface', { prose: 'old', links: [], depth: 0 });
    expect(s.getPage('npc1', 'surface')).toBeDefined();
    s.invalidatePage('npc1', 'surface');
    expect(s.getPage('npc1', 'surface')).toBeUndefined();
  });

  it('invalidatePage is a no-op for an unknown npc or key', () => {
    const s = new NpcAttentionStore();
    expect(() => s.invalidatePage('ghost', 'surface')).not.toThrow();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/npc-attention-store.test.ts`
Expected: FAIL — `invalidatePage is not a function`.

- [ ] **Step 3: Implement**

In `src/llm/npc-attention-store.ts`, add this method to the `NpcAttentionStore` class, immediately after `putPage`:

```ts
  /** Drop one cached page so the next read regenerates it (used to re-read the surface after a whisper). */
  invalidatePage(npcId: string, path: string): void {
    this.pages.get(npcId)?.delete(path);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/npc-attention-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/llm/npc-attention-store.ts tests/unit/npc-attention-store.test.ts
git commit -m "feat(attention): NpcAttentionStore.invalidatePage for surface re-reads

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Mind prompt — whisper context at depth 0

**Files:**
- Modify: `src/llm/mind-prompt-builder.ts`
- Test: `tests/unit/mind-prompt-builder.test.ts`

Context: `buildMindPagePrompt(ctx)` builds the `emit_mind_page` tool prompt. We add an optional `recentWhispers` to the context and, **only at depth 0**, append a block framing the whispers as intrusive, unbidden notions so the surface re-read reflects them. `WhisperTurn` is exported from `@/llm/npc-attention-store`.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/mind-prompt-builder.test.ts` (it already imports `buildMindPagePrompt` and has a `maeve()`-style fixture — reuse the existing `npc()` factory in that file; if the factory is named differently, match it):

```ts
  it('includes recent whispers as unbidden notions at depth 0 only', () => {
    const whispers = [{ whisper: 'heed the river', dialogue: 'a voice?', tick: 1 }];
    const surface = buildMindPagePrompt({ npc: npc(), path: ['surface'], candidates: [], depth: 0, recentWhispers: whispers });
    const surfaceUser = surface.messages.find((m) => m.role === 'user')!.content;
    expect(surfaceUser).toContain('heed the river');
    expect(surfaceUser.toLowerCase()).toMatch(/unbidden|from outside|intrud/);

    const deep = buildMindPagePrompt({ npc: npc(), path: ['surface', 'fear'], candidates: [], depth: 1, recentWhispers: whispers });
    const deepUser = deep.messages.find((m) => m.role === 'user')!.content;
    expect(deepUser).not.toContain('heed the river');
  });
```

If the test file's NPC factory isn't named `npc`, open the file first and use whatever fixture it defines (e.g. `maeve()`); the assertions are what matter.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/mind-prompt-builder.test.ts`
Expected: FAIL — `recentWhispers` not in type / text absent.

- [ ] **Step 3: Implement**

In `src/llm/mind-prompt-builder.ts`:

a) Add the import at the top with the other type imports:

```ts
import type { WhisperTurn } from '@/llm/npc-attention-store';
```

b) Extend the context interface:

```ts
export interface MindPromptContext {
  npc: Entity;
  path: string[];
  candidates: MindCandidate[];
  depth: number;
  /** Recent whisper turns; folded into the SURFACE (depth 0) prompt only, framed as unbidden notions. */
  recentWhispers?: WhisperTurn[];
}
```

c) In `buildMindPagePrompt`, inside the function body, just before the final `lines.push(brevityInstruction(ctx.depth));` line, add the depth-0 whisper block:

```ts
  if (ctx.depth === 0 && ctx.recentWhispers && ctx.recentWhispers.length) {
    const recent = ctx.recentWhispers.slice(-3);
    lines.push('A god has been whispering into this mind. These notions arrive unbidden, as if from outside — let them colour the surface thoughts (the mortal never perceives the god directly):');
    for (const w of recent) lines.push(`  - "${w.whisper}"`);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/mind-prompt-builder.test.ts`
Expected: PASS (all existing tests in the file still pass).

- [ ] **Step 5: Commit**

```bash
git add src/llm/mind-prompt-builder.ts tests/unit/mind-prompt-builder.test.ts
git commit -m "feat(mind): fold recent whispers into the surface prompt as unbidden notions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Mind orchestrator — surface whisper context + suppress depth-0 command

**Files:**
- Modify: `src/game/mind-orchestrator.ts`
- Test: `tests/unit/mind-orchestration.test.ts`

Context: `openMindPage` currently always emits a `probe_mind` command on a miss, even at depth 0 (cost 0). We (a) suppress the command when `cost === 0` (a free read records nothing — avoids replay-log noise from re-reading the surface on every whisper), and (b) at depth 0 read the recent whisper turns from the store and pass them into `buildMindPagePrompt`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/mind-orchestration.test.ts` inside `describe('openMindPage', …)`:

```ts
  it('emits NO probe_mind command for a free depth-0 read', async () => {
    const { d } = mkDeps();
    await openMindPage(maeve(), ['surface'], 0, d);
    expect(d.queue.drain()).toHaveLength(0); // depth 0 is free → no spend record
  });

  it('passes recent whispers into the depth-0 surface prompt', async () => {
    const seen: string[] = [];
    const spyClient = new LLMClient({
      async generate(messages: any[]) {
        for (const m of messages) if (m.role === 'user') seen.push(m.content);
        return { content: '', toolCalls: [{ id: 'c0', name: 'emit_mind_page', arguments: { prose: 'p', links: [] } }], latencyMs: 0 };
      },
    } as any);
    const { d, store } = mkDeps({ llm: spyClient });
    store.appendTurn('maeve', { whisper: 'heed the river', dialogue: 'a voice?', tick: 1 });
    await openMindPage(maeve(), ['surface'], 0, d);
    expect(seen.join('\n')).toContain('heed the river');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/mind-orchestration.test.ts`
Expected: FAIL — depth-0 currently emits a command; whisper text not in prompt.

- [ ] **Step 3: Implement**

In `src/game/mind-orchestrator.ts`, replace the block from `const candidates = buildCandidateIds(...)` through the `deps.queue.emit({...})` call with:

```ts
    const candidates = buildCandidateIds(npc, deps.world);
    const recentWhispers = depth === 0 ? deps.store.getTranscript(npc.id) : undefined;
    const { messages, tools } = buildMindPagePrompt({ npc, path, candidates, depth, recentWhispers });
    const res = await deps.llm.generateWithTools(messages, tools);
    const call = res.toolCalls?.find((c) => c.name === 'emit_mind_page');
    if (!call) return FALLBACK(depth); // no page → no command, no charge, retry stays possible
    const args = readArgs(call.arguments) as { prose?: string; links?: RawMindLink[] };
    const prose = typeof args.prose === 'string' ? args.prose.trim() : '';
    // Empty prose = a truncated/garbled tool call (e.g. JSON cut off). Treat it
    // like a failed read: no charge, no cache, retry stays possible — never cache
    // a blank "…" page that would stick to this NPC for the session.
    if (!prose) return FALLBACK(depth);
    const page: MindPage = {
      prose,
      links: resolveLinks(args.links ?? [], candidates),
      depth,
    };
    // Spend only now that we have a page, and only when the read costs something:
    // a free depth-0 read (surface / whisper re-read) records no command, avoiding
    // replay-log noise. The executor is the single authoritative spend path.
    if (cost > 0) {
      deps.queue.emit({
        verb: 'probe_mind',
        source: deps.playerSpiritId,
        target: { kind: 'npc', npcId: npc.id },
        payload: { depth },
      });
    }
    deps.store.putPage(npc.id, key, page);
    return page;
```

Note: `cost` is already computed earlier in the function (`const cost = mindProbeCost(depth);`). Keep that line as-is.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/mind-orchestration.test.ts`
Expected: PASS — including the existing depth-1 test ("a depth-1 miss emits exactly one probe_mind command") since depth 1 cost is 1 > 0.

- [ ] **Step 5: Commit**

```bash
git add src/game/mind-orchestrator.ts tests/unit/mind-orchestration.test.ts
git commit -m "feat(mind): surface read gets whisper context; free depth-0 read emits no command

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Whisper input component (replace the thread view)

**Files:**
- Rewrite: `src/ui/npc-whisper-mode.ts`
- Rewrite: `tests/unit/npc-whisper-mode.test.ts`

Context: the thread/transcript view is removed. This module becomes just the compose row (textarea + Send), with `setNpc` (clears the field on NPC switch) and `setSendEnabled` (power gating). No store dependency.

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `tests/unit/npc-whisper-mode.test.ts` with:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/npc-whisper-mode.test.ts`
Expected: FAIL — `mountWhisperInput` not exported.

- [ ] **Step 3: Implement — replace the whole file**

Replace the entire contents of `src/ui/npc-whisper-mode.ts` with:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/npc-whisper-mode.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/npc-whisper-mode.ts tests/unit/npc-whisper-mode.test.ts
git commit -m "refactor(attention): npc-whisper-mode → mountWhisperInput (compose row, no thread)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Whisper orchestrator — drop thread-refresh callbacks

**Files:**
- Modify: `src/game/whisper-orchestrator.ts`
- Test: `tests/unit/whisper-orchestration.test.ts`

Context: `onTurnAppended`/`onTurnUpdated` existed only to refresh the now-deleted thread view. Remove them from the deps and the body. The surface re-read after a whisper is driven by `game.ts` awaiting `sendWhisper` (Task 7), not by these callbacks.

- [ ] **Step 1: Update the test deps first (will compile-fail until impl)**

In `tests/unit/whisper-orchestration.test.ts`, find the `mkDeps` helper (around line 21) and remove the `onTurnAppended` / `onTurnUpdated` properties from the returned object. The line currently reads:

```ts
    onTurnAppended: () => {}, onTurnUpdated: () => {},
```

Delete that line entirely.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/whisper-orchestration.test.ts`
Expected: FAIL to typecheck/run — extra props were required by `WhisperOrchestratorDeps` (or, if it still passes because the props were optional, this confirms removal is safe). Either way, proceed.

- [ ] **Step 3: Implement**

In `src/game/whisper-orchestrator.ts`:

a) Remove these two lines from the `WhisperOrchestratorDeps` interface:

```ts
  onTurnAppended(npcId: string): void;
  onTurnUpdated(npcId: string): void;
```

b) In `sendWhisper`, delete every call to `deps.onTurnAppended(npcId)` and `deps.onTurnUpdated(npcId)` (there are three `onTurnUpdated` calls and one `onTurnAppended` call). The surrounding logic (append provisional turn, fill dialogue / mark degraded, apply bonus + mood) stays exactly as-is — only the callback invocations are removed.

After editing, the success path tail reads:

```ts
    turn.dialogue = parsed.dialogue;
    if (typeof parsed.belief_bonus === 'number') {
      turn.faithBonus = applyWhisperBonus(npc, parsed.belief_bonus, deps.playerSpiritId);
    }
    if (typeof parsed.mood_delta === 'number') {
      const props = npc.properties as unknown as { mood: number };
      props.mood = clamp(props.mood + clamp(parsed.mood_delta, -MOOD_DELTA_CLAMP, MOOD_DELTA_CLAMP), 0, 1);
    }
  } catch {
    turn.degraded = true;
  }
```

and the early degraded-return becomes:

```ts
    if (!parsed || typeof parsed.dialogue !== 'string' || parsed.dialogue.length === 0) {
      turn.degraded = true;
      return;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/whisper-orchestration.test.ts`
Expected: PASS — the transcript/bonus/degraded assertions are unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/game/whisper-orchestrator.ts tests/unit/whisper-orchestration.test.ts
git commit -m "refactor(whisper): drop thread-refresh callbacks (surface re-read drives the UI now)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Panel restructure — mind always front, whisper input footer

**Files:**
- Modify: `src/ui/npc-attention-panel.ts`
- Test: `tests/unit/npc-attention-panel.test.ts`

Context: remove the Mind/Whisper tab row, the whisper thread body, `activeMode`/`applyMode`, the `whisper` divine button, and the handle methods `getActiveMode`/`refreshWhisper`/`refreshWhisperLast`. The mind body is always visible. A whisper input (`mountWhisperInput`) sits in the footer above the divine buttons; sending resets the view to `surface`, shows the loading state, and calls `deps.onWhisperSend`. Drop the now-unused `store` from `NpcAttentionPanelDeps`.

- [ ] **Step 1: Rewrite the test file**

Replace the entire contents of `tests/unit/npc-attention-panel.test.ts` with:

```ts
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

function deps(over: Partial<Parameters<typeof mountNpcAttentionPanel>[1]> = {}) {
  return { onWhisperSend: () => {}, onMindOpen: () => {}, onMindCrossNav: () => {}, ...over };
}

describe('mountNpcAttentionPanel', () => {
  let host: HTMLElement;
  beforeEach(() => { host = document.createElement('div'); });

  it('renders identity, needs and faith bars on first update', () => {
    const h = mountNpcAttentionPanel(host, deps());
    h.update(fakeSim(), { power: 5 });
    expect(host.textContent).toContain('Maeve');
    expect(host.textContent).toContain('farmer');
    expect(host.querySelectorAll('.sg-fill').length).toBeGreaterThanOrEqual(7);
    h.destroy();
  });

  it('shows the mind body and a whisper input, with no mode tabs', () => {
    const h = mountNpcAttentionPanel(host, deps());
    h.update(fakeSim(), { power: 5 });
    expect(host.querySelectorAll('[data-sg-mode]').length).toBe(0); // tabs gone
    expect(host.querySelector('[data-sg-body="mind"]')).not.toBeNull();
    expect(host.querySelector('[data-sg=whisper-input]')).not.toBeNull();
    h.destroy();
  });

  it('opens the mind surface when an NPC is selected', () => {
    const opened: Array<[string, string[], number]> = [];
    const h = mountNpcAttentionPanel(host, deps({ onMindOpen: (id, path, depth) => opened.push([id, path, depth]) }));
    h.setNpc('npc1');
    expect(opened).toEqual([['npc1', ['surface'], 0]]);
    h.destroy();
  });

  it('sending a whisper resets to surface and fires onWhisperSend', () => {
    const sends: Array<[string, string]> = [];
    const opens: Array<[string, string[], number]> = [];
    const h = mountNpcAttentionPanel(host, deps({
      onWhisperSend: (id, text) => sends.push([id, text]),
      onMindOpen: (id, path, depth) => opens.push([id, path, depth]),
    }));
    h.setNpc('npc1');
    h.update(fakeSim(), { power: 5 });
    const input = host.querySelector('[data-sg=whisper-input]') as HTMLTextAreaElement;
    input.value = 'heed the river';
    (host.querySelector('[data-sg=whisper-send]') as HTMLButtonElement).click();
    expect(sends).toEqual([['npc1', 'heed the river']]);
    h.destroy();
  });

  it('gates the whisper send when power is below cost', () => {
    const h = mountNpcAttentionPanel(host, deps());
    h.setNpc('npc1');
    h.update(fakeSim(), { power: 0 });
    expect((host.querySelector('[data-sg=whisper-send]') as HTMLButtonElement).disabled).toBe(true);
    h.destroy();
  });

  it('update() does not wipe a focused element in the mind body', () => {
    const h = mountNpcAttentionPanel(host, deps());
    h.setNpc('npc1');
    h.update(fakeSim(), { power: 5 });
    const body = host.querySelector('[data-sg-body="mind"]') as HTMLElement;
    const sentinel = document.createElement('span'); sentinel.id = 'sentinel';
    body.appendChild(sentinel);
    h.update(fakeSim({ needs: { safety: 0.9, prosperity: 0.4, community: 0.6, meaning: 0.3 } }), { power: 6 });
    expect(host.querySelector('#sentinel')).not.toBeNull();
    h.destroy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/npc-attention-panel.test.ts`
Expected: FAIL — tabs still present / `store` required in deps / whisper input absent.

- [ ] **Step 3: Implement the panel changes**

In `src/ui/npc-attention-panel.ts`:

a) Update the import on line 3:

```ts
import { mountWhisperInput, type WhisperInputHandle } from '@/ui/npc-whisper-mode';
```

b) Delete the `.sg-modes` and `.sg-mode` rules from the `STYLE` template (the two lines starting `.sg-modes {` and the two `.sg-mode` rules).

c) Delete the `AttentionMode` type export (line 56).

d) In `NpcAttentionPanelOptions`, delete the `onWhisper?: () => void;` line.

e) In `NpcAttentionPanelDeps`, delete the `store: NpcAttentionStore;` line. Then remove the now-unused import of `NpcAttentionStore` (keep `MindPage` — change the import on line 6 to `import type { MindPage } from '@/llm/npc-attention-store';`).

f) In `NpcAttentionPanelHandle`, delete the three lines `getActiveMode(): AttentionMode;`, `refreshWhisper(): void;`, and `refreshWhisperLast(): void;`.

g) In `mountNpcAttentionPanel`, delete `let activeMode: AttentionMode = 'mind';`.

h) Delete the entire `modes` block (the lines creating `modes`, `whisperTab`, `mindTab`, and `modes.append(...)`), and delete the `whisperBody` + `mountWhisperMode(...)` block. Replace them with a whisper input host mounted after the mind body. Concretely, the section that currently builds `modes`, `whisperBody`/`whisperMode`, and `mindBody`/`mindMode` becomes:

```ts
  const mindBody = document.createElement('div');
  mindBody.className = 'sg-body'; mindBody.dataset.sgBody = 'mind';
  const mindMode = mountMindMode(mindBody, {
    onDrill: (label) => {
      mindPath = [...mindPath, label];
      mindMode.showLoading(mindPath);
      if (currentNpcId) deps.onMindOpen(currentNpcId, mindPath, mindPath.length - 1);
    },
    onCrumb: (i) => {
      mindPath = mindPath.slice(0, i + 1);
      mindMode.showLoading(mindPath);
      if (currentNpcId) deps.onMindOpen(currentNpcId, mindPath, mindPath.length - 1);
    },
    onCrossNav: (id) => { deps.onMindCrossNav(id); },
    nextCost: () => mindProbeCost(mindPath.length),
  });

  const whisperHost = document.createElement('div');
  const whisperInput: WhisperInputHandle = mountWhisperInput(whisperHost, {
    onSend: (text) => {
      if (!currentNpcId) return;
      // A whisper re-shapes the surface: snap back to it and show the "stir" state;
      // game.ts re-reads the surface after the whisper resolves and pushes it via showMindPage.
      mindPath = ['surface'];
      mindLoadedFor = mindKeyFor(currentNpcId, mindPath);
      mindMode.showLoading(mindPath);
      deps.onWhisperSend(currentNpcId, text);
    },
  });
```

i) Update the divine `actions` block: delete the `whisperBtn` creation line and remove `whisperBtn` from the `actions.append(...)` call. The append becomes:

```ts
  actions.append(backfillBtn, dreamBtn, prayBtn, omenBtn, miracleBtn);
```

Also delete the `whisperBtn.addEventListener(...)` line and the `whisperBtn.disabled = ...` line in `update`.

j) Update the panel assembly line (currently `panel.append(header, topRow, modes, whisperBody, mindBody, actions);`) to:

```ts
  panel.append(header, topRow, mindBody, whisperHost, actions);
```

k) Delete the `applyMode` function, the `whisperTab`/`mindTab` `addEventListener` blocks, and the bare `applyMode();` call. Keep `ensureMindLoaded` but remove its dependence on mode (it no longer needs `applyMode`):

```ts
  // Open the current mind page exactly once per (npc, path).
  function ensureMindLoaded(): void {
    if (currentNpcId && mindLoadedFor !== mindKeyFor(currentNpcId, mindPath)) {
      mindMode.showLoading(mindPath);
      deps.onMindOpen(currentNpcId, mindPath, mindPath.length - 1);
    }
  }
```

l) In `update`, replace the whisper-related tail (`whisperMode.refresh(); whisperMode.setSendEnabled(power >= 1);`) with:

```ts
      whisperInput.setSendEnabled(power >= WHISPER_COST);
```

m) In `setNpc`, remove the `activeMode = 'mind';` and `applyMode();` lines and the `whisperMode.setNpc(npcId);` line; replace with `whisperInput.setNpc(npcId);`. The method becomes:

```ts
    setNpc(npcId) {
      if (npcId === currentNpcId) return;
      currentNpcId = npcId;
      mindPath = ['surface'];
      mindLoadedFor = null;
      whisperInput.setNpc(npcId);
      ensureMindLoaded();
    },
```

n) In the returned handle, delete `getActiveMode`, `refreshWhisper`, and `refreshWhisperLast`. In `destroy`, replace `whisperMode.destroy();` with `whisperInput.destroy();`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/npc-attention-panel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/npc-attention-panel.ts tests/unit/npc-attention-panel.test.ts
git commit -m "feat(attention): mind always front; whisper becomes a footer input (no tabs)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Wire the surface re-read in game.ts + adjust game-ui + frame-renderer

**Files:**
- Modify: `src/game.ts`
- Modify: `src/game/game-ui.ts`
- Modify: `src/game/frame-renderer.ts`
- Test: `tests/dom/game-ui.test.ts` (adjust if it referenced removed callbacks)

Context: after `sendWhisper` resolves, invalidate the surface page and re-read it so the panel shows the shifted thoughts. Remove the deleted thread callbacks and the `onWhisper` divine option.

- [ ] **Step 1: Update game.ts onWhisperSend**

In `src/game.ts`, first extend the import on line 16:

```ts
import { openMindPage, pathKey } from '@/game/mind-orchestrator';
```

Then replace the `onWhisperSend` handler (the block from `onWhisperSend: (npcId: string, text: string) => {` through its closing `},`) with:

```ts
      onWhisperSend: (npcId: string, text: string) => {
        const world = this.state.world;
        if (!world) return;
        const entity = getNpc(world, npcId);
        if (!entity) return;
        void sendWhisper(entity, text, {
          queue: this.commandQueue,
          llm: this.llmClient,
          store: this.attentionStore,
          playerSpiritId: 'player',
          now: () => this.state.clock.now(),
        }).then(() => {
          // The whisper re-shapes their surface thoughts: drop the cached surface
          // page and re-read it (free, depth 0) with the new whisper as context.
          if (!this.state.world) return;
          const npc = getNpc(this.state.world, npcId);
          if (!npc) return;
          this.attentionStore.invalidatePage(npcId, pathKey(['surface']));
          return openMindPage(npc, ['surface'], 0, {
            world: this.state.world,
            store: this.attentionStore,
            queue: this.commandQueue,
            llm: this.llmClientCapable ?? this.llmClient,
            playerSpirit: this.state.spirits.get('player')!,
            playerSpiritId: 'player',
          }).then((page) => {
            if (page) this.ui.npcAttentionPanel.showMindPage(['surface'], page);
          });
        });
      },
```

- [ ] **Step 2: Update game-ui.ts panel mount**

In `src/game/game-ui.ts`, the panel mount (around line 89) currently passes `store: cb.attentionStore`. Remove that property so the mount becomes:

```ts
    this.npcAttentionPanel = mountNpcAttentionPanel(this.npcInfoPanel, {
      onWhisperSend: cb.onWhisperSend,
      onMindOpen: cb.onMindOpen,
      onMindCrossNav: cb.onMindCrossNav,
    });
```

Leave `attentionStore` on the `GameUiCallbacks` interface (game.ts still owns the store and passes it; it is simply no longer forwarded into the panel). If TypeScript flags `attentionStore` as unused on the callbacks bag, keep it — it documents the dependency and other code may read it; do not remove it unless the compiler errors on it specifically.

- [ ] **Step 3: Update frame-renderer.ts**

In `src/game/frame-renderer.ts`, delete the `onWhisper: () => { this.deps.divine.whisper(entity); },` line from the `npcAttentionPanel.update({...})` options (around line 166). The remaining divine options (`onDream`, `onAnswerPrayer`, `onOmen`, `onMiracle`, `onLlmBackfill`, `portraitSheet`, `pinned`, `power`, `onTogglePin`) stay.

- [ ] **Step 4: Build + check the DOM test**

Run: `npm run build`
Expected: clean typecheck (only the pre-existing Vite chunk-size warnings).

Run: `npx vitest run tests/dom/game-ui.test.ts`
Expected: PASS. If it fails because it asserted on a removed callback (`onWhisper`) or passed `store` into the panel deps, update those assertions to match the new shape (panel deps are `{ onWhisperSend, onMindOpen, onMindCrossNav }`).

- [ ] **Step 5: Commit**

```bash
git add src/game.ts src/game/game-ui.ts src/game/frame-renderer.ts tests/dom/game-ui.test.ts
git commit -m "feat(attention): re-read the surface after a whisper; drop thread + divine-whisper wiring

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Full suite + finish

**Files:** none (verification only).

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: all tests pass. If any test still references `mountWhisperMode`, `getActiveMode`, `refreshWhisper*`, `onTurnAppended/onTurnUpdated`, `data-sg-mode`, or the `whisper` divine action, update it to the new shape (these are the only surfaces this epic changed).

- [ ] **Step 2: Determinism + no-random guards**

Run: `npx vitest run tests/unit/no-random-in-sim.test.ts tests/unit/attention-replay-guard.test.ts tests/unit/game-attention-scrub.test.ts`
Expected: PASS — no `src/sim/` randomness introduced; the store still clears on scrub.

- [ ] **Step 3: Build once more**

Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Manual smoke (note for the human)**

`npm run dev`, select an NPC: the mind surface shows immediately (no tabs); type a whisper and send; the body shows "their thoughts stir…" then the surface re-reads to reflect the whisper. Drill links and breadcrumb still work; divine buttons (Omen/Dream/Miracle/Answer/Backfill) remain.

- [ ] **Step 5: Finish the branch**

Use superpowers:finishing-a-development-branch to verify tests and merge `feat/npc-attention-surface` to `main` locally (do NOT push — the user merges/pushes manually).

---

## Self-Review Notes

- **Spec coverage:** layout (Task 6), whisper→surface loop (Tasks 6–7), surface gets whisper context (Tasks 2–3), force re-read via `invalidatePage` (Tasks 1, 7), depth-0 command suppression (Task 3), handle trim + thread deletion (Tasks 4–6), edge cases — power gating (Task 6), no extra cost (Task 3), determinism guard (Task 8). All covered.
- **Type consistency:** `mountWhisperInput`/`WhisperInputHandle` (Task 4) are used in Task 6; `pathKey` import (Task 7) is exported from `mind-orchestrator.ts`; `invalidatePage(npcId, path)` signature consistent across Tasks 1/7; `recentWhispers` on `MindPromptContext` consistent across Tasks 2/3.
- **No placeholders:** every code step shows complete code.
