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
import { evaluateConnectome } from '@/world/connectome-diagnostics';

export interface FateFocus {
  event: SimEvent;
  threadId?: ThreadId;
}

const SYSTEM_CHARTER =
  'You are Fate — impersonal and reactive. You amplify, escalate, or let fade what the mortals\' story ' +
  'already produces; you never invent arbitrary plot. You may PREPARE content to be discovered later ' +
  '(arm_staged_beat) OR act on a settlement\'s ongoing troubles now: nudge_event_severity changes the ' +
  'intensity of its current event, force_next_event steers what befalls it next. You may also arm a ' +
  'SOFT (atmosphere-only) beat at a transient causal site — a place the waters just made. Only ever use a ' +
  'subjectPoiId listed in the active threads, a flooded settlement, or a causal site. Act sparingly — ' +
  'often the right choice is to call no tool.';

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
    case 'place_flooded':
      return `A flood has inundated "${ev.name}" (${ev.poiId}) — ${ev.depthM.toFixed(1)} m deep, ` +
        `${Math.round(ev.coverage * 100)}% of the settlement under water.`;
    case 'place_receded': return `The flood at "${ev.name}" (${ev.poiId}) has receded.`;
    case 'site_born':
      return `The waters have made a new place: "${ev.name}" (${ev.siteId}) — a ${ev.kind} ` +
        `drowning ${ev.cells} tiles of open land. It is transient; it will fade as the waters drain.`;
    case 'site_faded': return `"${ev.name}" (${ev.siteId}) has dried out and is gone.`;
    default: return `Event: ${ev.type}.`;
  }
}

/** Active causal sites as Fate-addressable subjects (ephemeral, but real while they last). */
function describeSitesForFate(state: GameState): { text: string; siteIds: Set<string> } {
  const siteIds = new Set<string>();
  const lines: string[] = [];
  for (const s of state.causalSites?.active() ?? []) {
    siteIds.add(s.id);
    lines.push(`- causal site "${s.name}" (${s.id}): a ${s.kind}, intensity ${s.intensity.toFixed(2)}, ` +
      `attributed to ${s.cause}. Ephemeral — soft (atmosphere) beats only.`);
  }
  const text = lines.length ? `Causal sites (transient places):\n${lines.join('\n')}` : '';
  return { text, siteIds };
}

/** A terse digest of the connectome LINTER for Fate, so the DM can NOTICE and act on
 *  world-quality issues (a duplicate road corridor, a pressure-point junction) the same way
 *  it acts on threads — each diagnostic carries a `suggestedFix` verb Fate's command channel
 *  can apply. Empty string when the world lints clean (the common case), so a healthy world
 *  adds nothing to the prompt. */
export function describeWorldQualityForFate(state: GameState): string {
  if (!state.world || !state.map) return '';
  let report;
  try { report = evaluateConnectome({ world: state.world, map: state.map }); }
  catch { return ''; }
  if (report.total === 0) return '';
  const top = report.diagnostics.slice(0, 6).map((d) => `- [${d.severity}] ${d.rule}: ${d.message}`);
  return `World quality (${report.counts.error} error / ${report.counts.warn} warn / ${report.counts.info} info) — fixable via the command channel:\n${top.join('\n')}`;
}

export function buildFateContext(
  state: GameState,
  focus: FateFocus,
): { system: string; user: string; validPoiIds: Set<string> } {
  const { text: threadsText, poiIds } = describeThreadsForFate(state);
  // A flood is a beat-worthy event even at a settlement with no open thread, so the
  // triggering flood's POI is a valid subject — let Fate respond to the deluge there.
  if (focus.event.type === 'place_flooded') poiIds.add(focus.event.poiId);
  // W-I: causal sites are first-class Fate subjects while they live. Their ids join
  // validPoiIds, so `arm_staged_beat` can stage a (soft) beat at a drowned plain.
  const { text: sitesText, siteIds } = describeSitesForFate(state);
  for (const id of siteIds) poiIds.add(id);
  const user = [
    buildWorldSummary(state),
    threadsText,
    sitesText,
    describeWorldQualityForFate(state),   // connectome lint digest (empty when clean)
    `Triggering event: ${describeEvent(focus.event)}`,
    'Decide whether to prepare one grounded beat to be discovered. Use a subjectPoiId from the active threads, a flooded settlement, or a causal site listed above.',
  ].filter(Boolean).join('\n\n');
  return { system: SYSTEM_CHARTER, user, validPoiIds: poiIds };
}
