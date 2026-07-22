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
import { SettlementGrowthSystem, housingCapacityByPoi } from '@/sim/systems/settlement-growth-system';
import { RoadEvolutionSystem } from '@/sim/systems/road-evolution-system';
import { TrampleDepositSystem, TramplePromoteDecaySystem } from '@/sim/systems/trample-system';
import { BirthSystem } from '@/sim/systems/birth-system';
import { LordSystem } from '@/sim/systems/lord-system';
import { CohortSystem } from '@/sim/systems/cohort-system';
import { MaterializationSystem } from '@/sim/systems/materialization-system';
import { WeatherSystem } from '@/sim/systems/weather-system';
import type { ZoomBand } from '@/game/affordance/zoom-band';
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
  /** P2 living-population: the coordinator's live VIEW focus (which settlement
   *  the camera is framing + the zoom band). Read each tick by the
   *  MaterializationSystem; view state stays OUT of the sim/snapshot. */
  focusView: () => { poiId: string | null; band: ZoomBand };
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
  }, deps.authorLog, () => state.weather, () => state));
  scheduler.register(new NpcMovementSystem(() => state.map));
  // Desire-line trample: deposit footfall (~3 Hz, gated to soft ground) + a
  // low-Hz promote/decay pass that wears trails to dirt and fades them back.
  // The deposit fire ALSO tallies footfall on road tiles into the road-wear economy's per-edge
  // `use` statistic (S1) — the same 3 Hz loop, since roads shed trample wear anyway.
  scheduler.register(new TrampleDepositSystem(() => state.map, () => state.trample, () => state.roadUse));
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
  // Two-tier population P1: the belief economy reads the STATISTICAL tier
  // (state.cohorts) — power regen, rival situation, birth throttle, growth,
  // perception all take the same getter.
  const getCohorts = () => state.cohorts;
  // P2 living-population (slice 1): materialize a FOCUSED settlement's cohort
  // souls into real npc entities so the town fills with walkers, and bank them
  // back (conservation-exact) when focus leaves. Registered after
  // NpcActivitySystem so the extras it mints are swept by the already-registered
  // activity/movement systems on the same tick. Stateful (hysteresis) → joins
  // the WP-D snapshot seam; rebuilds its live set from materializedTemp on load.
  const materialization = new MaterializationSystem(getCohorts, () => state.map, deps.focusView);
  scheduler.register(materialization);
  state.systemState.register(materialization);
  scheduler.register(new SpiritSystem(getCohorts));
  scheduler.register(new RivalSystem(commandQueue, getCohorts));
  scheduler.register(new MortalitySystem());
  scheduler.register(new BirthSystem({
    cohorts: getCohorts,
    housingCapacity: housingCapacityByPoi,   // §5.2: housing gates births (slack × capacity)
  }));
  // M3 (mortal power): seats, succession, and the tithe economy — hourly, like
  // the other day-keyed lifecycle systems. Reads the statistical tier so the
  // tithe hits BOTH population tiers (the named tier feels it in
  // NpcActivitySystem's work restore). LordState rides the snapshot on
  // World.lords — no system-state registration needed. M5: also reads the
  // runtime-POI store to derive dominion links (the knights' extraction reach).
  scheduler.register(new LordSystem(getCohorts, () => state.runtimePois));
  // Two-tier population P0+P1: shadow cohort ledger — observes the named tier
  // hourly + audits conservation of souls, and (P1) audits that the statistical
  // tier's counts never change outside ledgered flows. Stateful (baseline
  // census + flow counters), so it joins the WP-D snapshot seam.
  const cohorts = new CohortSystem(getCohorts);
  scheduler.register(cohorts);
  state.systemState.register(cohorts);
  // Social gravity (roads round 8): live growth reads the trample grid so new
  // housing prefers lots along the desire lines believers actually walk.
  // P1: growth also counts statistical souls — towns house their fiction pop.
  scheduler.register(new SettlementGrowthSystem(() => state.trample, getCohorts));
  // Road evolution ALSO folds the road-use tally into `edge.use` on its applying year-passes
  // (road-wear economy S1) — the tally + cohorts feed the measured-traffic + wealth terms.
  // S2 steps the class ladder there; S3 steps the crossing-tier store (upgraded spans + the
  // corridor log a promoted trail earns — the trample grid feeds that detection); S4 steps
  // the adoption ledger (a corridor with sustained qualifying wear becomes a real path edge).
  scheduler.register(new RoadEvolutionSystem(
    () => state.roadUse, getCohorts, () => state.crossingTiers, () => state.trample,
    () => state.adoptions));
  // W-G: deterministic water/atmosphere tick — steps the stepper installed on world
  // seed + polls the flood watch, writing place_flooded/receded into the event log.
  scheduler.register(new WeatherSystem(
    () => state.weather,
    () => state.floodWatch,
    () => state.causalSites,
  ));
  // P1 (ruling 2): aggregate cohort belief realizes tiles too, not just named believers.
  scheduler.register(new PerceptionSystem(identityOracle, () => state.map, undefined, getCohorts));
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
    // F4: a fired portent beat flips its arc-ledger entry to discovered.
    () => state.fateArcs ?? null,
  ));
}
