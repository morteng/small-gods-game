/**
 * fate-tools.ts — the LLM seam for the Fate brain.
 *
 * THREE constrained tools. `arm_staged_beat` prepares latent content discovered
 * later; `nudge_event_severity` and `force_next_event` are IMMEDIATE levers over a
 * settlement's current/next event. Every tool can only target a settlement that is
 * already part of an active thread (validated against `validPoiIds` — a drift
 * guard, mirroring the Create panel) so Fate amplifies existing conditions and
 * never invents. `parseFateToolCalls` returns both staged beats (armed on
 * discovery) and immediate commands (emitted now onto the command channel).
 */
import type { LLMTool, LLMToolCall } from '@/llm/llm-client';
import type { Command } from '@/sim/command/types';
import type { StagedBeat } from '@/sim/threads/staging-types';
import type { SettlementEventType } from '@/core/types';

export const FATE_ROLES = ['preacher', 'skeptic', 'refugee'] as const;

export const FATE_EVENT_TYPES: readonly SettlementEventType[] = [
  'drought', 'festival', 'dispute', 'plague', 'raiders', 'trading_caravan', 'stranger_arrives', 'harvest_blessing',
];
const MAX_NUDGE = 0.5;
/** Music cues Fate may attach to a beat — grounded to the base swell vocabulary
 *  (presentation/cues) so a beat can only reference a cue that actually exists. */
export const FATE_MUSIC_CUES = ['swell_miracle', 'dirge_death', 'fanfare_settlement'] as const;

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
        musicCue: {
          type: 'string', enum: [...FATE_MUSIC_CUES],
          description: 'Optional: a short musical cue to swell when this beat is discovered.',
        },
        storylet: {
          type: 'string',
          description:
            'Optional: id of a loaded storylet to open as an interactive card on discovery ' +
            '(from the storylets listed in context). Dropped silently if unrecognized.',
        },
      },
      required: ['subjectPoiId', 'hard'],
    },
  },
  {
    name: 'nudge_event_severity',
    description:
      "Raise (positive delta) or lower (negative delta) the intensity of a settlement's CURRENT event. " +
      'Only for a settlement listed with an active event. Applies immediately.',
    parameters: {
      type: 'object',
      properties: {
        subjectPoiId: { type: 'string', description: 'A settlement id from the listed active threads.' },
        delta: { type: 'number', description: 'Severity change, -0.5…0.5. Positive worsens, negative eases.' },
      },
      required: ['subjectPoiId', 'delta'],
    },
  },
  {
    name: 'force_next_event',
    description:
      'Steer what befalls a settlement NEXT: the next event rolled there will be the chosen type, ' +
      'from the existing vocabulary. Applies immediately (latent until the next roll).',
    parameters: {
      type: 'object',
      properties: {
        subjectPoiId: { type: 'string', description: 'A settlement id from the listed active threads.' },
        eventType: { type: 'string', enum: [...FATE_EVENT_TYPES], description: 'Which event to bring next.' },
      },
      required: ['subjectPoiId', 'eventType'],
    },
  },
];

export interface FateToolCtx {
  validPoiIds: Set<string>;
  now: number;
  /** Drift guard for `arm_staged_beat`'s optional `storylet` ref — the loaded
   *  pack(s)' storylet ids. Omit (or empty) to disable storylet arming entirely. */
  validStoryletIds?: Set<string>;
}

export interface ParsedFateActions {
  beats: Array<Omit<StagedBeat, 'id' | 'status'>>;
  commands: Array<Omit<Command, 'seq'>>;
}

/** Validate the model's tool calls into armable beats + immediate commands; drop anything ungrounded. */
export function parseFateToolCalls(
  calls: LLMToolCall[] | undefined,
  ctx: FateToolCtx,
): ParsedFateActions {
  const beats: ParsedFateActions['beats'] = [];
  const commands: ParsedFateActions['commands'] = [];
  for (const c of calls ?? []) {
    if (c.name === 'arm_staged_beat') {
      const beat = parseArmBeat(c, ctx);
      if (beat) beats.push(beat);
    } else if (c.name === 'nudge_event_severity') {
      const cmd = parseNudge(c, ctx);
      if (cmd) commands.push(cmd);
    } else if (c.name === 'force_next_event') {
      const cmd = parseForceEvent(c, ctx);
      if (cmd) commands.push(cmd);
    }
  }
  return { beats, commands };
}

/** W-I: causal-site ids are poiId-compatible but name an ephemeral place, not a
 *  settlement — so they only accept SOFT staged beats, never settlement-event verbs. */
function isSiteId(id: string): boolean { return id.startsWith('causal:'); }

function parseArmBeat(c: LLMToolCall, ctx: FateToolCtx): Omit<StagedBeat, 'id' | 'status'> | null {
  const a = c.arguments as {
    subjectPoiId?: unknown; threadId?: unknown; hard?: unknown; role?: unknown; soft?: unknown; musicCue?: unknown;
    storylet?: unknown;
  };
  const poiId = typeof a.subjectPoiId === 'string' ? a.subjectPoiId : '';
  if (!ctx.validPoiIds.has(poiId)) { console.warn('[fate] dropped beat: unknown subjectPoiId', poiId); return null; }
  const onSite = isSiteId(poiId);
  const hard: Command[] = [];
  // A transient causal site has no settlement structure to inject a stranger INTO, so
  // its beats are atmosphere-only (the spec's "soft, discovered if anyone returns here").
  if (a.hard === 'inject_npc' && !onSite) {
    const role = typeof a.role === 'string' && (FATE_ROLES as readonly string[]).includes(a.role) ? a.role : 'refugee';
    hard.push({ verb: 'inject_npc', source: 'fate', target: { kind: 'settlement', poiId }, payload: { role }, seq: 0 });
  }
  const beat: Omit<StagedBeat, 'id' | 'status'> = {
    subject: onSite ? { kind: 'site', siteId: poiId } : { kind: 'settlement', poiId },
    trigger: { kind: 'discovery' },
    hard,
    stagedTick: ctx.now,
  };
  if (typeof a.threadId === 'number') beat.threadId = a.threadId;
  if (typeof a.soft === 'string' && a.soft.trim()) beat.soft = { kind: 'location_vibe', text: a.soft.trim() };
  if (typeof a.musicCue === 'string' && (FATE_MUSIC_CUES as readonly string[]).includes(a.musicCue)) beat.musicCue = a.musicCue;
  // Drift guard: a hallucinated/stale storylet id is dropped (logged), the beat still arms.
  if (typeof a.storylet === 'string' && a.storylet.trim()) {
    if (ctx.validStoryletIds?.has(a.storylet)) beat.storylet = a.storylet;
    else console.warn('[fate] dropped storylet ref: unknown storylet id', a.storylet);
  }
  return beat;
}

function parseNudge(c: LLMToolCall, ctx: FateToolCtx): Omit<Command, 'seq'> | null {
  const a = c.arguments as { subjectPoiId?: unknown; delta?: unknown };
  const poiId = typeof a.subjectPoiId === 'string' ? a.subjectPoiId : '';
  if (!ctx.validPoiIds.has(poiId)) { console.warn('[fate] dropped nudge: unknown subjectPoiId', poiId); return null; }
  if (isSiteId(poiId)) { console.warn('[fate] dropped nudge: causal sites have no settlement event', poiId); return null; }
  if (typeof a.delta !== 'number' || !Number.isFinite(a.delta)) { console.warn('[fate] dropped nudge: bad delta', a.delta); return null; }
  const delta = Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, a.delta));
  return { verb: 'nudge_severity', source: 'fate', target: { kind: 'settlement', poiId }, payload: { delta } };
}

function parseForceEvent(c: LLMToolCall, ctx: FateToolCtx): Omit<Command, 'seq'> | null {
  const a = c.arguments as { subjectPoiId?: unknown; eventType?: unknown };
  const poiId = typeof a.subjectPoiId === 'string' ? a.subjectPoiId : '';
  if (!ctx.validPoiIds.has(poiId)) { console.warn('[fate] dropped force_next_event: unknown subjectPoiId', poiId); return null; }
  if (isSiteId(poiId)) { console.warn('[fate] dropped force_next_event: causal sites have no settlement event', poiId); return null; }
  if (typeof a.eventType !== 'string' || !(FATE_EVENT_TYPES as readonly string[]).includes(a.eventType)) {
    console.warn('[fate] dropped force_next_event: bad eventType', a.eventType); return null;
  }
  return { verb: 'bias_event', source: 'fate', target: { kind: 'settlement', poiId }, payload: { eventType: a.eventType } };
}
