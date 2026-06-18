/**
 * Drivers — wrap the StoryRunner for the two ways content gets consumed.
 *
 *  - `scriptedPlay` drives a whole pack headlessly with a fixed choice list,
 *    dispatching effects to the host and collecting a transcript. This is the
 *    no-key reference loop and the backbone of the test suite: same seed + same
 *    choices ⇒ identical transcript.
 *  - In the live game an interactive driver would instead surface `choice`
 *    yields to the player UI and await input; the runner API (advance/choose) is
 *    identical, only the choice source differs.
 */
import { createRng } from '@/core/rng';
import type { Rng } from '@/core/rng';
import type { StoryPack, Effect } from './story-ir';
import { Scope } from './story-state';
import type { StoryHost } from './story-state';
import type { Director } from './director';
import { DumbDirector } from './director';
import { StoryRunner } from './runner';
import type { StageLine, StageChoice } from './runner';
import { selectStorylet } from './select';

export interface Transcript {
  lines: StageLine[];
  effects: Effect[];
  /** Storylets entered, in order. */
  visited: string[];
  /** Choices the driver actually made, as (prompt options → chosen index). */
  decisions: { options: StageChoice[]; chose: number }[];
}

export interface ScriptedPlayOptions {
  seed?: number;
  host?: StoryHost;
  director?: Director;
  /** Force the first storylet; otherwise the selector picks from the reservoir. */
  startId?: string;
  /** Choice indices consumed in order. Past the end, the driver picks option 0. */
  choices?: number[];
  /** Safety stop for runaway goto loops. */
  maxSteps?: number;
}

const NULL_HOST: StoryHost = { dispatch() {} };

/** Play one storylet (selected or forced) to its `end`, headlessly. */
export function scriptedPlay(pack: StoryPack, opts: ScriptedPlayOptions = {}): Transcript {
  const rng: Rng = createRng(opts.seed ?? 1);
  const host = opts.host ?? NULL_HOST;
  const director = opts.director ?? new DumbDirector();
  const scope = new Scope(host, pack.state);
  const runner = new StoryRunner(pack, scope, rng, director);

  const start = opts.startId
    ? pack.storylets.find((s) => s.id === opts.startId)
    : selectStorylet(pack, scope, rng, runner.seen, director);
  if (!start) throw new Error('scriptedPlay: no eligible storylet to start');

  const tx: Transcript = { lines: [], effects: [], visited: [], decisions: [] };
  const choices = [...(opts.choices ?? [])];
  const maxSteps = opts.maxSteps ?? 10_000;

  runner.enter(start.id);
  tx.visited.push(start.id);
  let last = runner.currentStorylet;

  for (let step = 0; step < maxSteps; step++) {
    const y = runner.advance();
    if (runner.currentStorylet !== last && runner.currentStorylet) {
      tx.visited.push(runner.currentStorylet);
      last = runner.currentStorylet;
    }
    switch (y.kind) {
      case 'say': tx.lines.push(y.line); break;
      case 'effect': tx.effects.push(y.effect); host.dispatch(y.effect); break;
      case 'choice': {
        const chose = choices.length ? choices.shift()! : y.options[0].index;
        tx.decisions.push({ options: y.options, chose });
        runner.choose(chose);
        break;
      }
      case 'end': return tx;
    }
  }
  throw new Error(`scriptedPlay: exceeded ${maxSteps} steps (goto loop?)`);
}
