/**
 * Storylet engine — public surface.
 *
 * An authored-narrative layer for Small Gods: deterministic, capability-sandboxed
 * story packs that play standalone with no AI key (the dumb director) and double
 * as a reservoir the Fate AI draws from and enriches when a key is present. See
 * docs/superpowers/specs/2026-06-18-storylet-engine-design.md.
 */
export * from './story-ir';
export { Scope } from './story-state';
export type { StoryHost, ReadonlyScope } from './story-state';
export { evalExpr, evalCondition, truthy } from './expr';
export { resolveText, interpolate } from './text';
export type { Director } from './director';
export { DumbDirector } from './director';
export { StoryRunner } from './runner';
export type { Yield, StageLine, StageChoice } from './runner';
export { selectStorylet, eligibleStorylets } from './select';
export { validatePack } from './validate';
export type { ValidateOptions } from './validate';
export { scriptedPlay } from './play';
export type { Transcript, ScriptedPlayOptions } from './play';
