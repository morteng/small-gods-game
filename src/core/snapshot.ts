import type { GameState } from '@/core/state';
import type { Entity } from '@/core/types';
import type { RngState } from '@/core/rng';
import type { Manifestation } from '@/core/spirit';
import { fromState } from '@/core/rng';
import { World } from '@/world/world';

export interface Snapshot {
  /** Sim tick count at capture time. */
  tick: number;
  /** Number of events in the log at capture time. */
  eventId: number;
  /** Serialized RNG state. */
  rng: RngState;
  /** Deep-cloned copies of every world entity. */
  entities: Entity[];
  /** Snapshot of every spirit: id, power, and manifestation. */
  spirits: Array<{ id: string; power: number; manifestation: Manifestation | null }>;
}

export function captureSnapshot(state: GameState): Snapshot {
  if (!state.world) {
    throw new Error('captureSnapshot: state.world is null — call after world seed');
  }
  const entities: Entity[] = state.world.query({}).map(e => ({
    ...e,
    properties: structuredClone(e.properties),
  }));
  const spirits = Array.from(state.spirits.values()).map(s => ({
    id: s.id,
    power: s.power,
    manifestation: s.manifestation ? structuredClone(s.manifestation) : null,
  }));
  return {
    tick: state.clock.now(),
    eventId: state.eventLog.size(),
    rng: state.rng.getState(),
    entities,
    spirits,
  };
}

export function restoreSnapshot(state: GameState, snap: Snapshot): void {
  if (!state.world || !state.map) {
    throw new Error('restoreSnapshot: world/map not initialized');
  }
  state.clock.setNow(snap.tick);
  state.rng = fromState(snap.rng);

  for (const ss of snap.spirits) {
    const live = state.spirits.get(ss.id);
    if (live) {
      live.power = ss.power;
      live.manifestation = ss.manifestation;
    }
  }

  const fresh = new World(state.map);
  for (const e of snap.entities) {
    fresh.addEntity({ ...e, properties: structuredClone(e.properties) });
  }
  state.world = fresh;
}
