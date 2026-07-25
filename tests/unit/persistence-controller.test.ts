import { describe, it, expect, vi } from 'vitest';
import { PersistenceController, type JournalDelta } from '@/game/persistence-controller';
import { createState } from '@/core/state';
import { World } from '@/world/world';
import type { GameMap, Tile } from '@/core/types';
import type { SaveFile } from '@/core/save-file';
import type { SaveSlot, SaveMetaInput } from '@/services/save-store';

function miniMap(): GameMap {
  const tiles: Tile[][] = [[{ type: 'grass', x: 0, y: 0, walkable: true, state: 'realized' }]];
  return { tiles, width: 1, height: 1, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

function freshState() {
  const s = createState();
  s.map = miniMap();
  s.world = new World(s.map);
  return s;
}

interface RecordedWrite { save: SaveFile; meta: SaveMetaInput; journal: JournalDelta; slot: SaveSlot; }

function mkController(over: Partial<ConstructorParameters<typeof PersistenceController>[0]> = {}) {
  const writes: RecordedWrite[] = [];
  const state = over.state ?? freshState();
  const ctrl = new PersistenceController({
    state,
    timeline: { isScrubbed: false } as any,
    now: () => 0,
    throttleMs: 1000,
    // The controller hands the writer a FACTORY (live-reference save); invoke it
    // like the real writer does, synchronously with the persist step. Also
    // records the meta/journal/slot the controller computed for this write.
    write: async (makeSave, meta, journal, slot) => { writes.push({ save: makeSave(), meta, journal, slot }); },
    ...over,
  });
  return { ctrl, writes, state };
}

describe('PersistenceController', () => {
  it('coalesces multiple dirty marks into one throttled write', async () => {
    vi.useFakeTimers();
    const { ctrl, writes } = mkController();
    ctrl.start();
    ctrl.markDirty(); ctrl.markDirty(); ctrl.markDirty();
    await vi.advanceTimersByTimeAsync(1100);
    expect(writes.length).toBe(1);
    ctrl.destroy();
    vi.useRealTimers();
  });

  it('does not write while the timeline is scrubbed', async () => {
    vi.useFakeTimers();
    const { ctrl, writes } = mkController({ timeline: { isScrubbed: true } as any });
    ctrl.start();
    ctrl.markDirty();
    await vi.advanceTimersByTimeAsync(2000);
    expect(writes.length).toBe(0);
    ctrl.destroy();
    vi.useRealTimers();
  });

  it('flush() writes immediately when dirty', async () => {
    const { ctrl, writes } = mkController();
    ctrl.start();
    ctrl.markDirty();
    await ctrl.flush();
    expect(writes.length).toBe(1);
    ctrl.destroy();
  });

  it('flush() is a no-op when not dirty', async () => {
    const { ctrl, writes } = mkController();
    ctrl.start();
    await ctrl.flush();
    expect(writes.length).toBe(0);
    ctrl.destroy();
  });

  it('destroy() cancels a pending throttled write', async () => {
    vi.useFakeTimers();
    const { ctrl, writes } = mkController();
    ctrl.start();
    ctrl.markDirty();
    ctrl.destroy();
    await vi.advanceTimersByTimeAsync(2000);
    expect(writes.length).toBe(0);
    vi.useRealTimers();
  });

  it('marks dirty automatically on an eventLog append', async () => {
    const { ctrl, writes, state } = mkController();
    ctrl.start();
    state.eventLog.append({ type: 'power_depleted', spiritId: 'player' });
    await ctrl.flush();
    expect(writes.length).toBe(1);
    ctrl.destroy();
  });

  it('defaults the coalesce window to 30 s (a save stalls the main thread — cadence is a smoothness dial)', async () => {
    vi.useFakeTimers();
    const { ctrl, writes } = mkController({ throttleMs: undefined });
    ctrl.start();
    ctrl.markDirty();
    await vi.advanceTimersByTimeAsync(29_000);
    expect(writes.length).toBe(0);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(writes.length).toBe(1);
    ctrl.destroy();
    vi.useRealTimers();
  });

  it('the built save aliases live state and encodes tiles synchronously (single-clone contract)', async () => {
    const { ctrl, state } = mkController();
    ctrl.start();
    ctrl.markDirty();
    let aliased = false;
    let tilesEncoded = false;
    (ctrl as any).write = async (makeSave: () => SaveFile) => {
      const save = makeSave();
      // Non-tile map fields still alias live state — the writer must persist
      // synchronously with the factory call (put()'s clone is the one copy).
      aliased = save.map.villages === state.map!.villages;
      // Tiles are the exception: the factory ENCODES them into the compact
      // typed-array codec, so put()'s clone never walks the tile objects.
      tilesEncoded = save.map.tiles.typeOrd instanceof Uint16Array
        && !Array.isArray(save.map.tiles);
    };
    await ctrl.flush();
    expect(aliased).toBe(true);
    expect(tilesEncoded).toBe(true);
    ctrl.destroy();
  });
});

describe('PersistenceController — journal delta + meta provider', () => {
  it('the first write carries every event appended since construction (cursor starts at 0)', async () => {
    // createState() seeds one `spirit_birth` event, so "since construction"
    // already means "since before this test appended anything" — assert
    // against eventLog.size() rather than a hardcoded count.
    const { ctrl, writes, state } = mkController();
    ctrl.start();
    state.eventLog.append({ type: 'power_depleted', spiritId: 'player' });
    state.eventLog.append({ type: 'power_depleted', spiritId: 'player' });
    await ctrl.flush();
    expect(writes).toHaveLength(1);
    expect(writes[0].journal.events).toHaveLength(state.eventLog.size());
    expect(writes[0].journal.from).toBe(0);
  });

  it('a second write only carries events NEW since the first (the cursor advances)', async () => {
    const { ctrl, writes, state } = mkController();
    ctrl.start();
    state.eventLog.append({ type: 'power_depleted', spiritId: 'player' });
    await ctrl.flush();
    const firstBatch = writes[0].journal.events;
    expect(firstBatch.length).toBe(state.eventLog.size()); // seeded event(s) + this one
    const firstId = firstBatch[firstBatch.length - 1].id;

    state.eventLog.append({ type: 'power_depleted', spiritId: 'player' });
    await ctrl.flush();
    expect(writes).toHaveLength(2);
    // The delta, not the cumulative log — this is the whole point of the
    // journal (O(delta) per save, not O(total history)).
    expect(writes[1].journal.events).toHaveLength(1);
    expect(writes[1].journal.events[0].id).not.toBe(firstId);
    expect(writes[1].journal.from).toBe(firstId);
  });

  it('initialCursor seeds the autosave slot so a RESUMED game only journals events after the resumed save', async () => {
    const state = freshState();
    // Simulate history already persisted under the resumed save (ids 1, 2).
    state.eventLog.append({ type: 'power_depleted', spiritId: 'player' });
    const resumedAt = state.eventLog.append({ type: 'power_depleted', spiritId: 'player' }).id;
    const { ctrl, writes } = mkController({ state, initialCursor: resumedAt });
    ctrl.start();
    state.eventLog.append({ type: 'power_depleted', spiritId: 'player' }); // NEW, post-resume
    await ctrl.flush();
    expect(writes).toHaveLength(1);
    expect(writes[0].journal.events).toHaveLength(1);
    expect(writes[0].journal.from).toBe(resumedAt);
  });

  it('defaults the meta provider (plain name, zeroed tier/mass/playtime, no thumbnail)', async () => {
    const { ctrl, writes } = mkController();
    ctrl.start();
    ctrl.markDirty();
    await ctrl.flush();
    expect(writes[0].meta).toMatchObject({
      name: 'Autosave', dateLabel: '', godTier: '', beliefMass: 0, playtimeMs: 0, thumbnail: null,
    });
  });

  it('uses an injected meta provider — never reaches into Game for these fields itself', async () => {
    const meta: SaveMetaInput = {
      name: 'My World', tick: 42, dateLabel: 'Day 3, dusk', godTier: 'whisper',
      beliefMass: 12.5, playtimeMs: 90_000, thumbnail: 'data:image/jpeg;base64,x',
    };
    const { ctrl, writes } = mkController({ meta: () => meta });
    ctrl.start();
    ctrl.markDirty();
    await ctrl.flush();
    expect(writes[0].meta).toEqual(meta);
    // The playtime also rides the SaveFile blob itself (top-level, per the
    // v4 SaveFile shape), not just the meta row.
    expect(writes[0].save.playtimeMs).toBe(90_000);
  });

  it('writes to the configured slot (default "autosave")', async () => {
    const { ctrl, writes } = mkController();
    ctrl.start();
    ctrl.markDirty();
    await ctrl.flush();
    expect(writes[0].slot).toBe('autosave');
  });

  it('writes to a custom configured autosave slot', async () => {
    const { ctrl, writes } = mkController({ slot: 'slot2' });
    ctrl.start();
    ctrl.markDirty();
    await ctrl.flush();
    expect(writes[0].slot).toBe('slot2');
  });
});

describe('PersistenceController.saveNow — manual save', () => {
  it('writes immediately to the given slot, ignoring the throttle/dirty gate', async () => {
    const { ctrl, writes } = mkController();
    ctrl.start();
    // Deliberately NOT dirty — saveNow must still write.
    await ctrl.saveNow('slot1');
    expect(writes).toHaveLength(1);
    expect(writes[0].slot).toBe('slot1');
    ctrl.destroy();
  });

  it('writes even while the timeline is scrubbed (the player asked for THIS moment)', async () => {
    const { ctrl, writes } = mkController({ timeline: { isScrubbed: true } as any });
    ctrl.start();
    await ctrl.saveNow('slot1');
    expect(writes).toHaveLength(1);
    ctrl.destroy();
  });

  it('an optional name override replaces the meta provider\'s name for this write only', async () => {
    const { ctrl, writes } = mkController({ meta: () => ({
      name: 'Autosave', tick: 0, dateLabel: '', godTier: '', beliefMass: 0, playtimeMs: 0, thumbnail: null,
    }) });
    ctrl.start();
    await ctrl.saveNow('slot1', 'Before the Flood');
    expect(writes[0].meta.name).toBe('Before the Flood');
  });

  it('each slot tracks its own journal cursor independently', async () => {
    const { ctrl, writes, state } = mkController();
    ctrl.start();
    state.eventLog.append({ type: 'power_depleted', spiritId: 'player' });
    await ctrl.saveNow('slot1');
    const sizeAfterFirst = state.eventLog.size();
    expect(writes[0].journal.events).toHaveLength(sizeAfterFirst);

    state.eventLog.append({ type: 'power_depleted', spiritId: 'player' });
    // slot2 has never been written — it owes its FULL history (from 0), same
    // as slot1 did on its first write, independent of slot1's cursor.
    await ctrl.saveNow('slot2');
    expect(writes[1].journal.events).toHaveLength(state.eventLog.size());
    expect(writes[1].journal.from).toBe(0);
  });

  it('saveNow to the autosave slot clears a pending throttled write', async () => {
    vi.useFakeTimers();
    const { ctrl, writes } = mkController();
    ctrl.start();
    ctrl.markDirty();
    await ctrl.saveNow('autosave');
    expect(writes).toHaveLength(1);
    // The pending throttled write is now redundant (already subsumed) — it
    // must not fire a second, empty-delta write.
    await vi.advanceTimersByTimeAsync(2000);
    expect(writes).toHaveLength(1);
    ctrl.destroy();
    vi.useRealTimers();
  });
});
