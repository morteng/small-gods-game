// src/blueprint/lint.ts
// Deterministic, pure lint over a ResolvedBlueprint — the SHARED FLOOR of the building
// authoring loop. It runs the compile once (harvesting the geometry-compiler's structured
// diagnostics) plus a set of structural self-checks, and returns a flat, machine-readable
// report an authoring LLM can act on. Three consumers, one function:
//   - dev/offline harness (scripts/building-preview.ts --lint) — where we hone the recipe,
//   - MCP (`lint_blueprint`) — an agent driving a headless game,
//   - the in-game Fate author-building tool — the gate a runtime LLM cannot author past.
// It answers AUTHORING errors (a window with no wall, a dormer on a flat roof, a part off
// the footprint). It deliberately does NOT judge geometry PROPORTIONS (a dormer that reads
// as a sunken pit is correct-by-the-rules but ugly) — that is the montage/vision-critic's
// job. Keep this layer cheap, deterministic, and Node-only.
import type { ResolvedBlueprint, ResolvedPart } from './types';
import { toGeometry } from './compile/to-geometry';
import type { GeometryDiagnostic } from './compile/diagnostics';
import { ROOF_KIND } from './parts/body';

export type LintSeverity = 'error' | 'warn' | 'info';

export interface BlueprintLint {
  code: string;
  severity: LintSeverity;
  part?: string;
  feature?: string;
  message: string;
  detail?: Record<string, number | string>;
}

/** RoofKinds that cannot host a gabled dormer — `dormerSolids` returns null for a flat
 *  roof (no ridge), so a dormer feature there silently vanishes. (Shed/mono-pitch depend
 *  on the derived rise, so we don't over-claim them — only `flat` is a guaranteed drop.) */
const DORMERLESS_ROOFS = new Set(['flat']);

/** Occupied structure-local tiles of a wall-bearing part (body/wing/box footprint). */
function occupancy(p: ResolvedPart): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i < p.size.w; i++) for (let j = 0; j < p.size.h; j++) s.add(`${p.at.x + i},${p.at.y + j}`);
  return s;
}

/**
 * Lint a resolved blueprint. Returns [] for a clean asset. Ordered errors-first so a caller
 * can gate on `some(l => l.severity === 'error')` and surface the rest as advice.
 */
export function lintBlueprint(rb: ResolvedBlueprint): BlueprintLint[] {
  const out: BlueprintLint[] = [];

  // 1. Geometry-compiler diagnostics (eave breach, dropped apertures) — harvested via the sink.
  const diagnostics: GeometryDiagnostic[] = [];
  try {
    toGeometry(rb, { diagnostics });
  } catch (e) {
    out.push({ code: 'compile-throw', severity: 'error', message: `blueprint failed to compile: ${(e as Error).message}` });
    return out;   // nothing else is meaningful once compile threw
  }
  for (const d of diagnostics) {
    out.push({ code: d.code, severity: d.severity, part: d.part, feature: d.feature, message: d.message, detail: d.detail });
  }

  // 2. Structural self-checks over the resolved parts.
  const { w: fw, h: fh } = rb.footprint;
  const wallBearing: ResolvedPart[] = [];
  for (const p of rb.parts) {
    // 2a. A part poking outside the declared footprint (drives collision / placement bounds).
    if (p.at.x < 0 || p.at.y < 0 || p.at.x + p.size.w > fw || p.at.y + p.size.h > fh) {
      out.push({
        code: 'part-out-of-footprint', severity: 'warn', part: p.id,
        message: `part "${p.id}" (${p.type}) at (${p.at.x},${p.at.y}) size ${p.size.w}×${p.size.h} exceeds footprint ${fw}×${fh}`,
        detail: { x: p.at.x, y: p.at.y, w: p.size.w, h: p.size.h, footprintW: fw, footprintH: fh },
      });
    }

    // 2b. A gabled dormer on a roof that can't host one — it is silently dropped downstream.
    const roofKind = ROOF_KIND[p.params?.roof as string];
    if (roofKind && DORMERLESS_ROOFS.has(roofKind)) {
      for (const f of p.features) {
        if (f.type === 'dormer') {
          out.push({
            code: 'dormer-unhostable', severity: 'warn', part: p.id, feature: f.id,
            message: `dormer "${f.id}" sits on a ${p.params?.roof} roof (${roofKind}) with no ridge to host it — it will not render`,
            detail: { roof: String(p.params?.roof), roofKind },
          });
        }
      }
    }

    if (p.type === 'body' || p.type === 'wing' || p.type === 'box') wallBearing.push(p);
  }

  // 2d. Two distinct wall-bearing parts occupying the same tiles — usually a placement slip
  //     (z-fighting / a roof notch where they meet). Info, not error: some designs abut on
  //     purpose, but an author almost always wants to know.
  for (let i = 0; i < wallBearing.length; i++) {
    const occ = occupancy(wallBearing[i]);
    for (let j = i + 1; j < wallBearing.length; j++) {
      let shared = 0;
      for (const k of occupancy(wallBearing[j])) if (occ.has(k)) shared++;
      if (shared > 0) {
        out.push({
          code: 'parts-overlap', severity: 'info', part: wallBearing[i].id,
          message: `parts "${wallBearing[i].id}" and "${wallBearing[j].id}" overlap on ${shared} tile(s)`,
          detail: { other: wallBearing[j].id, tiles: shared },
        });
      }
    }
  }

  const rank: Record<LintSeverity, number> = { error: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** One-line human/agent summary — e.g. "2 errors, 1 warning" or "clean". */
export function summarizeLint(lints: BlueprintLint[]): string {
  const e = lints.filter(l => l.severity === 'error').length;
  const w = lints.filter(l => l.severity === 'warn').length;
  const i = lints.filter(l => l.severity === 'info').length;
  if (!lints.length) return 'clean';
  return [e && `${e} error${e > 1 ? 's' : ''}`, w && `${w} warning${w > 1 ? 's' : ''}`, i && `${i} note${i > 1 ? 's' : ''}`]
    .filter(Boolean).join(', ');
}
