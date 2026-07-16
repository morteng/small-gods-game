/**
 * GameQuery — the single read-only facade over `GameState`.
 *
 * Pure reads: never mutates, snapshot-consistent (reads the live world; a caller
 * that needs a frozen view takes it at a tick boundary). Every method returns a
 * compact, JSON-serializable DTO — no live `Entity`/`World`/`Spirit` references —
 * so the (future) MCP bridge can `JSON.stringify` results directly, and the
 * WebGPU UI can bind to plain data. Subsumes and extends the read verbs that used
 * to live inline in `debug-api.ts`.
 *
 * Part of the S0 command/query bus (docs/superpowers/specs/2026-06-15-command-query-bus-s0-spec.md):
 * the read side that `GameBus` unifies with the existing command channel.
 */
import type { GameState } from '@/core/state';
import type { Entity, EntityId } from '@/core/types';
import type { QueryOpts } from '@/world/world';
import type { SpiritId } from '@/core/spirit';
import type { AppendedEvent } from '@/core/events';
import { npcProps } from '@/world/npc-helpers';
import { evaluateContracts, type ContractReport } from '@/world/connectome-contracts';
import { isDurable } from '@/sim/believers';
import { ALL_DOMAINS, DOMAIN_DEFS, aggregateDomain, isOminous, getDomainBelief } from '@/sim/belief-domains';
import { getCapability } from '@/sim/command/registry';
import { scoreAffordance, PRAYER_SUBJECT_TEXT } from '@/game/affordance/salience';
import { affordancesForTarget, type VerbUnlock } from '@/game/affordance/derive';
import type { CommandCtx, CommandTarget } from '@/sim/command/types';
import type { World } from '@/world/world';
import { calendarLabel, TICKS_PER_DAY, DAYS_PER_YEAR } from '@/core/calendar';
import { PLAYER_SPIRIT_ID } from '@/sim/believers';
import { POWER_REGEN_RATE, POWER_UNDERSTANDING_COEFF, POWER_DEVOTION_COEFF } from '@/sim/spirit-system';
import {
  prayerAge, eligibleClaimants,
  PRAYER_CLAIM_WARNING_TICKS, PRAYER_CLAIM_WINDOW_TICKS, CLAIM_NOTICE_HORIZON_TICKS,
} from '@/sim/rival-claims';

const TICKS_PER_YEAR = TICKS_PER_DAY * DAYS_PER_YEAR;

// ── Compact, serializable DTOs ───────────────────────────────────────────────

export interface WorldSummary {
  name: string | undefined;
  map: { w: number; h: number } | null;
  tick: number;
  calendar: string;
  era: string | undefined;
  npcs: number;
  buildings: number;
  vegetation: number;
  remains: number;
  byKind: Record<string, number>;
}

export interface BeliefRef { faith: number; understanding: number; devotion: number; }

export interface NpcView {
  id: EntityId;
  name: string;
  role: string;
  x: number;
  y: number;
  mood: number;
  activity: string;
  /** Faith toward the player spirit (0–1), the most-asked-for scalar. */
  faith: number;
  homePoiId?: string;
  /** Deed-derived byname (M2), e.g. "the Twice-Answered". */
  epithet?: string;
}

export interface NpcDetail extends NpcView {
  beliefs: Record<string, BeliefRef>;
  needs: { safety: number; prosperity: number; community: number; meaning: number };
  personality: { assertiveness: number; skepticism: number; piety: number; sociability: number };
  relationships: { npcId: string; type: string; trust: number }[];
  lineageId: EntityId;
  ageYears: number;
}

/** One labelled 0–1 bar in the inspector (a need, a belief scalar, a domain conviction). */
export interface InspectorBar { label: string; value: number; }
/** One affordance row in the inspector (the full vocabulary; locked verbs greyed). */
export interface InspectorAffordance { verb: string; label: string; cost: number; unlocked: boolean; affordable: boolean; }

/** The target-first inspector payload (spec §8): full legible state for any
 *  selectable + what the target believes YOU command (the belief-loop feedback) +
 *  the complete divine vocabulary applicable here. Plain data → MCP/UI bind directly. */
export interface InspectorView {
  kind: 'npc' | 'settlement';
  title: string;
  subtitle: string;
  /** Live state bars (belief toward you, mood, needs), each 0–1. */
  state: InspectorBar[];
  /** What the target believes YOU command, per domain (0 = the thought never occurred). */
  domains: InspectorBar[];
  /** The full divine vocabulary for this target — locked/unaffordable verbs greyed. */
  affordances: InspectorAffordance[];
}

export interface BeliefView {
  spiritId: SpiritId;
  believers: number;
  power: number;
  regenPerTick: number;
  /** Means over durable believers (0 when there are none). */
  faith: number;
  understanding: number;
  devotion: number;
}

export interface SettlementView {
  poiId: string;
  name: string | undefined;
  type: string;
  importance: string | undefined;
  position: { x: number; y: number } | null;
  npcCount: number;
  wards: { name: string; type: string }[];
}

export interface TimelineView {
  rate: number;
  currentTick: number;
  maxTick: number;
  scrubbed: boolean;
  /** Number of committed branch points (`timeline_commit` events). */
  commits: number;
}

export interface SpiritView {
  id: SpiritId;
  name: string;
  isPlayer: boolean;
  power: number;
  color: string;
  sigil: string;
  believers: number;
}

/** One belief-granted power, projected for the skill panel + MCP. The panel reads
 *  ONLY this — it is the single legibility payload (locked/unlocked + why + how far). */
export interface BeliefPowerView {
  domain: string;
  label: string;
  blurb: string;
  /** The capability verb this domain gates. */
  verb: string;
  /** Aggregate conviction 0–1 (faith×devotion-weighted across the congregation). */
  conviction: number;
  /** Conviction needed to unlock. */
  threshold: number;
  /** conviction ≥ threshold AND the capability is implemented. */
  unlocked: boolean;
  /** NPCs visibly holding this belief. */
  reach: number;
  /** Faith-bearers toward this spirit (the aggregate's support). */
  believers: number;
}

export type InboxKind = 'prayer' | 'opportunity' | 'threat' | 'tiding';

// ── WP-C: faith/mood turning points as transient inbox "tidings" ────────────
/** How long a belief/mood crossing stays in the inbox. Items are derived from the
 *  event log inside this sliding window, so they auto-expire — no stored inbox
 *  state, same pattern as the rival-claim notices. Under 1:1 realtime fiction
 *  time IS real time, so the old workaround (7.5 compressed sim-days just to be
 *  ~30 real seconds) collapses back to the fiction intent: crossings from the
 *  LAST DAY are news; anything older is history. */
export const CROSSING_NOTICE_HORIZON_TICKS = TICKS_PER_DAY;
/** Concurrent tiding-item cap: crossings are coalesced per settlement and then at
 *  most this many buckets surface, so news can never drown threats or pleas. */
export const MAX_TIDING_ITEMS = 3;

/** One triageable item in the divine inbox. Deterministic id so the UI can carry
 *  ignore/surface state across frames. The target routes the "Act" verb. */
export interface InboxItem {
  id: string;
  kind: InboxKind;
  title: string;
  detail: string;
  /** Deterministic priority, higher = more urgent. Surfaced items are boosted. */
  salience: number;
  /** True when the director (Fate) has promoted this with intent (B-E). */
  surfaced: boolean;
  target: { kind: 'npc'; npcId: string } | { kind: 'settlement'; poiId: string } | { kind: 'none' };
  /** World anchor in TILE coords (P5): the npc's position / the settlement's poi
   *  position. Omitted for `none` targets (a rival threat has no place). Drives the
   *  zoomed-out alert pins + the camera-fly framing; pure presentation. */
  anchor?: { x: number; y: number };
}

export interface GameQuery {
  worldSummary(): WorldSummary;
  /** Belief-granted powers for a spirit (default player): the skill-panel payload. */
  beliefPowers(spiritId?: SpiritId): BeliefPowerView[];
  /** The triageable divine inbox for a spirit (default player), salience-ranked. */
  divineInbox(spiritId?: SpiritId): InboxItem[];
  /** Raw entity passthrough (read-only) — the console/MCP escape hatch. */
  entities(opts?: QueryOpts): Entity[];
  npcs(filter?: QueryOpts): NpcView[];
  npc(id: EntityId): NpcDetail | null;
  /** Target-first inspector: full state + domain-belief feedback + affordances for
   *  a selected npc/settlement (default spirit = player). Null when unresolvable. */
  inspect(target: CommandTarget, spiritId?: SpiritId): InspectorView | null;
  beliefState(spiritId?: SpiritId): BeliefView;
  settlement(poiId: string): SettlementView | null;
  events(sinceId?: number): AppendedEvent[];
  timeline(): TimelineView;
  spirits(): SpiritView[];
  /** Canvas as a PNG data URL (browser only; '' headless). */
  screenshot(): string;
  /** The connectome linter: structured diagnostics (rule breaks / smells / pressure
   *  points) over the generated world, for agents + the studio overlay. */
  connectomeDiagnostics(): ContractReport;
}

export interface GameQueryDeps {
  state: GameState;
  /** The on-screen scene canvas (WebGPU). Browser-only; omit in Node tests →
   *  `screenshot()` returns ''. */
  canvas?: HTMLCanvasElement | null;
  /** Capture provider: renders one fresh frame and composites scene+overlay into a
   *  data URL. Supplied by Game — a WebGPU canvas can't be read between frames
   *  (the swap chain detaches after present), so the grab must drawImage straight
   *  after a synchronous render. Omitted ⇒ `screenshot()` falls back to
   *  `canvas.toDataURL()`. */
  capture?: () => string;
  /** Live transport rate (scheduler.getRate). Omit → reported as 0. */
  rate?: () => number;
  /** Scrub/tick window (TimelineController). Omit → live, no scrub. */
  timeline?: { readonly isScrubbed: boolean; readonly currentTick: number; readonly maxTick: number };
  /** M1: the chronicler's most recent daily annal (`ChronicleService.latest()`).
   *  Omit / return null ⇒ no chronicle item surfaces (golden-test default). */
  chronicleLatest?: () => { text: string; year: number; season: string; dayOfYear: number } | null;
}

/** The spirit's belief-unlock vector (a domain's verb is unlocked once its
 *  aggregate conviction clears the threshold AND the capability is implemented).
 *  The `this`-free core of `beliefPowers`, so `inspect`/`affordancesForTarget`
 *  gate on the same signal the powers panel shows. */
function beliefUnlocks(world: World | null, spiritId: SpiritId): VerbUnlock[] {
  return ALL_DOMAINS.map((domain) => {
    const def = DOMAIN_DEFS[domain];
    const conviction = world ? aggregateDomain(world, spiritId, domain).conviction : 0;
    const implemented = getCapability(def.verb)?.implemented ?? false;
    return { verb: def.verb, unlocked: implemented && conviction >= def.unlockThreshold };
  });
}

function durableBelieverCount(state: GameState, spiritId: SpiritId): number {
  const world = state.world;
  if (!world) return 0;
  let n = 0;
  for (const e of world.query({ kind: 'npc' })) {
    if (isDurable(npcProps(e).beliefs[spiritId])) n++;
  }
  return n;
}

export function createGameQuery(deps: GameQueryDeps): GameQuery {
  const { state } = deps;

  function npcView(e: Entity): NpcView {
    const p = npcProps(e);
    return {
      id: e.id,
      name: p.name,
      role: p.role,
      x: e.x,
      y: e.y,
      mood: p.mood,
      activity: p.activity,
      faith: p.beliefs[PLAYER_SPIRIT_ID]?.faith ?? 0,
      homePoiId: p.homePoiId,
      epithet: p.epithet,
    };
  }

  return {
    worldSummary(): WorldSummary {
      const w = state.world;
      const byKind: Record<string, number> = {};
      if (w) for (const e of w.query({})) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
      const buildings = w ? w.query({ tag: 'building' }).length : 0;
      return {
        name: state.worldSeed?.name,
        map: state.map ? { w: state.map.width, h: state.map.height } : null,
        tick: state.clock.now(),
        calendar: calendarLabel(state.clock.now()),
        era: state.worldSeed?.era,
        npcs: byKind['npc'] ?? 0,
        buildings,
        vegetation: w ? w.query({ tag: 'vegetation' }).length : 0,
        remains: byKind['remains'] ?? 0,
        byKind,
      };
    },

    entities(opts: QueryOpts = {}): Entity[] {
      return state.world ? state.world.query(opts) : [];
    },

    npcs(filter: QueryOpts = {}): NpcView[] {
      if (!state.world) return [];
      const opts: QueryOpts = filter.kind || filter.tag ? filter : { ...filter, kind: 'npc' };
      return state.world.query(opts).filter(e => e.kind === 'npc').map(npcView);
    },

    npc(id: EntityId): NpcDetail | null {
      const e = state.world?.query({ kind: 'npc' }).find(n => n.id === id);
      if (!e) return null;
      const p = npcProps(e);
      const beliefs: Record<string, BeliefRef> = {};
      for (const [sid, b] of Object.entries(p.beliefs)) {
        beliefs[sid] = { faith: b.faith, understanding: b.understanding, devotion: b.devotion };
      }
      return {
        ...npcView(e),
        beliefs,
        needs: { ...p.needs },
        personality: { ...p.personality },
        relationships: p.relationships.map(r => ({ npcId: r.npcId, type: r.type, trust: r.trust })),
        lineageId: p.lineageId,
        ageYears: Math.max(0, (state.clock.now() - p.birthTick) / TICKS_PER_YEAR),
      };
    },

    inspect(target: CommandTarget, spiritId: SpiritId = PLAYER_SPIRIT_ID): InspectorView | null {
      const world = state.world;
      if (!world) return null;
      const ctx: CommandCtx = { world, spirits: state.spirits, log: state.eventLog };
      const affordances: InspectorAffordance[] =
        affordancesForTarget(target, spiritId, ctx, beliefUnlocks(world, spiritId))
          .map(a => ({ verb: a.verb, label: a.label, cost: a.preview.cost, unlocked: a.unlocked, affordable: a.preview.affordable }));

      if (target.kind === 'npc') {
        const e = world.query({ kind: 'npc' }).find(n => n.id === target.npcId);
        if (!e) return null;
        const p = npcProps(e);
        const b = p.beliefs[spiritId] ?? { faith: 0, understanding: 0, devotion: 0 };
        const ageYears = Math.max(0, (state.clock.now() - p.birthTick) / TICKS_PER_YEAR);
        // M0.b: a praying soul's inspector line names the plea's subject.
        const doing = p.activity === 'worship'
          ? `praying for ${PRAYER_SUBJECT_TEXT[p.prayerNeed ?? 'meaning']}`
          : p.activity;
        return {
          kind: 'npc',
          // M2: a deed-earned byname joins the title — "Tola the Twice-Answered".
          title: p.epithet ? `${p.name} ${p.epithet}` : p.name,
          subtitle: `${p.role} · age ${Math.floor(ageYears)} · ${doing}`,
          state: [
            { label: 'Faith', value: b.faith },
            { label: 'Understanding', value: b.understanding },
            { label: 'Devotion', value: b.devotion },
            { label: 'Mood', value: p.mood },
            { label: 'Safety', value: p.needs.safety },
            { label: 'Prosperity', value: p.needs.prosperity },
            { label: 'Community', value: p.needs.community },
            { label: 'Meaning', value: p.needs.meaning },
          ],
          domains: ALL_DOMAINS.map(d => ({ label: DOMAIN_DEFS[d].label, value: getDomainBelief(p, spiritId, d) })),
          affordances,
        };
      }

      if (target.kind === 'settlement') {
        const poi = state.worldSeed?.pois.find(pp => pp.id === target.poiId);
        if (!poi) return null;
        const souls = world.query({ kind: 'npc' }).filter(n => npcProps(n).homePoiId === target.poiId).length;
        return {
          kind: 'settlement',
          title: poi.name ?? target.poiId,
          subtitle: `${poi.type}${poi.importance ? ` · ${poi.importance}` : ''} · ${souls} souls`,
          // no per-target scalars for a place; the congregation's convictions carry the state.
          state: [],
          // settlement-scale loop feedback: how convinced the whole congregation is.
          domains: ALL_DOMAINS.map(d => ({ label: DOMAIN_DEFS[d].label, value: aggregateDomain(world, spiritId, d).conviction })),
          affordances,
        };
      }
      return null;
    },

    beliefState(spiritId: SpiritId = PLAYER_SPIRIT_ID): BeliefView {
      const spirit = state.spirits.get(spiritId);
      let believers = 0, fSum = 0, uSum = 0, dSum = 0, contribTotal = 0;
      if (state.world) {
        for (const e of state.world.query({ kind: 'npc' })) {
          const b = npcProps(e).beliefs[spiritId];
          if (!b) continue;
          contribTotal += b.faith
            * (1 + POWER_UNDERSTANDING_COEFF * b.understanding)
            * (1 + POWER_DEVOTION_COEFF * b.devotion);
          if (isDurable(b)) { believers++; fSum += b.faith; uSum += b.understanding; dSum += b.devotion; }
        }
      }
      const denom = believers || 1;
      return {
        spiritId,
        believers,
        power: spirit?.power ?? 0,
        regenPerTick: contribTotal * POWER_REGEN_RATE,
        faith: fSum / denom,
        understanding: uSum / denom,
        devotion: dSum / denom,
      };
    },

    settlement(poiId: string): SettlementView | null {
      const poi = state.worldSeed?.pois.find(p => p.id === poiId);
      if (!poi) return null;
      const village = state.map?.villages.find(v => v.name && v.name === poi.name);
      const npcCount = state.world
        ? state.world.query({ kind: 'npc' }).filter(e => npcProps(e).homePoiId === poiId).length
        : 0;
      return {
        poiId: poi.id,
        name: poi.name,
        type: poi.type,
        importance: poi.importance,
        position: poi.position ? { x: poi.position.x, y: poi.position.y } : null,
        npcCount,
        wards: (village?.wards ?? []).map(w => ({ name: w.name, type: w.type })),
      };
    },

    events(sinceId = 0): AppendedEvent[] {
      return state.eventLog.since(sinceId);
    },

    timeline(): TimelineView {
      const commits = state.eventLog.since(0)
        .reduce((n, e) => n + (e.event.type === 'timeline_commit' ? 1 : 0), 0);
      return {
        rate: deps.rate?.() ?? 0,
        currentTick: deps.timeline?.currentTick ?? state.clock.now(),
        maxTick: deps.timeline?.maxTick ?? state.clock.now(),
        scrubbed: deps.timeline?.isScrubbed ?? false,
        commits,
      };
    },

    spirits(): SpiritView[] {
      return [...state.spirits.values()].map(s => ({
        id: s.id,
        name: s.name,
        isPlayer: s.isPlayer,
        power: s.power,
        color: s.color,
        sigil: s.sigil,
        believers: durableBelieverCount(state, s.id),
      }));
    },

    beliefPowers(spiritId: SpiritId = PLAYER_SPIRIT_ID): BeliefPowerView[] {
      const world = state.world;
      return ALL_DOMAINS.map((domain) => {
        const def = DOMAIN_DEFS[domain];
        const agg = world
          ? aggregateDomain(world, spiritId, domain)
          : { conviction: 0, reach: 0, believers: 0 };
        const implemented = getCapability(def.verb)?.implemented ?? false;
        return {
          domain,
          label: def.label,
          blurb: def.blurb,
          verb: def.verb,
          conviction: agg.conviction,
          threshold: def.unlockThreshold,
          unlocked: implemented && agg.conviction >= def.unlockThreshold,
          reach: agg.reach,
          believers: agg.believers,
        };
      });
    },

    divineInbox(spiritId: SpiritId = PLAYER_SPIRIT_ID): InboxItem[] {
      const world = state.world;
      if (!world) return [];
      const surfacedSet = state.surfacedInbox ?? new Set<string>();
      const items: InboxItem[] = [];
      // Fate surfacing (B-E): a promoted item is flagged + boosted (scoreAffordance
      // folds the +1 in). All salience runs through the shared `scoreAffordance`
      // brain so the inbox (global lens) and hover (local lens, P3) never disagree.

      // ── prayers: NPCs actively pleading (worship), weighted by faith × need ──
      for (const e of world.query({ kind: 'npc' })) {
        const p = npcProps(e);
        if (p.activity !== 'worship') continue;
        const faith = p.beliefs[spiritId]?.faith ?? 0;
        if (faith <= 0) continue;
        // M0.b: the plea has a SUBJECT — weight + word the item by the need
        // actually asked for (fallback: the classic meaning-plea).
        const need = p.prayerNeed ?? 'meaning';
        const needDeficit = 1 - p.needs[need];
        const id = `prayer:${e.id}`;
        const surfaced = surfacedSet.has(id);
        items.push({
          id,
          kind: 'prayer',
          title: `${p.name} is praying`,
          detail: `A ${p.role} pleads for ${PRAYER_SUBJECT_TEXT[need]}.`,
          salience: scoreAffordance({ kind: 'prayer', faith, needDeficit, surfaced }),
          surfaced,
          target: { kind: 'npc', npcId: e.id },
          anchor: { x: e.x, y: e.y },
        });
      }

      // ── opportunities: settlements in ominous straits (claim the wrath) ──
      for (const [poiId, evs] of world.activeEvents) {
        let worst = 0;
        let worstType: string | null = null;
        for (const ev of evs) {
          if (isOminous(ev.type) && ev.severity > worst) { worst = ev.severity; worstType = ev.type; }
        }
        if (!worstType) continue;
        const poi = state.worldSeed?.pois.find(pp => pp.id === poiId);
        const poiName = poi?.name ?? poiId;
        const id = `opp:${poiId}`;
        const surfaced = surfacedSet.has(id);
        items.push({
          id,
          kind: 'opportunity',
          title: `${worstType} grips ${poiName}`,
          detail: 'A sign now would be taken as your hand on the sky.',
          salience: scoreAffordance({ kind: 'opportunity', severity: worst, surfaced }),
          surfaced,
          target: { kind: 'settlement', poiId },
          ...(poi?.position ? { anchor: { x: poi.position.x, y: poi.position.y } } : {}),
        });
      }

      // ── threats: a rival spirit drawing your believers' faith ──
      for (const s of state.spirits.values()) {
        if (s.id === spiritId || s.isPlayer) continue;
        let rivalBelievers = 0;
        for (const e of world.query({ kind: 'npc' })) {
          if ((npcProps(e).beliefs[s.id]?.faith ?? 0) >= 0.15) rivalBelievers++;
        }
        if (rivalBelievers === 0) continue;
        const id = `threat:${s.id}`;
        const surfaced = surfacedSet.has(id);
        items.push({
          id,
          kind: 'threat',
          title: `${s.name} courts the faithful`,
          detail: `${rivalBelievers} soul(s) lean toward a rival.`,
          salience: scoreAffordance({ kind: 'threat', rivalBelievers, surfaced }),
          surfaced,
          target: { kind: 'none' },
        });
      }

      // ── contested prayers: a plea aging toward a rival's grasp (Track 3) ──
      // A worshipper whose plea has gone unanswered long enough that a funded rival
      // in its settlement is poised to claim it — surfaced while there is STILL time
      // to answer. (No claimant present ⇒ no threat, so it stays an ordinary prayer.)
      const now = state.clock.now();
      for (const e of world.query({ kind: 'npc' })) {
        const p = npcProps(e);
        if (p.activity !== 'worship') continue;
        const age = prayerAge(p, now);
        if (age < PRAYER_CLAIM_WARNING_TICKS) continue;
        const claimants = eligibleClaimants(e, state.spirits);
        if (claimants.length === 0) continue;
        const faith = p.beliefs[spiritId]?.faith ?? 0;
        const urgency = Math.min(1, age / PRAYER_CLAIM_WINDOW_TICKS);
        const id = `contest:${e.id}`;
        const surfaced = surfacedSet.has(id);
        items.push({
          id,
          kind: 'threat',
          title: `${p.name}'s prayer is slipping away`,
          detail: `Answer now or a rival will — ${claimants.length} spirit(s) circle this plea.`,
          salience: scoreAffordance({ kind: 'prayer_contested', faith, urgency, surfaced }),
          surfaced,
          target: { kind: 'npc', npcId: e.id },
          anchor: { x: e.x, y: e.y },
        });
      }

      // ── claimed prayers: a rival already answered one you left (Track 3) ──
      // Read from the canonical event log (snapshot-safe): a recent `answer_prayer`
      // whose spirit is a non-player rival IS the claim. Lingers one sim-day.
      const recent = state.eventLog.range(now - CLAIM_NOTICE_HORIZON_TICKS, now + 1)
        .filter(a => a.event.type === 'answer_prayer'
          && a.event.spiritId !== spiritId
          && !(state.spirits.get(a.event.spiritId)?.isPlayer ?? true));
      if (recent.length > 0) {
        const npcById = new Map(world.query({ kind: 'npc' }).map(n => [n.id, n]));
        for (const a of recent) {
          const ev = a.event as { type: 'answer_prayer'; spiritId: SpiritId; npcId: string };
          const rival = state.spirits.get(ev.spiritId);
          const npc = npcById.get(ev.npcId);
          const faith = npc ? (npcProps(npc).beliefs[spiritId]?.faith ?? 0) : 0;
          const id = `claimed:${a.id}`;
          const surfaced = surfacedSet.has(id);
          items.push({
            id,
            kind: 'threat',
            title: `${rival?.name ?? 'A rival'} answered a prayer you ignored`,
            detail: 'A plea you left unanswered was taken up by another — that soul now leans away.',
            salience: scoreAffordance({ kind: 'prayer_claimed', faith, surfaced }),
            surfaced,
            target: npc ? { kind: 'npc', npcId: ev.npcId } : { kind: 'none' },
            ...(npc ? { anchor: { x: npc.x, y: npc.y } } : {}),
          });
        }
      }

      // ── tidings: faith/mood turning points (belief_cross / mood_cross), WP-C ──
      // These fire in the sim on every threshold crossing but used to surface only
      // in the ?legacyui glyph strip — the shipped chrome never showed them. Derived
      // from the log inside a sliding half-day window (auto-expiring, transient),
      // coalesced per settlement, capped, and scored strictly below the threat floor.
      const crossings = state.eventLog.range(now - CROSSING_NOTICE_HORIZON_TICKS, now + 1)
        .filter(a => (a.event.type === 'belief_cross' && a.event.spiritId === spiritId)
                  || a.event.type === 'mood_cross');
      if (crossings.length > 0) {
        type Bucket = { key: string; poiId?: string; npcId?: string; risen: number; fallen: number; mood: number };
        const npcs = new Map(world.query({ kind: 'npc' }).map(n => [n.id, n]));
        const buckets = new Map<string, Bucket>();
        for (const a of crossings) {
          const ev = a.event as { type: 'belief_cross' | 'mood_cross'; npcId: string; kind: 'high' | 'low' };
          const npc = npcs.get(ev.npcId);
          const home = npc ? npcProps(npc).homePoiId : undefined;
          const key = home ?? `npc:${ev.npcId}`;
          let b = buckets.get(key);
          if (!b) { b = { key, poiId: home, npcId: home ? undefined : ev.npcId, risen: 0, fallen: 0, mood: 0 }; buckets.set(key, b); }
          if (ev.type === 'mood_cross') b.mood++;
          else if (ev.kind === 'high') b.risen++;
          else b.fallen++;
        }
        const tidings: InboxItem[] = [];
        for (const b of buckets.values()) {
          const poi = b.poiId ? state.worldSeed?.pois.find(pp => pp.id === b.poiId) : undefined;
          const npc = b.npcId ? npcs.get(b.npcId) : undefined;
          const name = poi?.name ?? (npc ? npcProps(npc).name : b.key);
          const title =
            b.risen > 0 && b.fallen === 0 ? `Faith rises in ${name}` :
            b.fallen > 0 && b.risen === 0 ? `Faith falters in ${name}` :
            b.risen > 0 ? `Faith stirs in ${name}` : `Spirits shift in ${name}`;
          const parts: string[] = [];
          if (b.risen > 0) parts.push(`${b.risen} soul(s) crossed into belief`);
          if (b.fallen > 0) parts.push(`${b.fallen} fell away`);
          if (b.mood > 0) parts.push(`${b.mood} mood(s) turned`);
          const count = b.risen + b.fallen + b.mood;
          const id = `cross:${b.key}`;
          const surfaced = surfacedSet.has(id);
          tidings.push({
            id,
            kind: 'tiding',
            title,
            detail: parts.join('; ') + '.',
            salience: scoreAffordance({ kind: 'tiding', count, surfaced }),
            surfaced,
            target: b.poiId ? { kind: 'settlement', poiId: b.poiId }
              : npc ? { kind: 'npc', npcId: npc.id } : { kind: 'none' },
            ...(poi?.position ? { anchor: { x: poi.position.x, y: poi.position.y } }
              : npc ? { anchor: { x: npc.x, y: npc.y } } : {}),
          });
        }
        // Cap the news: keep only the most salient buckets (stable id tiebreak).
        tidings.sort((a, b) => (b.salience - a.salience) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        items.push(...tidings.slice(0, MAX_TIDING_ITEMS));
      }

      // ── M1: the chronicler's voice — the latest daily annal, surfaced as one
      // low-salience inbox item (no new panel; reuses the existing tiding lens).
      const chronicle = deps.chronicleLatest?.();
      if (chronicle) {
        const id = `chronicle:${chronicle.year}:${chronicle.dayOfYear}`;
        const surfaced = surfacedSet.has(id);
        items.push({
          id,
          kind: 'tiding',
          title: `The chronicle of Y${chronicle.year} ${chronicle.season}, day ${chronicle.dayOfYear}`,
          detail: chronicle.text,
          salience: scoreAffordance({ kind: 'chronicle', surfaced }),
          surfaced,
          target: { kind: 'none' },
        });
      }

      // Deterministic order: salience desc, then id asc as a stable tiebreak.
      items.sort((a, b) => (b.salience - a.salience) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return items;
    },

    screenshot(): string {
      // Prefer the capture provider (fresh render + scene/overlay composite); fall
      // back to the raw canvas in environments that don't supply one.
      if (deps.capture) return deps.capture();
      return deps.canvas ? deps.canvas.toDataURL('image/png') : '';
    },

    connectomeDiagnostics(): ContractReport {
      if (!state.world || !state.map) {
        return {
          total: 0, counts: { error: 0, warn: 0, info: 0 }, byRule: {}, diagnostics: [],
          byLevel: { building: 0, site: 0, settlement: 0, world: 0 },
          byKind: { invariant: 0, requirement: 0 }, unmet: [],
        };
      }
      return evaluateContracts({ world: state.world, map: state.map });
    },
  };
}
