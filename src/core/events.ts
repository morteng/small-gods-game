import type { SimClock } from '@/core/clock';
import type { EntityId, NpcRole, Region, WorldSeed } from '@/core/types';
import type { SpiritId } from '@/core/spirit';

export type SimEvent =
  | { type: 'world_seeded';       worldSeed: WorldSeed; substrateSeed: number }
  | { type: 'spirit_birth';       spiritId: SpiritId; name: string; isPlayer: boolean }
  | { type: 'spirit_manifest';    spiritId: SpiritId; form: 'avatar'; at: { x: number; y: number } }
  | { type: 'spirit_possess';     spiritId: SpiritId; npcId: EntityId }
  | { type: 'spirit_unmanifest';  spiritId: SpiritId; reason: 'voluntary' | 'killed' | 'unhost' }
  | { type: 'spirit_gaze_shift';  spiritId: SpiritId; fromNpcId?: EntityId; toNpcId: EntityId }
  | { type: 'npc_spawn';          npcId: EntityId; role: NpcRole; poiId: string }
  | { type: 'whisper';            spiritId: SpiritId; npcId: EntityId }
  | { type: 'belief_cross';       npcId: EntityId; spiritId: SpiritId; kind: 'high' | 'low'; faith: number }
  | { type: 'mood_cross';         npcId: EntityId; kind: 'high' | 'low'; mood: number }
  | { type: 'power_depleted';     spiritId: SpiritId }
  | { type: 'region_realized';    region: Region; cause: 'belief_spread' | 'miracle' | 'cradle_start' }
  | { type: 'tile_collapsed';     x: number; y: number; becameType: string; by: 'wfc' | 'oracle' }
  | { type: 'entity_emerged';     entityId: EntityId; kind: string; x: number; y: number }
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

  size(): number {
    return this.events.length;
  }
}

export type { SpiritId };
