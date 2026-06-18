/**
 * StorySession — the interactive driver (live counterpart to headless scriptedPlay).
 *
 * The game (player) or Fate (agent) drives this one stage at a time: it surfaces a
 * single `line` or `choice` and waits. Effects are NOT narrative stops — they are
 * auto-dispatched through the host (→ bus) between stops, so `do` nodes fire as the
 * story advances without pausing the UI. This is what a beat-fired handler creates
 * to actually play a storylet in the running game.
 *
 * The choice SOURCE is decoupled from the runtime: a human clicks, or an agent
 * calls `choose()` — identical API either way (agent-first).
 */
import type { Rng } from '@/core/rng';
import { createRng } from '@/core/rng';
import type { StoryPack } from './story-ir';
import { Scope } from './story-state';
import type { StoryHost } from './story-state';
import type { Director } from './director';
import { DumbDirector } from './director';
import { StoryRunner } from './runner';
import type { StageLine, StageChoice } from './runner';
import { selectStorylet } from './select';

export type Stage =
  | { kind: 'line'; line: StageLine }
  | { kind: 'choice'; options: StageChoice[] }
  | { kind: 'done' };

export interface StorySessionOptions {
  seed?: number;
  host?: StoryHost;
  director?: Director;
  /** Guard against runaway goto chains while pumping to the next stop. */
  maxStepsPerStage?: number;
}

const NULL_HOST: StoryHost = { dispatch() {} };

export class StorySession {
  private readonly runner: StoryRunner;
  private readonly host: StoryHost;
  private readonly rng: Rng;
  private readonly maxSteps: number;
  private stage: Stage = { kind: 'done' };
  private started = false;

  constructor(
    private readonly pack: StoryPack,
    opts: StorySessionOptions = {},
  ) {
    this.rng = createRng(opts.seed ?? 1);
    this.host = opts.host ?? NULL_HOST;
    this.maxSteps = opts.maxStepsPerStage ?? 10_000;
    const scope = new Scope(this.host, pack.state);
    this.runner = new StoryRunner(pack, scope, this.rng, opts.director ?? new DumbDirector());
  }

  get current(): Stage { return this.stage; }
  get done(): boolean { return this.stage.kind === 'done'; }
  get scope(): Scope { return this.runner.scope; }
  get storyletId(): string | null { return this.runner.currentStorylet; }

  /** Enter a storylet (explicit id, or selected from the reservoir) and stop at the first stage. */
  start(startId?: string): Stage {
    const id = startId ?? selectStorylet(this.pack, this.runner.scope, this.rng, this.runner.seen)?.id;
    if (!id) throw new Error('StorySession.start: no eligible storylet');
    this.started = true;
    this.runner.enter(id);
    return (this.stage = this.pump());
  }

  /** Advance past the current `line` to the next stage. No-op on choice/done. */
  next(): Stage {
    if (!this.started) throw new Error('StorySession.next: call start() first');
    if (this.stage.kind !== 'line') return this.stage;
    return (this.stage = this.pump());
  }

  /** Resolve the current `choice` and advance to the next stage. */
  choose(index: number): Stage {
    if (this.stage.kind !== 'choice') throw new Error('StorySession.choose: no choice pending');
    this.runner.choose(index);
    return (this.stage = this.pump());
  }

  /** Run the runner, auto-dispatching effects, until a line / choice / end. */
  private pump(): Stage {
    for (let i = 0; i < this.maxSteps; i++) {
      const y = this.runner.advance();
      switch (y.kind) {
        case 'say': return { kind: 'line', line: y.line };
        case 'choice': return { kind: 'choice', options: y.options };
        case 'effect': this.host.dispatch(y.effect); break; // not a stop
        case 'end': return { kind: 'done' };
      }
    }
    throw new Error(`StorySession: exceeded ${this.maxSteps} steps (goto loop?)`);
  }
}
