/**
 * mind-orchestrator.ts — "Mind mode" orchestrator.
 *
 * `openMindPage` ties the deterministic floor (mind-probe cost + the authoritative
 * spend, performed by the probe_mind executor on tick) to the soft LLM page
 * generation (mind-prompt-builder + mind-link-resolver). One entry point opens one
 * mind page:
 *
 *   1. Cache-first: a hit returns the stored page with NO spend, NO command, NO LLM.
 *   2. Affordability: if the player can't afford the depth-scaled cost, abort
 *      cleanly (return null, emit nothing).
 *   3. Spend path: emit exactly one probe_mind command. The orchestrator never
 *      decrements power itself — the executor is the single spend path (no
 *      double-spend).
 *   4. Generate: call the capable tier, read the emit_mind_page tool call, resolve
 *      links against real candidate ids, cache, and return the page.
 *   5. Fallback: on LLM error or no tool call, return a muted, UNcached page so a
 *      later retry can still succeed.
 */
import type { Entity } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';
import type { World } from '@/world/world';
import type { CommandQueue } from '@/sim/command/command-queue';
import type { LLMClient } from '@/llm/llm-client';
import type { NpcAttentionStore, MindPage } from '@/llm/npc-attention-store';
import { mindProbeCost } from '@/sim/mind-probe';
import { buildMindPagePrompt } from '@/llm/mind-prompt-builder';
import { buildCandidateIds, resolveLinks, type RawMindLink } from '@/llm/mind-link-resolver';

/** Canonical cache key for a path through a mind. */
export function pathKey(path: string[]): string {
  return path.join(' ▸ ');
}

export interface MindOrchestratorDeps {
  world: World;
  store: NpcAttentionStore;
  queue: CommandQueue;
  llm: LLMClient;
  playerSpirit: Spirit;
  playerSpiritId: SpiritId;
}

const FALLBACK = (depth: number): MindPage => ({
  prose: 'Their mind clouds over; nothing comes through.',
  links: [],
  depth,
});

export async function openMindPage(
  npc: Entity,
  path: string[],
  depth: number,
  deps: MindOrchestratorDeps,
): Promise<MindPage | null> {
  const key = pathKey(path);
  const cached = deps.store.getPage(npc.id, key);
  if (cached) return cached;

  const cost = mindProbeCost(depth);
  if (deps.playerSpirit.power < cost) return null;

  // The executor performs the authoritative spend on tick; the orchestrator only
  // requests the probe (single spend path, no double-spend).
  deps.queue.emit({
    verb: 'probe_mind',
    source: deps.playerSpiritId,
    target: { kind: 'npc', npcId: npc.id },
    payload: { depth },
  });

  try {
    const candidates = buildCandidateIds(npc, deps.world);
    const { messages, tools } = buildMindPagePrompt({ npc, path, candidates, depth });
    const res = await deps.llm.generateWithTools(messages, tools);
    const call = res.toolCalls?.find((c) => c.name === 'emit_mind_page');
    if (!call) return FALLBACK(depth);
    const args = readArgs(call.arguments) as { prose?: string; links?: RawMindLink[] };
    const page: MindPage = {
      prose: typeof args.prose === 'string' && args.prose.length ? args.prose : '…',
      links: resolveLinks(args.links ?? [], candidates),
      depth,
    };
    deps.store.putPage(npc.id, key, page);
    return page;
  } catch {
    return FALLBACK(depth);
  }
}

/**
 * Read tool-call arguments. In this codebase `LLMToolCall.arguments` is already a
 * parsed object (see parseToolCalls in llm-client.ts), so this returns it directly;
 * the string branch is defensive in case a provider ever passes raw JSON through.
 */
function readArgs(a: unknown): Record<string, unknown> {
  if (a && typeof a === 'object') return a as Record<string, unknown>;
  if (typeof a === 'string') {
    try {
      return JSON.parse(a);
    } catch {
      return {};
    }
  }
  return {};
}
