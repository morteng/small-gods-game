// src/blueprint/authoring.ts
// The one authoring facade every surface calls: resolve → lint → gate. An LLM (dev
// harness, MCP, or the in-game Fate author-building tool) hands in a preset name or a raw
// Blueprint (+ optional descriptors/patches); it returns the resolved blueprint, the lint
// report, and a single `ok` verdict. `ok === false` means "do NOT commit this building" —
// it either failed to resolve or carries an error-severity lint. A runtime caller gates on
// `ok` and feeds `lints` back to the model to self-correct; it CANNOT author a broken asset
// past this floor. Pure + deterministic (no paid gen, no render) — safe on the sim path.
import { resolveBlueprint } from './resolve';
import { descriptorPatch } from './descriptors';
import { lintBlueprint, summarizeLint, type BlueprintLint } from './lint';
import { ensureBuildingTypesRegistered } from './register-buildings';
import { synthesizeBlueprint, resolveAsset } from './presets';
import type { Blueprint, BlueprintPatch, Descriptors, ResolvedBlueprint } from './types';

export interface AuthorInput {
  /** A preset name (e.g. 'cottage') to start from … */
  preset?: string;
  /** … OR a full hand-authored Blueprint. Exactly one of preset/blueprint is required. */
  blueprint?: Blueprint;
  /** Qualitative bias (wealth/quality/style/condition) folded in before resolve. */
  descriptors?: Descriptors;
  /** Extra layered patches applied over the base (deep-merged, parts by id). */
  patches?: BlueprintPatch[];
  seed?: number;
}

export interface AuthorResult {
  rb?: ResolvedBlueprint;
  lints: BlueprintLint[];
  /** True ⇒ resolved cleanly with no error-severity lint — safe to commit/render. */
  ok: boolean;
  /** One-line status ("clean" | "2 warnings" | a resolve failure message). */
  summary: string;
}

/**
 * Resolve + lint a building spec into a commit-or-reject verdict. The shared gate.
 */
export function authorBlueprint(input: AuthorInput): AuthorResult {
  ensureBuildingTypesRegistered();
  let rb: ResolvedBlueprint | undefined;
  try {
    if (input.blueprint) {
      const patches: BlueprintPatch[] = [];
      if (input.descriptors) patches.push(descriptorPatch(input.blueprint, input.descriptors));
      if (input.patches) patches.push(...input.patches);
      rb = resolveBlueprint([input.blueprint, ...patches], input.seed ?? 0);
    } else if (input.preset) {
      rb = input.descriptors
        ? resolveAsset({ type: input.preset, descriptors: input.descriptors, seed: input.seed })
        : synthesizeBlueprint(input.preset, input.patches ?? [], input.seed);
    } else {
      return { lints: [], ok: false, summary: 'provide `preset` or `blueprint`' };
    }
  } catch (e) {
    return { lints: [], ok: false, summary: `resolve failed: ${(e as Error).message}` };
  }
  if (!rb) return { lints: [], ok: false, summary: `unknown preset "${input.preset}"` };

  const lints = lintBlueprint(rb);
  const ok = !lints.some(l => l.severity === 'error');
  return { rb, lints, ok, summary: summarizeLint(lints) };
}
