// The living whisper/conversation card (C1 re-presentable + C2 transcript +
// C4 free-text): presents the card for an NPC target and runs conversational
// whisper turns through `sendWhisper`, rebuilding the open card as each turn
// resolves. Non-NPC / textless choices fall back to the coordinator's one-shot
// emit seam — command dispatch itself never lives here.
import type { GameState } from '@/core/state';
import type { CommandQueue } from '@/sim/command/command-queue';
import type { CommandTarget } from '@/sim/command/types';
import type { UiSpec, UiSpecChoice } from '@/story/uispec';
import type { LLMClient } from '@/llm/llm-client';
import type { NpcAttentionStore } from '@/llm/npc-attention-store';
import { buildWhisperCard } from '@/game/affordance/whisper-card';
import { sendWhisper } from '@/game/whisper-orchestrator';
import { getNpc } from '@/world/npc-helpers';
import { PLAYER_SPIRIT_ID } from '@/sim/believers';
import { getUiRuntime } from '@/render/ui/ui-runtime';

export interface ConversationDeps {
  state: GameState;
  queue: CommandQueue;
  attentionStore: NpcAttentionStore;
  /** The LIVE client for conversation turns — the game passes capable-tier with
   *  chat-tier fallback (applyLlmConfig rebuilds them — read through, never captured). */
  llm: () => LLMClient;
  /** Fallback for a non-NPC / textless card choice: emit the pre-paired command
   *  (one-shot) with the coordinator's cast FX + HUD invalidation. */
  emitFallback: (choice: UiSpecChoice) => void;
  /** Belief/inbox shifted → drop the coordinator's HUD memo. */
  invalidateHudSim: () => void;
  requestRender: () => void;
}

export class ConversationController {
  /** The NPC the open conversation card addresses — the free-text island's target
   *  (the typed words carry no target of their own, unlike a canned path's command). */
  private npcId: string | null = null;

  constructor(private readonly deps: ConversationDeps) {}

  /** Build + present the whisper card for an NPC target; false if it can't (non-NPC,
   *  no world) so the caller falls back to a direct emit. */
  present(target: CommandTarget): boolean {
    const spec = this.buildSpec(target);
    if (!spec) return false;
    // keepOpen: the whisper card is a LIVING conversation (C1) — choosing a path
    // whispers and re-presents the card instead of dismissing, and the sim keeps
    // running so the whisper's belief floor lands on a tick while the card is up.
    this.npcId = target.kind === 'npc' ? target.npcId : null;
    getUiRuntime().presentUiSpec(spec, (choice) => this.onChoice(choice), { keepOpen: true });
    this.deps.requestRender();
    return true;
  }

  /** Free-text whisper from the conversation card's DOM island (C4). Routes the raw
   *  typed words to the addressed NPC through the SAME `sendWhisper` path a canned
   *  path uses (no slant — spec §7.4: raw text is enough). No-op if the card has
   *  closed or its target is gone. */
  sendFreeText(text: string): void {
    const npcId = this.npcId;
    if (!npcId || !getUiRuntime().hasCard()) return;
    this.whisperTo(npcId, text);
  }

  /** Build the whisper/conversation card spec for an NPC target's current situation,
   *  or null if the target isn't a resolvable NPC. Deterministic (`buildWhisperCard`);
   *  re-run each turn so the belief bars + paths reflect the latest state. */
  private buildSpec(target: CommandTarget): UiSpec | null {
    const { state } = this.deps;
    const world = state.world;
    if (!world || target.kind !== 'npc') return null;
    const ctx = { world, spirits: state.spirits, log: state.eventLog };
    const transcript = this.deps.attentionStore.getTranscript(target.npcId);
    return buildWhisperCard(target, PLAYER_SPIRIT_ID, ctx, transcript);
  }

  /** Rebuild the open conversation card from the latest situation + transcript. No-op
   *  if the player has closed the card. Used both for the provisional (pending) turn
   *  and the resolved reply. */
  private refreshCard(npcId: string): void {
    const rt = getUiRuntime();
    if (!rt.hasCard()) return;
    const spec = this.buildSpec({ kind: 'npc', npcId });
    if (spec) rt.updateOpenCard(spec);
    this.deps.requestRender();
  }

  /** A whisper-card choice. For an NPC target carrying whispered words, run the full
   *  conversational whisper (`sendWhisper`: deterministic floor + LLM reply + transcript)
   *  and, when it resolves, rebuild the card from the fresh situation/belief so the
   *  exchange stays live. Non-NPC / textless choices fall back to a one-shot emit. */
  private onChoice(choice: UiSpecChoice): void {
    const cmd = choice.command;
    const text = typeof cmd.payload?.text === 'string' ? cmd.payload.text : '';
    if (cmd.target.kind === 'npc' && text && this.whisperTo(cmd.target.npcId, text)) return;
    this.deps.emitFallback(choice);
  }

  /** Run one conversational whisper turn to `npcId`: the deterministic floor + LLM
   *  reply + transcript (`sendWhisper`), rebuilding the open card from the fresh
   *  situation both immediately (the provisional "…" turn) and on resolution (the
   *  NPC's words + moved bars). Returns false if the NPC can't be resolved. */
  private whisperTo(npcId: string, text: string): boolean {
    const { state } = this.deps;
    const world = state.world;
    const npc = world ? getNpc(world, npcId) : null;
    if (!npc) return false;
    void sendWhisper(npc, text, {
      queue: this.deps.queue,
      llm: this.deps.llm(),
      store: this.deps.attentionStore,
      playerSpiritId: PLAYER_SPIRIT_ID,
      now: () => state.clock.now(),
    }).then(() => {
      // Reply landed (or degraded): rebuild so the NPC's words + the moved bars show.
      this.deps.invalidateHudSim();
      this.refreshCard(npcId);
    });
    // sendWhisper appends the provisional turn synchronously (before its first
    // await), so the pending "…" turn is already in the transcript — show it now.
    this.deps.invalidateHudSim();
    this.refreshCard(npcId);
    return true;
  }
}
