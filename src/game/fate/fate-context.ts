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
import { buildLordSituation } from '@/sim/lord';
import { getNpc, npcProps } from '@/world/npc-helpers';
import { TICKS_PER_DAY } from '@/core/calendar';
import { MAX_LIVE_ARCS } from '@/sim/fate/arc-types';
import { getArcShape, seedableShapes } from '@/sim/fate/arc-library';
import { advancingVerbsFor } from '@/sim/fate/arc-advance';
import { computeFateTempo, describeTempoForFate } from '@/sim/fate/fate-tempo';
import { ADVANCE_ARC_TOOLS } from './fate-tools';

/**
 * What woke Fate. Two shapes, discriminated by `kind`:
 *  - EVENT (default): a story-significant event / rival pressure the FateTrigger saw.
 *    `kind` is OPTIONAL here so the legacy `{ event, threadId }` shape still satisfies
 *    it — absence means 'event'. Always test the special case (`kind === 'pulse'`).
 *  - PULSE: the clock-driven heartbeat (F2). No event — "nothing happened; what are
 *    you building toward?".
 */
export interface EventFocus {
  kind?: 'event';
  event: SimEvent;
  threadId?: ThreadId;
}
export interface PulseFocus {
  kind: 'pulse';
}
export type FateFocus = EventFocus | PulseFocus;

const SYSTEM_CHARTER =
  'You are Fate — impersonal and reactive. You amplify, escalate, or let fade what the mortals\' story ' +
  'already produces; you never invent arbitrary plot. You may PREPARE content to be discovered later ' +
  '(arm_staged_beat) OR act on a settlement\'s ongoing troubles now: nudge_event_severity changes the ' +
  'intensity of its current event, force_next_event steers what befalls it next. You may also arm a ' +
  'SOFT (atmosphere-only) beat at a transient causal site — a place the waters just made. And you may ' +
  'COACH a rival god\'s disposition (set_rival_stance) to keep the contest alive: turn a rival UP when the ' +
  'player is coasting and dwarfs it, DOWN when the player is drowning and losing prayers — the anti-snowball ' +
  'counter-loop, never to crown a winner. Where a mortal LORD holds a settlement (the Lords list) you may ' +
  'COACH HIS RULE (set_lord_stance): raise his tithe and want breeds prayer and unrest; lower it and the ' +
  'land breathes — or have him endow a shrine to a rival god, granting it standing there. A lord is a ' +
  'mortal: he competes for allegiance, never for belief. When the story earns a LASTING mark, you may raise ONE building ' +
  '(author_building) in a settlement already in play — a shrine after a miracle, a hall as a village grows — ' +
  'placed only if it is well-formed; this is a heavy hand, so do it rarely and only when it plainly fits. ' +
  'You also hold LONG-RANGE intentions as ARCS: seed_arc opens a story shape from the library — only a ' +
  'shape whose preconditions currently hold (an unmet shape is rejected; you never get a plot device) and ' +
  'never beyond the live-arc cap — while abandon_arc folds a live arc whose preconditions have become ' +
  'unreachable rather than forcing it through. WEAVING: when you press toward an arc, apply the lever ' +
  'through advance_arc, naming EVERY live arc the pressure serves (servedArcs) — and prefer the single ' +
  'pressure that advances the MOST arcs at once: one drought serving two arcs is how plot braids rather ' +
  'than queues. A claimed arc must hold an UNMET goal that pressure plausibly moves (each arc lists its ' +
  '"advance via" levers) and pressure budget left; false claims are dropped. ' +
  'PORTENTS FIRST: every heavy blow must be foreshadowed. ' +
  'plant_portent lays an omen on a live arc (kind from that arc\'s listed portent kinds; at most one per ' +
  'deliberation); a HEAVY beat (hard=inject_npc) armed on an arc whose portent ledger is empty is ' +
  'REJECTED — omens make you readable. ' +
  'Only ever use a subjectPoiId listed in the active threads, a ' +
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
    // P1 (two-tier population): Fate's digest counts BOTH tiers — statistical
    // believers weigh follower balance like named ones.
    const sit = buildRivalSituation(world, state.spirits, r.id, {
      playerId: PLAYER_SPIRIT_ID,
      cohorts: state.cohorts,
    });
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

/** Bound on how many lords the digest enumerates (it rides an LLM prompt). */
const MAX_LORDS_IN_DIGEST = 6;

/**
 * M3: a compact, deterministic digest of the SEATED LORDS — mortal power — for
 * Fate, reusing `buildLordSituation` (the `buildRivalSituation` pattern). Per
 * seat: the lord's name, tithe/unrest/garrison, both population tiers, mean
 * prosperity across both tiers, and standing prayer pressure. Empty string when
 * no settlement holds a lord, and the enumerated poiIds are the only valid
 * `poiId` for `set_lord_stance`.
 */
export function describeLordsForFate(state: GameState): { text: string; lordPoiIds: Set<string> } {
  const lordPoiIds = new Set<string>();
  const world = state.world;
  if (!world || world.lords.size === 0) return { text: '', lordPoiIds };
  const poiName = new Map<string, string>();
  for (const p of state.worldSeed?.pois ?? []) poiName.set(p.id, p.name ?? p.id);
  const now = state.clock.now();

  const lines: string[] = [];
  for (const poiId of [...world.lords.keys()].sort().slice(0, MAX_LORDS_IN_DIGEST)) {
    const seat = world.lords.get(poiId)!;
    lordPoiIds.add(poiId);
    const sit = buildLordSituation(world, state.cohorts, poiId, seat, now);
    const holder = getNpc(world, seat.npcId);
    const lordName = holder ? npcProps(holder).name : seat.npcId;
    const pop = sit.namedPopulation + sit.statPopulation;
    const prosperity = pop > 0
      ? (sit.meanProsperityNamed * sit.namedPopulation + sit.meanProsperityStat * sit.statPopulation) / pop
      : 0;
    // M6: an active Peace of God is part of the seat's situation — a SWORN lord
    // cannot be coached above his oath's tithe cap (set_lord_stance clamps).
    const peace = seat.peace && now < seat.peace.untilTick
      ? (seat.peace.sworn.includes(seat.npcId)
        ? ` Bound by a sworn Peace of God (tithe capped at ${seat.peace.titheCap.toFixed(2)}) — he cannot be coached above it.`
        : ' A Peace of God stands there, but this lord never swore it (he rules unbound).')
      : '';
    // M5: a castle seat's grip is part of its situation — the knights carry
    // this seat's tithe to the gripped settlement (its people bleed for it).
    const grip = seat.gripsPoiId
      ? ` His knights hold "${poiName.get(seat.gripsPoiId) ?? seat.gripsPoiId}" (${seat.gripsPoiId}) in their grip — they carry his tithe there.`
      : '';
    lines.push(
      `- ${lordName}, lord of "${poiName.get(poiId) ?? poiId}" (${poiId}): tithe ${seat.tithe.toFixed(2)}, ` +
      `unrest ${seat.unrest.toFixed(2)}, garrison ${sit.garrison}; ${pop} soul(s), ` +
      `mean prosperity ${prosperity.toFixed(2)}, ${sit.prayerPressure} standing plea(s) at risk.${peace}${grip}`,
    );
  }
  return { text: `Lords (mortal power — coach via set_lord_stance):\n${lines.join('\n')}`, lordPoiIds };
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

/** A compact digest of Fate's LIVE arcs — its own standing intentions — so a
 *  deliberation (a pulse especially) can weave toward them rather than restart cold
 *  each time. Empty string when Fate holds no arcs (the common early-game case). */
export function describeArcsForFate(state: GameState): string {
  const arcs = state.fateArcs?.live() ?? [];
  if (arcs.length === 0) return '';
  const lines = arcs.map((a) => {
    const goals = a.goals.map((g) => `${g.predicate}${g.met ? ' ✓' : ''}`).join(', ') || 'none';
    // F4: the ledger state + the shape's legal portent kinds ride the digest, so the
    // model knows a heavy beat is gated and which flavours plant_portent may pick.
    const kinds = getArcShape(a.shape)?.portentKinds ?? [];
    const discovered = a.portents.filter((p) => p.discovered).length;
    const portents = a.portents.length === 0
      ? (kinds.length
          ? `portents: NONE (heavy beats gated — plant one of: ${kinds.join(', ')})`
          : 'portents: none (this shape carries no omens)')
      : `portents: ${a.portents.length} planted (${discovered} discovered)` +
        (kinds.length ? `; kinds: ${kinds.join(', ')}` : '');
    // F5 weaving: which levers could still move this arc's UNMET goals — named as
    // TOOLS (what the model actually calls): the advance_arc-wrappable levers, plus
    // arm_staged_beat when the goal wants a stranger (inject_npc rides a beat).
    const verbs = new Set(advancingVerbsFor(a.goals));
    const levers = Object.entries(ADVANCE_ARC_TOOLS)
      .filter(([, verb]) => verbs.has(verb)).map(([tool]) => tool);
    if (verbs.has('inject_npc')) levers.push('arm_staged_beat');
    const pressure = `pressure: ${a.applied.length} applied, budget ${a.pressureBudget} left` +
      (a.pressureBudget <= 0 ? ' (SPENT — no more pressure; land or fold)'
        : levers.length ? `; advance via ${levers.join(', ')}` : '');
    return `- arc ${a.id} "${a.shape}" (${a.stage}); goals: ${goals}; ${portents}; ${pressure}`;
  });
  return `Your live arcs (standing intentions):\n${lines.join('\n')}`;
}

/** F3: the shapes seed_arc may open RIGHT NOW — only those whose `seedWhen`
 *  preconditions currently hold, and only while there is room under the live-arc
 *  cap. Empty string when nothing is seedable (or the cap is reached), so an
 *  unseedable world adds nothing to the prompt — and the model is never shown a
 *  shape the parse-time gate would reject. */
export function describeSeedableShapesForFate(state: GameState): string {
  const store = state.fateArcs;
  if (!store) return '';
  if (store.live().length >= MAX_LIVE_ARCS) return '';
  const shapes = seedableShapes(state);
  if (shapes.length === 0) return '';
  const lines = shapes.map((s) => `- ${s.key}: ${s.logline}`);
  return `Story shapes seedable now (seed_arc — their preconditions currently hold):\n${lines.join('\n')}`;
}

export function buildFateContext(
  state: GameState,
  focus: FateFocus,
): {
  system: string; user: string;
  validPoiIds: Set<string>; validRivalIds: Set<string>; validLordPoiIds: Set<string>;
} {
  const isPulse = focus.kind === 'pulse';
  const { text: threadsText, poiIds } = describeThreadsForFate(state);
  // A flood is a beat-worthy event even at a settlement with no open thread, so the
  // triggering flood's POI is a valid subject — let Fate respond to the deluge there.
  if (!isPulse && focus.event.type === 'place_flooded') poiIds.add(focus.event.poiId);
  // W-I: causal sites are first-class Fate subjects while they live. Their ids join
  // validPoiIds, so `arm_staged_beat` can stage a (soft) beat at a drowned plain.
  const { text: sitesText, siteIds } = describeSitesForFate(state);
  for (const id of siteIds) poiIds.add(id);
  // WP-L: the rivals digest + the ids the set_rival_stance drift-guard validates.
  const { text: rivalsText, rivalIds } = describeRivalsForFate(state);
  // M3: the lords digest + the poiIds the set_lord_stance drift-guard validates.
  const { text: lordsText, lordPoiIds } = describeLordsForFate(state);
  // F2: the pulse asks a DIFFERENT question than the event path — "nothing happened;
  // what are you building toward?" — and always shows Fate its own live arcs.
  const focusLine = isPulse
    ? 'Nothing in particular just happened. Consider the world as a whole and your standing intentions: what are you building toward?'
    : `Triggering event: ${describeEvent(focus.event)}`;
  const closing = isPulse
    ? 'Decide what long-range intention to advance, if any. You may open a new arc (seed_arc) from the ' +
      'seedable shapes, press toward your live arcs with ONE lever (advance_arc — prefer a pressure that ' +
      'serves several arcs at once), fold one that has become unreachable (abandon_arc), or prepare one ' +
      'grounded beat to be discovered — or, just as often, do nothing this turn.'
    : 'Decide whether to prepare one grounded beat to be discovered. Use a subjectPoiId from the active threads, a flooded settlement, or a causal site listed above.';
  const user = [
    buildWorldSummary(state),
    threadsText,
    sitesText,
    rivalsText,
    lordsText,                            // M3: seated lords (empty when none)
    describeWorldQualityForFate(state),   // connectome lint digest (empty when clean)
    describeArcsForFate(state),           // Fate's live arcs (empty when none)
    describeSeedableShapesForFate(state), // F3: shapes seed_arc may open now (empty when none)
    // Pacing digest — the LLM reads the dramatic RHYTHM and self-paces (it never
    // computes tempo; this is a pure derivation over staging/eventLog/arcs).
    describeTempoForFate(computeFateTempo(state, state.clock?.now() ?? 0)),
    focusLine,
    closing,
  ].filter(Boolean).join('\n\n');
  return { system: SYSTEM_CHARTER, user, validPoiIds: poiIds, validRivalIds: rivalIds, validLordPoiIds: lordPoiIds };
}
