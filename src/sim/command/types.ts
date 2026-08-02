/**
 * Command channel — core types.
 *
 * One typed intent stream that the player, rival spirits, and (later) Fate all
 * emit onto. A `Command` is a *request*; the executor validates it against the
 * capability registry and either applies it (delegating to divine-actions.ts) or
 * returns a structured rejection. See
 * docs/superpowers/specs/2026-06-03-command-channel-capability-registry-design.md.
 */
import type { Spirit, SpiritId } from '@/core/spirit';
import type { World } from '@/world/world';
import type { EventLog } from '@/core/events';
import type { Rng } from '@/core/rng';
import type { WeatherStepper } from '@/sim/water/weather-stepper';

export type CommandVerb =
  // divine tier — implemented, belief-spending interventions
  | 'whisper' | 'omen' | 'dream' | 'miracle' | 'answer_prayer' | 'probe_mind'
  // divine tier — belief-CONTENT gated dramatic actions (Track B, what believers
  // think you can do unlocks the verb; see src/sim/belief-domains.ts)
  | 'smite' | 'summon_storm'
  // divine tier — the Peace of God (mortal-power M6): spends the congregation's
  // DEVOTION (never power) to bind a seated lord's armed men by oath
  | 'proclaim_peace' | 'bind_oath'
  // authoring tier — DECLARED, executor pending (filled in by the Fate cycle)
  | 'bias_event' | 'inject_npc' | 'nudge_severity' | 'place_building' | 'grow_settlement'
  | 'rename_ward' | 'retype_ward' | 'set_rival_stance' | 'set_lord_stance'
  // authoring tier — mortal power M4: the settlement's seated LORD founds a
  // castle (a runtime POI + physical stamp). MORTAL power made concrete — the
  // player's god cannot build castles (tenet 9: mortals act first); the verb is
  // how Fate/dev coaching triggers the lord's act. See castle-verbs.ts.
  | 'found_castle'
  // authoring tier — mortal power (Manning the Walls W3): the settlement's resident soldiers
  // muster onto its walls, or stand back down, on the seated lord's order — a standing order
  // riding `GarrisonOrders` (`state.garrisonOrders`) alongside the auto-muster `GarrisonSystem`
  // already derives from the contention ladder. Same tier reasoning as `found_castle`.
  | 'muster_garrison' | 'stand_down_garrison'
  // editor tier — god-mode world authoring (the Create panel; cost 0, no spirit)
  | 'author_spawn_npc' | 'author_remove_entity' | 'author_modify_npc'
  | 'author_place_object' | 'author_move_entity' | 'author_set_climate'
  // meta tier (R9 time controls) — change HOW FAST the sim advances, not sim
  // state. Intercepted on the GAME side (never enqueued), so they never enter the
  // sim tick / event log / snapshot / replay. See registry.ts + game-bus onMeta.
  | 'set_time_rate' | 'skip_to_next_event' | 'cancel_seek'
  // meta tier (UI v3) — the SHELL verbs: starting/loading/saving a world, moving
  // between meta screens, settings, key rebinding, photo + seed share. Same
  // contract as the time controls above: no `apply`, intercepted at the dispatch
  // boundary, never enqueued — but registered here so the whole menu flow is
  // drivable by MCP / the dev bus / tests through the ordinary command path
  // instead of a bespoke test hook. See registry.ts + Game.handleMetaCommand.
  | 'new_game' | 'load_slot' | 'save_slot' | 'delete_slot' | 'rename_slot'
  | 'quit_to_title' | 'open_screen' | 'close_screen'
  | 'set_setting' | 'rebind_key' | 'capture_photo' | 'copy_world_code';

export type CommandTarget =
  | { kind: 'npc'; npcId: string }
  | { kind: 'entity'; id: string }            // any World entity (flora/prop/animal)
  | { kind: 'settlement'; poiId: string }
  | { kind: 'tile'; x: number; y: number }    // a point on the ground
  // A disc on the ground: centre (x,y) + radius in tiles — the area-effect
  // counterpart to 'tile' (agent-driven-UI P2 / abilities-v1 B1). `radius` is
  // ADVISORY: nobody trusts it raw — every reader (the cost formula, the
  // apply effect) re-derives the same clamp via `clampAreaRadius` below, so a
  // hand-built Command or a stale bus/MCP call can never see preview and
  // effect disagree about what actually got cast.
  | { kind: 'area'; x: number; y: number; radius: number }
  | { kind: 'none' };

/** The discriminant of every CommandTarget — the vocabulary a verb can accept. */
export type CommandTargetKind = CommandTarget['kind'];

/**
 * Clamp an area-target radius into the playable band (2..12 tiles) — narrower
 * is pointless (a point/tile target is cheaper and more precise), wider
 * outruns the area-neutral cost formula's headroom (registry.ts). This is a
 * CLAMP, never a rejection — `previewCommand` (command-system.ts) rejects a
 * command only for a non-finite radius or an out-of-bounds centre, so a
 * sloppy agent call still does something sane rather than bouncing. Every
 * reader of an area radius — the cost formula, `summonStormAt`'s effect, the
 * preview's own gate — MUST go through this one function, never clamp
 * independently, or preview and apply could disagree about the disc actually
 * cast. Lives here (not registry.ts / divine-actions.ts, both of which need
 * it) because `types.ts` carries zero RUNTIME imports of its own (everything
 * above is `import type`) — the leaf-module pattern (CLAUDE.md) without a new
 * file, exactly like `divine-costs.ts` for the cost constants.
 */
export function clampAreaRadius(radius: number): number {
  const r = Number.isFinite(radius) ? radius : 2;
  return Math.round(Math.max(2, Math.min(12, r)));
}

export interface Command {
  verb: CommandVerb;
  /** Who is acting: 'player', a rival id, 'fate', or 'author' (editor tier). */
  source: SpiritId;
  target: CommandTarget;
  /** Verb-specific params (reserved; the v1 divine verbs ignore it). */
  params?: Record<string, number | string>;
  /** Structured args for editor-tier verbs (entityId, role, coords, …). */
  payload?: Record<string, unknown>;
  /** Monotonic emission order, stamped by the queue on emit. */
  seq: number;
}

export type RejectionReason =
  | 'insufficient_power'
  | 'precondition_failed'
  | 'not_implemented'
  | 'invalid_target'
  | 'invalid_payload'
  | 'unknown_source';

export type CommandResult =
  | { status: 'applied'; verb: CommandVerb; source: SpiritId }
  | { status: 'rejected'; verb: CommandVerb; source: SpiritId; reason: RejectionReason };

/** Everything the registry needs to validate + apply a command. */
export interface CommandCtx {
  world: World;
  spirits: Map<SpiritId, Spirit>;
  log: EventLog;
  /** W-H: the deterministic water stepper, so weather verbs (`summon_storm`) can lay
   *  a flood as part of their (logged, replay-safe) command apply. Optional — preview
   *  callers and headless paths omit it; the verb no-ops its flood if absent. */
  weather?: WeatherStepper | null;
  /** M4: the full game state, for verbs whose effect lives beyond the World —
   *  `found_castle` writes the RuntimePoiStore (`state.runtimePois`) and projects
   *  the directory into BOTH worldSeed clones (`state.worldSeed` + map's).
   *  Injected by CommandExecutorSystem (like `weather`); preview callers that
   *  omit it lose only state-dependent precondition checks (the apply re-checks
   *  and declines cleanly). Type-only import — no runtime cycle. */
  state?: import('@/core/state').GameState | null;
}

/**
 * The context an `apply` receives — `CommandCtx` plus the seeded RNG and current
 * tick. Editor verbs need these to place/seed deterministically; divine verbs
 * ignore them. Kept separate from `CommandCtx` so read-only callers
 * (previewCommand, the player UI's optimistic gate) need not supply them.
 */
export interface ApplyCtx extends CommandCtx {
  rng: Rng;
  now: number;
}
