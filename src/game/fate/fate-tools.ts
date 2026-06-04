/**
 * fate-tools.ts — the LLM seam for the Fate brain.
 *
 * ONE constrained tool (`arm_staged_beat`). The brain can only stage into a
 * settlement that is already part of an active thread (validated against
 * `validPoiIds` — a drift guard, mirroring the Create panel) so Fate amplifies
 * existing conditions and never invents. A staged beat's hard payload is the
 * `inject_npc` command (latent until discovery); the soft payload is a vibe line.
 * This replaces the deterministic `stageStrangerOnHardship` stub as the producer.
 */
import type { LLMTool, LLMToolCall } from '@/llm/llm-client';
import type { Command } from '@/sim/command/types';
import type { StagedBeat } from '@/sim/threads/staging-types';

export const FATE_ROLES = ['preacher', 'skeptic', 'refugee'] as const;

export const FATE_TOOLS: LLMTool[] = [
  {
    name: 'arm_staged_beat',
    description:
      'Prepare a beat to be discovered at a settlement that is already part of an unfolding thread. ' +
      'The content stays hidden until the player notices that settlement. Stage at most one.',
    parameters: {
      type: 'object',
      properties: {
        subjectPoiId: { type: 'string', description: 'A settlement id from the listed active threads. Required.' },
        threadId: { type: 'integer', description: 'The thread id this beat belongs to (from the list).' },
        hard: {
          type: 'string', enum: ['inject_npc', 'none'],
          description: "'inject_npc' = a stranger arrives; 'none' = atmosphere only.",
        },
        role: {
          type: 'string', enum: [...FATE_ROLES],   // single source of truth for the archetype vocabulary
          description: 'If hard=inject_npc, who arrives.',
        },
        soft: { type: 'string', description: 'One line of atmosphere/narration primed on discovery.' },
      },
      required: ['subjectPoiId', 'hard'],
    },
  },
];

export interface FateToolCtx {
  validPoiIds: Set<string>;
  now: number;
}

/** Validate the model's tool calls into armable beats; drop anything ungrounded. */
export function parseFateToolCalls(
  calls: LLMToolCall[] | undefined,
  ctx: FateToolCtx,
): Array<Omit<StagedBeat, 'id' | 'status'>> {
  const beats: Array<Omit<StagedBeat, 'id' | 'status'>> = [];
  for (const c of calls ?? []) {
    if (c.name !== 'arm_staged_beat') continue;
    const a = c.arguments as {
      subjectPoiId?: unknown; threadId?: unknown; hard?: unknown; role?: unknown; soft?: unknown;
    };
    const poiId = typeof a.subjectPoiId === 'string' ? a.subjectPoiId : '';
    if (!ctx.validPoiIds.has(poiId)) {
      console.warn('[fate] dropped beat: unknown subjectPoiId', poiId);
      continue;
    }
    const hard: Command[] = [];
    if (a.hard === 'inject_npc') {
      const role = typeof a.role === 'string' && (FATE_ROLES as readonly string[]).includes(a.role) ? a.role : 'refugee';
      hard.push({ verb: 'inject_npc', source: 'fate', target: { kind: 'settlement', poiId }, payload: { role }, seq: 0 });
    }
    const beat: Omit<StagedBeat, 'id' | 'status'> = {
      subject: { kind: 'settlement', poiId },
      trigger: { kind: 'discovery' },
      hard,
      stagedTick: ctx.now,
    };
    if (typeof a.threadId === 'number') beat.threadId = a.threadId;
    if (typeof a.soft === 'string' && a.soft.trim()) beat.soft = { kind: 'location_vibe', text: a.soft.trim() };
    beats.push(beat);
  }
  return beats;
}
