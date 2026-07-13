// The scheduler's tick-system roster, extracted from the Game constructor.
// Registration ORDER is load-bearing (documented inline); systems that carry
// internal sim state also register with the snapshot seam (WP-D scrub-ghost
// pattern) so scrub/commit/save-load restores that state with the world.
import type { GameState } from '@/core/state';
import type { Scheduler } from '@/core/scheduler';
import type { CommandQueue } from '@/sim/command/command-queue';
import type { DiscoveryQueue } from '@/sim/threads/discovery-queue';
import type { ThreadSubject } from '@/sim/threads/thread-types';
import type { AuthorCommandLog } from '@/sim/command/author-command-log';
import type { NpcAttentionStore } from '@/llm/npc-attention-store';
import type { StoryRegistry } from '@/story';
import { pathKey } from '@/game/mind-orchestrator';
import { CommandExecutorSystem } from '@/sim/command/command-system';
import { RivalSystem } from '@/sim/systems/rival-system';
import { NpcMovementSystem } from '@/sim/systems/npc-movement-system';
import { NpcSimSystem } from '@/sim/systems/npc-sim-system';
import { BeliefPropagationSystem } from '@/sim/systems/belief-propagation-system';
import { NpcActivitySystem } from '@/sim/systems/npc-activity-system';
import { SettlementEventSystem } from '@/sim/systems/settlement-event-system';
import { SpiritSystem } from '@/sim/spirit-system';
import { BeliefContentSystem } from '@/sim/systems/belief-content-system';
import { PerceptionSystem } from '@/world/perception-system';
import { PlotThreadSystem } from '@/sim/threads/systems/plot-thread-system';
import { AbandonmentSystem } from '@/sim/systems/abandonment-system';
import { MortalitySystem } from '@/sim/systems/mortality-system';
import { SettlementGrowthSystem } from '@/sim/systems/settlement-growth-system';
import { RoadEvolutionSystem } from '@/sim/systems/road-evolution-system';
import { TrampleDepositSystem, TramplePromoteDecaySystem } from '@/sim/systems/trample-system';
import { BirthSystem } from '@/sim/systems/birth-system';
import { CohortSystem } from '@/sim/systems/cohort-system';
import { WeatherSystem } from '@/sim/systems/weather-system';
import { StagingActivationSystem } from '@/sim/threads/systems/staging-activation-system';
import { identityOracle } from '@/world/oracle';

export interface SimSystemsDeps {
  state: GameState;
  scheduler: Scheduler;
  commandQueue: CommandQueue;
  discoveryQueue: DiscoveryQueue;
  attentionStore: NpcAttentionStore;
  authorLog: AuthorCommandLog;
  storyRegistry: StoryRegistry;
  /** True when no capable LLM is configured — the deterministic stub producer
   *  runs only as the offline fallback. */
  fateOffline: () => boolean;
  /** An applied `author_set_climate` changed worldSeed.climate — the coordinator
   *  forces the renderer's climate-field re-derive + a redraw. */
  onClimateApplied: () => void;
  /** A fired staged beat carrying a storylet ref → interactive card (plus any
   *  presentation cue). Returns false if the storylet id is unknown. */
  onBeatFired: (subject: ThreadSubject, storyletId: string) => boolean;
}

export function registerSimSystems(deps: SimSystemsDeps): void {
  const { state, scheduler, commandQueue } = deps;
  // Command executor runs FIRST: queued player/rival/Fate commands apply at the
  // top of the tick, before the sim systems compute this tick's state.
  scheduler.register(new CommandExecutorSystem(commandQueue, (r) => {
    if (r.status === 'rejected' && r.source === 'player') {
      // Seam for a player-facing rejection toast (Fate/UI cycle). Common
      // rejections (insufficient power / cooldown) are already pre-suppressed at
      // emit by the controller's previewCommand gate, so this is rare.
      console.debug('[command] player command rejected:', r.verb, r.reason);
    }
    // A god-mode climate re-zone changed worldSeed.climate; the renderer's
    // getClimateFields re-derives on its next read (cache key folds in the
    // climate signature) — just force a redraw so the new band shows at once.
    if (r.status === 'applied' && r.verb === 'author_set_climate') {
      deps.onClimateApplied();
    }
  }, deps.authorLog, () => state.weather));
  scheduler.register(new NpcMovementSystem(() => state.map));
  // Desire-line trample: deposit footfall (~3 Hz, gated to soft ground) + a
  // low-Hz promote/decay pass that wears trails to dirt and fades them back.
  scheduler.register(new TrampleDepositSystem(() => state.map, () => state.trample));
  scheduler.register(new TramplePromoteDecaySystem(() => state.map, () => state.trample));
  // Order: settlement events affect needs → NpcSimSystem decays needs + recomputes mood
  // → activity system picks activities from needs → belief propagation → spirits
  // These three carry internal sim state (cooldowns / edge sides / lapse
  // history) — register them with the snapshot seam too (WP-D scrub-ghost
  // pattern) so scrub/commit/save-load restores that state with the world.
  const settlementEvents = new SettlementEventSystem();
  const npcSim = new NpcSimSystem();
  const abandonment = new AbandonmentSystem();
  scheduler.register(settlementEvents);
  scheduler.register(npcSim);
  scheduler.register(abandonment);
  state.systemState.register(settlementEvents);
  state.systemState.register(npcSim);
  state.systemState.register(abandonment);
  scheduler.register(new NpcActivitySystem());
  scheduler.register(new BeliefPropagationSystem());
  // Belief CONTENT (Track B): propagate + decay what they think you can DO.
  // After propagation (faith spread) so content rides the same social graph.
  scheduler.register(new BeliefContentSystem());
  scheduler.register(new SpiritSystem());
  scheduler.register(new RivalSystem(commandQueue));
  scheduler.register(new MortalitySystem());
  scheduler.register(new BirthSystem());
  // Two-tier population P0: shadow cohort ledger — observes the named tier
  // hourly + audits conservation of souls. Stateful (baseline census + flow
  // counters), so it joins the WP-D snapshot seam; zero gameplay reads.
  const cohorts = new CohortSystem();
  scheduler.register(cohorts);
  state.systemState.register(cohorts);
  // Social gravity (roads round 8): live growth reads the trample grid so new
  // housing prefers lots along the desire lines believers actually walk.
  scheduler.register(new SettlementGrowthSystem(() => state.trample));
  scheduler.register(new RoadEvolutionSystem());
  // W-G: deterministic water/atmosphere tick — steps the stepper installed on world
  // seed + polls the flood watch, writing place_flooded/receded into the event log.
  scheduler.register(new WeatherSystem(
    () => state.weather,
    () => state.floodWatch,
    () => state.causalSites,
  ));
  scheduler.register(new PerceptionSystem(identityOracle, () => state.map));
  // Narrative substrate: recognizers + stub producers run LAST so they see this
  // frame's events; activation fires armed beats (its commands apply next tick).
  scheduler.register(new PlotThreadSystem(
    () => state.plotThreads,
    () => state.staging,
    deps.fateOffline,                       // stub runs only as the offline fallback
    () => deps.storyRegistry,               // lets the stub attach a storylet ref to staged beats
  ));
  scheduler.register(new StagingActivationSystem(
    deps.discoveryQueue, commandQueue,
    () => state.staging, () => state.plotThreads,
    (subject, soft) => {
      // Prime soft narration where the player will find it: an NPC's mind page.
      if (subject.kind === 'npc') {
        deps.attentionStore.putPage(subject.npcId, pathKey(['staged']), { prose: soft.text, links: [], depth: 0 });
      }
    },
    // A fired beat carrying a storylet ref opens it as an interactive card.
    (subject, storyletId) => deps.onBeatFired(subject, storyletId),
    // W-I: reap beats armed at a causal site once it has faded.
    () => state.causalSites,
  ));
}
