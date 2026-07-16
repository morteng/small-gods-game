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
import type { LLMClient, LLMMessage } from '@/llm/llm-client';
import type { Command } from '@/sim/command/types';
import type { StagedBeat } from '@/sim/threads/staging-types';
import type { FateArcStore } from '@/sim/fate/arc-store';
import { getArcShape, isShapeSeedable, openArcFromShape } from '@/sim/fate/arc-library';
import { queryNpcs } from '@/world/npc-helpers';
import { buildFateContext, type FateFocus } from './fate-context';
import {
  FATE_TOOLS, parseFateToolCalls, authoringRetryPrompt, AUTHOR_BUILDING_TOOL,
  portentGateRetryPrompt, PORTENT_RETRY_TOOLS,
  type FateToolCtx, type ArcToolMeta, type ArcPortentRequest,
} from './fate-tools';

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
      // F3: recompute arc-goal truth BEFORE the prompt is built, so both the arcs
      // digest and the seedWhen gate see fresh state (met is never trusted stale).
      const arcStore = state.fateArcs ?? null;
      arcStore?.recomputeGoals(state);
      const { system, user, validPoiIds, validRivalIds, validLordPoiIds } = buildFateContext(state, focus);
      const messages: LLMMessage[] = [{ role: 'system', content: system }, { role: 'user', content: user }];
      const buildToolCtx = (): FateToolCtx => ({
        validPoiIds, validRivalIds, validLordPoiIds, now: state.clock.now(),
        validStoryletIds: this.deps.getValidStoryletIds?.(),
        // Without an arc store (legacy/partial states) the arc tools stay disabled —
        // parse drops every seed_arc/abandon_arc/plant_portent, logged (safe default).
        arcs: arcStore ? {
          liveArcIds: new Set(arcStore.live().map((a) => a.id)),
          liveArcCount: arcStore.live().length,
          isShapeSeedable: (key) => isShapeSeedable(key, state),
          validNpcIds: state.world ? new Set(queryNpcs(state.world).map((e) => e.id)) : undefined,
          // F4: what the portent tools validate against — rebuilt per turn so the
          // gate sees ledger growth from portents applied earlier this deliberation.
          arcMeta: new Map<number, ArcToolMeta>(arcStore.live().map((a) => [a.id, {
            shape: a.shape, castPoiIds: [...a.cast.poiIds], portentCount: a.portents.length,
          }])),
        } : undefined,
      });
      const toolCtx = buildToolCtx();
      const res = await client.generateWithTools(messages, FATE_TOOLS);
      const { beats, commands, authoringRejections, arcSeeds, arcAbandons, arcPortents, portentRejections } =
        parseFateToolCalls(res.toolCalls, toolCtx);
      this.armBeats(state, beats);
      for (const c of commands) this.deps.emitCommand(c);

      // F3: apply validated arc operations to the snapshot-backed store. Goals and
      // budget come from the LIBRARY at apply time — the model bound only the cast.
      if (arcStore) {
        for (const s of arcSeeds) {
          const shape = getArcShape(s.shape);
          if (!shape) continue;                  // cannot happen post-parse; belt-and-braces
          const arc = openArcFromShape(arcStore, shape, s.cast, state.clock.now());
          console.info(`[fate] seeded arc ${arc.id} "${shape.key}"`);
        }
        for (const ab of arcAbandons) {
          if (arcStore.abandon(ab.arcId, ab.reason)) {
            console.info(`[fate] abandoned arc ${ab.arcId} — ${ab.reason}`);
          }
        }
        // F4: materialize validated portents — a soft staged beat + a ledger entry
        // (linked by beatId) + the portent_planted tiding event.
        this.applyPortents(state, arcStore, arcPortents);
        if (arcSeeds.length || arcAbandons.length) arcStore.recomputeGoals(state);
      }

      // F4 self-correction: a heavy beat rejected by the portents-first gate gets ONE
      // bounded retry carrying the rejection text, scoped to plant_portent +
      // arm_staged_beat — the model foreshadows first, then re-arms (same-response
      // omens count). Skipped when a beat already armed this turn (stage at most one).
      if (arcStore && beats.length === 0 && portentRejections.length > 0) {
        const retryMessages: LLMMessage[] = [
          ...messages,
          { role: 'assistant', content: res.content || '(attempted a heavy beat)' },
          { role: 'user', content: portentGateRetryPrompt(portentRejections) },
        ];
        const retry = await client.generateWithTools(retryMessages, PORTENT_RETRY_TOOLS);
        // Fresh ctx: ledger counts include any portents applied in the main pass.
        const corrected = parseFateToolCalls(retry.toolCalls, buildToolCtx());
        this.applyPortents(state, arcStore, corrected.arcPortents);
        this.armBeats(state, corrected.beats);
        if (corrected.beats.length) console.info('[fate] heavy beat passed the portent gate on self-correction retry');
      }

      // Self-correction: if a building failed the structural gate AND we didn't already place
      // one this deliberation (Fate raises at most one), run ONE bounded retry that feeds the
      // lints back. Scoped to the authoring tool so the follow-up can't duplicate other actions.
      const placedBuilding = commands.some((c) => c.verb === 'place_building');
      if (!placedBuilding && authoringRejections.length > 0) {
        const retryMessages: LLMMessage[] = [
          ...messages,
          { role: 'assistant', content: res.content || '(attempted author_building)' },
          { role: 'user', content: authoringRetryPrompt(authoringRejections) },
        ];
        const retry = await client.generateWithTools(retryMessages, [AUTHOR_BUILDING_TOOL]);
        const corrected = parseFateToolCalls(retry.toolCalls, toolCtx);
        for (const c of corrected.commands) this.deps.emitCommand(c);
        if (corrected.commands.length) console.info('[fate] author_building passed the gate on self-correction retry');
      }
    } catch (err) {
      console.warn('[fate] deliberation failed:', err);   // never swallow — log, arm nothing
    } finally {
      this.inFlight = false;
    }
  }

  /** Arm validated beats onto the snapshot-backed StagingBuffer (main pass + retries). */
  private armBeats(state: GameState, beats: Array<Omit<StagedBeat, 'id' | 'status'>>): void {
    for (const b of beats) {
      const armed = state.staging.arm(b);
      if (b.threadId !== undefined) {
        const t = state.plotThreads.get(b.threadId);
        if (t) t.vars.staged = 1;            // cooperate with the stub's once-per-thread guard
      }
      this.deps.onArmed?.(armed);
    }
  }

  /**
   * F4: materialize validated plant_portent calls. Each becomes (1) a SOFT staged
   * beat at the named settlement — the omen the player can discover; (2) a ledger
   * entry on the arc, linked by beatId so the activation system can flip it to
   * discovered; (3) a `portent_planted` event — the inbox tiding + the chronicler's
   * line. `plantPortent` refuses a no-longer-live arc, in which case nothing arms.
   */
  private applyPortents(state: GameState, arcStore: FateArcStore, portents: ArcPortentRequest[]): void {
    for (const p of portents) {
      const now = state.clock.now();
      const armed = state.staging.arm({
        subject: { kind: 'settlement', poiId: p.subjectPoiId },
        trigger: { kind: 'discovery' },
        hard: [],
        soft: { kind: 'location_vibe', text: p.text },
        arcId: p.arcId,
        stagedTick: now,
      });
      if (!arcStore.plantPortent(p.arcId, {
        tick: now, kind: p.kind, discovered: false, text: p.text, beatId: armed.id,
      })) {
        // The arc folded between parse and apply — un-arm the orphaned omen.
        state.staging.markExpired(armed.id);
        console.warn('[fate] plant_portent raced an arc fold — omen expired', p.arcId);
        continue;
      }
      state.eventLog?.append({
        type: 'portent_planted', arcId: p.arcId, kind: p.kind, poiId: p.subjectPoiId, beatId: armed.id,
      });
      this.deps.onArmed?.(armed);
      console.info(`[fate] portent (${p.kind}) planted on arc ${p.arcId} at ${p.subjectPoiId}`);
    }
  }
}
