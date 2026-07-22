/**
 * chronicle-prompt-builder.ts — M1 "the chronicler's voice".
 *
 * Templates a window of structured `SimEvent`s into a monastic-annalist prompt.
 * `SimEvent` carries NO prose (see `core/events.ts`); every line below is a terse
 * FACT derived straight from the event's fields — numbers, ids, causes, severities.
 * The register instructions (system prompt) are what turn those facts into
 * annotation: the chronicler NEVER explains an event causally (disaster ⇒
 * therefore sin/portent — he names the sin, he does not trace politics).
 *
 * Read-only by construction: this module only ever reads `AppendedEvent[]` and
 * formats strings. It has no path back into the sim (no World mutation, no
 * EventLog.append, no state-writeback) — see `ChronicleService` for the hard
 * read-only guard this module is designed to make trivial to keep.
 *
 * Mirrors `npc-prompt-builder.ts`'s conventions: compact structured context,
 * ~500-800 token budget, a shared system prompt, a small pure formatter per
 * section.
 */

import type { EntityId } from '@/core/types';
import type { AppendedEvent, SimEvent } from '@/core/events';
import type { CalendarTick } from '@/core/calendar';
import type { World } from '@/world/world';
import type { SkipSummary } from '@/sim/time-skip';
import type { EraArcDigest } from '@/sim/fate/arc-era';
import { getNpc, npcProps } from '@/world/npc-helpers';

// ─── Register (the system prompt) ──────────────────────────────────────────

/** Verbatim from the M1 spec register: short annalistic clauses joined by
 *  "and"; numbers/dates/feast-days/weather/corpses recorded faithfully; sudden
 *  lament breaking the list, then the list resumes; praise and condemnation of
 *  the same man left unreconciled; portents come FIRST and explain what
 *  follows; never "I do not know why" — always a named sin. Cause is God, sin,
 *  or portent — NEVER politics. */
export const CHRONICLER_SYSTEM_PROMPT = `You are a monastic annalist keeping the chronicle of a small settlement, in the register of the Anglo-Saxon Chronicle, Orderic Vitalis, and Alcuin's letter on the sack of Lindisfarne.

You do not explain events causally. You ANNOTATE them: something happened, therefore name the sin or portent it was for. You never write "I do not know why" — you always say what sin it was for. Cause is attributed ONLY to God, sin, or portent — NEVER to politics, lords, feuds, or worldly causes.

REGISTER (follow exactly):
- Write short annalistic clauses joined by "and".
- Record numbers, dates, feast-days, what was taken, the weather, and the condition of the dead FAITHFULLY — these are given facts below; never invent or alter them.
- Portents come FIRST in the entry and explain what follows.
- You may break the list of facts with a sudden lament, then resume the list.
- You may praise a man and condemn him in the same sentence — do NOT reconcile the two; let both stand unresolved.
- Do not invent names, numbers, or events beyond what is given below. Do not resolve ambiguity — annotate what is given, do not explain it away.

OUTPUT: one chronicle entry, 3-6 sentences, plain prose. No JSON, no headers, no meta-commentary.`;

// ─── Event window ───────────────────────────────────────────────────────────

export interface ChronicleWindow {
  /** The completed day's events (any order — capped/ranked internally). */
  events: AppendedEvent[];
  /** Calendar context for the day being chronicled. */
  calendar: CalendarTick;
  /** Optional world, purely to resolve npc ids to names for a friendlier prompt.
   *  Omit (tests) and events template by id — still fully deterministic. */
  world?: World | null;
}

export interface BuiltChroniclePrompt {
  system: string;
  user: string;
  estimatedTokens: number;
}

/** Cap the window rather than dumping the whole day — most salient N (deaths,
 *  portents, miracles… weighted above routine whispers), re-sorted chronologically
 *  for narration once capped. */
export const MAX_CHRONICLE_EVENTS = 15;

// ─── Salience ranking (pure, deterministic — no Math.random) ───────────────

const EVENT_WEIGHT: Partial<Record<SimEvent['type'], number>> = {
  npc_death: 10,
  smite: 10,
  era_skipped: 10,
  place_flooded: 9,
  summon_storm: 9,
  settlement_begin: 8,
  miracle: 8,
  castle_founded: 9,
  grip_taken: 7,
  grip_broken: 7,
  peace_proclaimed: 8,
  peace_lapsed: 6,
  oath_sworn: 5,
  site_faded: 8,
  omen: 7,
  npc_birth: 7,
  power_depleted: 7,
  thread_resolved: 6,
  beat_fired: 6,
  portent_planted: 6,
  believer_lost: 6,
  site_born: 6,
  settlement_upgraded: 5,
  settlement_end: 5,
  place_receded: 5,
  answer_prayer: 5,
  belief_cross: 4,
  settlement_grown: 4,
  dream: 4,
  mood_cross: 3,
  whisper: 3,
  mind_probed: 3,
  npc_spawn: 2,
  spirit_birth: 2,
};

function weightOf(a: AppendedEvent): number {
  return EVENT_WEIGHT[a.event.type] ?? 1;
}

/** Stable chronological order: by sim tick `t`, id as a tiebreak (append order
 *  within the same tick — the same tiebreak convention `game-query.ts` uses). */
function byTime(a: AppendedEvent, b: AppendedEvent): number {
  return (a.t - b.t) || (a.id - b.id);
}

/** Deterministic top-N by weight (ties broken by id, stable), returned back in
 *  chronological order for narration. Pure — safe for the offline path too. */
export function selectChronicleEvents(events: AppendedEvent[], cap = MAX_CHRONICLE_EVENTS): AppendedEvent[] {
  if (events.length <= cap) return events.slice().sort(byTime);
  const ranked = events.slice().sort((a, b) => (weightOf(b) - weightOf(a)) || (a.id - b.id));
  return ranked.slice(0, cap).sort(byTime);
}

// ─── Fact-line templating ───────────────────────────────────────────────────

const SETTLEMENT_EVENT_TEXT: Record<string, string> = {
  drought: 'a drought fell upon',
  festival: 'a festival was held in',
  dispute: 'discord arose in',
  plague: 'plague struck',
  raiders: 'raiders fell upon',
  trading_caravan: 'a trading caravan came to',
  stranger_arrives: 'a stranger arrived at',
  harvest_blessing: 'the harvest was blessed in',
};

function resolveNpcName(world: World | null | undefined, id: EntityId): string {
  if (!world) return id;
  const npc = getNpc(world, id);
  return npc ? npcProps(npc).name : id;
}

/** Resolve a POI id to its directory name (`worldSeed.pois` — authored ∪ projected
 *  runtime entries, per `world/runtime-poi.ts`'s projection contract). Falls back
 *  to the id when the world or the POI isn't available (tests may omit `world`). */
function resolvePoiName(world: World | null | undefined, id: string): string {
  if (!world) return id;
  const poi = world.tiles.worldSeed?.pois.find(p => p.id === id);
  return poi?.name ?? id;
}

/** One terse, factual line per event — no prose, no invention, just the given
 *  fields rendered as a clause. The register (system prompt) is what turns
 *  these into annotation; this function only reports what happened. */
export function eventFactLine(a: AppendedEvent, world?: World | null): string {
  const ev = a.event;
  switch (ev.type) {
    case 'world_seeded':
      return 'In the beginning, the world was made.';
    case 'spirit_birth':
      return `A god was born, named ${ev.name}.`;
    case 'npc_spawn':
      return `A soul entered the parish (role: ${ev.role}).`;
    case 'whisper':
      return `The god whispered to ${resolveNpcName(world, ev.npcId)}.`;
    case 'dream':
      return `A dream was sent to ${resolveNpcName(world, ev.npcId)}.`;
    case 'omen':
      return `A portent was shown, of severity ${ev.severity.toFixed(2)}.`;
    case 'miracle':
      return `A miracle answered a need for ${ev.needType}, amount ${ev.amount.toFixed(2)}.`;
    case 'answer_prayer':
      return `A prayer was answered${ev.need ? ` (for ${ev.need})` : ''}${ev.statistical ? ', among the common folk' : ` — ${resolveNpcName(world, ev.npcId)}`}.`;
    case 'smite':
      return `Lightning struck, witnessed by ${ev.witnesses}.`;
    case 'mind_probed':
      return `A mind was searched, to a depth of ${ev.depth}.`;
    case 'believer_lost':
      return `${resolveNpcName(world, ev.npcId)}'s faith lapsed.`;
    case 'npc_encounter':
      return `${resolveNpcName(world, ev.aId)} and ${resolveNpcName(world, ev.bId)} ${ev.warm ? 'talked together' : 'fell to quarrelling'}.`;
    case 'npc_death':
      return `${resolveNpcName(world, ev.npcId)} died, cause: ${ev.cause}.`;
    case 'npc_birth':
      return 'A child was born.';
    case 'era_skipped':
      return `Years passed: ${ev.years}, with ${ev.deaths} deaths and ${ev.births} births.`;
    case 'road_promoted':
      return `A well-trodden way was built up from a ${ev.from} to a ${ev.to}.`;
    case 'road_demoted':
      return `A neglected ${ev.from} dwindled back to a ${ev.to}.`;
    case 'crossing_upgraded':
      return ev.from === undefined
        ? `A ${ev.toLabel} was laid where the way crosses the water.`
        : `The crossing was raised from a ${ev.fromLabel} to a ${ev.toLabel}.`;
    case 'road_adopted': {
      const from = ev.fromPoiId ? resolvePoiName(world, ev.fromPoiId) : undefined;
      const to = ev.toPoiId ? resolvePoiName(world, ev.toPoiId) : undefined;
      return from && to
        ? `A trail worn by travellers' feet between ${from} and ${to} became a true road.`
        : from || to
          ? `A trail worn by travellers' feet near ${from ?? to} became a true road.`
          : "A trail worn by travellers' feet became a true road.";
    }
    case 'belief_cross':
      return `Belief crossed ${ev.kind} (${Math.round(ev.faith * 100)}%).`;
    case 'mood_cross':
      return `Mood crossed ${ev.kind}.`;
    case 'power_depleted':
      return "The god's power was spent to nothing.";
    case 'settlement_grown':
      return `A ${ev.preset} was raised in the settlement.`;
    case 'settlement_upgraded':
      return `A building rose from ${ev.from} to ${ev.to}.`;
    case 'settlement_begin':
      return `${(SETTLEMENT_EVENT_TEXT[ev.eventType] ?? `${ev.eventType} came to`)} the settlement, severity ${ev.severity.toFixed(2)}.`;
    case 'settlement_end':
      return `The ${ev.eventType.replace(/_/g, ' ')} ended.`;
    case 'lord_risen':
      return ev.succession
        ? `${resolveNpcName(world, ev.npcId)} succeeded to the lordship of the settlement.`
        : `${resolveNpcName(world, ev.npcId)} rose as lord over the settlement.`;
    case 'castle_founded':
      return `${resolveNpcName(world, ev.lordNpcId)} raised a castle, ${ev.name}, to hold the land in his fist.`;
    case 'grip_taken':
      return `The knights of the castle rode out, ${ev.garrison} armed man/men, and the settlement passed under their grip; what its people earn is carried up to the keep.`;
    case 'grip_broken':
      return 'No knight rode from the castle, and its grip on the settlement was broken; the tithe went uncollected.';
    case 'shrine_endowed':
      return `The lord ${resolveNpcName(world, ev.lordNpcId)} endowed a shrine to another god (${ev.rivalId}).`;
    case 'peace_proclaimed':
      return `The relics were carried into the field and the Peace of God was proclaimed; ${ev.sworn} armed man/men swore upon them before the crowd.`;
    case 'oath_sworn':
      return `${resolveNpcName(world, ev.npcId)} was brought before the relics and swore the oath of the Peace.`;
    case 'peace_lapsed':
      return 'The term of the Peace of God ran out, and the armed men were no longer bound by their oath.';
    case 'thread_resolved':
      return `A thread of fate was ${ev.status}.`;
    case 'beat_fired':
      return 'A fated beat came to pass.';
    case 'portent_planted':
      return `An omen (a ${ev.kind}) gathered over the place — a portent of things building.`;
    case 'summon_storm':
      return `A storm was summoned, ${ev.depthM.toFixed(1)}m deep over ${ev.cells} cells.`;
    case 'place_flooded':
      return `The waters rose over ${ev.name}, ${ev.depthM.toFixed(1)}m deep, covering ${Math.round(ev.coverage * 100)}%.`;
    case 'place_receded':
      return `The waters receded from ${ev.name}.`;
    case 'site_born':
      return `${ev.name} came into being (a ${ev.kind}).`;
    case 'site_faded':
      return `${ev.name} faded away.`;
    default:
      // Internal/bookkeeping events (timeline_commit, authored_*, region_realized,
      // tile_collapsed, thread_opened/advanced, system_error, …) — rare in a day
      // window and low-weighted, but templated honestly rather than dropped so
      // the annalist never silently loses a fact.
      return `${ev.type.replace(/_/g, ' ')} was recorded.`;
  }
}

// ─── Prompt assembly ────────────────────────────────────────────────────────

export function buildChroniclePrompt(window: ChronicleWindow): BuiltChroniclePrompt {
  const selected = selectChronicleEvents(window.events);
  const lines = selected.map((a) => eventFactLine(a, window.world));
  const dateHeader = `=== YEAR ${window.calendar.year}, ${window.calendar.season.toUpperCase()}, DAY ${window.calendar.dayOfYear} ===`;
  const eventsBlock = lines.length > 0
    ? `=== EVENTS OF THE DAY ===\n${lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}`
    : `=== EVENTS OF THE DAY ===\nNothing was recorded this day.`;

  const user = [
    dateHeader,
    '',
    eventsBlock,
    '',
    'Write the chronicle entry for this day, following the register above.',
  ].join('\n');

  const estimatedTokens = Math.ceil((CHRONICLER_SYSTEM_PROMPT.length + user.length) / 4);
  return { system: CHRONICLER_SYSTEM_PROMPT, user, estimatedTokens };
}

// ─── Offline fallback (no LLM configured, or the call failed) ─────────────

/**
 * Deterministic templated annal from the SAME selected event window — dull but
 * honest, same facts the LLM prompt would have carried, no invention, no
 * `Math.random`. Byte-identical for byte-identical input.
 */
export function renderOfflineAnnal(window: ChronicleWindow): string {
  const events = selectChronicleEvents(window.events);
  const dateLabel = `Year ${window.calendar.year}, day ${window.calendar.dayOfYear} (${window.calendar.season})`;
  if (events.length === 0) {
    return `${dateLabel}: nothing was recorded.`;
  }

  let deaths = 0;
  let births = 0;
  let miracles = 0;
  let believerLost = 0;
  let prayersAnswered = 0;
  let portents = 0;
  let floods = 0;
  const settlementCounts = new Map<string, number>();
  // Distinct causes of death, in first-seen (chronological) order — deterministic,
  // and the "condition of the dead" the register asks to be recorded faithfully.
  const deathCauses = new Map<string, number>();

  for (const a of events) {
    const ev = a.event;
    switch (ev.type) {
      case 'npc_death':
        deaths++;
        deathCauses.set(ev.cause, (deathCauses.get(ev.cause) ?? 0) + 1);
        break;
      case 'npc_birth': births++; break;
      case 'miracle': miracles++; break;
      case 'believer_lost': believerLost++; break;
      case 'answer_prayer': prayersAnswered++; break;
      case 'omen': case 'smite': portents++; break;
      case 'place_flooded': case 'summon_storm': floods++; break;
      case 'settlement_begin':
        settlementCounts.set(ev.eventType, (settlementCounts.get(ev.eventType) ?? 0) + 1);
        break;
      default: break;
    }
  }

  const parts: string[] = [];
  for (const type of settlementCounts.keys()) parts.push(`there was a ${type.replace(/_/g, ' ')}`);
  if (portents > 0) parts.push(`${portents} portent(s) were shown`);
  if (deaths > 0) parts.push(`${deaths} died (${[...deathCauses.keys()].join(', ')})`);
  if (births > 0) parts.push(`${births} were born`);
  if (miracles > 0) parts.push(`${miracles} miracle(s) occurred`);
  if (believerLost > 0) parts.push(`${believerLost} fell from faith`);
  if (prayersAnswered > 0) parts.push(`${prayersAnswered} prayer(s) were answered`);
  if (floods > 0) parts.push(`the waters rose ${floods} time(s)`);
  if (parts.length === 0) parts.push('the day passed uneventfully');

  return `In this year, ${parts.join(', and ')}.`;
}

// ─── F6: the era entry (a time-skip's summary, authored by its spanning arcs) ─

/**
 * The era window: pure given facts. `summary` comes straight from `applySkip`
 * (the sim is truth); `arcs` are the settled digests of the arcs that spanned
 * the skip (`@/sim/fate/arc-era`); `calendar` is the POST-skip date — the
 * annalist writes after the years have passed.
 */
export interface EraChronicleWindow {
  summary: SkipSummary;
  arcs: EraArcDigest[];
  calendar: CalendarTick;
}

/** The daily register, plus the era framing — same annalist, longer span. */
export const ERA_CHRONICLER_ADDENDUM = `
ERA ENTRY: this entry covers a SPAN OF YEARS, not one day. Write 4-8 sentences.
The designs of Fate given below are portents and judgments — annotate what came
to pass, what was abandoned, and what remains unfinished. Never alter or invent
the numbers of years, deaths, births, or the faithful.`;

/** One terse factual line per spanning arc — disposition, goals, pressures,
 *  omens. No prose, no invention; the register annotates. Pure + deterministic. */
export function eraArcFactLine(d: EraArcDigest): string {
  const disposition =
    d.stage === 'landed' ? 'came to pass'
    : d.stage === 'abandoned' ? `was abandoned (${d.abandonedReason ?? 'the moment passed'})`
    : 'remains unfinished';
  const goals = d.goals.length > 0
    ? ` It sought: ${d.goals.map((g) => `${g.predicate.replace(/_/g, ' ')} (${g.met ? 'come true' : 'not come true'})`).join(', ')}.`
    : '';
  const pressures = d.pressures.length > 0
    ? ` Pressures were applied: ${d.pressures.map((p) => `${p.verb} x${p.count}`).join(', ')}.`
    : ' No hand was laid upon the world for it.';
  const omens = d.portentsPlanted > 0
    ? ` Omens: ${d.portentsPlanted} planted, ${d.portentsDiscovered} seen.`
      + (d.omens.length > 0 ? ` ("${d.omens.slice(0, 2).join('" · "')}")` : '')
    : '';
  return `The design "${d.title}" ${disposition}.${goals}${pressures}${omens}`;
}

export function buildEraChroniclePrompt(window: EraChronicleWindow): BuiltChroniclePrompt {
  const { summary, arcs, calendar } = window;
  const system = CHRONICLER_SYSTEM_PROMPT + ERA_CHRONICLER_ADDENDUM;
  const dateHeader = `=== YEAR ${calendar.year}, ${calendar.season.toUpperCase()}, DAY ${calendar.dayOfYear} — AFTER ${summary.years} YEAR(S) PASSED ===`;
  const eraFacts = [
    '=== THE ERA (given facts — never alter) ===',
    `1. ${summary.years} year(s) passed.`,
    `2. ${summary.deaths} died and ${summary.births} were born.`,
    `3. The faithful numbered ${summary.believersBefore} before, and ${summary.believersAfter} after.`,
  ].join('\n');
  const arcsBlock = arcs.length > 0
    ? `=== THE DESIGNS OF FATE ACROSS THOSE YEARS ===\n${arcs.map((d, i) => `${i + 1}. ${eraArcFactLine(d)}`).join('\n')}`
    : '=== THE DESIGNS OF FATE ACROSS THOSE YEARS ===\nFate authored nothing in those years; the world merely turned.';

  const user = [
    dateHeader,
    '',
    eraFacts,
    '',
    arcsBlock,
    '',
    'Write the chronicle entry for this era, following the register above.',
  ].join('\n');

  const estimatedTokens = Math.ceil((system.length + user.length) / 4);
  return { system, user, estimatedTokens };
}

/** One offline arc clause — mirrors `renderOfflineAnnal`'s dullness discipline. */
function offlineArcClause(d: EraArcDigest): string {
  const applied = d.pressures.reduce((n, p) => n + p.count, 0);
  const worked = applied > 0 ? `after ${applied} pressure(s)` : 'though no hand was laid upon the world';
  const omens = d.portentsPlanted > 0 ? `, with ${d.portentsPlanted} omen(s) planted (${d.portentsDiscovered} seen)` : '';
  switch (d.stage) {
    case 'landed':
      return `Fate's design "${d.title}" came to pass, ${worked}${omens}`;
    case 'abandoned':
      return `Fate's design "${d.title}" was abandoned (${d.abandonedReason ?? 'the moment passed'}), ${worked}${omens}`;
    default:
      return `Fate's design "${d.title}" remained unfinished, ${worked}${omens}`;
  }
}

/**
 * Deterministic templated era annal — the honest no-LLM fallback, same facts
 * the era prompt would have carried, no invention, no `Math.random`.
 * Byte-identical for byte-identical input.
 */
export function renderOfflineEraAnnal(window: EraChronicleWindow): string {
  const { summary, arcs, calendar } = window;
  const head = `Year ${calendar.year}: ${summary.years} year(s) passed, and ${summary.deaths} died, and ${summary.births} were born, and the faithful went from ${summary.believersBefore} to ${summary.believersAfter}.`;
  if (arcs.length === 0) {
    return `${head} Fate authored nothing in those years; the world merely turned.`;
  }
  return `${head} ${arcs.map(offlineArcClause).join('. ')}.`;
}
