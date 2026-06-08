// src/blueprint/registry.ts
// Two self-describing registries. Adding a part/feature = one registration; no
// consumer edits. paramSchema on each entry is the agent's capability catalogue.
import type { Part, Feature, ResolvedPart, ResolvedFeature } from './types';
import type { ParamSchema } from './param-schema';
import type { Part as Prim } from '@/assetgen/compose';

/** Context passed to resolve (seed-fill) — deterministic. */
export interface ResolveCtx {
  seed: number;
  materials: Record<string, string>;
}
/** Context passed to compile (geometry/collision/anchors/brief). */
export interface CompileCtx {
  materials: Record<string, string>;
  footprint: { w: number; h: number };
}

/** A part type contributes geometry, blocked cells, anchors, and a brief phrase. */
export interface PartType {
  type: string;
  paramSchema: ParamSchema;
  /** Fill type-specific defaults (params already schema-validated by the resolver). */
  resolve(part: Part, ctx: ResolveCtx): { params: Record<string, unknown> };
  /** assetgen prims. Wing-bearing parts return a `prim:'building'`; the compiler merges them. */
  toPrims(p: ResolvedPart, ctx: CompileCtx): Prim[];
  /** Structure-local cells this part blocks (collision). */
  toCollision(p: ResolvedPart, ctx: CompileCtx): Array<[number, number]>;
  /** World-offset anchors (relative to footprint top-left). */
  toAnchors(p: ResolvedPart, ctx: CompileCtx): Array<{ kind: string; x: number; y: number; facing: [number, number]; main?: boolean; width?: number }>;
  /** Phrase for the generative brief. */
  toBrief(p: ResolvedPart, ctx: CompileCtx): string;
}

/** A feature type resolves (door-size fix lives here) and contributes a brief phrase.
 *  An *opening* feature additionally implements the opening hooks (threshold/aperture/filler);
 *  the geometry compiler treats any feature whose kind declares `aperture` as a wall opening. */
export interface FeatureType {
  type: string;
  paramSchema: ParamSchema;
  resolve(f: Feature, ctx: ResolveCtx): { params: Record<string, unknown> };
  toBrief(f: ResolvedFeature, ctx: CompileCtx): string;
  /** Opening hooks (optional). Present ⇒ this feature is a wall opening. */
  /** True if a passable threshold (door/gate) → the opening contributes a walkable cell
   *  in `toCollision` and a pathing anchor in `toAnchors`; window/portal = false. */
  threshold?: boolean;
  aperture?(f: ResolvedFeature, host: ResolvedPart, ctx: CompileCtx): import('./features/opening').ApertureSpec;
  filler?(f: ResolvedFeature, host: ResolvedPart, ctx: CompileCtx): Prim[];
}

let parts = new Map<string, PartType>();
let features = new Map<string, FeatureType>();

export function registerPartType(pt: PartType): void {
  if (parts.has(pt.type)) throw new Error(`part type "${pt.type}" already registered`);
  parts.set(pt.type, pt);
}
export function registerFeatureType(ft: FeatureType): void {
  if (features.has(ft.type)) throw new Error(`feature type "${ft.type}" already registered`);
  features.set(ft.type, ft);
}
export function getPartType(type: string): PartType {
  const pt = parts.get(type);
  if (!pt) throw new Error(`unknown part type "${type}"`);
  return pt;
}
export function getFeatureType(type: string): FeatureType | undefined { return features.get(type); }
export function listPartTypes(): PartType[] { return [...parts.values()]; }
export function listFeatureTypes(): FeatureType[] { return [...features.values()]; }

/** Test-only: clear both registries. */
export function _resetRegistryForTest(): void { parts = new Map(); features = new Map(); }
