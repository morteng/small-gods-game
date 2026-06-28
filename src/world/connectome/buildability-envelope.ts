// src/world/connectome/buildability-envelope.ts
//
// The BUILDABILITY ENVELOPE — the capability filter that says WHICH structures a settlement
// may build, so the connectome never spawns what a society can't yet make (no cathedral in a
// neolithic hamlet). It is a function of two axes the game already simulates:
//   • TECH    = era baseline + aggregate believer UNDERSTANDING. This is the god-game's own
//               progression made physical: a people who deeply understand their god unlock
//               ambitious works EARLIER (cultivating understanding literally unlocks
//               architecture). Understanding defaults to 0 at worldgen (no NPCs yet) — the
//               dynamic unlock arrives once a settlement-evolution loop feeds it.
//   • ECONOMY = settlement wealth / size / labour (prosperity).
//
// PURE + deterministic + no Math.random (it only READS sim/worldgen state). It is a capability
// FILTER over generation, not a simulation — the brainstorm §3½ home for the user's "limit
// structures to technological and economic limits, and that spreads into the whole connectome"
// requirement. Today it owns the bridge-class gate (extracted from crossing-builder's inline
// rule); the wall/paving/arch-style accessors are the same shape, ready for the other placers.

import type { ArchStyle } from '@/assetgen/geometry/arch';

/** The structural choices the envelope gates. Ordinal: each is "the grandest allowed". */
export type BridgeClass = 'log-plank' | 'timber' | 'dressed-stone';
export type WallClass = 'none' | 'palisade' | 'timber-pale' | 'stone-curtain';
export type PavingCeiling = 'dirt' | 'gravel' | 'cobble';

export interface EnvelopeInputs {
  /** Era rank: 0 stone-age … 3 late-medieval/renaissance. */
  era: number;
  /** Economy rank: 0 destitute … 3 opulent. */
  economy: number;
  /** Aggregate believer understanding 0..1 — raises effective tech up to +1 era-equivalent.
   *  Absent ⇒ 0 (worldgen, before NPCs / belief exist). */
  understanding?: number;
}

/** Effective tech level: the era baseline lifted by how well the people understand their god.
 *  A fully-understanding settlement (1.0) builds as if a full era more advanced. */
export function effectiveTech(i: EnvelopeInputs): number {
  const u = i.understanding ?? 0;
  return i.era + (u < 0 ? 0 : u > 1 ? 1 : u);
}

/** The grandest bridge a crossing may build — tech × economy × how busy it is (importance:
 *  0 footpath … 3 highway). Preserves crossing-builder's historic thresholds exactly when
 *  understanding = 0 (era replaces the old `era` rank one-for-one). */
export function bridgeClassFor(i: EnvelopeInputs, importance: number): BridgeClass {
  const tech = effectiveTech(i);
  if (tech >= 2 && i.economy >= 1 && importance >= 1) return 'dressed-stone';
  if (tech >= 1 || i.economy >= 1) return 'timber';
  return 'log-plank';
}

/** The grandest defensive enclosure a settlement may raise. */
export function wallClassFor(i: EnvelopeInputs): WallClass {
  const tech = effectiveTech(i);
  if (tech >= 2 && i.economy >= 2) return 'stone-curtain';
  if (tech >= 1 && i.economy >= 1) return 'timber-pale';
  if (i.economy >= 1 || tech >= 1) return 'palisade';
  return 'none';
}

/** The most-finished road surface a settlement's economy will pay to lay. */
export function pavingCeilingFor(i: EnvelopeInputs): PavingCeiling {
  if (effectiveTech(i) >= 2 && i.economy >= 2) return 'cobble';
  if (i.economy >= 1) return 'gravel';
  return 'dirt';
}

/** Which arch styles the masons know — round/segmental early, the pointed/horseshoe gothic
 *  vocabulary only once tech is high enough. (`flat` is always available — it's a lintel.) */
export function archStylesFor(i: EnvelopeInputs): Set<ArchStyle> {
  const tech = effectiveTech(i);
  const s = new Set<ArchStyle>(['flat']);
  if (tech >= 1) { s.add('round'); s.add('segmental'); }
  if (tech >= 2) { s.add('pointed'); s.add('horseshoe'); }
  return s;
}

/** The whole resolved capability set for a settlement (one call → every allow-list). A placer
 *  can take this once and consult its fields, instead of re-deriving each gate. */
export interface BuildabilityEnvelope {
  tech: number;
  economy: number;
  bridge: BridgeClass;
  wall: WallClass;
  paving: PavingCeiling;
  archStyles: Set<ArchStyle>;
}

/** Resolve the full envelope from the two axes. `importance` (0..3) gates the bridge class;
 *  pass the busiest road class that reaches the settlement (default 3 = no extra cap). */
export function resolveEnvelope(i: EnvelopeInputs, importance = 3): BuildabilityEnvelope {
  return {
    tech: effectiveTech(i),
    economy: i.economy,
    bridge: bridgeClassFor(i, importance),
    wall: wallClassFor(i),
    paving: pavingCeilingFor(i),
    archStyles: archStylesFor(i),
  };
}
