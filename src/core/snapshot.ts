import type { GameState } from '@/core/state';
import type { Entity } from '@/core/types';
import type { RngState } from '@/core/rng';
import type { Spirit } from '@/core/spirit';
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
  /** Complete deep-cloned copies of every spirit. Snapshot is authoritative. */
  spirits: Spirit[];
}

export function captureSnapshot(state: GameState): Snapshot {
  if (!state.world) {
    throw new Error('captureSnapshot: state.world is null — call after world seed');
  }
  const entities: Entity[] = state.world.query({}).map(e => ({
    ...e,
    properties: structuredClone(e.properties),
  }));
  const spirits = Array.from(state.spirits.values()).map(s => structuredClone(s));
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

  // Snapshot is authoritative: replace the spirits map wholesale so spirits
  // present at capture time are reinstated, and any added after capture are
  // dropped (matches "rewind == go back to that exact world" semantics).
  state.spirits.clear();
  for (const s of snap.spirits) {
    state.spirits.set(s.id, structuredClone(s));
  }

  const fresh = new World(state.map);
  for (const e of snap.entities) {
    fresh.addEntity({ ...e, properties: structuredClone(e.properties) });
  }
  state.world = fresh;
}
