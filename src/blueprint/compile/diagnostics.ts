// src/blueprint/compile/diagnostics.ts
// Structured geometry-compile diagnostics. The compiler (to-geometry) historically
// console.warn'd self-corrections (a window breaching the eave; a part whose openings
// had no wall to carve). Those warnings vanished into the console — invisible to an
// authoring agent. A caller that passes a `GeometryDiagnostic[]` SINK into toGeometry
// receives them as data instead, so the blueprint linter (and, later, the in-game Fate
// author-building tool) can feed them back to the LLM for self-correction.
//
// Contract: when a sink is supplied the compiler pushes structured entries and STAYS
// SILENT (no console noise during a lint run); with no sink it console.warns exactly as
// before, so the runtime render path is byte-for-byte unchanged.

export type GeometryDiagnosticCode =
  | 'eave-breach'        // a window taller than the wall — clamped under the eave
  | 'apertures-dropped'; // a part declared openings but emitted no wall-bearing prim

export interface GeometryDiagnostic {
  code: GeometryDiagnosticCode;
  /** 'warn' = auto-corrected, render proceeds; 'error' = geometry was lost. */
  severity: 'warn' | 'error';
  part?: string;
  feature?: string;
  message: string;
  /** Machine-readable specifics (measurements, counts) for an agent to reason over. */
  detail?: Record<string, number | string>;
}

/** Push to the sink if present (silent), else console.warn — the compatibility seam. */
export function emitDiagnostic(sink: GeometryDiagnostic[] | undefined, d: GeometryDiagnostic): void {
  if (sink) { sink.push(d); return; }
  console.warn(`[toGeometry] ${d.message}`);
}
