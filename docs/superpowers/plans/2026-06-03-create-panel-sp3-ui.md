# Create Panel — Sub-project 3: The Create Panel UI (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dev/author panel where the author types a plain-language request, the capable LLM (`llmClientCapable`) returns editor tool calls, the panel previews them as human-readable lines (gated by the registry's read-only `previewCommand`), and on Confirm emits them as `source:'author'` editor commands onto the command channel.

**Architecture:** Three new modules + wiring. `src/llm/editor-tools.ts` exposes the editor verbs as `LLMTool[]` (hand-written JSON schemas, drift-guarded against the registry). `src/llm/world-summary.ts` builds a compact text digest (settlements, population, roster sample, object counts) for the prompt. `src/dev/CreatePanel.ts` is the FloatingPanel UI: prompt → `generateWithTools` → map tool calls to a preview (each validated via `previewCommand`) → Confirm emits the valid ones via `queue.emit({source:'author', payload})`. It is owned by `DevModeController` (like the other dev panels) and reached from the dev toolbar; `game.ts` passes the command queue and a getter for the (config-rebuilt) capable client.

**Tech Stack:** TypeScript ESM, Vitest (jsdom DOM tests). The panel calls `LLMClient.generateWithTools` (SP1) and emits `payload`-carrying editor commands (SP2). No network in tests — a mock client returns canned `toolCalls`.

**Scope:** Prompt → single-shot tool calls → preview → confirm → emit, for the five editor verbs. Out of scope (deferred): apply-on-send (no preview); multi-turn read loop; promoting to player-facing; surfacing post-apply executor results live (preview-time `previewCommand` gating is the v1 feedback). "The world itself" (tiles/biome/seed) stays out.

---

## File Structure

- **Create** `src/llm/editor-tools.ts` — `EDITOR_TOOLS: LLMTool[]` (one per editor verb) + `editorToolList()`.
- **Create** `src/llm/world-summary.ts` — `buildWorldSummary(state): string`.
- **Create** `src/dev/CreatePanel.ts` — `mountCreatePanel(deps): CreatePanelHandle`.
- **Modify** `src/game/dev-mode-controller.ts` — construct/own the panel; add a toolbar button; dispose in `destroy()`; extend deps with `commandQueue` + `getLlmCapable`.
- **Modify** `src/game.ts` — pass `commandQueue` and `getLlmCapable: () => this.llmClientCapable` into `DevModeController`.
- **Create** tests: `tests/unit/editor-tools.test.ts`, `tests/unit/world-summary.test.ts`, `tests/dom/create-panel.test.ts`.

---

## Task 1: Editor tool schemas (`editor-tools.ts`)

The LLM tool list for the editor verbs, kept in the LLM layer (the sim registry stays LLM-free), drift-guarded so it can't fall out of sync with the registry's editor-tier verbs.

**Files:**
- Create: `src/llm/editor-tools.ts`
- Test: `tests/unit/editor-tools.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/editor-tools.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { EDITOR_TOOLS, editorToolList } from '@/llm/editor-tools';
import { listCapabilities } from '@/sim/command/registry';

describe('editor tools', () => {
  it('exposes exactly one tool per editor-tier registry verb (no drift)', () => {
    const editorVerbs = listCapabilities().filter(c => c.tier === 'editor').map(c => c.verb).sort();
    const toolNames = EDITOR_TOOLS.map(t => t.name).sort();
    expect(toolNames).toEqual(editorVerbs);
  });

  it('every tool has a description and an object-typed JSON-schema parameters', () => {
    for (const t of EDITOR_TOOLS) {
      expect(t.description.length).toBeGreaterThan(0);
      expect((t.parameters as { type?: string }).type).toBe('object');
      expect(t.parameters).toHaveProperty('properties');
    }
  });

  it('editorToolList returns the tool array', () => {
    expect(editorToolList()).toBe(EDITOR_TOOLS);
  });

  it('author_spawn_npc requires a role and supports belief overrides', () => {
    const spawn = EDITOR_TOOLS.find(t => t.name === 'author_spawn_npc')!;
    const props = (spawn.parameters as { properties: Record<string, unknown>; required?: string[] });
    expect(props.required).toContain('role');
    expect(props.properties).toHaveProperty('faith');
    expect(props.properties).toHaveProperty('near');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/editor-tools.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `src/llm/editor-tools.ts`:

```ts
/**
 * editor-tools.ts — the editor (god-mode) verbs exposed as LLM tools.
 *
 * The capable tier (Create panel; later Fate) sends these to the model; the
 * model's tool calls become editor commands on the channel. Schemas are kept
 * here in the LLM layer (the sim registry stays LLM-free); a drift test ties
 * the set to the registry's editor-tier verbs so they can't diverge. Payload
 * shapes mirror the precondition/apply contracts in
 * src/sim/command/editor-verbs.ts.
 */
import type { LLMTool } from './llm-client';

const ROLES = ['priest', 'elder', 'farmer', 'merchant', 'soldier', 'noble', 'child', 'beggar'];
const BELIEF = { type: 'number', minimum: 0, maximum: 1 } as const;
const NEAR = {
  description: 'A settlement poiId (string) OR explicit {x,y} tile coordinates.',
  type: ['string', 'object'],
} as const;

export const EDITOR_TOOLS: LLMTool[] = [
  {
    name: 'author_spawn_npc',
    description: 'Spawn one or more NPCs near a settlement or coordinate. Use for "add N <role>s near <place>".',
    parameters: {
      type: 'object',
      properties: {
        role: { type: 'string', enum: ROLES, description: 'NPC role.' },
        count: { type: 'integer', minimum: 1, maximum: 20, description: 'How many to spawn (default 1).' },
        near: NEAR,
        name: { type: 'string', description: 'Optional name; random if omitted.' },
        faith: BELIEF, understanding: BELIEF, devotion: BELIEF,
      },
      required: ['role', 'near'],
    },
  },
  {
    name: 'author_remove_entity',
    description: 'Remove an entity by id, or all entities matching a {kind, role} filter. Use for "remove the beggars".',
    parameters: {
      type: 'object',
      properties: {
        entityId: { type: 'string', description: 'Exact entity id to remove.' },
        filter: {
          type: 'object',
          description: 'Remove all matches. Provide kind (e.g. "npc") and/or role.',
          properties: { kind: { type: 'string' }, role: { type: 'string', enum: ROLES } },
        },
      },
    },
  },
  {
    name: 'author_modify_npc',
    description: 'Change fields on an existing NPC (name, role, belief, mood, activity). Use for "make X a devout priest".',
    parameters: {
      type: 'object',
      properties: {
        entityId: { type: 'string', description: 'NPC entity id.' },
        set: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            role: { type: 'string', enum: ROLES },
            faith: BELIEF, understanding: BELIEF, devotion: BELIEF,
            mood: { type: 'number', minimum: 0, maximum: 1 },
            activity: { type: 'string' },
          },
        },
      },
      required: ['entityId', 'set'],
    },
  },
  {
    name: 'author_place_object',
    description: 'Place one or more world objects of a given entity-kind near a coordinate (e.g. a well, a tree).',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'Entity-kind id (e.g. "well", "oak_tree").' },
        x: { type: 'integer' }, y: { type: 'integer' },
        count: { type: 'integer', minimum: 1, maximum: 50 },
        scatterRadius: { type: 'integer', minimum: 1, maximum: 12 },
      },
      required: ['kind', 'x', 'y'],
    },
  },
  {
    name: 'author_move_entity',
    description: 'Move an entity to new tile coordinates (must be a realized, walkable tile).',
    parameters: {
      type: 'object',
      properties: {
        entityId: { type: 'string' },
        to: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, required: ['x', 'y'] },
      },
      required: ['entityId', 'to'],
    },
  },
];

export function editorToolList(): LLMTool[] {
  return EDITOR_TOOLS;
}
```

- [ ] **Step 4: Run test + commit**

Run: `npx vitest run tests/unit/editor-tools.test.ts` → PASS.

```bash
git add src/llm/editor-tools.ts tests/unit/editor-tools.test.ts
git commit -m "$(cat <<'EOF'
feat(llm): editor verbs as LLM tools (drift-guarded against registry)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: World summary (`world-summary.ts`)

A compact text digest the prompt embeds so the model can resolve "the northern village" / "Brother Aldous" to ids and coordinates.

**Files:**
- Create: `src/llm/world-summary.ts`
- Test: `tests/unit/world-summary.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/world-summary.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildWorldSummary } from '@/llm/world-summary';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import type { GameState } from '@/core/state';
import type { GameMap, NpcProperties } from '@/core/types';

function map(): GameMap {
  return { tiles: [[{ type: 'grass', x: 0, y: 0, walkable: true, state: 'realized' }]], width: 8, height: 8, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

function npc(id: string, role: string, poi: string, name: string) {
  const p = initNpcProps(name, role as NpcProperties['role'], 7);
  p.homePoiId = poi;
  return { id, kind: 'npc', x: 1, y: 1, properties: p as unknown as Record<string, unknown> };
}

function state(): GameState {
  const world = new World(map());
  world.addEntity(npc('n1', 'priest', 'northvale', 'Aldous'));
  world.addEntity(npc('n2', 'farmer', 'northvale', 'Bryn'));
  return {
    world,
    worldSeed: { name: 'Testlands', size: { width: 8, height: 8 }, pois: [{ id: 'northvale', name: 'Northvale', type: 'village', position: { x: 3, y: 4 } }] },
  } as unknown as GameState;
}

describe('buildWorldSummary', () => {
  it('names the world, lists settlements with ids+coords, and population', () => {
    const s = buildWorldSummary(state());
    expect(s).toContain('Testlands');
    expect(s).toContain('northvale');
    expect(s).toContain('Northvale');
    expect(s).toContain('(3,4)');
    expect(s).toMatch(/2 NPC/);
  });

  it('includes a roster sample with id, name, role, and home', () => {
    const s = buildWorldSummary(state());
    expect(s).toContain('n1');
    expect(s).toContain('Aldous');
    expect(s).toContain('priest');
  });

  it('does not throw on a null world / missing worldSeed', () => {
    expect(() => buildWorldSummary({ world: null, worldSeed: null } as unknown as GameState)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/world-summary.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `src/llm/world-summary.ts`:

```ts
/**
 * world-summary.ts — a compact text digest of the current world for the Create
 * panel's prompt. Gives the capable model enough to resolve references like
 * "the northern village" / "Brother Aldous" to concrete ids and coordinates,
 * without a read-tool loop (single-shot, SP3 scope).
 */
import type { GameState } from '@/core/state';
import { queryNpcs, npcProps } from '@/world/npc-helpers';

const ROSTER_CAP = 30;

export function buildWorldSummary(state: GameState): string {
  const name = state.worldSeed?.name ?? 'unnamed';
  const lines: string[] = [`World "${name}".`];

  const pois = state.worldSeed?.pois ?? [];
  if (pois.length) {
    const poiText = pois.map(p => {
      const at = p.position ? ` at (${p.position.x},${p.position.y})` : '';
      return `${p.id}="${p.name ?? p.id}"${at}`;
    }).join('; ');
    lines.push(`Settlements: ${poiText}.`);
  }

  const world = state.world;
  if (!world) return lines.join(' ');

  const npcs = queryNpcs(world);
  const roleCounts = new Map<string, number>();
  for (const e of npcs) {
    const r = npcProps(e).role;
    roleCounts.set(r, (roleCounts.get(r) ?? 0) + 1);
  }
  const roleText = [...roleCounts.entries()].map(([r, n]) => `${r} ${n}`).join(', ');
  lines.push(`Population: ${npcs.length} NPCs${roleText ? ` (${roleText})` : ''}.`);

  if (npcs.length) {
    const roster = npcs.slice(0, ROSTER_CAP).map(e => {
      const p = npcProps(e);
      return `${e.id} "${p.name}" ${p.role}${p.homePoiId ? ` @${p.homePoiId}` : ''}`;
    }).join('; ');
    const more = npcs.length > ROSTER_CAP ? ` …(+${npcs.length - ROSTER_CAP} more)` : '';
    lines.push(`Roster: ${roster}${more}.`);
  }

  // Object counts by kind (non-npc), helps the model reference existing objects.
  const kinds = new Map<string, number>();
  for (const e of world.query({})) {
    if (e.kind === 'npc') continue;
    kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
  }
  if (kinds.size) {
    const kindText = [...kinds.entries()].map(([k, n]) => `${k} ${n}`).join(', ');
    lines.push(`Objects: ${kindText}.`);
  }

  return lines.join(' ');
}
```

- [ ] **Step 4: Run test + commit**

Run: `npx vitest run tests/unit/world-summary.test.ts` → PASS.

```bash
git add src/llm/world-summary.ts tests/unit/world-summary.test.ts
git commit -m "$(cat <<'EOF'
feat(llm): buildWorldSummary — compact world digest for the author prompt

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: The Create panel (`CreatePanel.ts`)

The UI: prompt → tool calls → preview (gated by `previewCommand`) → Confirm emits.

**Files:**
- Create: `src/dev/CreatePanel.ts`
- Test: `tests/dom/create-panel.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/dom/create-panel.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountCreatePanel } from '@/dev/CreatePanel';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import { LLMClient } from '@/llm/llm-client';
import type { GameState } from '@/core/state';
import type { GameMap, NpcProperties } from '@/core/types';
import type { LLMToolCall } from '@/llm/llm-client';

function bigMap(n = 10): GameMap {
  const tiles: GameMap['tiles'] = [];
  for (let y = 0; y < n; y++) {
    const row = [];
    for (let x = 0; x < n; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row as never);
  }
  return { tiles, width: n, height: n, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

function state(): GameState {
  const world = new World(bigMap());
  const p = initNpcProps('Aldous', 'farmer' as NpcProperties['role'], 7);
  p.homePoiId = 'northvale';
  world.addEntity({ id: 'n1', kind: 'npc', x: 5, y: 5, properties: p as unknown as Record<string, unknown> });
  return {
    world,
    spirits: new Map([['player', { id: 'player', name: 'You', sigil: '✦', color: '#fff', isPlayer: true, power: 100, manifestation: null }]]),
    eventLog: { append: vi.fn() },
    worldSeed: { name: 'Testlands', size: { width: 10, height: 10 }, pois: [{ id: 'northvale', name: 'Northvale', type: 'village', position: { x: 5, y: 5 } }] },
  } as unknown as GameState;
}

/** A capable client whose provider returns the given canned tool calls. */
function mockCapable(toolCalls: LLMToolCall[]): LLMClient {
  return new LLMClient({
    name: () => 'mock', isAvailable: () => true,
    async generate() { return { content: '', latencyMs: 0, toolCalls }; },
  });
}

function button(root: HTMLElement, text: string): HTMLButtonElement {
  const b = Array.from(root.querySelectorAll('button')).find(x => x.textContent?.includes(text));
  if (!b) throw new Error(`no button "${text}"`);
  return b as HTMLButtonElement;
}

describe('CreatePanel', () => {
  let container: HTMLElement;
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); });

  it('mounts with a prompt textarea and a Send button', () => {
    const panel = mountCreatePanel({ container, getState: () => state(), queue: { emit: vi.fn() } as never, getLlmCapable: () => null });
    expect(panel.element.querySelector('textarea')).toBeTruthy();
    expect(() => button(panel.element, 'Send')).not.toThrow();
  });

  it('shows a hint and disables Send when no capable client is configured', () => {
    const panel = mountCreatePanel({ container, getState: () => state(), queue: { emit: vi.fn() } as never, getLlmCapable: () => null });
    expect(button(panel.element, 'Send').disabled).toBe(true);
    expect(panel.element.textContent).toMatch(/capable model/i);
  });

  it('on Send → renders a preview line per tool call', async () => {
    const queue = { emit: vi.fn() };
    const capable = mockCapable([{ id: 'c1', name: 'author_spawn_npc', arguments: { role: 'priest', count: 2, near: 'northvale' } }]);
    const panel = mountCreatePanel({ container, getState: state, queue: queue as never, getLlmCapable: () => capable });

    panel.element.querySelector('textarea')!.value = 'add 2 priests to northvale';
    await panel.send();

    expect(panel.element.textContent).toMatch(/spawn 2× priest/i);
    expect(queue.emit).not.toHaveBeenCalled(); // preview only — not yet emitted
  });

  it('on Confirm → emits valid editor commands with source author', async () => {
    const queue = { emit: vi.fn() };
    const capable = mockCapable([{ id: 'c1', name: 'author_spawn_npc', arguments: { role: 'priest', count: 1, near: 'northvale' } }]);
    const panel = mountCreatePanel({ container, getState: state, queue: queue as never, getLlmCapable: () => capable });

    panel.element.querySelector('textarea')!.value = 'add a priest';
    await panel.send();
    button(panel.element, 'Confirm').dispatchEvent(new Event('click'));

    expect(queue.emit).toHaveBeenCalledWith(expect.objectContaining({
      verb: 'author_spawn_npc', source: 'author', payload: expect.objectContaining({ role: 'priest' }),
    }));
  });

  it('marks an invalid tool call as rejected in the preview and does not emit it', async () => {
    const queue = { emit: vi.fn() };
    // missing role → previewCommand rejects invalid_payload
    const capable = mockCapable([{ id: 'c1', name: 'author_spawn_npc', arguments: { near: 'northvale' } }]);
    const panel = mountCreatePanel({ container, getState: state, queue: queue as never, getLlmCapable: () => capable });

    panel.element.querySelector('textarea')!.value = 'add someone';
    await panel.send();
    expect(panel.element.textContent).toMatch(/invalid_payload|rejected/i);

    button(panel.element, 'Confirm').dispatchEvent(new Event('click'));
    expect(queue.emit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dom/create-panel.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the panel**

Create `src/dev/CreatePanel.ts`:

```ts
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
  prompt.placeholder = 'e.g. add three farmers near Northvale; make n1 a devout priest';
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

  function refreshAvailability(): void {
    const ok = deps.getLlmCapable() !== null;
    sendBtn.disabled = !ok;
    if (!ok) status.textContent = 'Configure an OpenRouter capable model in LLM settings to use Create.';
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
    const client = deps.getLlmCapable();
    if (!client) { refreshAvailability(); return; }
    const text = prompt.value.trim();
    if (!text) { status.textContent = 'Type a request first.'; return; }

    clearPreview();
    sendBtn.disabled = true;
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
      refreshAvailability();
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dom/create-panel.test.ts`
Expected: PASS (5 tests).

NOTE: if `LLMClient.generateWithTools` is not the method name from SP1, check `src/llm/llm-client.ts` and use the actual single-shot tool-calling method. The mock client implements `LLMProvider` and returns `{ toolCalls }` so `generateWithTools` (which calls `provider.generate`) surfaces them.

- [ ] **Step 5: Commit**

```bash
git add src/dev/CreatePanel.ts tests/dom/create-panel.test.ts
git commit -m "$(cat <<'EOF'
feat(dev): Create panel — NL world authoring (prompt → preview → emit)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire the panel into DevModeController + game.ts

Make the panel reachable: own it in `DevModeController`, give it a toolbar button, dispose it, and pass the command queue + capable-client getter from `game.ts`.

**Files:**
- Modify: `src/game/dev-mode-controller.ts`
- Modify: `src/game.ts`
- Test: extend `tests/dom/create-panel.test.ts` is not needed; rely on existing dev-mode tests + a typecheck. (DevModeController wiring is integration; the panel behavior is already unit-tested.)

- [ ] **Step 1: Extend `DevModeControllerDeps`**

In `src/game/dev-mode-controller.ts`, add to `DevModeControllerDeps`:
```ts
  commandQueue: CommandQueue;
  getLlmCapable: () => LLMClient | null;
```
Imports:
```ts
import { mountCreatePanel, type CreatePanelHandle } from '@/dev/CreatePanel';
import type { CommandQueue } from '@/sim/command/command-queue';
import type { LLMClient } from '@/llm/llm-client';
```

- [ ] **Step 2: Construct + own the panel**

Add a field alongside the other panels:
```ts
  private createPanel: CreatePanelHandle;
```
Construct it next to the others (after `mapEditor`):
```ts
this.createPanel = mountCreatePanel({
  container,
  getState: () => this.deps.state,
  queue: this.deps.commandQueue,
  getLlmCapable: this.deps.getLlmCapable,
  dock: this.dock,
});
```

- [ ] **Step 3: Add the toolbar button**

In the `mountDevToolbar(container, [...])` array, add (after the `overlay` entry):
```ts
{ id: 'create', label: '✨ Create', isActive: () => this.createPanel.isVisible(), onClick: () => this.createPanel.toggle() },
```

- [ ] **Step 4: Dispose it**

In `destroy()`, add:
```ts
this.createPanel.destroy();
```

- [ ] **Step 5: Pass deps from `game.ts`**

In `src/game.ts`, where `new DevModeController({...})` is constructed (~line 240), add:
```ts
this.dev = new DevModeController({
  container: this.container, state: this.state, scheduler: this.scheduler,
  getViewport: () => this.viewport(), getRenderDeps: () => this.renderDeps(),
  commandQueue: this.commandQueue,
  getLlmCapable: () => this.llmClientCapable,
});
```

- [ ] **Step 6: Typecheck + dev-mode tests + full suite**

Run: `npx tsc --noEmit` → clean.
Run: `npx vitest run tests/dom/create-panel.test.ts` → PASS.
Run: `npm test` → all green (prior baseline 1056 + SP3 tests).

Manually sanity-check (optional, not a test): `npm run dev`, open dev toolbar, click ✨ Create, with a real OpenRouter key + capable model, type "add two farmers near <a poi id>", verify a preview appears and Confirm spawns them.

- [ ] **Step 7: Commit**

```bash
git add src/game/dev-mode-controller.ts src/game.ts
git commit -m "$(cat <<'EOF'
feat(dev): wire Create panel into dev toolbar + game.ts (queue + capable client)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage (design §3 SP3):** creator panel on dev chrome (FloatingPanel + dock + toolbar) — Tasks 3, 4; prompt → world summary + editor tool list → `generateWithTools` → toolCalls — Task 3; preview/confirm with human-readable `describe` lines — Task 3; Confirm emits `source:'author'` editor commands → apply+record (SP2) — Task 3; rejections surface in the panel (via `previewCommand` at preview time — `not_implemented`/`invalid_target`/`invalid_payload`) — Task 3; model resolves references from the world summary, no read loop — Tasks 2, 3.
- **Layering:** the sim registry stays LLM-free; `editor-tools.ts` (LLM layer) holds the schemas, drift-guarded against the registry's editor verbs (Task 1).
- **Capable client is read through a getter** so a live LLM-settings rebuild (`applyLlmConfig`) is picked up without re-mounting the panel.
- **No determinism impact:** the panel only emits onto the existing channel; application + recording + replay are SP2's (already proven). Author commands emitted from the panel are recorded live and replay via the AuthorCommandLog.
- **Type consistency:** `mountCreatePanel(deps)`/`CreatePanelHandle` names match the DevModeController wiring; `editorToolList()` and `buildWorldSummary(state)` signatures match their callers; `generateWithTools(messages, tools)` is the SP1 method (Task 3 Step 4 flags verifying the exact name).
- **Confirm during implementation:** the exact `mountDevToolbar` array + `destroy()` + `new DevModeController` sites in the two files (line numbers approximate — match by surrounding code); the `sg-dev-btn` class is the shared dev button style (used by DebugOverlayPanel's reset button).
