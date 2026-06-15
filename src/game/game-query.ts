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
import { isDurable } from '@/sim/believers';
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

export interface GameQuery {
  worldSummary(): WorldSummary;
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
}

export interface GameQueryDeps {
  state: GameState;
  /** Browser-only; omit in Node tests → `screenshot()` returns ''. */
  canvas?: HTMLCanvasElement | null;
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

    screenshot(): string {
      return deps.canvas ? deps.canvas.toDataURL('image/png') : '';
    },
  };
}
