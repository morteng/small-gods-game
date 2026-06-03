/**
 * Whisper orchestrator — ties the deterministic command floor to the soft LLM
 * narration for a single conversational whisper.
 *
 * `sendWhisper` emits exactly ONE `whisper` command (the executor applies the
 * deterministic belief/power floor on tick — the orchestrator never mutates
 * belief/power directly), appends a provisional transcript turn so the player
 * sees their whisper immediately, then calls the LLM for the NPC's reaction.
 * On success it fills the turn's dialogue and applies the clamped soft bonus +
 * mood delta; on LLM error or unusable response it marks the turn `degraded`
 * (the floor already moved belief, so the interaction still counts).
 */
import type { Entity } from '@/core/types';
import type { SpiritId } from '@/core/spirit';
import type { CommandQueue } from '@/sim/command/command-queue';
import type { LLMClient, LLMResponse } from '@/llm/llm-client';
import type { NpcAttentionStore } from '@/llm/npc-attention-store';
import { buildWhisperPrompt } from '@/llm/whisper-prompt-builder';
import { applyWhisperBonus } from '@/llm/state-writeback';

export interface WhisperOrchestratorDeps {
  queue: CommandQueue;
  llm: LLMClient;
  store: NpcAttentionStore;
  playerSpiritId: SpiritId;
  now(): number;
  onTurnAppended(npcId: string): void;
  onTurnUpdated(npcId: string): void;
}

const MOOD_DELTA_CLAMP = 0.2;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export async function sendWhisper(npc: Entity, text: string, deps: WhisperOrchestratorDeps): Promise<void> {
  const npcId = npc.id;

  // 1. Deterministic floor — exactly one command. The executor applies belief/power on tick.
  deps.queue.emit({
    verb: 'whisper',
    source: deps.playerSpiritId,
    target: { kind: 'npc', npcId },
    payload: { conversational: true, text },
  });

  // 2. Provisional turn (shown immediately). Capture prior turns for prompt continuity BEFORE appending.
  const recentBefore = deps.store.getTranscript(npcId).slice();
  deps.store.appendTurn(npcId, { whisper: text, dialogue: '', tick: deps.now() });
  deps.onTurnAppended(npcId);
  const turns = deps.store.getTranscript(npcId);
  const turn = turns[turns.length - 1];

  // 3. Soft narration.
  try {
    const prompt = buildWhisperPrompt({ npc, whisperText: text, recentTurns: recentBefore, playerSpiritId: deps.playerSpiritId });
    const res = await deps.llm.generateNpcBackfill(prompt.system, prompt.user);
    const parsed = parseReaction(res);
    if (!parsed || typeof parsed.dialogue !== 'string' || parsed.dialogue.length === 0) {
      turn.degraded = true;
      deps.onTurnUpdated(npcId);
      return;
    }
    turn.dialogue = parsed.dialogue;
    if (typeof parsed.belief_bonus === 'number') {
      turn.faithBonus = applyWhisperBonus(npc, parsed.belief_bonus, deps.playerSpiritId);
    }
    if (typeof parsed.mood_delta === 'number') {
      const props = npc.properties as unknown as { mood: number };
      props.mood = clamp(props.mood + clamp(parsed.mood_delta, -MOOD_DELTA_CLAMP, MOOD_DELTA_CLAMP), 0, 1);
    }
    deps.onTurnUpdated(npcId);
  } catch {
    turn.degraded = true;
    deps.onTurnUpdated(npcId);
  }
}

interface Reaction {
  dialogue?: string;
  mood_delta?: number;
  belief_bonus?: number;
}

/** Prefer the client's pre-parsed JSON; fall back to parsing/extracting from content. */
function parseReaction(res: Pick<LLMResponse, 'content' | 'parsed'>): Reaction | null {
  const src = res.parsed ?? safeJson(res.content);
  if (!src) return null;
  return src as Reaction;
}

function safeJson(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s);
  } catch {
    // Fall through to extract a JSON object substring (models sometimes wrap JSON in prose).
  }
  const m = s.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  return null;
}
