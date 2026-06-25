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
import { evaluateConnectome, type DiagnosticReport } from '@/world/connectome-diagnostics';
import { isDurable } from '@/sim/believers';
import { ALL_DOMAINS, DOMAIN_DEFS, aggregateDomain, isOminous } from '@/sim/belief-domains';
import { getCapability } from '@/sim/command/registry';
import { calendarLabel, TICKS_PER_DAY, DAYS_PER_YEAR } from '@/core/calendar';
import { PLAYER_SPIRIT_ID } from '@/sim/believers';
import { POWER_REGEN_RATE, POWER_UNDERSTANDING_COEFF, POWER_DEVOTION_COEFF } from '@/sim/spirit-system';

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
}

export interface NpcDetail extends NpcView {
  beliefs: Record<string, BeliefRef>;
  needs: { safety: number; prosperity: number; community: number; meaning: number };
  personality: { assertiveness: number; skepticism: number; piety: number; sociability: number };
  relationships: { npcId: string; type: string; trust: number }[];
  lineageId: EntityId;
  ageYears: number;
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

export type InboxKind = 'prayer' | 'opportunity' | 'threat';

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
  beliefState(spiritId?: SpiritId): BeliefView;
  settlement(poiId: string): SettlementView | null;
  events(sinceId?: number): AppendedEvent[];
  timeline(): TimelineView;
  spirits(): SpiritView[];
  /** Canvas as a PNG data URL (browser only; '' headless). */
  screenshot(): string;
  /** The connectome linter: structured diagnostics (rule breaks / smells / pressure
   *  points) over the generated world, for agents + the studio overlay. */
  connectomeDiagnostics(): DiagnosticReport;
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
      const surfaced = state.surfacedInbox ?? new Set<string>();
      const items: InboxItem[] = [];

      // ── prayers: NPCs actively pleading (worship), weighted by faith × need ──
      for (const e of world.query({ kind: 'npc' })) {
        const p = npcProps(e);
        if (p.activity !== 'worship') continue;
        const faith = p.beliefs[spiritId]?.faith ?? 0;
        if (faith <= 0) continue;
        const meaningDeficit = 1 - p.needs.meaning;
        items.push({
          id: `prayer:${e.id}`,
          kind: 'prayer',
          title: `${p.name} is praying`,
          detail: `A ${p.role} pleads for an answer.`,
          salience: faith * (0.4 + 0.6 * meaningDeficit),
          surfaced: false,
          target: { kind: 'npc', npcId: e.id },
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
        const poiName = state.worldSeed?.pois.find(pp => pp.id === poiId)?.name ?? poiId;
        items.push({
          id: `opp:${poiId}`,
          kind: 'opportunity',
          title: `${worstType} grips ${poiName}`,
          detail: 'A sign now would be taken as your hand on the sky.',
          salience: 0.5 + 0.5 * worst,
          surfaced: false,
          target: { kind: 'settlement', poiId },
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
        items.push({
          id: `threat:${s.id}`,
          kind: 'threat',
          title: `${s.name} courts the faithful`,
          detail: `${rivalBelievers} soul(s) lean toward a rival.`,
          salience: 0.4 + Math.min(0.5, rivalBelievers * 0.05),
          surfaced: false,
          target: { kind: 'none' },
        });
      }

      // Fate surfacing (B-E): promoted items get flagged + boosted above the pack.
      for (const it of items) {
        if (surfaced.has(it.id)) { it.surfaced = true; it.salience += 1; }
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

    connectomeDiagnostics(): DiagnosticReport {
      if (!state.world || !state.map) {
        return { total: 0, counts: { error: 0, warn: 0, info: 0 }, byRule: {}, diagnostics: [] };
      }
      return evaluateConnectome({ world: state.world, map: state.map });
    },
  };
}
