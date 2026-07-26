/**
 * Abilities v1 — A4: cast FX subscribe to the event log, not to the player's
 * click. Before this slice, `Game.fireCastFx` fired from `emitDivine` — the
 * PLAYER's emit seam — so a `smite`/`summon_storm` issued through the bus
 * (MCP bridge, an agent, a rival, Fate) produced no visual feedback at all.
 * Now `Game.onDivineFxEvent` subscribes to `state.eventLog` (the SAME seam
 * `onEncounterEvent`/`FateTrigger` already use) and reacts to the event's OWN
 * coordinates, regardless of who cast it.
 *
 * These tests drive the REAL command pipeline: `bus.emit` enqueues onto
 * `Game`'s own `CommandQueue`; a standalone `CommandExecutorSystem` bound to
 * that same queue + the game's own state (not a mock) drains and applies it,
 * which is what actually appends the `smite`/`summon_storm` SimEvent that
 * `onDivineFxEvent` reacts to — exactly the path a live game's scheduler runs,
 * just invoked directly instead of through `Game`'s full multi-system tick (so
 * a minimal jsdom world doesn't have to satisfy every OTHER system's data
 * assumptions too).
 *
 * `smite`/`summon_storm` are both belief-CONTENT gated (the congregation must
 * believe the god commands the storm/rains — `src/sim/belief-domains.ts`), so
 * each test seeds one fully-convinced believer, following the `convince()`
 * pattern in `tests/unit/smite-targeting.test.ts`.
 */
/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Game } from '@/game';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import { addDomainBelief } from '@/sim/belief-domains';
import { CommandExecutorSystem } from '@/sim/command/command-system';
import type { GameMap, NpcProperties, Tile } from '@/core/types';

if (typeof (globalThis as any).ResizeObserver === 'undefined') {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

function miniMap(): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 16; y++) {
    tiles[y] = [];
    for (let x = 0; x < 16; x++) tiles[y][x] = { type: 'grass', x, y, walkable: true, state: 'realized' };
  }
  return {
    tiles, width: 16, height: 16, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
}

/** A believer whose congregation-conviction unlocks BOTH `smite` (storm) and
 *  `summon_storm` (flood) — fully convinced, matching `smite-targeting.test.ts`'s
 *  `convince()` helper. Placed away from the targets below so belief content
 *  reads as "the congregation believes", not "the target npc believes". */
function seedCongregation(world: World): void {
  const props = initNpcProps('Believer', 'farmer', 999) as NpcProperties;
  props.beliefs = { player: { faith: 1, understanding: 1, devotion: 1 } };
  addDomainBelief(props, 'player', 'storm', 1);
  addDomainBelief(props, 'player', 'flood', 1);
  world.addEntity({ id: 'believer', kind: 'npc', x: 10, y: 10, tags: [], properties: props as unknown as Record<string, unknown> });
}

/** Drain and apply whatever's queued on the game's own CommandQueue, using a
 *  standalone CommandExecutorSystem bound to the game's real state — the same
 *  executor `sim-systems.ts` registers on the live scheduler, invoked directly
 *  so this test doesn't have to satisfy every OTHER registered system's data
 *  assumptions (cohorts, roads, weather POIs, …) just to drain one command. */
function applyQueuedCommands(game: Game): void {
  const state = (game as any).state;
  const queue = (game as any).commandQueue;
  const exec = new CommandExecutorSystem(queue, undefined, undefined, () => state.weather, () => state);
  exec.tick({
    world: state.world, spirits: state.spirits, log: state.eventLog, clock: state.clock,
    rng: state.rng, now: state.clock.now(), dt: 16.667,
  });
}

describe('Game — cast FX fire off the event log, not the player click (abilities-v1 A4)', () => {
  let container: HTMLElement;
  let game: Game;
  let trigger: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);
    game = new Game(container);

    const map = miniMap();
    const state = (game as any).state;
    state.map = map;
    state.world = new World(map);
    seedCongregation(state.world);
    // The default player stipend (10) covers smite (8) but not a full-radius
    // summon_storm (12, SUMMON_STORM_COST) — bump it so every test below is
    // exercising the FX subscription, not tripping an unrelated power gate.
    state.spirits.get('player')!.power = 100;

    trigger = vi.spyOn((game as any).ui.divineEffects, 'trigger');
  });

  afterEach(() => {
    game.destroy();
    container.remove();
    vi.restoreAllMocks();
  });

  it('a bus-emitted smite (not emitDivine) fires the smite FX at the target npc\'s position', () => {
    const state = (game as any).state;
    state.world.addEntity({
      id: 'n1', kind: 'npc', x: 4, y: 6, tags: [],
      properties: initNpcProps('Ada', 'farmer', 1),
    });

    // The bus is the MCP/agent/rival surface — never `emitDivine`, never
    // `castPower`/`resolveTargetedCast`. This is the headline case A4 fixes.
    (game as any).bus.emit({ verb: 'smite', source: 'player', target: { kind: 'npc', npcId: 'n1' } });

    // Enqueued, not yet applied — no event appended yet, so no FX either.
    expect(trigger).not.toHaveBeenCalled();

    applyQueuedCommands(game);

    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith('smite', 4, 6); // smite passes no radius arg at all
  });

  it('a bus-emitted area summon_storm fires the storm FX with its radius threaded through', () => {
    (game as any).bus.emit({
      verb: 'summon_storm', source: 'player',
      target: { kind: 'area', x: 8, y: 8, radius: 4 },
    });
    applyQueuedCommands(game);

    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith('storm', 8, 8, 4);
  });

  it('a settlement-target summon_storm (poiId, no x/y) resolves to the POI position', () => {
    const state = (game as any).state;
    state.worldSeed = { name: 'Test', era: 'medieval', pois: [
      { id: 'p1', type: 'village', name: 'Hollow', importance: 'high', position: { x: 3, y: 5 } },
    ] } as any;

    (game as any).bus.emit({ verb: 'summon_storm', source: 'player', target: { kind: 'settlement', poiId: 'p1' } });
    applyQueuedCommands(game);

    expect(trigger).toHaveBeenCalledTimes(1);
    // A settlement cast carries no `radius` field on its event at all (only an
    // area cast does) — `divine-effects.ts` supplies its own visual default.
    expect(trigger).toHaveBeenCalledWith('storm', 3, 5, undefined);
  });

  it('loading a log full of historical smites (save load) does not replay N effects', () => {
    const state = (game as any).state;
    const historical = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1, t: i * 10,
      event: { type: 'smite' as const, spiritId: 'player', npcId: `ghost${i}`, witnesses: 0 },
    }));

    // `save-file.ts` restores a save exactly this way — `hydrate` is silent by
    // contract (events.test.ts pins it), so the FX subscription must see zero
    // fires for a session's worth of historical smites at load.
    state.eventLog.hydrate(historical);

    expect(trigger).not.toHaveBeenCalled();
  });
});
