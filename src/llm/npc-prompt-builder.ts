/**
 * NPC Prompt Builder — constructs the ~500 token LLM prompt from NPC sim state.
 *
 * This is the bridge between the programmatic simulation layer and the LLM
 * narration layer. Given an NPC's compact state, it produces a structured
 * prompt that lets the LLM generate rich, consistent dialogue and scene
 * descriptions.
 *
 * Prompt structure (~500 tokens):
 *   - System prompt (shared, ~100 tokens)
 *   - NPC card: personality, role, beliefs, needs, mood (~150 tokens)
 *   - Recent events from ring buffer (~100 tokens)
 *   - Previous interaction summaries (~100 tokens)
 *   - Current context: activity, location, nearby NPCs (~50 tokens)
 */

import type { Entity, NpcProperties, NpcActivity, SettlementEventType } from '@/core/types';
import { npcProps } from '@/world/npc-helpers';
import type { World } from '@/world/world';
import type { SpiritId } from '@/core/spirit';

// ─── NPC Prompt Context ──────────────────────────────────────

export interface NpcPromptContext {
  npc: Entity;
  world: World;
  recentEvents: string[];
  previousInteractions: string[];
  nearbyNpcNames: string[];
  activeEvents: SettlementEventType[];
  playerSpiritId: SpiritId;
}

// ─── System Prompt (shared across all NPC backfill calls) ───────────────────

const SYSTEM_PROMPT = `You are the narrative voice for NPCs in "Small Gods", a god game inspired by Terry Pratchett's work.

WORLD RULES:
- Gods gain power from genuine belief, not fear or habit
- NPCs have rich inner lives, doubts, and memories
- The supernatural is real but subtle — miracles leave questions
- Tone: Pratchett-esque (serious themes, wry observations, dry humor)

STYLE GUIDELINES:
- Be concise (2-4 sentences for dialogue, 1-3 for narration)
- Show personality through word choice, not exposition
- Embrace ambiguity — not everything has clear meaning
- Allow for skepticism and doubt in believers
- Use grounded language — avoid purple prose

OUTPUT FORMAT:
Respond with a JSON object:
{
  "narration": "Optional scene description",
  "dialogue": "Optional NPC speech",
  "inner_thought": "Optional internal monologue",
  "belief_delta": { "faith": 0.1, "understanding": 0.05, "devotion": 0.02 },
  "mood_delta": 0.1,
  "new_events": ["Event description for event log"]
}

Keep belief_delta small (-0.3 to +0.3) and mood_delta subtle (-0.2 to +0.2).
Focus on one or two meaningful changes, not sweeping transformations.`;

// ─── Main Builder Function ─────────────────────────────────────────

export interface BuiltPrompt {
  system: string;
  user: string;
  estimatedTokens: number;
}

/**
 * Build the full LLM prompt for an NPC backfill interaction.
 */
export function buildNpcPrompt(ctx: NpcPromptContext): BuiltPrompt {
  const props = npcProps(ctx.npc);
  const simState = buildSimStateSummary(props);
  const eventsText = buildEventsSection(ctx.recentEvents);
  const interactionsText = buildInteractionsSection(ctx.previousInteractions);
  const contextText = buildContextSection(ctx.npc, ctx.nearbyNpcNames, ctx.activeEvents, ctx.world);

  const user = [
    `=== NPC CARD ===`,
    formatNpcCard(props),
    ``,
    `=== CURRENT SIM STATE ===`,
    simState,
    ``,
    eventsText,
    ``,
    interactionsText,
    ``,
    contextText,
    ``,
    `Generate a response as this NPC. Reflect their personality, current mood (${simState.includes('mood') ? 'shown above' : '0.5'}), and recent experiences.`,
  ].join('\n');

  // Rough token estimate: ~4 chars per token for English
  const estimatedTokens = Math.ceil((SYSTEM_PROMPT.length + user.length) / 4);

  return { system: SYSTEM_PROMPT, user, estimatedTokens };
}

// ─── NPC Card Formatter ─────────────────────────────────────────

function formatNpcCard(props: NpcProperties): string {
  const lines = [
    `Name: ${props.name}`,
    `Role: ${props.role}`,
    `Personality: assertiveness=${(props.personality.assertiveness).toFixed(2)}, skepticism=${(props.personality.skepticism).toFixed(2)}, piety=${(props.personality.piety).toFixed(2)}, sociability=${(props.personality.sociability).toFixed(2)}`,
    `Beliefs about player: faith=${(props.beliefs['player']?.faith ?? 0).toFixed(2)}, understanding=${(props.beliefs['player']?.understanding ?? 0).toFixed(2)}, devotion=${(props.beliefs['player']?.devotion ?? 0).toFixed(2)}`,
    `Needs: safety=${(props.needs.safety).toFixed(2)}, prosperity=${(props.needs.prosperity).toFixed(2)}, community=${(props.needs.community).toFixed(2)}, meaning=${(props.needs.meaning).toFixed(2)}`,
    `Mood: ${props.mood.toFixed(2)}`,
    `Activity: ${props.activity}`,
  ];

  if (props.homePoiId) {
    lines.push(`Home: ${props.homePoiId}`);
  }

  return lines.join('\n');
}

// ─── Sim State Summary ────────────────────────────────────────

function buildSimStateSummary(props: NpcProperties): string {
  const lines = [
    `Mood: ${props.mood.toFixed(2)} (${(props.mood > 0.6 ? 'content' : props.mood > 0.4 ? 'neutral' : 'troubled')})`,
    `Activity: ${props.activity}`,
    `Whisper cooldown: ${props.whisperCooldown} ticks`,
  ];
  return lines.join('\n');
}

// ─── Events Section ───────────────────────────────────────────

function buildEventsSection(recentEvents: string[]): string {
  if (recentEvents.length === 0) {
    return `=== RECENT EVENTS ===\nNone recently.`;
  }
  const lines = recentEvents.map((e, i) => `${i + 1}. ${e}`);
  return `=== RECENT EVENTS ===\n${lines.join('\n')}`;
}

// ─── Previous Interactions ─────────────────────────────────────

function buildInteractionsSection(previous: string[]): string {
  if (previous.length === 0) {
    return `=== PREVIOUS INTERACTIONS ===\nNo previous interactions with the player.`;
  }
  const lines = previous.map((p, i) => `${i + 1}. ${p}`);
  return `=== PREVIOUS INTERACTIONS ===\n${lines.join('\n')}`;
}

// ─── Context Section ──────────────────────────────────────────

function buildContextSection(
  npc: Entity,
  nearbyNpcNames: string[],
  activeEvents: SettlementEventType[],
  _world: World,
): string {
  const lines = [
    `Location: (${Math.floor(npc.x)}, ${Math.floor(npc.y)})`,
    `Nearby NPCs: ${nearbyNpcNames.length > 0 ? nearbyNpcNames.join(', ') : 'none'}`,
  ];

  if (activeEvents.length > 0) {
    lines.push(`Active settlement events: ${activeEvents.join(', ')}`);
  }

  return `=== CURRENT CONTEXT ===\n${lines.join('\n')}`;
}

// ─── Interaction Summary ──────────────────────────────────────

/**
 * Create a short text summary of an LLM interaction for future context.
 */
export function createInteractionSummary(
  npcName: string,
  response: { belief_delta?: { faith?: number; understanding?: number; devotion?: number }; mood_delta?: number; dialogue?: string },
  playerName: string,
): string {
  const parts: string[] = [];

  parts.push(`${npcName} interacted with ${playerName}.`);

  if (response.dialogue) {
    const preview = response.dialogue.length > 50 ? response.dialogue.slice(0, 47) + '...' : response.dialogue;
    parts.push(`${npcName} said: "${preview}"`);
  }

  if (response.belief_delta) {
    const deltaParts: string[] = [];
    if (response.belief_delta.faith) deltaParts.push(`faith${response.belief_delta.faith > 0 ? '+' : ''}${response.belief_delta.faith.toFixed(2)}`);
    if (response.belief_delta.understanding) deltaParts.push(`understanding${response.belief_delta.understanding > 0 ? '+' : ''}${response.belief_delta.understanding.toFixed(2)}`);
    if (response.belief_delta.devotion) deltaParts.push(`devotion${response.belief_delta.devotion > 0 ? '+' : ''}${response.belief_delta.devotion.toFixed(2)}`);
    if (deltaParts.length > 0) {
      parts.push(`Belief changed: ${deltaParts.join(', ')}`);
    }
  }

  if (response.mood_delta) {
    const direction = response.mood_delta > 0 ? 'improved' : 'worsened';
    parts.push(`Mood ${direction} by ${Math.abs(response.mood_delta).toFixed(2)}`);
  }

  return parts.join(' ');
}
