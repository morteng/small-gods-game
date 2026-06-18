/**
 * FateDirector + the StoryAgent seam — the with-AI tier.
 *
 * Agent-first, but determinism-preserving. The runtime (runner + text resolution)
 * stays SYNCHRONOUS and seed-deterministic; the agent never sits in the hot path.
 * Instead Fate works at two ASYNC boundaries, both BETWEEN sync runner steps:
 *
 *   1. enrichment — before entering a storylet, `warmEnrichment()` asks the agent
 *      to rewrite each AI-optional slot, caching results by `slotId`. The runner
 *      then reads that cache synchronously; an un-warmed slot falls back to the
 *      authored text. So a slow/failed/declined agent NEVER blocks or desyncs play.
 *   2. selection — `chooseNext()` lets the agent pick the next storylet from the
 *      already-eligible pool (pacing / theme / player model); declining defers to
 *      the deterministic default.
 *
 * This is the "author-time-ish enrichment, runtime execution" split applied per
 * beat: the agent shapes content just-ahead-of-need, the engine plays it back
 * reproducibly. The cache is also the persistence unit — a warmed slot can be
 * stored so a re-roll/replay yields identical prose.
 */
import type { EnrichHint, Storylet, Value } from './story-ir';
import type { Director } from './director';
import type { ReadonlyScope } from './story-state';
import { forEachNode } from './validate';

/** A compact, serializable view of state handed to the agent (no live objects). */
export type StateSnapshot = Record<string, Value>;

export interface EnrichRequest {
  hint: EnrichHint;
  /** The storylet being entered. */
  storyletId: string;
  /** Read-only state the agent may condition on. */
  state: StateSnapshot;
}

export interface SelectRequest {
  /** The already-eligible pool — agent only narrows, never bypasses gating. */
  candidates: { id: string; title?: string; tags?: string[] }[];
  state: StateSnapshot;
}

/**
 * The async seam Fate (or any LLM driver) implements. Track 4 backs this with the
 * capable-tier client; tests back it with a deterministic mock. Both `enrich` and
 * `select` are ADVISORY — returning null defers to the deterministic baseline, so
 * the pack remains fully playable if the agent is absent or errors.
 */
export interface StoryAgent {
  /** Rewrite an AI-optional slot, or null to keep the authored fallback. */
  enrich(req: EnrichRequest): Promise<string | null>;
  /** Pick a candidate id, or null to defer to the default selector. */
  select?(req: SelectRequest): Promise<string | null>;
}

/** The warmed-slot cache: slotId → agent-authored text. */
export type EnrichmentCache = Map<string, string>;

/**
 * A Director whose enrichment comes from a pre-warmed cache (sync, deterministic)
 * and whose selection can be a pre-decided id. No async in the Director itself —
 * the agent work already happened at the boundaries below.
 */
export class FateDirector implements Director {
  constructor(
    private readonly cache: EnrichmentCache = new Map(),
    private chosenId: string | null = null,
  ) {}

  enrich(hint: EnrichHint): string | undefined {
    return this.cache.get(hint.slotId);
  }

  select(eligible: Storylet[]): Storylet | undefined {
    if (!this.chosenId) return undefined;
    return eligible.find((s) => s.id === this.chosenId);
  }

  /** Record the agent's selection so the next `select()` honours it. */
  setChosen(id: string | null): void { this.chosenId = id; }
}

/** Collect every AI-optional slot reachable in a storylet body (incl. choice/if). */
export function collectEnrichHints(storylet: Storylet): EnrichHint[] {
  const hints: EnrichHint[] = [];
  forEachNode(storylet.body, (n) => {
    if (n.t === 'say') pushHint(n.text, hints);
    else if (n.t === 'choice') n.options.forEach((o) => pushHint(o.text, hints));
  });
  return hints;
}

function pushHint(slot: import('./story-ir').TextSlot, out: EnrichHint[]): void {
  if (typeof slot !== 'string' && 'fallback' in slot) out.push(slot.enrich);
}

/**
 * Ask the agent to enrich every slot in `storylet`, populating `cache`. Failures
 * are swallowed per-slot (that slot just falls back). Returns the same cache for
 * chaining. Call this just before entering a storylet.
 */
export async function warmEnrichment(
  storylet: Storylet,
  agent: StoryAgent,
  state: StateSnapshot,
  cache: EnrichmentCache = new Map(),
): Promise<EnrichmentCache> {
  await Promise.all(
    collectEnrichHints(storylet).map(async (hint) => {
      if (cache.has(hint.slotId)) return; // already warmed (replay-stable)
      try {
        const text = await agent.enrich({ hint, storyletId: storylet.id, state });
        if (text != null) cache.set(hint.slotId, text);
      } catch {
        /* leave un-warmed → authored fallback renders */
      }
    }),
  );
  return cache;
}

/** Ask the agent to pick from the eligible pool; null/throw → defer to default. */
export async function chooseNext(
  eligible: Storylet[],
  agent: StoryAgent,
  state: StateSnapshot,
): Promise<string | null> {
  if (!agent.select || eligible.length === 0) return null;
  try {
    const id = await agent.select({
      candidates: eligible.map((s) => ({ id: s.id, title: s.title, tags: s.tags })),
      state,
    });
    return id && eligible.some((s) => s.id === id) ? id : null;
  } catch {
    return null;
  }
}

/** Project a scope's owned fields into a snapshot for the agent. */
export function snapshotScope(scope: ReadonlyScope, keys: string[]): StateSnapshot {
  const out: StateSnapshot = {};
  for (const k of keys) {
    const v = scope.get(k);
    if (v !== undefined) out[k] = v;
  }
  return out;
}
