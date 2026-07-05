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
import { evaluateContracts } from '@/world/connectome-contracts';
import { PLAYER_SPIRIT_ID } from '@/sim/believers';
import { buildRivalSituation } from '@/sim/rival-claims';
import { TICKS_PER_DAY } from '@/core/calendar';

export interface FateFocus {
  event: SimEvent;
  threadId?: ThreadId;
}

const SYSTEM_CHARTER =
  'You are Fate — impersonal and reactive. You amplify, escalate, or let fade what the mortals\' story ' +
  'already produces; you never invent arbitrary plot. You may PREPARE content to be discovered later ' +
  '(arm_staged_beat) OR act on a settlement\'s ongoing troubles now: nudge_event_severity changes the ' +
  'intensity of its current event, force_next_event steers what befalls it next. You may also arm a ' +
  'SOFT (atmosphere-only) beat at a transient causal site — a place the waters just made. And you may ' +
  'COACH a rival god\'s disposition (set_rival_stance) to keep the contest alive: turn a rival UP when the ' +
  'player is coasting and dwarfs it, DOWN when the player is drowning and losing prayers — the anti-snowball ' +
  'counter-loop, never to crown a winner. Only ever use a subjectPoiId listed in the active threads, a ' +
  'flooded settlement, or a causal site, and only a rivalId from the Rivals list. Act sparingly — often the ' +
  'right choice is to call no tool.';

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
    case 'answer_prayer':
      return ev.spiritId === PLAYER_SPIRIT_ID
        ? `A prayer was answered.`
        : `A rival (${ev.spiritId}) has answered a prayer the player left unanswered — the faithful drift.`;
    default: return `Event: ${ev.type}.`;
  }
}

/** Sum a per-settlement follower record into a single count. */
function sumFollowers(rec: Record<string, number>): number {
  let n = 0;
  for (const v of Object.values(rec)) n += v;
  return n;
}

/** How far back the rivals digest counts recent prayer claims — two days
 *  (the fiction intent of the old 480-tick/2-compressed-day lookback). */
const RIVAL_CLAIM_LOOKBACK_TICKS = 2 * TICKS_PER_DAY;
/** Bound on how many rivals the digest enumerates (it rides an LLM prompt). */
const MAX_RIVALS_IN_DIGEST = 6;

/**
 * A compact, deterministic digest of the competing rival gods for Fate — reusing
 * `buildRivalSituation` for the real per-settlement follower counts. Per rival:
 * name, disposition (policy + the two levers most relevant to escalation),
 * followers vs the player, settlements held, and recent prayer claims from the
 * event log. Bounded (≤ MAX_RIVALS_IN_DIGEST lines) so it stays a summary, not a
 * dump. Empty string when there are no rivals (nothing to add to the prompt), and
 * the enumerated ids are the only valid `rivalId` for `set_rival_stance`.
 */
export function describeRivalsForFate(state: GameState): { text: string; rivalIds: Set<string> } {
  const rivalIds = new Set<string>();
  const world = state.world;
  if (!world || !state.spirits) return { text: '', rivalIds };

  const rivals = [...state.spirits.values()]
    .filter((s) => !s.isPlayer && s.ai?.personality)
    .slice(0, MAX_RIVALS_IN_DIGEST);
  if (rivals.length === 0) return { text: '', rivalIds };

  // Count recent rival claims per spirit from the event log (bounded lookback).
  const now = state.clock.now();
  const claimsByRival = new Map<string, number>();
  for (const a of state.eventLog?.range(now - RIVAL_CLAIM_LOOKBACK_TICKS, now + 1) ?? []) {
    if (a.event.type === 'answer_prayer' && a.event.spiritId !== PLAYER_SPIRIT_ID) {
      claimsByRival.set(a.event.spiritId, (claimsByRival.get(a.event.spiritId) ?? 0) + 1);
    }
  }

  const lines: string[] = [];
  for (const r of rivals) {
    rivalIds.add(r.id);
    const sit = buildRivalSituation(world, state.spirits, r.id, { playerId: PLAYER_SPIRIT_ID });
    const rivalFollowers = sumFollowers(sit.rivalFollowersInSettlement);
    const playerFollowers = sumFollowers(sit.playerFollowersInSettlement);
    const held = r.ai?.settlements ?? [];
    const p = r.ai!.personality!;
    const claims = claimsByRival.get(r.id) ?? 0;
    lines.push(
      `- ${r.name} (${r.id}; ${r.ai?.policy ?? 'coexist'}, aggression ${p.aggression.toFixed(2)}, ` +
      `territoriality ${p.territoriality.toFixed(2)}): ${rivalFollowers} follower(s) vs your ${playerFollowers}, ` +
      `holds ${held.length} settlement(s), ${claims} recent prayer claim(s).`,
    );
  }
  return { text: `Rivals (competing gods):\n${lines.join('\n')}`, rivalIds };
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
  try { report = evaluateContracts({ world: state.world, map: state.map }); }
  catch { return ''; }
  if (report.total === 0) return '';
  // Unmet REQUIREMENTS carry a suggestedFix — the actionable half — so surface them first.
  const ordered = [...report.unmet, ...report.diagnostics.filter((d) => !report.unmet.includes(d))];
  const top = ordered.slice(0, 6).map((d) => `- [${d.severity}] ${d.rule}: ${d.message}`);
  return `World quality (${report.counts.error} error / ${report.counts.warn} warn / ${report.counts.info} info) — fixable via the command channel:\n${top.join('\n')}`;
}

export function buildFateContext(
  state: GameState,
  focus: FateFocus,
): { system: string; user: string; validPoiIds: Set<string>; validRivalIds: Set<string> } {
  const { text: threadsText, poiIds } = describeThreadsForFate(state);
  // A flood is a beat-worthy event even at a settlement with no open thread, so the
  // triggering flood's POI is a valid subject — let Fate respond to the deluge there.
  if (focus.event.type === 'place_flooded') poiIds.add(focus.event.poiId);
  // W-I: causal sites are first-class Fate subjects while they live. Their ids join
  // validPoiIds, so `arm_staged_beat` can stage a (soft) beat at a drowned plain.
  const { text: sitesText, siteIds } = describeSitesForFate(state);
  for (const id of siteIds) poiIds.add(id);
  // WP-L: the rivals digest + the ids the set_rival_stance drift-guard validates.
  const { text: rivalsText, rivalIds } = describeRivalsForFate(state);
  const user = [
    buildWorldSummary(state),
    threadsText,
    sitesText,
    rivalsText,
    describeWorldQualityForFate(state),   // connectome lint digest (empty when clean)
    `Triggering event: ${describeEvent(focus.event)}`,
    'Decide whether to prepare one grounded beat to be discovered. Use a subjectPoiId from the active threads, a flooded settlement, or a causal site listed above.',
  ].filter(Boolean).join('\n\n');
  return { system: SYSTEM_CHARTER, user, validPoiIds: poiIds, validRivalIds: rivalIds };
}
