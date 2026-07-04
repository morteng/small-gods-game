import type { Entity, SettlementEventType } from '@/core/types';
import type { GameState } from '@/core/state';
import type { World } from '@/world/world';
import { npcProps, getRecentEventDescriptions } from '@/world/npc-helpers';
import { buildNpcPrompt, type NpcPromptContext } from '@/llm/npc-prompt-builder';
import { applyLLMWriteback, type LLMResponse } from '@/llm/state-writeback';
import { LLMClient, MockLLMProvider } from '@/llm/llm-client';
import type { LlmDisplayHandle } from '@/ui/llm-display';
import { selectMemoriesForPrompt, recordMemory, distillInteraction, computeSalience } from '@/llm/interaction-memory';

export function parseLLMJson(content: string): LLMResponse {
  try { return JSON.parse(content); } catch { return { narration: content }; }
}

export function getNearbyNpcNames(world: World, npc: Entity, radius: number): string[] {
  const nearby = world.query({
    region: { x: Math.floor(npc.x) - radius, y: Math.floor(npc.y) - radius, w: radius * 2 + 1, h: radius * 2 + 1 },
    kind: 'npc',
  });
  return nearby.filter(e => e.id !== npc.id).map(e => npcProps(e).name);
}

export function getActiveEventsForPoi(world: World, poiId?: string): SettlementEventType[] {
  if (!poiId) return [];
  const events = world.activeEvents.get(poiId);
  return events?.map(e => e.type) ?? [];
}

export interface LlmBackfillDeps {
  state: GameState;
  llmDisplay: LlmDisplayHandle;
  client?: LLMClient;            // defaults to new LLMClient(new MockLLMProvider(100))
  onWriteback?: () => void;      // called after writeback so caller can refresh UI
}

export class LlmBackfillService {
  private client: LLMClient;

  constructor(private deps: LlmBackfillDeps) {
    this.client = deps.client ?? new LLMClient(new MockLLMProvider(100));
  }

  setClient(client: LLMClient): void {
    this.client = client;
  }

  async trigger(npcEntity: Entity): Promise<void> {
    const { state, llmDisplay } = this.deps;
    if (!state.world) return;
    const props = npcProps(npcEntity);
    const player = state.spirits.get('player');
    if (!player) return;

    const context: NpcPromptContext = {
      npc: npcEntity,
      world: state.world,
      recentEvents: getRecentEventDescriptions(props, state.eventLog, undefined, npcEntity.id),
      previousInteractions: selectMemoriesForPrompt(props.memories ?? [], 6),
      nearbyNpcNames: getNearbyNpcNames(state.world, npcEntity, 3),
      activeEvents: getActiveEventsForPoi(state.world, props.homePoiId),
      playerSpiritId: 'player',
    };

    const prompt = buildNpcPrompt(context);
    try {
      const response = await this.client.generateNpcBackfill(prompt.system, prompt.user, { maxTokens: 200, temperature: 0.7, cache: { ttlSeconds: 300 } });
      const parsed = parseLLMJson(response.content);
      const writeback = applyLLMWriteback(npcEntity, parsed, 'player', state.eventLog);
      recordMemory(props, {
        tick: state.clock.now(),
        kind: 'backfill',
        summary: distillInteraction(props.name, parsed, player.name),
        salience: computeSalience('backfill', parsed.belief_delta, parsed.mood_delta),
      });
      if (writeback.narration && writeback.dialogue) llmDisplay.showBoth(props.name, writeback.dialogue, writeback.narration);
      else if (writeback.dialogue) llmDisplay.showDialogue(props.name, writeback.dialogue);
      else if (writeback.narration) llmDisplay.showNarration(writeback.narration);
      this.deps.onWriteback?.();
    } catch (err) {
      console.error('[LLM] Backfill failed:', err);
    }
  }
}
