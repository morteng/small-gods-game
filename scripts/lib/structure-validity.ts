// scripts/lib/structure-validity.ts
// PURE, world-free analytic structural-validity core (the ASCE Bridge Designer crossover slice
// of the LLM-authorable modeling epic, spec: docs/superpowers/specs/2026-08-07-structure-validity-authoring-spec.md).
// Given a placement origin, a footprint, an INJECTED `terrain` height sampler (metres — same
// convention as measure-structure-fit.ts), and a bridge SUPERSTRUCTURE CLASS, it reports how
// the crossing's clear span compares to that class's recommended max span, plus a cheap sag
// proxy. It is a LEGIBILITY signal for the author loop — "will this crossing read as an
// engineered span or a lintel in the void" — NOT a physics solver.
//
// No physics: no member-force maps, no truck-load FEM, no deflection. `clearSpanM` is a
// deterministic scan for the longest contiguous below-grade gap across the footprint; the sag
// proxy is a monotone-in-span number (∝ span⁴/stiffness). The per-class envelopes are coarse,
// defensible first guesses (a writer-facing signal, not a civil-engineering standard).
//
// Deterministic and Math.random-free: every number is a pure function of the injected sampler
// + the numeric tables below, so the SAME sampler ⇒ an object-equal report on every call. This
// module imports NOTHING from the game world — the unit test drives it with synthetic
// heightfields (no world, no manifold, no renderer).

import { METRES_PER_TILE } from '../../src/render/scale-contract';

/** Bridge superstructure classes the analytic span check keys on. These name the crossing
 *  lineages Small Gods already composes (`deck` roadway, `arch_span`, timber trestle, stone
 *  arcade) — see src/blueprint/parts/bridge.ts. */
export type BridgeClass = 'deck' | 'arch' | 'timber' | 'stone';

export const BRIDGE_CLASSES: readonly BridgeClass[] = ['deck', 'arch', 'timber', 'stone'];

/** Recommended max CLEAR span per class (metres). Coarse first-guess envelopes — a LEGIBILITY
 *  signal, not an engineering standard. Filled-spandrel arch spans the most; a log-plank
 *  trestle the least. */
export const BRIDGE_CLASS_MAX_SPAN_M: Record<BridgeClass, number> = {
  arch:   36,
  stone:  24,
  deck:   12,
  timber: 8,
};

/** Relative stiffness per class for the sag proxy — HIGHER = stiffer = LESS sag at equal span.
 *  Archetypes: filled-spandrel masonry barely deflects; a timber trestle sags readily. */
const CLASS_STIFFNESS: Record<BridgeClass, number> = {
  arch:   0.015,
  stone:  0.03,
  deck:   0.06,
  timber: 0.25,
};

/** A cell whose ground drops more than this many metres below the crossing's grade counts as
 *  part of the unsupported gap an abutment would frame (i.e. the "channel" being spanned). */
const BELOW_GRADE_M = 0.5;
/** Ratio above which a span reads as near/failing vs its class envelope. */
const WARN_RATIO = 0.75;

/** The class's recommended max clear span in metres. */
export function maxSpanM(cls: BridgeClass): number {
  return BRIDGE_CLASS_MAX_SPAN_M[cls];
}

/**
 * Deterministic clear-span estimate: the LONGEST contiguous run of footprint cells whose
 * terrain sits BELOW the anchor grade by more than `BELOW_GRADE_M`, along the footprint's
 * dominant (longer) axis, scaled to metres. Scans every line along the long axis and takes the
 * max run, so a channel crossing a whole footprint reads as one span even if the banks are
 * ragged. Flush/flat ground (nothing below grade) yields span 0 (no gap to cross).
 */
export function clearSpanM(
  place: { x: number; y: number },
  footprint: { w: number; h: number },
  terrain: (x: number, y: number) => number,
): number {
  const ox = Math.floor(place.x);
  const oy = Math.floor(place.y);
  const w = Math.max(1, Math.floor(footprint.w));
  const h = Math.max(1, Math.floor(footprint.h));
  const grade = terrain(ox, oy);
  // Walk along the LONG axis (x by default; y only if the footprint is strictly taller).
  const scanAcross = w >= h;
  const lines = scanAcross ? h : w;
  const cellsPerLine = scanAcross ? w : h;
  let maxGapTiles = 0;
  for (let li = 0; li < lines; li++) {
    let run = 0;
    for (let ci = 0; ci < cellsPerLine; ci++) {
      const tx = ox + (scanAcross ? ci : li);
      const ty = oy + (scanAcross ? li : ci);
      const below = terrain(tx, ty) < grade - BELOW_GRADE_M;
      run = below ? run + 1 : 0;
      if (run > maxGapTiles) maxGapTiles = run;
    }
  }
  return maxGapTiles * METRES_PER_TILE;
}

/** Cheap continuous-beam sag proxy: deflection ∝ span⁴/stiffness (the uniform-load form
 *  `5 w L⁴ / 384 E I` with beam/load/elasticity folded into CLASS_STIFFNESS), collapsed to
 *  millimetres per metre of span. NOT a real deflection — a monotone-in-span legibility number
 *  so an author sees "longer + flexible ⇒ sags more" without a solver. */
export function sagProxyMmPerM(spanM: number, cls: BridgeClass): number {
  const L = Math.max(0, spanM);
  return +((CLASS_STIFFNESS[cls] * Math.pow(L, 4))).toFixed(1);
}

export type SpanState = 'ok' | 'warn' | 'fail';

export interface SpanReport {
  cls: BridgeClass;
  clearSpanM: number;
  maxSpanM: number;
  /** clearSpanM / maxSpanM (1 = exactly at the envelope; > 1 = over). */
  ratio: number;
  status: SpanState;
  /** Remedy when not 'ok': a class that plausibly spans, or a mid-pier for an arch. */
  suggested: 'arch' | 'mid-pier' | null;
  msg: string;
}

/** The aggregate check: clear span vs the class envelope, with an actionable remedy string.
 *  `status` is a pure function of ratio: `> 1` fail, `> WARN_RATIO` warn, else ok. The remedy
 *  proposes 'arch' (a class that spans farther) unless the class IS arch, in which case it
 *  proposes a 'mid-pier'. */
export function checkSpan(
  place: { x: number; y: number },
  footprint: { w: number; h: number },
  terrain: (x: number, y: number) => number,
  cls: BridgeClass = 'deck',
): SpanReport {
  const clearSpanMValue = clearSpanM(place, footprint, terrain);
  const maxSpanMValue = BRIDGE_CLASS_MAX_SPAN_M[cls];
  const ratio = maxSpanMValue > 0 ? clearSpanMValue / maxSpanMValue : 0;

  let status: SpanState = 'ok';
  let suggested: SpanReport['suggested'] = null;
  if (ratio > 1) {
    status = 'fail';
  } else if (ratio > WARN_RATIO) {
    status = 'warn';
  }
  if (ratio > WARN_RATIO) {
    suggested = cls === 'arch' ? 'mid-pier' : 'arch';
  }

  let msg: string;
  if (status === 'fail') {
    msg = `${clearSpanMValue.toFixed(1)} m clear span exceeds the ${cls} envelope (${maxSpanMValue} m) — use ${suggested === 'arch' ? 'an arch class' : 'a mid-pier'} to frame this crossing`;
  } else if (status === 'warn') {
    msg = `${clearSpanMValue.toFixed(1)} m clear span is near the ${cls} envelope (${maxSpanMValue} m) — ${suggested === 'arch' ? 'an arch class' : 'a mid-pier'} reads safer`;
  } else {
    msg = `${clearSpanMValue.toFixed(1)} m clear span is within the ${cls} envelope (${maxSpanMValue} m)`;
  }

  return {
    cls,
    clearSpanM: clearSpanMValue,
    maxSpanM: maxSpanMValue,
    ratio: +ratio.toFixed(3),
    status,
    suggested,
    msg,
  };
}
