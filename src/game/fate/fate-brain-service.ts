/**
 * fate-brain-service.ts — the autonomous Fate producer.
 *
 * Runs OFF the sim tick (async, like LlmBackfillService), so src/sim/ stays
 * Math.random-free and replay-safe. It reads thread + world state, asks the
 * capable LLM to arm at most one staged beat, validates the result, and arms it
 * on the snapshot-backed StagingBuffer (full-state persistence — no SAVE_VERSION
 * bump). Gated on a capable client + not-scrubbing; single-flight. Replaces the
 * deterministic stageStrangerOnHardship stub as the authoring intelligence.
 */
import type { GameState } from '@/core/state';
import type { LLMClient } from '@/llm/llm-client';
import type { Command } from '@/sim/command/types';
import type { StagedBeat } from '@/sim/threads/staging-types';
import { buildFateContext, type FateFocus } from './fate-context';
import { FATE_TOOLS, parseFateToolCalls } from './fate-tools';

export interface FateBrainDeps {
  getState: () => GameState;
  getCapableClient: () => LLMClient | null;
  isScrubbed: () => boolean;
  /** Emit an immediate command (nudge_severity / bias_event) onto the queue. */
  emitCommand: (cmd: Omit<Command, 'seq'>) => void;
  /** Observability/test seam — fires for each armed beat. Intentionally unwired in game.ts. */
  onArmed?: (beat: StagedBeat) => void;
  /** Loaded storylet ids — the drift-guard set `arm_staged_beat`'s optional `storylet`
   *  ref is validated against. Omit to disable storylet arming from Fate entirely. */
  getValidStoryletIds?: () => Set<string>;
}

export class FateBrainService {
  private inFlight = false;

  constructor(private readonly deps: FateBrainDeps) {}

  isReady(): boolean {
    return this.deps.getCapableClient() !== null && !this.deps.isScrubbed() && !this.inFlight;
  }

  async deliberate(focus: FateFocus): Promise<void> {
    if (!this.isReady()) return;
    const client = this.deps.getCapableClient()!;
    this.inFlight = true;
    try {
      const state = this.deps.getState();
      const { system, user, validPoiIds } = buildFateContext(state, focus);
      const res = await client.generateWithTools(
        [{ role: 'system', content: system }, { role: 'user', content: user }],
        FATE_TOOLS,
      );
      const { beats, commands } = parseFateToolCalls(res.toolCalls, {
        validPoiIds, now: state.clock.now(), validStoryletIds: this.deps.getValidStoryletIds?.(),
      });
      for (const b of beats) {
        const armed = state.staging.arm(b);
        if (b.threadId !== undefined) {
          const t = state.plotThreads.get(b.threadId);
          if (t) t.vars.staged = 1;            // cooperate with the stub's once-per-thread guard
        }
        this.deps.onArmed?.(armed);
      }
      for (const c of commands) this.deps.emitCommand(c);
    } catch (err) {
      console.warn('[fate] deliberation failed:', err);   // never swallow — log, arm nothing
    } finally {
      this.inFlight = false;
    }
  }
}
