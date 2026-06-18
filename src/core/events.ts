import type { SimClock } from '@/core/clock';
import type { EntityId, NpcRole, Region, WorldSeed, SettlementEventType } from '@/core/types';
import type { SpiritId } from '@/core/spirit';
import type { ThreadId, ShapeId, ThreadSubject, NarrativeWeight } from '@/sim/threads/thread-types';
import type { BeatId } from '@/sim/threads/staging-types';

export type SimEvent =
  | { type: 'world_seeded';       worldSeed: WorldSeed; substrateSeed: number }
  | { type: 'spirit_birth';       spiritId: SpiritId; name: string; isPlayer: boolean }
  | { type: 'spirit_manifest';    spiritId: SpiritId; form: 'avatar'; at: { x: number; y: number } }
  | { type: 'spirit_possess';     spiritId: SpiritId; npcId: EntityId }
  | { type: 'spirit_unmanifest';  spiritId: SpiritId; reason: 'voluntary' | 'killed' | 'unhost' }
  | { type: 'spirit_gaze_shift';  spiritId: SpiritId; fromNpcId?: EntityId; toNpcId: EntityId }
  | { type: 'npc_spawn';          npcId: EntityId; role: NpcRole; poiId: string }
  | { type: 'whisper';            spiritId: SpiritId; npcId: EntityId }
  | { type: 'omen';               spiritId: SpiritId; poiId: string; severity: number }
  | { type: 'dream';              spiritId: SpiritId; npcId: EntityId }
  | { type: 'miracle';            spiritId: SpiritId; poiId: string; needType: string; amount: number }
  | { type: 'answer_prayer';      spiritId: SpiritId; npcId: EntityId }
  | { type: 'smite';              spiritId: SpiritId; npcId: EntityId; poiId?: string; witnesses: number }
  | { type: 'mind_probed';        spiritId: SpiritId; npcId: EntityId; depth: number }
  | { type: 'believer_lost';      npcId: EntityId }
  | { type: 'npc_death';          npcId: EntityId; lineageId: EntityId; cause: string }
  | { type: 'npc_birth';          npcId: EntityId; parentIds: EntityId[]; lineageId: EntityId }
  | { type: 'timeline_commit';    parentTick: number; rerolled: boolean }
  | { type: 'era_skipped';        fromTick: number; toTick: number; years: number; deaths: number; births: number; believersBefore: number; believersAfter: number }
  | { type: 'authored_spawn';     entityIds: EntityId[]; role: string; count: number }
  | { type: 'authored_remove';    entityIds: EntityId[]; count: number }
  | { type: 'authored_modify';    entityId: EntityId; fields: string[] }
  | { type: 'authored_place';     entityIds: EntityId[]; kind: string; count: number }
  | { type: 'authored_move';      entityId: EntityId; to: { x: number; y: number } }
  | { type: 'authored_climate';   climate: string }
  | { type: 'belief_cross';       npcId: EntityId; spiritId: SpiritId; kind: 'high' | 'low'; faith: number }
  | { type: 'mood_cross';         npcId: EntityId; kind: 'high' | 'low'; mood: number }
  | { type: 'power_depleted';     spiritId: SpiritId }
  | { type: 'region_realized';    region: Region; cause: 'belief_spread' | 'miracle' | 'cradle_start' }
  | { type: 'tile_collapsed';     x: number; y: number; becameType: string; by: 'wfc' | 'oracle' }
  | { type: 'entity_emerged';     entityId: EntityId; kind: string; x: number; y: number }
  | { type: 'settlement_grown';   poiId: string; entityId: EntityId; preset: string; lotId: string }
  | { type: 'settlement_upgraded'; poiId: string; entityId: EntityId; from: string; to: string; lotId: string }
  | { type: 'settlement_begin';   poiId: string; eventType: SettlementEventType; severity: number; durationTicks: number }
  | { type: 'settlement_end';     poiId: string; eventType: SettlementEventType }
  | { type: 'thread_opened';      threadId: ThreadId; shapeId: ShapeId; subject: ThreadSubject }
  | { type: 'thread_advanced';    threadId: ThreadId; phase: string; weight: NarrativeWeight }
  | { type: 'thread_resolved';    threadId: ThreadId; status: 'resolved' | 'abandoned' }
  | { type: 'beat_fired';         beatId: BeatId; subject: ThreadSubject; threadId?: ThreadId }
  | { type: 'system_error';       system: string; message: string };

export interface AppendedEvent {
  id: number;
  t: number;
  event: SimEvent;
}

export class EventLog {
  private events: AppendedEvent[] = [];
  private nextId = 1;
  private subscribers = new Set<(e: AppendedEvent) => void>();
  private readonly clock: SimClock;

  constructor(clock: SimClock) {
    this.clock = clock;
  }

  append(event: SimEvent): AppendedEvent {
    const appended: AppendedEvent = {
      id: this.nextId++,
      t: this.clock.now(),
      event,
    };
    this.events.push(appended);
    for (const fn of this.subscribers) {
      try {
        fn(appended);
      } catch (err) {
        console.error('[event-log] subscriber threw:', err);
      }
    }
    return appended;
  }

  subscribe(fn: (e: AppendedEvent) => void): () => void {
    this.subscribers.add(fn);
    return () => { this.subscribers.delete(fn); };
  }

  since(eventId: number): AppendedEvent[] {
    return this.events.filter(e => e.id > eventId);
  }

  range(tStart: number, tEnd: number): AppendedEvent[] {
    return this.events.filter(e => e.t >= tStart && e.t < tEnd);
  }

  /** O(n) lookup of a previously appended event by its numeric id. */
  getById(id: number): AppendedEvent | undefined {
    return this.events.find(e => e.id === id);
  }

  size(): number {
    return this.events.length;
  }

  /**
   * Drop every event with `t > cutoff`. Keeps `nextId` ahead of the highest
   * retained id so future appends never reuse a discarded id. Used by
   * `TimelineController.commit` when truncating after a scrub-and-commit.
   */
  truncateAfter(cutoff: number): void {
    this.events = this.events.filter(e => e.t <= cutoff);
    const highest = this.events.reduce((m, e) => (e.id > m ? e.id : m), 0);
    this.nextId = highest + 1;
  }

  /**
   * Bulk-load a serialized event array (from a save file). Replaces the log
   * contents and advances `nextId` past every restored id so future appends
   * never reuse one. Silent: subscribers are not re-notified.
   */
  hydrate(events: AppendedEvent[]): void {
    this.events = events.slice();
    this.nextId = events.reduce((m, e) => (e.id > m ? e.id : m), 0) + 1;
  }
}

/**
 * No-op replacement for EventLog used during replay. Append/subscribe are
 * no-ops so re-running systems doesn't pollute the canonical log.
 */
export class SilentEventLog extends EventLog {
  override append(event: SimEvent): AppendedEvent {
    return { id: 0, t: 0, event };
  }

  override subscribe(_fn: (e: AppendedEvent) => void): () => void {
    return () => {};
  }

  override since(): AppendedEvent[] {
    return [];
  }

  override range(): AppendedEvent[] {
    return [];
  }

  override size(): number {
    return 0;
  }
}

export type { SpiritId };
