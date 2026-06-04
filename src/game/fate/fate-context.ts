/**
 * fate-context.ts — builds the Fate brain's prompt.
 *
 * Reuses buildWorldSummary for the world digest and adds a digest of ACTIVE
 * settlement threads + the triggering event. The enumerated settlement poiIds are
 * the only valid `subjectPoiId` values (the tool validator enforces this) — so the
 * brain can only stage into a story the sim already produced.
 */
import type { GameState } from '@/core/state';
import type { SimEvent } from '@/core/events';
import type { ThreadId } from '@/sim/threads/thread-types';
import { buildWorldSummary } from '@/llm/world-summary';

export interface FateFocus {
  event: SimEvent;
  threadId?: ThreadId;
}

const SYSTEM_CHARTER =
  'You are Fate — impersonal and reactive. You amplify, escalate, or let fade what the mortals\' story ' +
  'already produces; you never invent arbitrary plot. You may PREPARE content to be discovered later ' +
  '(arm_staged_beat) OR act on a settlement\'s ongoing troubles now: nudge_event_severity changes the ' +
  'intensity of its current event, force_next_event steers what befalls it next. Only ever use a ' +
  'subjectPoiId listed in the active threads. Act sparingly — often the right choice is to call no tool.';

/** A compact, deterministic digest of active settlement threads + their poiIds. */
export function describeThreadsForFate(state: GameState): { text: string; poiIds: Set<string> } {
  const poiIds = new Set<string>();
  const poiName = new Map<string, string>();
  for (const p of state.worldSeed?.pois ?? []) poiName.set(p.id, p.name ?? p.id);

  const lines: string[] = [];
  for (const t of state.plotThreads.active()) {
    if (t.subject.kind !== 'settlement') continue;       // only settlement subjects are stageable in v1
    const poiId = t.subject.poiId;
    poiIds.add(poiId);
    const name = poiName.get(poiId) ?? poiId;
    const events = state.world?.activeEvents.get(poiId);
    const evText = events && events.length
      ? `active event: ${events[0].type} (severity ${events[0].severity})`
      : 'no active event';
    lines.push(`- thread ${t.id}: ${t.shapeId} at "${name}" (${poiId}), phase ${t.phase}; ${evText}`);
  }
  const text = lines.length ? `Active threads:\n${lines.join('\n')}` : 'Active threads: none.';
  return { text, poiIds };
}

function describeEvent(ev: SimEvent): string {
  switch (ev.type) {
    case 'thread_opened': return `A new ${ev.shapeId} thread (${ev.threadId}) just opened.`;
    case 'thread_advanced': return `Thread ${ev.threadId} reached a ${ev.weight} beat (phase ${ev.phase}).`;
    case 'thread_resolved': return `Thread ${ev.threadId} ${ev.status}.`;
    default: return `Event: ${ev.type}.`;
  }
}

export function buildFateContext(
  state: GameState,
  focus: FateFocus,
): { system: string; user: string; validPoiIds: Set<string> } {
  const { text: threadsText, poiIds } = describeThreadsForFate(state);
  const user = [
    buildWorldSummary(state),
    threadsText,
    `Triggering event: ${describeEvent(focus.event)}`,
    'Decide whether to prepare one grounded beat to be discovered. Only use a subjectPoiId from the list above.',
  ].join('\n\n');
  return { system: SYSTEM_CHARTER, user, validPoiIds: poiIds };
}
