/**
 * fate-tools.ts — the LLM seam for the Fate brain.
 *
 * Constrained tools only. `arm_staged_beat` prepares latent content discovered
 * later; `nudge_event_severity` and `force_next_event` are IMMEDIATE levers over a
 * settlement's current/next event. Every tool can only target a settlement that is
 * already part of an active thread (validated against `validPoiIds` — a drift
 * guard, mirroring the Create panel) so Fate amplifies existing conditions and
 * never invents. F3 adds the ARC tools: `seed_arc` opens a long-range intention
 * from the shape library (gated on the shape's `seedWhen` predicates — the "no
 * plot devices" gate — and MAX_LIVE_ARCS), `abandon_arc` folds an arc Fate can no
 * longer reach. `parseFateToolCalls` returns staged beats (armed on discovery),
 * immediate commands (emitted now onto the command channel), and validated arc
 * operations (applied to the snapshot-backed FateArcStore by the brain). Any
 * rejected call is DROPPED AND LOGGED — a bad call never kills the deliberation.
 */
import type { LLMTool, LLMToolCall } from '@/llm/llm-client';
import type { Command } from '@/sim/command/types';
import type { StagedBeat } from '@/sim/threads/staging-types';
import type { SettlementEventType } from '@/core/types';
import type { ArcCast } from '@/sim/fate/arc-types';
import { MAX_LIVE_ARCS } from '@/sim/fate/arc-types';
import { ARC_SHAPE_KEYS, getArcShape } from '@/sim/fate/arc-library';
import { authorBlueprint } from '@/blueprint/authoring';
import { BUILDING_BLUEPRINTS } from '@/blueprint/presets';
import type { BlueprintLint } from '@/blueprint/lint';
import type { Descriptors, Wealth, Quality, Condition } from '@/blueprint/types';

export const FATE_ROLES = ['preacher', 'skeptic', 'refugee'] as const;

/** The building presets Fate may raise — the shipped building vocabulary, read from
 *  the registry so the tool enum can NEVER drift from what actually resolves. */
export const FATE_BUILDING_PRESETS: readonly string[] = Object.entries(BUILDING_BLUEPRINTS)
  .filter(([, b]) => b.class === 'building')
  .map(([k]) => k);
/** Descriptor vocabularies for the optional restyle knobs (runtime mirrors of the
 *  Wealth/Quality/Condition types — validated so only known values ride through). */
const FATE_WEALTH: readonly Wealth[] = ['destitute', 'poor', 'modest', 'comfortable', 'rich', 'opulent'];
const FATE_QUALITY: readonly Quality[] = ['crude', 'plain', 'fine', 'ornate'];
const FATE_CONDITION: readonly Condition[] = ['pristine', 'lived_in', 'worn', 'dilapidated'];

export const FATE_EVENT_TYPES: readonly SettlementEventType[] = [
  'drought', 'festival', 'dispute', 'plague', 'raiders', 'trading_caravan', 'stranger_arrives', 'harvest_blessing',
];
const MAX_NUDGE = 0.5;
/** Music cues Fate may attach to a beat — grounded to the base swell vocabulary
 *  (presentation/cues) so a beat can only reference a cue that actually exists. */
export const FATE_MUSIC_CUES = ['swell_miracle', 'dirge_death', 'fanfare_settlement'] as const;

/** The RivalPersonality fields Fate may coach, and the per-call magnitude cap. A
 *  small clamp keeps any single deliberation from maxing a rival (anti-snowball is
 *  a nudge, not a switch); the verb's apply clamps the resulting field to [0,1]. */
export const FATE_STANCE_FIELDS = ['aggression', 'subtlety', 'territoriality', 'assertiveness', 'jealousy'] as const;
const MAX_STANCE_DELTA = 0.2;

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
  {
    name: 'set_rival_stance',
    description:
      "Coach a rival god's disposition by nudging its personality (each delta clamped to ±0.2; fields live " +
      'in 0…1). ANTI-SNOWBALL, per the counter-loop: turn a rival UP (raise aggression / territoriality) when ' +
      'the player is COASTING and its followers dwarf the rival, and DOWN when the player is DROWNING and ' +
      "losing prayers — you keep the contest alive, you never crown a winner. Only name a rivalId from the " +
      'Rivals list. Use at most one per deliberation.',
    parameters: {
      type: 'object',
      properties: {
        rivalId: { type: 'string', description: 'A rival god id from the Rivals list. Required.' },
        aggression: { type: 'number', description: 'Delta to aggression, -0.2…0.2.' },
        territoriality: { type: 'number', description: 'Delta to territoriality, -0.2…0.2.' },
        assertiveness: { type: 'number', description: 'Delta to assertiveness, -0.2…0.2.' },
        subtlety: { type: 'number', description: 'Delta to subtlety, -0.2…0.2.' },
        jealousy: { type: 'number', description: 'Delta to jealousy, -0.2…0.2.' },
      },
      required: ['rivalId'],
    },
  },
  {
    name: 'seed_arc',
    description:
      'Open a LONG-RANGE story arc from the shape library — a standing intention you will build toward ' +
      'across many days (it persists between deliberations). Only a shape listed as seedable in context: ' +
      'its preconditions are re-checked and an unmet shape is REJECTED — you never get a plot device. ' +
      `At most ${MAX_LIVE_ARCS} arcs may be live. Goals and budget come from the library, not from you; ` +
      'you bind only the CAST — which settlements (and mortals) the arc is about.',
    parameters: {
      type: 'object',
      properties: {
        shape: { type: 'string', enum: [...ARC_SHAPE_KEYS], description: 'A shape key listed as seedable in context. Required.' },
        castPoiIds: {
          type: 'array', items: { type: 'string' },
          description: 'Settlement ids (from the active threads / world summary) this arc is about. Unknown ids are dropped.',
        },
        castNpcIds: {
          type: 'array', items: { type: 'string' },
          description: 'Npc ids this arc is about (only ids named in context). Unknown ids are dropped.',
        },
      },
      required: ['shape'],
    },
  },
  {
    name: 'abandon_arc',
    description:
      'Fold a live arc whose preconditions have become unreachable — you never force a beat through. ' +
      'Name an arcId from your live arcs list and the reason it must fold; the reason is recorded ' +
      'and feeds the chronicle.',
    parameters: {
      type: 'object',
      properties: {
        arcId: { type: 'integer', description: 'A live arc id from your arcs list. Required.' },
        reason: { type: 'string', description: 'Why this arc can no longer be reached. Required.' },
      },
      required: ['arcId', 'reason'],
    },
  },
  {
    name: 'author_building',
    description:
      'Raise a NEW building in a settlement the unfolding story already touches — a shrine after a miracle, ' +
      'a tavern as a village swells. Name a preset from the building vocabulary and the settlement; it is ' +
      'placed on a clear plot near the centre. Optional descriptors restyle it (a rich, ornate manor; a worn ' +
      'cottage). GROUNDED ONLY: the settlement must be one listed in the active threads, and the building must ' +
      'read as a natural mark of what just happened. A malformed structure is rejected automatically. Prefer ' +
      'modest, fitting buildings; a lasting building is a heavy hand — use it rarely.',
    parameters: {
      type: 'object',
      properties: {
        subjectPoiId: { type: 'string', description: 'A settlement id from the listed active threads. Required.' },
        preset: { type: 'string', enum: [...FATE_BUILDING_PRESETS], description: 'Which building to raise. Required.' },
        wealth: { type: 'string', enum: [...FATE_WEALTH], description: 'Optional: how prosperous it looks.' },
        quality: { type: 'string', enum: [...FATE_QUALITY], description: 'Optional: craftsmanship.' },
        condition: { type: 'string', enum: [...FATE_CONDITION], description: 'Optional: condition when built.' },
        style: { type: 'string', description: 'Optional: a short style hint (open vocabulary).' },
      },
      required: ['subjectPoiId', 'preset'],
    },
  },
];

/** The single authoring tool, for the SCOPED self-correction retry — passing only this
 *  to the follow-up turn means the model can re-attempt the building but physically cannot
 *  re-emit a beat/nudge/stance (so the retry never duplicates turn-1 actions). */
export const AUTHOR_BUILDING_TOOL: LLMTool = FATE_TOOLS.find((t) => t.name === 'author_building')!;

/** Build the corrective user turn for one bounded self-correction pass: each rejected
 *  building + its error-severity lints (or the resolve-failure summary), and a request to
 *  re-attempt ONLY those buildings or call nothing. Pure/deterministic — unit-testable. */
export function authoringRetryPrompt(rejections: AuthoringRejection[]): string {
  const lines = rejections.map((r) => {
    const errs = r.lints.filter((l) => l.severity === 'error').map((l) => l.message);
    const why = errs.length ? errs.join('; ') : r.summary;
    return `- author_building "${r.preset}" at ${r.subjectPoiId} was REJECTED: ${why}`;
  });
  return (
    'The structural gate rejected the building(s) you tried to raise:\n' +
    lines.join('\n') +
    '\n\nCall author_building once more with corrected descriptors or a simpler, well-formed preset so it ' +
    'passes the gate — or call no tool if you cannot make it fit. Address ONLY the building(s) listed above; ' +
    'do not repeat any other action.'
  );
}

export interface FateToolCtx {
  validPoiIds: Set<string>;
  /** The live rival spirit ids the set_rival_stance drift-guard validates against.
   *  Optional so read-only/legacy callers need not supply it (an absent set drops
   *  every set_rival_stance call, logged — the safe default). */
  validRivalIds?: Set<string>;
  now: number;
  /** Drift guard for `arm_staged_beat`'s optional `storylet` ref — the loaded
   *  pack(s)' storylet ids. Omit (or empty) to disable storylet arming entirely. */
  validStoryletIds?: Set<string>;
  /** F3: the arc-tool gate context. Optional so legacy callers need not supply it —
   *  an absent field drops every seed_arc/abandon_arc call, logged (safe default,
   *  same discipline as validRivalIds). */
  arcs?: FateArcToolCtx;
}

/** What the seed_arc/abandon_arc guards validate against — a snapshot of the arc
 *  store + a live seedWhen evaluator, taken at deliberation time by the brain. */
export interface FateArcToolCtx {
  /** Ids of the currently LIVE arcs — abandon_arc's drift guard. */
  liveArcIds: Set<number>;
  /** Live arc count at deliberation time (the MAX_LIVE_ARCS gate; multiple
   *  seed_arc calls in ONE response are counted incrementally on top of it). */
  liveArcCount: number;
  /** The "no plot devices" gate: does the shape's `seedWhen` hold RIGHT NOW?
   *  (Pure over GameState — see arc-library.isShapeSeedable.) */
  isShapeSeedable: (shapeKey: string) => boolean;
  /** Live npc entity ids for cast drift-guarding; absent ⇒ every npc cast ref drops. */
  validNpcIds?: Set<string>;
}

/** An `author_building` call that resolved+linted to a REJECT (malformed geometry) —
 *  carried out of the parser so the brain service can feed the lints back for a bounded
 *  self-correction retry. Only actual gate failures land here; a hallucinated target or
 *  preset (dropped by the drift guards) is not a fixable-geometry case and never appears. */
export interface AuthoringRejection {
  callId: string;
  subjectPoiId: string;
  preset: string;
  /** authorBlueprint's one-line status (a resolve failure or "N errors"). */
  summary: string;
  /** The structural lints — the error-severity ones are the actionable feedback. */
  lints: BlueprintLint[];
}

/** A validated seed_arc call — the shape key + the drift-guarded cast binding.
 *  Goals/budget are NOT here: the brain reads them from the library at apply time. */
export interface ArcSeedRequest {
  shape: string;
  cast: ArcCast;
}

/** A validated abandon_arc call. */
export interface ArcAbandonRequest {
  arcId: number;
  reason: string;
}

export interface ParsedFateActions {
  beats: Array<Omit<StagedBeat, 'id' | 'status'>>;
  commands: Array<Omit<Command, 'seq'>>;
  /** author_building calls that failed the gate (empty when none) — see AuthoringRejection. */
  authoringRejections: AuthoringRejection[];
  /** F3: validated seed_arc calls, gated on seedWhen + MAX_LIVE_ARCS. */
  arcSeeds: ArcSeedRequest[];
  /** F3: validated abandon_arc calls (live arc + non-empty reason). */
  arcAbandons: ArcAbandonRequest[];
}

/** Validate the model's tool calls into armable beats + immediate commands + arc
 *  operations; drop anything ungrounded (logged) — a bad call never throws. */
export function parseFateToolCalls(
  calls: LLMToolCall[] | undefined,
  ctx: FateToolCtx,
): ParsedFateActions {
  const beats: ParsedFateActions['beats'] = [];
  const commands: ParsedFateActions['commands'] = [];
  const authoringRejections: AuthoringRejection[] = [];
  const arcSeeds: ArcSeedRequest[] = [];
  const arcAbandons: ArcAbandonRequest[] = [];
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
    } else if (c.name === 'set_rival_stance') {
      const cmd = parseSetRivalStance(c, ctx);
      if (cmd) commands.push(cmd);
    } else if (c.name === 'author_building') {
      const cmd = parseAuthorBuilding(c, ctx, authoringRejections);
      if (cmd) commands.push(cmd);
    } else if (c.name === 'seed_arc') {
      // Seeds within THIS response count against the cap incrementally, so two
      // seed_arc calls cannot slip past MAX_LIVE_ARCS together.
      const seed = parseSeedArc(c, ctx, arcSeeds.length);
      if (seed) arcSeeds.push(seed);
    } else if (c.name === 'abandon_arc') {
      const ab = parseAbandonArc(c, ctx);
      if (ab) arcAbandons.push(ab);
    }
  }
  return { beats, commands, authoringRejections, arcSeeds, arcAbandons };
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

/** WP-L: coach a rival's stance. Drift-guarded against live rival ids; each delta
 *  is capped to ±0.2 here (the verb's apply independently re-caps + floor/ceiling
 *  clamps, mirroring nudge_event_severity's defence-in-depth). A call with no finite
 *  delta is dropped — there is nothing to coach. */
function parseSetRivalStance(c: LLMToolCall, ctx: FateToolCtx): Omit<Command, 'seq'> | null {
  const a = c.arguments as Record<string, unknown>;
  const rivalId = typeof a.rivalId === 'string' ? a.rivalId : '';
  if (!ctx.validRivalIds?.has(rivalId)) { console.warn('[fate] dropped set_rival_stance: unknown rivalId', rivalId); return null; }
  const payload: Record<string, unknown> = { rivalId };
  let any = false;
  for (const f of FATE_STANCE_FIELDS) {
    const v = a[f];
    if (typeof v === 'number' && Number.isFinite(v)) {
      payload[f] = Math.max(-MAX_STANCE_DELTA, Math.min(MAX_STANCE_DELTA, v));
      any = true;
    }
  }
  if (!any) { console.warn('[fate] dropped set_rival_stance: no finite deltas', rivalId); return null; }
  return { verb: 'set_rival_stance', source: 'fate', target: { kind: 'none' }, payload };
}

/**
 * F3: open a long-range arc from the shape library. FOUR gates, every failure a
 * logged drop (never a throw — spec §7: a rejection must not kill the deliberation):
 *  1. an arc ctx must be supplied (absent ⇒ arc tools are disabled, safe default);
 *  2. the shape must exist in ARC_LIBRARY;
 *  3. live arcs (+ seeds already accepted from THIS response) must be under
 *     MAX_LIVE_ARCS;
 *  4. the shape's `seedWhen` predicates must hold RIGHT NOW — the "no plot
 *     devices" gate (spec §5).
 * The cast is drift-guarded: unknown poiIds / causal-site ids / unknown npc ids are
 * filtered (logged), and the arc still seeds — same discipline as the storylet ref.
 */
function parseSeedArc(c: LLMToolCall, ctx: FateToolCtx, seededThisResponse: number): ArcSeedRequest | null {
  const a = c.arguments as { shape?: unknown; castPoiIds?: unknown; castNpcIds?: unknown };
  if (!ctx.arcs) { console.warn('[fate] dropped seed_arc: no arc context supplied'); return null; }
  const shapeKey = typeof a.shape === 'string' ? a.shape : '';
  if (!getArcShape(shapeKey)) { console.warn('[fate] dropped seed_arc: unknown shape', shapeKey); return null; }
  if (ctx.arcs.liveArcCount + seededThisResponse >= MAX_LIVE_ARCS) {
    console.warn('[fate] dropped seed_arc: already at MAX_LIVE_ARCS', shapeKey);
    return null;
  }
  if (!ctx.arcs.isShapeSeedable(shapeKey)) {
    console.warn('[fate] dropped seed_arc: seedWhen preconditions not met', shapeKey);
    return null;
  }
  const poiIds: string[] = [];
  if (Array.isArray(a.castPoiIds)) {
    for (const id of a.castPoiIds) {
      // An arc is about durable places: a causal site is transient and cannot anchor one.
      if (typeof id === 'string' && ctx.validPoiIds.has(id) && !isSiteId(id)) poiIds.push(id);
      else console.warn('[fate] seed_arc: dropped cast poiId', id);
    }
  }
  const npcIds: string[] = [];
  if (Array.isArray(a.castNpcIds)) {
    for (const id of a.castNpcIds) {
      if (typeof id === 'string' && ctx.arcs.validNpcIds?.has(id)) npcIds.push(id);
      else console.warn('[fate] seed_arc: dropped cast npcId', id);
    }
  }
  return { shape: shapeKey, cast: { poiIds, npcIds } };
}

/** F3: fold a live arc. The arcId must be LIVE (a stale/finished id is a logged
 *  drop — abandonment can never resurrect) and the reason is REQUIRED, non-empty
 *  (it feeds the chronicler). */
function parseAbandonArc(c: LLMToolCall, ctx: FateToolCtx): ArcAbandonRequest | null {
  const a = c.arguments as { arcId?: unknown; reason?: unknown };
  if (!ctx.arcs) { console.warn('[fate] dropped abandon_arc: no arc context supplied'); return null; }
  const arcId = typeof a.arcId === 'number' && Number.isInteger(a.arcId) ? a.arcId : NaN;
  if (!ctx.arcs.liveArcIds.has(arcId)) { console.warn('[fate] dropped abandon_arc: not a live arc', a.arcId); return null; }
  const reason = typeof a.reason === 'string' ? a.reason.trim() : '';
  if (!reason) { console.warn('[fate] dropped abandon_arc: a reason is required', arcId); return null; }
  return { arcId, reason };
}

/**
 * Author a new building for a grounded settlement. This is the runtime endpoint of the
 * building-authoring harness: the model names a preset (+ optional restyle descriptors),
 * and `authorBlueprint` RESOLVES AND LINTS it before anything is placed. A building that
 * fails to resolve or carries an error-severity lint is dropped HERE — a runtime agent
 * physically cannot stamp a broken structure. On success the *already-resolved* blueprint
 * rides through in the command payload, so `place_building` stamps exactly what was gated
 * (no re-resolution, no drift). Drift-guarded to a real settlement (never a causal site).
 */
function parseAuthorBuilding(
  c: LLMToolCall, ctx: FateToolCtx, rejections?: AuthoringRejection[],
): Omit<Command, 'seq'> | null {
  const a = c.arguments as Record<string, unknown>;
  const poiId = typeof a.subjectPoiId === 'string' ? a.subjectPoiId : '';
  // The drift-guard drops below are HALLUCINATIONS (bad target / unknown type), not fixable
  // geometry — they never enter `rejections`, so the self-correction retry only re-tries the
  // buildings the model got structurally wrong (where lint feedback is actionable).
  if (!ctx.validPoiIds.has(poiId)) { console.warn('[fate] dropped author_building: unknown subjectPoiId', poiId); return null; }
  if (isSiteId(poiId)) { console.warn('[fate] dropped author_building: a causal site cannot hold a building', poiId); return null; }
  const preset = typeof a.preset === 'string' ? a.preset : '';
  if (!FATE_BUILDING_PRESETS.includes(preset)) { console.warn('[fate] dropped author_building: unknown preset', preset); return null; }

  // Only known descriptor-enum values ride through (an unknown one is ignored, not passed on).
  const descriptors: Descriptors = {};
  if (typeof a.wealth === 'string' && (FATE_WEALTH as readonly string[]).includes(a.wealth)) descriptors.wealth = a.wealth as Wealth;
  if (typeof a.quality === 'string' && (FATE_QUALITY as readonly string[]).includes(a.quality)) descriptors.quality = a.quality as Quality;
  if (typeof a.condition === 'string' && (FATE_CONDITION as readonly string[]).includes(a.condition)) descriptors.condition = a.condition as Condition;
  if (typeof a.style === 'string' && a.style.trim()) descriptors.style = a.style.trim();
  const hasDesc = Object.keys(descriptors).length > 0;

  // THE GATE. Pure + deterministic; safe to run inline off the sim tick.
  const verdict = authorBlueprint(hasDesc ? { preset, descriptors } : { preset });
  if (!verdict.ok || !verdict.rb) {
    console.warn('[fate] dropped author_building: failed the authoring gate —', verdict.summary);
    rejections?.push({ callId: c.id, subjectPoiId: poiId, preset, summary: verdict.summary, lints: verdict.lints });
    return null;
  }
  return { verb: 'place_building', source: 'fate', target: { kind: 'settlement', poiId }, payload: { resolved: verdict.rb } };
}
