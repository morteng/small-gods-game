# NPC Attention Surface — Slice 3: Mind Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Mind body into an infinite, on-the-fly hyperlinked wiki of an NPC's psyche. The surface (depth 0) is free; each deeper drill costs `2^(depth-1)` power via a new deterministic `probe_mind` command. Pages are LLM-generated with a typed link list: **gold** entity links (validated sim ids → cross-navigate) and **purple** concept links (deeper psyche pages). Visited pages cache by node-path (free back-navigation). Reading never mutates the NPC (v1).

**Architecture:** Mirrors Slice 2's split: a deterministic floor (the `probe_mind` verb spends depth-scaled power, mutates no NPC state, is replay-safe) plus soft narration (page prose + links in `NpcAttentionStore`, never snapshotted). A new `buildMindPagePrompt` produces a structured-output request; `LLMClient.generateWithTools` returns `{ prose, links }`; entity links are validated against a candidate-id set drawn from the NPC's world neighborhood (relationships, home, nearby NPCs, recent-event actors) — any unresolved id degrades to a concept link. The Mind view renders breadcrumb + prose + links; gold links cross-navigate (select that NPC + open their mind, or pan to a place); purple links drill deeper. The page cache lives in `NpcAttentionStore` (Slice 1), so back-nav is free and a scrub wipes it.

**Tech Stack:** TypeScript ESM, Vite, Vitest (jsdom for DOM tests), `@/`→`src/` alias, `MockLLMProvider` (tool-call canning) for LLM tests. All sim code `Math.random`-free.

---

## File Structure

- **Create** `src/sim/mind-probe.ts` — `mindProbeCost(depth): number` (`0,1,2,4,8,…`) and a `probeMind(spirit, depth, log): boolean` apply that spends power and emits a `mind_probed` event; no NPC mutation.
- **Modify** `src/sim/command/types.ts` — add `'probe_mind'` to the divine `CommandVerb` union.
- **Modify** `src/sim/command/registry.ts` — register the `probe_mind` capability (tier `divine`, dynamic cost from `payload.depth`, `targetKind:'npc'`, precondition = power ≥ cost, apply = `probeMind`).
- **Create** `src/llm/mind-link-resolver.ts` — `buildCandidateIds(npc, world): MindCandidate[]` + `resolveLinks(rawLinks, candidates): MindLink[]` (gold if id resolves, else degrade to concept).
- **Create** `src/llm/mind-prompt-builder.ts` — `buildMindPagePrompt(ctx): { messages, tools }` for `generateWithTools`; includes breadcrumb path + candidate ids the model may link.
- **Create** `src/ui/npc-mind-mode.ts` — `mountMindMode(body, deps): MindModeHandle`: breadcrumb, prose, gold/purple links, depth + running cost; drill → `deps.onDrill(path, depth)`; gold click → `deps.onCrossNav(entityId)`.
- **Modify** `src/ui/npc-attention-panel.ts` — host the mind-mode handle in the mind body (replace the Slice 1 placeholder); thread `store` + `onMindDrill` + `onMindCrossNav` deps.
- **Create** `src/game/mind-orchestrator.ts` — `openMindPage(npc, path, depth, deps)`: cache hit → render free; miss → emit `probe_mind` (if depth>0), call LLM, resolve links, cache, render.
- **Modify** `src/game/game-ui.ts`/`frame-renderer.ts` — wire drill + cross-nav (cross-nav sets `state.selectedNpcId` / pans camera).
- **Create** tests: `tests/unit/mind-probe.test.ts`, `tests/unit/mind-link-resolver.test.ts`, `tests/unit/mind-prompt-builder.test.ts`, `tests/unit/npc-mind-mode.test.ts`, `tests/unit/mind-orchestration.test.ts`, and a combined determinism guard `tests/unit/attention-replay-guard.test.ts`.

---

### Task 1: `probe_mind` cost curve + apply

**Files:**
- Create: `src/sim/mind-probe.ts`
- Test: `tests/unit/mind-probe.test.ts`

`mindProbeCost(depth)`: depth 0 → 0; depth d≥1 → `2^(d-1)` → 0,1,2,4,8,16. `probeMind` spends the cost from the spirit, appends a `mind_probed` event, mutates **no** NPC state. No randomness.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/mind-probe.test.ts
import { describe, it, expect } from 'vitest';
import { mindProbeCost, probeMind } from '@/sim/mind-probe';
import { EventLog } from '@/core/events';
import type { Spirit } from '@/core/spirit';

function player(power: number): Spirit {
  return { id: 'player', name: 'You', sigil: '✶', color: '#fff', isPlayer: true, power, manifestation: null } as Spirit;
}

describe('mindProbeCost', () => {
  it('is free at the surface and doubles per depth', () => {
    expect(mindProbeCost(0)).toBe(0);
    expect(mindProbeCost(1)).toBe(1);
    expect(mindProbeCost(2)).toBe(2);
    expect(mindProbeCost(3)).toBe(4);
    expect(mindProbeCost(4)).toBe(8);
    expect(mindProbeCost(5)).toBe(16);
  });
});

describe('probeMind', () => {
  it('spends the depth cost and logs a mind_probed event', () => {
    const log = new EventLog();
    const s = player(10);
    const ok = probeMind(s, 3, log, 'npc1'); // depth 3 → cost 4
    expect(ok).toBe(true);
    expect(s.power).toBe(6);
    const events = log.all();
    expect(events.some(e => e.event.type === 'mind_probed')).toBe(true);
  });

  it('rejects when power is insufficient', () => {
    const log = new EventLog();
    const s = player(2);
    const ok = probeMind(s, 4, log, 'npc1'); // cost 8 > 2
    expect(ok).toBe(false);
    expect(s.power).toBe(2);
  });

  it('is free and always succeeds at depth 0 without spending', () => {
    const log = new EventLog();
    const s = player(0);
    expect(probeMind(s, 0, log, 'npc1')).toBe(true);
    expect(s.power).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/mind-probe.test.ts`
Expected: FAIL — module not found. (Also `mind_probed` is not yet a `SimEvent` type — Step 3 adds it.)

- [ ] **Step 3: Add the `mind_probed` event type + implement**

In `src/core/events.ts` (or wherever the `SimEvent` discriminated union lives), add a variant:
```ts
| { type: 'mind_probed'; spiritId: SpiritId; npcId: string; depth: number }
```
Add a human-readable description for it in `getRecentEventDescriptions`/the event-describe map if one exists (e.g. `'🧠 Mind probed'`). Confirm the union's location first via `git grep -n "type: 'whisper'" src/core`.

Create `src/sim/mind-probe.ts`:
```ts
import type { Spirit } from '@/core/spirit';
import type { EventLog } from '@/core/events';

/** Power cost to open a mind page at the given depth: surface free, then 2^(depth-1). */
export function mindProbeCost(depth: number): number {
  if (depth <= 0) return 0;
  return 2 ** (depth - 1);
}

/**
 * Deterministic floor for reading a mind page: spend the depth-scaled power and log it.
 * Mutates NO npc state (observation only, v1). No randomness.
 * @returns true if applied (or free at depth 0); false if power insufficient.
 */
export function probeMind(spirit: Spirit, depth: number, log: EventLog, npcId: string): boolean {
  const cost = mindProbeCost(depth);
  if (spirit.power < cost) return false;
  spirit.power -= cost;
  log.append({ type: 'mind_probed', spiritId: spirit.id, npcId, depth });
  return true;
}
```
(Match the real `EventLog.append` signature — confirm whether it takes the bare `SimEvent` or a wrapper; mirror how `whisper()` appends its event in `divine-actions.ts`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/mind-probe.test.ts`
Expected: PASS (5 assertions across 3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sim/mind-probe.ts src/core/events.ts tests/unit/mind-probe.test.ts
git commit -m "feat(attention): probe_mind floor — 2^(depth-1) cost, mind_probed event, no npc mutation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Register the `probe_mind` capability

**Files:**
- Modify: `src/sim/command/types.ts` (add `'probe_mind'` to the divine verb union)
- Modify: `src/sim/command/registry.ts` (register the capability)
- Test: `tests/unit/probe-mind-capability.test.ts`

Cost is dynamic (from `payload.depth`), so the capability's static `cost` field is the surface cost (0); the precondition + apply compute the real cost from `mindProbeCost(depth)`. Replay-safe: `depth` is in the recorded command.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/probe-mind-capability.test.ts
import { describe, it, expect } from 'vitest';
import { CAPABILITY_REGISTRY } from '@/sim/command/registry';
import type { Command } from '@/sim/command/types';
// reuse the CommandCtx helper from the existing command tests (read tests/unit/command-system.test.ts first)

function ctxWithPlayer(power: number) { /* mirror existing helper; player spirit power=power, one npc 'npc1' */ }

describe('probe_mind capability', () => {
  it('is registered as a divine verb', () => {
    expect(CAPABILITY_REGISTRY.probe_mind).toBeDefined();
    expect(CAPABILITY_REGISTRY.probe_mind.tier).toBe('divine');
    expect(CAPABILITY_REGISTRY.probe_mind.implemented).toBe(true);
  });

  it('passes precondition at depth 0 with no power', () => {
    const { ctx } = ctxWithPlayer(0);
    const cmd: Command = { verb: 'probe_mind', source: 'player', target: { kind: 'npc', npcId: 'npc1' }, payload: { depth: 0 }, seq: 1 };
    expect(CAPABILITY_REGISTRY.probe_mind.precondition!(cmd, ctx)).toBeNull();
  });

  it('fails precondition at depth 4 (cost 8) with power 3', () => {
    const { ctx } = ctxWithPlayer(3);
    const cmd: Command = { verb: 'probe_mind', source: 'player', target: { kind: 'npc', npcId: 'npc1' }, payload: { depth: 4 }, seq: 1 };
    expect(CAPABILITY_REGISTRY.probe_mind.precondition!(cmd, ctx)).toBe('insufficient_power');
  });

  it('apply spends depth cost without mutating the npc', () => {
    const { ctx } = ctxWithPlayer(10);
    const cmd: Command = { verb: 'probe_mind', source: 'player', target: { kind: 'npc', npcId: 'npc1' }, payload: { depth: 2 }, seq: 1 };
    const before = JSON.stringify(ctx.world.registry.get('npc1')!.properties);
    const ok = CAPABILITY_REGISTRY.probe_mind.apply!(cmd, ctx);
    expect(ok).toBe(true);
    expect(ctx.spirits.get('player')!.power).toBe(8); // 10 - 2
    expect(JSON.stringify(ctx.world.registry.get('npc1')!.properties)).toBe(before);
  });
});
```

> Confirm the exact `RejectionReason` string for insufficient power used elsewhere (`git grep -n insufficient src/sim/command`). The registry may centrally check `cost` against power in the executor; if so, the dynamic cost needs the precondition to return that reason itself. Match the existing convention.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/probe-mind-capability.test.ts`
Expected: FAIL — `probe_mind` not in the registry / verb union.

- [ ] **Step 3: Add the verb + capability**

In `src/sim/command/types.ts`, extend the divine verb union (line ~15-17) to include `'probe_mind'`.

In `src/sim/command/registry.ts`, add after `answer_prayer`:
```ts
probe_mind: {
  verb: 'probe_mind', tier: 'divine', cost: 0, targetKind: 'npc', implemented: true,
  precondition(cmd, ctx) {
    const npc = npcOf(cmd, ctx);
    if (!npc) return 'invalid_target';
    const depth = Number(cmd.payload?.depth ?? 0);
    const spirit = ctx.spirits.get(cmd.source);
    if (!spirit) return 'invalid_target';
    return spirit.power < mindProbeCost(depth) ? 'insufficient_power' : null;
  },
  apply(cmd, ctx) {
    const depth = Number(cmd.payload?.depth ?? 0);
    return probeMind(ctx.spirits.get(cmd.source)!, depth, ctx.log, npcOf(cmd, ctx)!.id);
  },
  describe: (cmd) => `read the mind of ${targetLabel(cmd)} (depth ${Number(cmd.payload?.depth ?? 0)})`,
},
```
Add imports: `import { mindProbeCost, probeMind } from '@/sim/mind-probe';`. If the executor centrally deducts `cost`, ensure `probe_mind`'s static `cost:0` prevents double-spend (apply does the real spend) — read the executor to confirm whether `apply` or the executor spends power, and align so cost is charged exactly once.

- [ ] **Step 4: Run test + full command suite**

Run: `npx vitest run tests/unit/probe-mind-capability.test.ts && npx vitest run tests/unit/command-system.test.ts`
Expected: PASS, no regression.

- [ ] **Step 5: Commit**

```bash
git add src/sim/command/types.ts src/sim/command/registry.ts tests/unit/probe-mind-capability.test.ts
git commit -m "feat(attention): register probe_mind divine verb (dynamic depth cost, no mutation)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Link resolver — candidate ids + gold/purple resolution

**Files:**
- Create: `src/llm/mind-link-resolver.ts`
- Test: `tests/unit/mind-link-resolver.test.ts`

`buildCandidateIds(npc, world)` collects the real ids the model may link: the NPC's relationship `npcId`s, its `homePoiId`, nearby NPCs (a small spatial query), and recent-event actor ids — each with a human label + a kind (`'npc' | 'place'`). `resolveLinks(rawLinks, candidates)` maps the model's raw links: a link whose `entityId` is in the candidate set becomes a gold `entity` link; anything else (including a link the model marked `entity` but with an unknown/missing id) degrades to a `concept` link.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/mind-link-resolver.test.ts
import { describe, it, expect } from 'vitest';
import { buildCandidateIds, resolveLinks } from '@/llm/mind-link-resolver';
import { World } from '@/world/world';
import type { Entity } from '@/core/types';

function mkNpc(id: string, x: number, y: number, over: any = {}): Entity {
  return { id, kind: 'npc', x, y, properties: {
    name: id, role: 'farmer', relationships: [], recentEventIds: [], homePoiId: undefined, ...over,
  } } as unknown as Entity;
}

describe('buildCandidateIds', () => {
  it('includes relationship targets and home poi', () => {
    const w = new World();
    const tom = mkNpc('tom', 1, 1);
    w.addEntity(tom);
    const maeve = mkNpc('maeve', 1, 2, { relationships: [{ npcId: 'tom', type: 'family', trust: 0.8 }], homePoiId: 'poi_east' });
    w.addEntity(maeve);
    const cands = buildCandidateIds(maeve, w);
    const ids = cands.map(c => c.id);
    expect(ids).toContain('tom');
    expect(ids).toContain('poi_east');
  });
});

describe('resolveLinks', () => {
  const candidates = [
    { id: 'tom', label: 'Tom', kind: 'npc' as const },
    { id: 'poi_east', label: 'Easthollow', kind: 'place' as const },
  ];

  it('keeps a valid entity link as gold', () => {
    const out = resolveLinks([{ label: 'Tom', kind: 'entity', entityId: 'tom' }], candidates);
    expect(out[0]).toEqual({ label: 'Tom', kind: 'entity', entityId: 'tom' });
  });

  it('degrades an entity link with an unknown id to a concept link', () => {
    const out = resolveLinks([{ label: 'the stranger', kind: 'entity', entityId: 'ghost42' }], candidates);
    expect(out[0].kind).toBe('concept');
    expect(out[0].entityId).toBeUndefined();
  });

  it('passes concept links through unchanged', () => {
    const out = resolveLinks([{ label: 'fear of being forgotten', kind: 'concept' }], candidates);
    expect(out[0]).toEqual({ label: 'fear of being forgotten', kind: 'concept' });
  });

  it('degrades an entity link missing an id to concept', () => {
    const out = resolveLinks([{ label: 'someone', kind: 'entity' }], candidates);
    expect(out[0].kind).toBe('concept');
  });
});
```

> Confirm `World`'s real construction + `addEntity` API before finalizing the test (read `src/world/world.ts`); use whatever the existing world tests use to build a world with entities. If `World` needs a registry/indexes set up, mirror that setup.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/mind-link-resolver.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/llm/mind-link-resolver.ts
import type { Entity, NpcProperties } from '@/core/types';
import type { World } from '@/world/world';
import type { MindLink } from '@/llm/npc-attention-store';

export interface MindCandidate { id: string; label: string; kind: 'npc' | 'place'; }

export interface RawMindLink { label: string; kind: 'entity' | 'concept'; entityId?: string; }

const NEARBY_RADIUS = 6;
const MAX_CANDIDATES = 16;

export function buildCandidateIds(npc: Entity, world: World): MindCandidate[] {
  const p = npc.properties as unknown as NpcProperties;
  const out = new Map<string, MindCandidate>();

  for (const rel of p.relationships ?? []) {
    const e = world.registry.get(rel.npcId);
    if (e) out.set(rel.npcId, { id: rel.npcId, label: (e.properties as any)?.name ?? rel.npcId, kind: 'npc' });
  }
  if (p.homePoiId) out.set(p.homePoiId, { id: p.homePoiId, label: p.homePoiId, kind: 'place' });

  // Nearby NPCs (excluding self).
  const region = { x: npc.x - NEARBY_RADIUS, y: npc.y - NEARBY_RADIUS, w: NEARBY_RADIUS * 2, h: NEARBY_RADIUS * 2 };
  for (const e of world.query({ kind: 'npc', region })) {
    if (e.id === npc.id || out.has(e.id)) continue;
    out.set(e.id, { id: e.id, label: (e.properties as any)?.name ?? e.id, kind: 'npc' });
    if (out.size >= MAX_CANDIDATES) break;
  }
  return [...out.values()].slice(0, MAX_CANDIDATES);
}

export function resolveLinks(raw: RawMindLink[], candidates: MindCandidate[]): MindLink[] {
  const byId = new Map(candidates.map(c => [c.id, c]));
  return raw.map((l) => {
    if (l.kind === 'entity' && l.entityId && byId.has(l.entityId)) {
      return { label: l.label, kind: 'entity', entityId: l.entityId };
    }
    return { label: l.label, kind: 'concept' }; // degrade unresolved/idless entity links
  });
}
```
(Confirm the `Region` field names — `{x,y,w,h}` vs `{x,y,width,height}` — from `src/world/world.ts`'s `QueryOpts.region`/`Region` type and match exactly.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/mind-link-resolver.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/llm/mind-link-resolver.ts tests/unit/mind-link-resolver.test.ts
git commit -m "feat(attention): mind link resolver — candidate ids + gold/concept degradation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `buildMindPagePrompt` (structured output)

**Files:**
- Create: `src/llm/mind-prompt-builder.ts`
- Test: `tests/unit/mind-prompt-builder.test.ts`

Builds a `generateWithTools` request: messages (system + user with the compact NPC card, the breadcrumb path, and the candidate ids the model may reference as gold links) and a single tool `emit_mind_page` whose schema is `{ prose: string, links: Array<{ label, kind: 'entity'|'concept', entityId? }> }`. Token budget: summarize the breadcrumb tail when deep.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/mind-prompt-builder.test.ts
import { describe, it, expect } from 'vitest';
import { buildMindPagePrompt, MIND_PAGE_TOOL } from '@/llm/mind-prompt-builder';
import type { Entity } from '@/core/types';

function npc(): Entity {
  return { id: 'maeve', kind: 'npc', x: 1, y: 1, properties: {
    name: 'Maeve', role: 'farmer',
    personality: { assertiveness: 0.3, skepticism: 0.6, piety: 0.4, sociability: 0.5 },
    beliefs: { player: { faith: 0.4, understanding: 0.3, devotion: 0.1 } },
    needs: { safety: 0.4, prosperity: 0.3, community: 0.6, meaning: 0.3 },
    mood: 0.5, activity: 'work', recentEventIds: [], relationships: [], homePoiId: 'poi_east',
  } } as unknown as Entity;
}

describe('buildMindPagePrompt', () => {
  it('defines an emit_mind_page tool requiring prose + links', () => {
    expect(MIND_PAGE_TOOL.name).toBe('emit_mind_page');
    const props = (MIND_PAGE_TOOL.parameters as any).properties;
    expect(props.prose).toBeDefined();
    expect(props.links).toBeDefined();
  });

  it('includes the npc name and the breadcrumb path', () => {
    const { messages } = buildMindPagePrompt({ npc: npc(), path: ['surface', 'fear of being forgotten'], candidates: [], depth: 1 });
    const text = messages.map(m => m.content).join('\n');
    expect(text).toContain('Maeve');
    expect(text).toContain('fear of being forgotten');
  });

  it('lists candidate ids the model may link as entities', () => {
    const { messages } = buildMindPagePrompt({
      npc: npc(), path: ['surface'], depth: 0,
      candidates: [{ id: 'tom', label: 'Tom', kind: 'npc' }, { id: 'poi_east', label: 'Easthollow', kind: 'place' }],
    });
    const text = messages.map(m => m.content).join('\n');
    expect(text).toContain('tom');
    expect(text).toContain('Easthollow');
  });

  it('summarizes a deep breadcrumb tail to bound tokens', () => {
    const longPath = ['surface', 'a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const { messages } = buildMindPagePrompt({ npc: npc(), path: longPath, candidates: [], depth: 7 });
    const text = messages.map(m => m.content).join('\n');
    expect(text).toContain('g');        // current node always present
    expect(text.length).toBeLessThan(4000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/mind-prompt-builder.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/llm/mind-prompt-builder.ts
import type { Entity, NpcProperties } from '@/core/types';
import type { LLMTool, LLMMessage } from '@/llm/llm-client';
import type { MindCandidate } from '@/llm/mind-link-resolver';

export interface MindPromptContext {
  npc: Entity;
  /** breadcrumb path from surface to the current node, e.g. ['surface', 'fear of being forgotten']. */
  path: string[];
  candidates: MindCandidate[];
  depth: number;
}

export const MIND_PAGE_TOOL: LLMTool = {
  name: 'emit_mind_page',
  description: 'Emit one page of a mortal\'s mind: short prose plus typed hyperlinks to drill deeper.',
  parameters: {
    type: 'object',
    properties: {
      prose: { type: 'string', description: '2-4 sentences of what occupies this node of the mortal\'s mind, in Pratchett-tinged prose. Respect known facts (name, role, real relationships, real recent events).' },
      links: {
        type: 'array',
        description: 'Hyperlinks the player can drill into.',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            kind: { type: 'string', enum: ['entity', 'concept'] },
            entityId: { type: 'string', description: 'For kind=entity ONLY, the exact id from the provided candidate list. Omit for concept links.' },
          },
          required: ['label', 'kind'],
        },
      },
    },
    required: ['prose', 'links'],
  },
};

const MAX_PATH_SHOWN = 4;

export function buildMindPagePrompt(ctx: MindPromptContext): { messages: LLMMessage[]; tools: LLMTool[] } {
  const p = ctx.npc.properties as unknown as NpcProperties;
  const b = p.beliefs['player'] ?? { faith: 0, understanding: 0, devotion: 0 };

  // Bound tokens: keep 'surface' + the last few crumbs.
  const path = ctx.path.length > MAX_PATH_SHOWN
    ? [ctx.path[0], '…', ...ctx.path.slice(-(MAX_PATH_SHOWN - 1))]
    : ctx.path;

  const system = [
    'You generate one page of a mortal\'s mind as an infinite, hyperlinked wiki, for a god reading their thoughts.',
    'World: Terry Pratchett\'s Small Gods. Dreamlike but grounded in the mortal\'s real state.',
    'Call emit_mind_page exactly once. Entity links MUST use an id from the candidate list; for purely psychological nodes (fears, feelings, memories) use concept links with no id.',
  ].join(' ');

  const lines: string[] = [];
  lines.push(`Mortal: ${p.name}, a ${p.role}. Mood ${p.mood.toFixed(2)}; currently ${p.activity}.`);
  lines.push(`Faith in the reading god: ${b.faith.toFixed(2)} (understanding ${b.understanding.toFixed(2)}).`);
  lines.push(`Personality — assertiveness ${p.personality.assertiveness.toFixed(2)}, skepticism ${p.personality.skepticism.toFixed(2)}, piety ${p.personality.piety.toFixed(2)}, sociability ${p.personality.sociability.toFixed(2)}.`);
  lines.push(`You are reading at this path through their mind: ${path.join(' ▸ ')}.`);
  if (ctx.depth === 0) lines.push('This is the SURFACE — the immediate, top-of-mind thoughts.');
  else lines.push(`This node is "${ctx.path[ctx.path.length - 1]}" — go deeper into exactly this facet.`);
  if (ctx.candidates.length) {
    lines.push('Real people/places you may link as entity links (use the exact id):');
    for (const c of ctx.candidates) lines.push(`  - ${c.label} [${c.kind}] id=${c.id}`);
  } else {
    lines.push('No real entities available to link here; use concept links only.');
  }
  lines.push('Emit the page now.');

  return {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: lines.join('\n') },
    ],
    tools: [MIND_PAGE_TOOL],
  };
}
```
(Confirm `LLMTool`/`LLMMessage` shapes from `src/llm/llm-client.ts` — especially whether tool params key is `parameters` vs `input_schema`, and message role/content field names — and match exactly. The Create panel's `editor-tools.ts` already uses `LLMTool`; mirror its structure.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/mind-prompt-builder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/llm/mind-prompt-builder.ts tests/unit/mind-prompt-builder.test.ts
git commit -m "feat(attention): buildMindPagePrompt — structured emit_mind_page tool + breadcrumb + candidates

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Mind-mode wiki view

**Files:**
- Create: `src/ui/npc-mind-mode.ts`
- Test: `tests/unit/npc-mind-mode.test.ts`

Renders the current page: a clickable breadcrumb (each crumb navigates back — free), the page prose with inline gold/purple hyperlinks, and a footer showing current depth + the next-drill cost. It is a dumb view: it reads the current page from a passed `MindPage`, and calls `deps.onDrill(label, kind, entityId)` / `deps.onCrumb(index)` / `deps.onCrossNav(entityId)`. Orchestration (cost, LLM, cache) is the caller's job (Task 6).

Gold links render gold + a `⮕` marker and route to `onCrossNav(entityId)` (cross into the world); purple links render purple and route to `onDrill(label, 'concept')` (deeper page in this mind). The view tracks the breadcrumb it was told to show.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/npc-mind-mode.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mountMindMode } from '@/ui/npc-mind-mode';
import type { MindPage } from '@/llm/npc-attention-store';

const surface: MindPage = {
  depth: 0,
  prose: 'She kneels in the wet furrows.',
  links: [
    { label: 'Tom', kind: 'entity', entityId: 'tom' },
    { label: 'fear of being forgotten', kind: 'concept' },
  ],
};

describe('mountMindMode', () => {
  let body: HTMLElement;
  beforeEach(() => { body = document.createElement('div'); });

  it('renders prose and both link kinds', () => {
    const h = mountMindMode(body, { onDrill: () => {}, onCrumb: () => {}, onCrossNav: () => {}, nextCost: () => 1 });
    h.showPage(['surface'], surface);
    expect(body.textContent).toContain('She kneels');
    expect(body.querySelector('[data-sg-link="entity"]')?.textContent).toContain('Tom');
    expect(body.querySelector('[data-sg-link="concept"]')?.textContent).toContain('forgotten');
    h.destroy();
  });

  it('gold link click triggers cross-nav with the entity id', () => {
    let crossed = '';
    const h = mountMindMode(body, { onDrill: () => {}, onCrumb: () => {}, onCrossNav: (id) => { crossed = id; }, nextCost: () => 1 });
    h.showPage(['surface'], surface);
    (body.querySelector('[data-sg-link="entity"]') as HTMLElement).click();
    expect(crossed).toBe('tom');
    h.destroy();
  });

  it('purple link click triggers drill with label+concept', () => {
    let drilled: any = null;
    const h = mountMindMode(body, { onDrill: (label, kind) => { drilled = { label, kind }; }, onCrumb: () => {}, onCrossNav: () => {}, nextCost: () => 2 });
    h.showPage(['surface'], surface);
    (body.querySelector('[data-sg-link="concept"]') as HTMLElement).click();
    expect(drilled).toEqual({ label: 'fear of being forgotten', kind: 'concept' });
    h.destroy();
  });

  it('renders a clickable breadcrumb and fires onCrumb with the index', () => {
    let idx = -1;
    const h = mountMindMode(body, { onDrill: () => {}, onCrumb: (i) => { idx = i; }, onCrossNav: () => {}, nextCost: () => 0 });
    h.showPage(['surface', 'fear of being forgotten'], { ...surface, depth: 1 });
    const crumbs = body.querySelectorAll('[data-sg-crumb]');
    expect(crumbs.length).toBe(2);
    (crumbs[0] as HTMLElement).click();
    expect(idx).toBe(0);
    h.destroy();
  });

  it('shows the next-drill cost', () => {
    const h = mountMindMode(body, { onDrill: () => {}, onCrumb: () => {}, onCrossNav: () => {}, nextCost: () => 4 });
    h.showPage(['surface'], surface);
    expect(body.textContent).toContain('4'); // next-drill cost surfaced
    h.destroy();
  });

  it('shows a loading state then the page', () => {
    const h = mountMindMode(body, { onDrill: () => {}, onCrumb: () => {}, onCrossNav: () => {}, nextCost: () => 1 });
    h.showLoading(['surface', 'a']);
    expect(body.textContent?.toLowerCase()).toMatch(/reading|listening|…/);
    h.showPage(['surface', 'a'], { ...surface, depth: 1 });
    expect(body.textContent).toContain('She kneels');
    h.destroy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/npc-mind-mode.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/ui/npc-mind-mode.ts
import type { MindPage } from '@/llm/npc-attention-store';

const STYLE = `
.sg-mind { font: 12px/1.6 'IBM Plex Mono', monospace; color: #d7dce8; }
.sg-crumbs { font: 10px sans-serif; color: rgba(255,255,255,0.45); margin-bottom: 6px; display: flex; flex-wrap: wrap; gap: 4px; }
.sg-crumb { cursor: pointer; pointer-events: auto; color: rgba(154,170,255,0.85); }
.sg-crumb:hover { text-decoration: underline; }
.sg-crumb-sep { color: rgba(255,255,255,0.3); }
.sg-mind-prose { margin-bottom: 8px; }
.sg-link { cursor: pointer; pointer-events: auto; }
.sg-link[data-sg-link="entity"] { color: #ffd76b; text-decoration: underline; font-weight: 600; }
.sg-link[data-sg-link="concept"] { color: #c9a3ff; border-bottom: 1px dashed #c9a3ff; }
.sg-mind-foot { font: 10px sans-serif; color: rgba(255,255,255,0.45); margin-top: 6px; display: flex; justify-content: space-between; }
.sg-mind-loading { font: italic 11px sans-serif; color: rgba(255,255,255,0.4); padding: 10px 0; }
`;

export interface MindModeDeps {
  onDrill(label: string, kind: 'entity' | 'concept', entityId?: string): void;
  onCrumb(index: number): void;
  onCrossNav(entityId: string): void;
  /** Power cost of drilling one level deeper from the currently shown page. */
  nextCost(): number;
}

export interface MindModeHandle {
  showPage(path: string[], page: MindPage): void;
  showLoading(path: string[]): void;
  destroy(): void;
}

export function mountMindMode(body: HTMLElement, deps: MindModeDeps): MindModeHandle {
  while (body.firstChild) body.removeChild(body.firstChild);
  const style = document.createElement('style'); style.textContent = STYLE; body.appendChild(style);
  const root = document.createElement('div'); root.className = 'sg-mind'; body.appendChild(root);

  function renderCrumbs(path: string[]): HTMLElement {
    const bar = document.createElement('div'); bar.className = 'sg-crumbs';
    path.forEach((label, i) => {
      if (i > 0) { const sep = document.createElement('span'); sep.className = 'sg-crumb-sep'; sep.textContent = '▸'; bar.appendChild(sep); }
      const c = document.createElement('span'); c.className = 'sg-crumb'; c.dataset.sgCrumb = String(i); c.textContent = label;
      c.addEventListener('click', (e) => { e.stopPropagation(); deps.onCrumb(i); });
      bar.appendChild(c);
    });
    return bar;
  }

  function linkSpan(label: string, kind: 'entity' | 'concept', entityId?: string): HTMLElement {
    const s = document.createElement('span'); s.className = 'sg-link'; s.dataset.sgLink = kind;
    s.textContent = kind === 'entity' ? `⮕ ${label}` : label;
    s.addEventListener('click', (e) => {
      e.stopPropagation();
      if (kind === 'entity' && entityId) deps.onCrossNav(entityId);
      else deps.onDrill(label, kind, entityId);
    });
    return s;
  }

  return {
    showPage(path, page) {
      while (root.firstChild) root.removeChild(root.firstChild);
      root.appendChild(renderCrumbs(path));
      const prose = document.createElement('div'); prose.className = 'sg-mind-prose'; prose.textContent = page.prose;
      root.appendChild(prose);
      if (page.links.length) {
        const links = document.createElement('div');
        page.links.forEach((l, i) => { if (i > 0) links.appendChild(document.createTextNode(' · ')); links.appendChild(linkSpan(l.label, l.kind, l.entityId)); });
        root.appendChild(links);
      }
      const foot = document.createElement('div'); foot.className = 'sg-mind-foot';
      const depthEl = document.createElement('span'); depthEl.textContent = `depth ${page.depth}`;
      const costEl = document.createElement('span'); costEl.textContent = `drill deeper · ${deps.nextCost()} ⚡`;
      foot.append(depthEl, costEl);
      root.appendChild(foot);
    },
    showLoading(path) {
      while (root.firstChild) root.removeChild(root.firstChild);
      root.appendChild(renderCrumbs(path));
      const l = document.createElement('div'); l.className = 'sg-mind-loading'; l.textContent = 'reading their mind…';
      root.appendChild(l);
    },
    destroy() { while (body.firstChild) body.removeChild(body.firstChild); },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/npc-mind-mode.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/npc-mind-mode.ts tests/unit/npc-mind-mode.test.ts
git commit -m "feat(attention): mind-mode wiki view — breadcrumb, prose, gold/purple links, next-cost

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Mind orchestrator — cache, drill, cross-nav

**Files:**
- Create: `src/game/mind-orchestrator.ts`
- Test: `tests/unit/mind-orchestration.test.ts`

`openMindPage(npc, path, depth, deps)`:
1. **Cache hit** (`store.getPage(npcId, pathKey)` exists) → return it, no spend, no LLM.
2. **Miss:** emit `probe_mind` command (`payload:{depth}`) — except depth 0 which is free (still emit so it's logged/replay-consistent; cost is 0). If the player can't afford `mindProbeCost(depth)`, abort (return null) without emitting.
3. Call `generateWithTools(messages, tools)`; read the `emit_mind_page` tool call args `{ prose, links }`.
4. `resolveLinks(rawLinks, candidates)`; build `MindPage { prose, links, depth }`; `store.putPage(npcId, pathKey, page)`; return it.
5. On LLM failure: return a fallback `MindPage` with muted prose ("their mind clouds over") and no links; **do not cache** the fallback (so a retry can succeed) — but the power was already spent (floor applied). Note this tradeoff.

`pathKey` = `path.join(' ▸ ')`. Affordability is checked against the player's current power before emitting.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/mind-orchestration.test.ts
import { describe, it, expect } from 'vitest';
import { openMindPage, pathKey } from '@/game/mind-orchestrator';
import { CommandQueue } from '@/sim/command/command-queue';
import { NpcAttentionStore } from '@/llm/npc-attention-store';
import { LLMClient } from '@/llm/llm-client';
import { World } from '@/world/world';
import type { Entity } from '@/core/types';
import type { Spirit } from '@/core/spirit';

function maeve(): Entity {
  return { id: 'maeve', kind: 'npc', x: 1, y: 1, properties: {
    name: 'Maeve', role: 'farmer',
    personality: { assertiveness: 0.3, skepticism: 0.6, piety: 0.4, sociability: 0.5 },
    beliefs: { player: { faith: 0.4, understanding: 0.3, devotion: 0.1 } },
    needs: { safety: 0.4, prosperity: 0.3, community: 0.6, meaning: 0.3 },
    mood: 0.5, activity: 'work', recentEventIds: [], relationships: [], homePoiId: 'poi_east',
  } } as unknown as Entity;
}

// LLM stub that returns a canned emit_mind_page tool call.
function pageStub(prose: string, links: any[]): LLMClient {
  return new LLMClient({
    async generate() {
      return { content: '', toolCalls: [{ id: 'c0', name: 'emit_mind_page', arguments: { prose, links } }], latencyMs: 0 };
    },
  } as any);
}

function deps(over: any = {}) {
  const world = new World(); world.addEntity(maeve());
  const store = new NpcAttentionStore();
  const queue = new CommandQueue();
  const spirit: Spirit = { id: 'player', name: 'You', sigil: '✶', color: '#fff', isPlayer: true, power: 20, manifestation: null } as Spirit;
  return {
    world, store, queue, spirit,
    d: {
      world, store, queue,
      llm: pageStub('She kneels in the furrows.', [{ label: 'fear', kind: 'concept' }]),
      playerSpirit: spirit, playerSpiritId: 'player' as const,
      ...over,
    },
  };
}

describe('openMindPage', () => {
  it('surface (depth 0) is free, generates, and caches', async () => {
    const { d, store, spirit } = deps();
    const page = await openMindPage(maeve(), ['surface'], 0, d);
    expect(page?.prose).toContain('She kneels');
    expect(spirit.power).toBe(20); // free
    expect(store.getPage('maeve', pathKey(['surface']))).toBeDefined();
  });

  it('a cache hit does not re-spend or re-generate', async () => {
    const { d, store, spirit } = deps();
    store.putPage('maeve', pathKey(['surface', 'fear']), { prose: 'cached', links: [], depth: 1 });
    const before = spirit.power;
    const page = await openMindPage(maeve(), ['surface', 'fear'], 1, d);
    expect(page?.prose).toBe('cached');
    expect(spirit.power).toBe(before); // no spend
    expect(d.queue.drain()).toHaveLength(0); // no command emitted
  });

  it('a depth-1 miss emits probe_mind and spends 1', async () => {
    const { d, spirit } = deps();
    await openMindPage(maeve(), ['surface', 'fear'], 1, d);
    const drained = d.queue.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0].verb).toBe('probe_mind');
    expect(drained[0].payload).toMatchObject({ depth: 1 });
    // NOTE: the queue only records intent; the executor applies the spend on tick.
    // If the orchestrator spends eagerly against playerSpirit, assert power here instead.
  });

  it('aborts a drill the player cannot afford (no command, returns null)', async () => {
    const poor: Spirit = { id: 'player', name: 'You', sigil: '✶', color: '#fff', isPlayer: true, power: 1, manifestation: null } as Spirit;
    const { d } = deps({ playerSpirit: poor });
    const page = await openMindPage(maeve(), ['surface', 'a', 'b', 'c'], 4, d); // cost 8 > 1
    expect(page).toBeNull();
    expect(d.queue.drain()).toHaveLength(0);
  });

  it('degrades a bad entity id to a concept link in the cached page', async () => {
    const { d, store } = deps({ llm: undefined });
    d.llm = (await import('@/llm/llm-client')).LLMClient
      ? new (await import('@/llm/llm-client')).LLMClient({ async generate() {
          return { content: '', toolCalls: [{ id: 'c0', name: 'emit_mind_page', arguments: { prose: 'p', links: [{ label: 'ghost', kind: 'entity', entityId: 'nope' }] } }], latencyMs: 0 };
        } } as any)
      : d.llm;
    const page = await openMindPage(maeve(), ['surface'], 0, d);
    expect(page?.links[0].kind).toBe('concept');
    expect(store.getPage('maeve', pathKey(['surface']))?.links[0].kind).toBe('concept');
  });
});
```

> The "spends" assertion depends on whether the orchestrator spends eagerly (decrement `playerSpirit.power` itself before emitting) or relies on the executor's deferred apply. **Decision for this plan:** the orchestrator checks affordability against `playerSpirit.power` and **emits the command only** (the executor performs the authoritative spend on tick), to keep one spend path. Therefore the affordability test asserts on emission/abort, not on immediate power change. The implementer must NOT double-spend. The depth-1 test asserts the emitted command + payload; remove the eager-power assertion.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/mind-orchestration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/game/mind-orchestrator.ts
import type { Entity, SpiritId } from '@/core/types';
import type { Spirit } from '@/core/spirit';
import type { World } from '@/world/world';
import type { CommandQueue } from '@/sim/command/command-queue';
import type { LLMClient } from '@/llm/llm-client';
import type { NpcAttentionStore, MindPage } from '@/llm/npc-attention-store';
import { mindProbeCost } from '@/sim/mind-probe';
import { buildMindPagePrompt } from '@/llm/mind-prompt-builder';
import { buildCandidateIds, resolveLinks, type RawMindLink } from '@/llm/mind-link-resolver';

export function pathKey(path: string[]): string { return path.join(' ▸ '); }

export interface MindOrchestratorDeps {
  world: World;
  store: NpcAttentionStore;
  queue: CommandQueue;
  llm: LLMClient;
  playerSpirit: Spirit;
  playerSpiritId: SpiritId;
}

export async function openMindPage(
  npc: Entity, path: string[], depth: number, deps: MindOrchestratorDeps,
): Promise<MindPage | null> {
  const key = pathKey(path);
  const cached = deps.store.getPage(npc.id, key);
  if (cached) return cached; // free back-nav / revisit

  const cost = mindProbeCost(depth);
  if (deps.playerSpirit.power < cost) return null; // can't afford this drill

  // Deterministic floor: emit the probe command (executor performs the authoritative spend on tick).
  deps.queue.emit({ verb: 'probe_mind', source: deps.playerSpiritId, target: { kind: 'npc', npcId: npc.id }, payload: { depth } });

  // Soft narration.
  try {
    const candidates = buildCandidateIds(npc, deps.world);
    const { messages, tools } = buildMindPagePrompt({ npc, path, candidates, depth });
    const res = await deps.llm.generateWithTools(messages, tools);
    const call = res.toolCalls?.find(c => c.name === 'emit_mind_page');
    if (!call) return { prose: 'Their mind clouds over; nothing comes through.', links: [], depth }; // not cached
    const args = call.arguments as { prose?: string; links?: RawMindLink[] };
    const page: MindPage = {
      prose: typeof args.prose === 'string' ? args.prose : '…',
      links: resolveLinks(args.links ?? [], candidates),
      depth,
    };
    deps.store.putPage(npc.id, key, page);
    return page;
  } catch {
    return { prose: 'Their mind clouds over; nothing comes through.', links: [], depth }; // floor already spent; not cached → retry can succeed
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/mind-orchestration.test.ts`
Expected: PASS (adjust the depth-1 test per the Step 1 note — assert emission, not eager spend).

- [ ] **Step 5: Commit**

```bash
git add src/game/mind-orchestrator.ts tests/unit/mind-orchestration.test.ts
git commit -m "feat(attention): mind orchestrator — cache-first, probe_mind floor, link resolution

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Host mind-mode in the panel + wire drill/cross-nav into Game

**Files:**
- Modify: `src/ui/npc-attention-panel.ts` (replace mind-body placeholder with `mountMindMode`; on first switch to Mind, open the surface; thread `onMindDrill`/`onMindCrossNav` deps; track current breadcrumb)
- Modify: `src/game/game-ui.ts`/`frame-renderer.ts` (build deps; cross-nav sets `state.selectedNpcId = entityId` and, for a place, pans the camera; drill calls `openMindPage`)
- Test: covered by view + orchestrator unit tests; add a thin panel integration test if practical

The panel owns the breadcrumb state for Mind mode (the view is dumb). On switching to Mind for an NPC with no surface shown yet, the panel calls the caller's `onMindOpen(npcId, ['surface'], 0)`; the caller runs `openMindPage`, then calls `panel.showMindPage(path, page)`. Drilling a concept appends to the breadcrumb; clicking a crumb truncates it; both re-open via the caller (cache makes back-nav instant). Cross-nav delegates entirely to the caller (which flips `selectedNpcId` → the frame-renderer's existing selection path opens the new NPC's panel; `setNpc` resets Mind to surface).

- [ ] **Step 1: Extend the panel**

In `npc-attention-panel.ts`:
- Add to deps: `onMindOpen(npcId: string, path: string[], depth: number): void` and `onMindCrossNav(entityId: string): void`.
- After building `mindBody`, remove placeholder and mount: `const mindMode = mountMindMode(mindBody, { onDrill, onCrumb, onCrossNav, nextCost })`.
  - Maintain `let mindPath: string[] = ['surface']`.
  - `onDrill(label, kind)`: `mindPath = [...mindPath, label]; mindMode.showLoading(mindPath); deps.onMindOpen(currentNpcId!, mindPath, mindPath.length - 1);`
  - `onCrumb(i)`: `mindPath = mindPath.slice(0, i + 1); mindMode.showLoading(mindPath); deps.onMindOpen(currentNpcId!, mindPath, mindPath.length - 1);`
  - `onCrossNav(id)`: `deps.onMindCrossNav(id);`
  - `nextCost()`: `mindProbeCost(mindPath.length)` (next depth = current length).
- Expose `showMindPage(path, page)` on the handle → `mindMode.showPage(path, page)`.
- In the mode switch: when switching to Mind, if `mindPath` not yet shown for this NPC, call `mindMode.showLoading(['surface'])` + `deps.onMindOpen(currentNpcId!, ['surface'], 0)`.
- In `setNpc`: reset `mindPath = ['surface']` and clear the mind view (it'll reload on next Mind open).
- In `destroy`: `mindMode.destroy()`.

Import `mindProbeCost` from `@/sim/mind-probe`.

- [ ] **Step 2: Wire the caller in game-ui/frame-renderer**

```ts
onMindOpen: (npcId, path, depth) => {
  const entity = getNpc(this.deps.state.world!, npcId);
  if (!entity) return;
  void openMindPage(entity, path, depth, {
    world: this.deps.state.world!,
    store: this.deps.attentionStore,
    queue: this.deps.commandQueue,
    llm: this.deps.llmClientCapable ?? this.deps.llmClient, // structured output prefers the capable tier; fall back to NPC tier
    playerSpirit: this.deps.state.spirits.get('player')!,
    playerSpiritId: 'player',
  }).then((page) => {
    if (page) this.deps.ui.npcAttentionPanel.showMindPage(path, page);
    else this.deps.ui.npcAttentionPanel.showMindPage(path, { prose: 'Not enough power to drill deeper.', links: [], depth });
  });
},
onMindCrossNav: (entityId) => {
  // NPC → select + open its panel (frame-renderer's selection path handles the rest).
  const target = getNpc(this.deps.state.world!, entityId);
  if (target) { this.deps.state.selectedNpcId = entityId; this.lastInfoRefresh = 0; return; }
  // Otherwise treat as a place id → pan camera if resolvable (POI lookup); no-op if unknown.
  // (Place-panning is best-effort; if POI coords aren't readily available, leave as a follow-up.)
},
```
Confirm: the capable client may be null (onboarding) — fall back to `llmClient`. `generateWithTools` on a provider that lacks tool support should still return *something*; the orchestrator's no-tool-call branch yields the muted fallback. Verify `MockLLMProvider` tool canning works here for dev.

- [ ] **Step 3: Build + full test + manual smoke**

Run: `npm run build` → clean.
Run: `npm test` → all green.
Manual: select an NPC → 🧠 Mind → surface page renders free; click a purple concept → spends 1, deeper page; click another → spends 2; breadcrumb back to surface is instant + free; click a gold link to another NPC → that NPC's panel opens at their mind surface. Scrub time → revisiting regenerates (cache wiped).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(attention): mind mode wired — surface-on-open, drill, breadcrumb, gold cross-nav

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Determinism / replay guard (combined)

**Files:**
- Create: `tests/unit/attention-replay-guard.test.ts`

The spec's load-bearing guarantee (§6, §8): the `NpcAttentionStore` never appears in a snapshot, and a scrub past whisper/probe activity reproduces the deterministic floor while the soft layer is gone.

- [ ] **Step 1: Write the guard test**

```ts
// tests/unit/attention-replay-guard.test.ts
import { describe, it, expect } from 'vitest';
import { NpcAttentionStore } from '@/llm/npc-attention-store';
import { captureSnapshot } from '@/core/snapshot'; // confirm the real capture entry point
import { createInitialState } from '@/core/state'; // confirm the real factory name

describe('attention surface determinism guard', () => {
  it('store contents never appear in a captured snapshot', () => {
    const state = createInitialState(/* minimal args per the real factory */);
    const store = new NpcAttentionStore();
    store.appendTurn('npc1', { whisper: 'secret', dialogue: 'reaction', tick: 1 });
    store.putPage('npc1', 'surface', { prose: 'inner thoughts', links: [], depth: 0 });
    const snap = captureSnapshot(state); // store is NOT passed in — it's not part of state
    const json = JSON.stringify(snap);
    expect(json).not.toContain('secret');
    expect(json).not.toContain('inner thoughts');
  });

  it('clearAll() leaves the store empty (scrub semantics)', () => {
    const store = new NpcAttentionStore();
    store.appendTurn('n', { whisper: 'x', dialogue: 'y', tick: 1 });
    store.putPage('n', 'surface', { prose: 'p', links: [], depth: 0 });
    store.clearAll();
    expect(store.getTranscript('n')).toEqual([]);
    expect(store.getPage('n', 'surface')).toBeUndefined();
  });
});
```

> The implementer must confirm the real snapshot-capture function name/signature and the state factory (read `src/core/snapshot.ts` + `src/core/state.ts`). The structural guarantee (store is a separate object, never referenced by `GameState`) is what makes the first assertion hold; the test documents and enforces it. If constructing a full state is heavy, assert against a minimal state that still exercises `captureSnapshot`.

- [ ] **Step 2: Run + verify**

Run: `npx vitest run tests/unit/attention-replay-guard.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/attention-replay-guard.test.ts
git commit -m "test(attention): determinism guard — store never snapshotted, clears on scrub

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage (§4, §7 Slice 3, §8):** `probe_mind` verb, escalating cost, power-gated, no mutation ✓ (Tasks 1–2; cost curve 0/1/2/4/8 asserted; power gate; JSON-stable no-mutation assertion). `buildMindPagePrompt` + structured link output ✓ (Task 4). Wiki UI (breadcrumb, prose, gold/purple) ✓ (Task 5). Gold cross-nav (select NPC + open mind / pan place) ✓ (Task 7; place-pan flagged best-effort). Page cache by path (free back-nav) ✓ (Task 6 cache-hit test). Link resolution (valid→entity, invalid→concept) ✓ (Task 3 + Task 6). Cache clears on scrub ✓ (inherited from Slice 1 `clearAll`; Task 8 asserts clear). Drill renders page ✓ (Task 5/7). Combined determinism guard ✓ (Task 8).
- **Cost curve consistency:** `mindProbeCost` = `0,1,2,4,8,16` (depth 0 free, then `2^(depth-1)`) is identical in Task 1 (def + test), Task 2 (capability), Task 6 (affordability), and Task 7 (`nextCost`). Matches spec §4.
- **Single spend path:** Resolved explicitly — the orchestrator checks affordability but the **executor** performs the authoritative power spend via `probeMind` on tick; the orchestrator never decrements power itself (no double-spend). The Task 6 test note enforces this.
- **Placeholder scan:** The `>` notes are verification directives (confirm `EventLog.append` shape, `LLMTool` param key, `Region` field names, snapshot/state factory names, `RejectionReason` strings, `World.addEntity`) — the implementer reads the real signatures rather than trusting guesses. No deferred feature work hidden as a placeholder. Place-panning on cross-nav is explicitly scoped as best-effort with a follow-up note (NPC cross-nav is the primary, fully-specified path).
- **Type consistency:** `MindPage`/`MindLink` (Slice 1) are produced by the orchestrator (Task 6), stored, and rendered by the view (Task 5). `MindCandidate`/`RawMindLink` defined in Task 3 are consumed by Task 4 (prompt) and Task 6 (resolve). `buildMindPagePrompt` returns `{messages, tools}` consumed by `generateWithTools`. `mindProbeCost`/`probeMind` signatures consistent across Tasks 1/2/6. The panel handle gains `showMindPage(path, page)` used by Task 7's caller; the view handle's `showPage/showLoading/destroy` are used identically in Task 5 (def) and the panel (Task 7).
- **Cross-slice dependency:** Slices 2 and 3 both depend on Slice 1's `NpcAttentionStore` (`MindPage`/`MindLink`/`WhisperTurn` types) and the panel shell. Build order is strict: 1 → 2 → 3. Slice 3 also relies on the SP1 `generateWithTools`/`MockLLMProvider` tool-canning already shipped (Create panel epic), confirmed available.
