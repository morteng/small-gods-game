// src/blueprint/audit-structure.ts
// The SECOND audit stage (Phase B1): composes TRUE structure facts that blueprint lint
// cannot see (it runs pre-geometry). Where `lintBlueprint` judges AUTHORING (a window with
// no wall, a part off the footprint), `auditStructure` judges the COMPOSED GEOMETRY — the
// same spec `composeStructure` renders — and reports geometric truths back to an authoring
// LLM: is the solid clipping its sprite budget? does anything pierce the ground plane?
// do declared mount sockets actually project through? how much mass is there?
//
// It mirrors `BlueprintLint`'s shape exactly ({code,severity,part?,feature?,message,
// detail?}) so the preview loop (scripts/author-preview.ts) can print ONE merged report
// and gate on `severity === 'error'` uniformly across both stages. Deterministic and
// Math.random-free: same spec ⇒ identical audit. It only READS geometry — it never mutates
// it, so nothing here touches goldens or version constants.
//
// Deliberately NOT the cheap Fate gate: this is author-time preview tooling (DR-5). The
// mesh pass (volume/facet stats) re-drives the manifold kernel; gate it off with
// `opts.computeMeshStats:false` where only the cheap rules are wanted.
//
// Q2 (manifold robustness): manifold-3d 3.5.x DOES expose `Manifold.status()` (ErrorStatus:
// NoError|NonFiniteVertex|NotManifold|Degenerate|Cancelled), `volume()` and `isEmpty()` —
// but `partFacets`/`manifoldToFacets` extract the facets and DROP the Manifold object, so a
// kernel-status rule would need the Manifold (or a status sink) threaded through compose — a
// larger, deferred change. What we honestly surface instead from the EXTRACTED geometry:
// degenerate/empty output (`structure-empty`), zero-height collapse (visible in `massing`
// as zMin≈zMax), and any mesh-extraction failure (`structure-mesh-error`). We do NOT
// fabricate a robustness API that this pipeline does not reach.
import type { LintSeverity } from './lint';
import type { ResolvedBlueprint } from './types';
import { getFeatureType } from './registry';
import { isOpening } from './features/opening';
import type { Part as Prim, StructureResult, StructureSpec } from '@/assetgen/compose';
import { partFacets } from '@/assetgen/compose';
import type { WorldFacet } from '@/assetgen/types';

/** Mirrors `BlueprintLint` so both stages merge into one uniform report. */
export interface StructureAudit {
  code: string;
  severity: LintSeverity;
  part?: string;
  feature?: string;
  message: string;
  detail?: Record<string, number | string>;
}

export const AUDIT_Z_EPS = 1e-6;          // below this a floor reads as "piercing the ground"
export const AUDIT_OVERFLOW_MARGIN_PX = 2; // bbox within this many px of the canvas edge = clipped

/** Deterministic mesh facts derived from the extracted solid facets. */
export interface MeshStats {
  facetCount: number;
  vertexCount: number;
  /** Signed-tetrahedron sum / 6 over the outward-oriented triangles. Exact for a closed
   *  solid; UNDERCOUNTS an open/cutaway mesh — treat as an approximation, never a contract. */
  approxVolume: number;
  zMin: number;
  zMax: number;
}

function round(x: number, p = 3): number {
  const f = 10 ** p;
  return Math.round(x * f) / f;
}

/** The nominal lowest z (cube-units) of a prim's solid from its own fields — no manifold.
 *  `undefined` means "no determinate floor / allowlisted" (a skirt LEGITIMATELY drops below
 *  the ground plane as a foundation lip, so it is never flagged). */
function primFloorZ(p: Prim): number | undefined {
  switch (p.prim) {
    case 'box': return p.at[2];
    case 'cylinder': case 'cone': case 'prism': case 'pyramid': return p.baseZ;
    case 'waterwheel': return p.center[2];
    case 'ellipsoid': return p.baseZ - p.radii[2];
    case 'arch': return p.at[2];
    case 'column': return p.baseZ ?? 0;
    case 'roundwood': return p.center[2] - p.radius;   // approx: ignores pitch taper
    case 'building': return 0;                          // walls rise from the ground plane
    case 'flora': case 'linear': return 0;              // sits on the ground
    case 'rock': return p.baseZ;
    case 'skirt': return undefined;                     // allowlisted foundation lip (z<0)
  }
}

/** Signed tetrahedron volume over outward-oriented triangles — O(n), deterministic. */
function signedVolume(facets: WorldFacet[]): number {
  let vol = 0;
  for (const f of facets) {
    const pts = f.pts;
    for (let i = 1; i + 1 < pts.length; i++) {
      const ax = pts[0][0], ay = pts[0][1], az = pts[0][2];
      const bx = pts[i][0], by = pts[i][1], bz = pts[i][2];
      const cx = pts[i + 1][0], cy = pts[i + 1][1], cz = pts[i + 1][2];
      const crossX = by * cz - bz * cy;
      const crossY = bz * cx - bx * cz;
      const crossZ = bx * cy - by * cx;
      vol += ax * crossX + ay * crossY + az * crossZ;
    }
  }
  return vol / 6;
}

/** Compute mesh facts from the same solids composeStructure renders. Deterministic. */
export async function extractMeshStats(spec: StructureSpec): Promise<MeshStats> {
  const facets = (await Promise.all(spec.parts.map((p) => partFacets(p).then((r) => r.facets)))).flat();
  let zMin = Infinity, zMax = -Infinity, vertexCount = 0;
  for (const f of facets) {
    for (const v of f.pts) {
      if (v[2] < zMin) zMin = v[2];
      if (v[2] > zMax) zMax = v[2];
    }
    vertexCount += f.pts.length;
  }
  return {
    facetCount: facets.length,
    vertexCount,
    approxVolume: Math.abs(signedVolume(facets)),   // Math.abs: guard against winding convention
    zMin: zMin === Infinity ? 0 : zMin,
    zMax: zMax === -Infinity ? 0 : zMax,
  };
}

/** Fraction of the rendered canvas that carries opaque geometry (a cheap massing density). */
function opaqueFractionOf(result: StructureResult): number {
  const n = result.size * result.size;
  if (n <= 0) return 0;
  let opaque = 0;
  const grey = result.grey;
  for (let i = 0; i < n; i++) if (grey[i * 4 + 3] === 255) opaque++;
  return opaque / n;
}

/** True when the resolved blueprint should project at least one mount socket (a building
 *  or any wall opening). Used to catch a socket that silently failed to project. */
function expectsSockets(rb: ResolvedBlueprint): boolean {
  const hasBuildingPart = rb.parts.some((p) => p.type === 'body' || p.type === 'wing');
  const hasOpening = rb.parts.some((p) => p.features.some((f) => isOpening(getFeatureType(f.type))));
  return hasBuildingPart || hasOpening;
}

export interface AuditOpts {
  /** Extract volume/facet stats by re-driving the manifold kernel (author-time only).
   *  Default true; disable where only the cheap structure rules are wanted. */
  computeMeshStats?: boolean;
}

/**
 * Audit a COMPOSED structure. Consumes the StructureSpec the composer rendered, the resolved
 * blueprint it came from, and the StructureResult it produced. Returns severity-ordered
 * audits (errors first). Deterministic.
 */
export async function auditStructure(
  spec: StructureSpec,
  rb: ResolvedBlueprint,
  result: StructureResult,
  opts: AuditOpts = {},
): Promise<StructureAudit[]> {
  const out: StructureAudit[] = [];
  const size = result.size;
  const bw = result.bbox.w, bh = result.bbox.h;

  // 1. Degenerate / empty render — the strongest failure: an authored asset that composes
  //    to NO opaque geometry is useless, regardless of how it passed blueprint lint.
  if (bw <= 0 || bh <= 0) {
    out.push({ code: 'structure-empty', severity: 'error', message: 'structure composed to no opaque geometry (empty bbox)' });
    return out.sort(bySeverity);   // nothing else is meaningful on an empty render
  }

  // 2. Bbox vs the sprite budget — a solid that clips the canvas (or fills it edge-to-edge)
  //    is spilling out of its renderable footprint.
  if (size > 0 && (bw >= size - AUDIT_OVERFLOW_MARGIN_PX || bh >= size - AUDIT_OVERFLOW_MARGIN_PX)) {
    out.push({
      code: 'structure-overflow', severity: 'warn',
      message: `opaque bbox ${bw}×${bh}px touches the ${size}px sprite budget edge — the solid likely clips its renderable footprint`,
      detail: { bboxW: bw, bboxH: bh, size },
    });
  }

  // 3. Ground penetration — any non-skirt prim whose solid floor sits below z=0 (the
  //    ground plane) slices into the terrain. Skirts are allowlisted (their lip is the point).
  for (const prim of spec.parts) {
    const floor = primFloorZ(prim);
    if (floor !== undefined && floor < -AUDIT_Z_EPS) {
      out.push({
        code: 'z-penetration', severity: 'error',
        part: prim.srcId,
        message: `part "${prim.srcId ?? prim.prim}" (${prim.prim}) floor sits at z=${floor.toFixed(3)} — it penetrates below the ground plane`,
        detail: { z: round(floor, 4), prim: prim.prim },
      });
    }
  }

  // 4. Openings with no wall mass behind — a declared opening can only be carved if the
  //    spec carried a wall-bearing solid to carve it into. When none exists, the openings
  //    vanish silently (lint's compiler sink catches the same drop at compile time; this is
  //    the structure-level view over the EMITTED prims).
  const hasWallBearing = spec.parts.some((p) => p.prim === 'building' || p.prim === 'box' || p.prim === 'cylinder');
  if (!hasWallBearing) {
    for (const p of rb.parts) {
      const openings = p.features.filter((f) => isOpening(getFeatureType(f.type)));
      if (openings.length) {
        out.push({
          code: 'opening-no-wall', severity: 'warn', part: p.id,
          message: `part "${p.id}" declares ${openings.length} opening(s) but the structure emitted no wall-bearing solid — they will not render`,
          detail: { count: openings.length },
        });
      }
    }
  }

  // 5. Mount sockets — confirmed through when the blueprint expected them; a missing set
  //    means a lintel/ridge/eave anchor silently failed to project (signs/lamps can't hang).
  const tags = result.anchors.tags ?? [];
  if (expectsSockets(rb)) {
    if (tags.length === 0) {
      out.push({
        code: 'mount-anchor-missing', severity: 'warn',
        message: 'blueprint has building/opening parts that should project mount sockets (lintel/ridge/eave) but none came through',
      });
    } else {
      out.push({
        code: 'mount-anchors', severity: 'info',
        message: `${tags.length} mount socket(s) projected onto the sprite`,
        detail: { count: tags.length, kinds: Array.from(new Set(tags.map((t) => t.kind))).sort().join(',') },
      });
    }
  }

  // 6. Massing facts (author-time mesh pass, opt-out-able).
  if (opts.computeMeshStats !== false) {
    try {
      const m = await extractMeshStats(spec);
      const opaqueFraction = opaqueFractionOf(result);
      out.push({
        code: 'massing', severity: 'info',
        message: `facet=${m.facetCount} vert=${m.vertexCount} approxVolume=${round(m.approxVolume)} z[${round(m.zMin, 4)},${round(m.zMax, 4)}] opaque=${(opaqueFraction * 100).toFixed(1)}%`,
        detail: {
          facetCount: m.facetCount, vertexCount: m.vertexCount,
          approxVolume: round(m.approxVolume), zMin: round(m.zMin, 4), zMax: round(m.zMax, 4),
          opaqueFraction: round(opaqueFraction, 4),
        },
      });
    } catch (e) {
      out.push({
        code: 'structure-mesh-error', severity: 'warn',
        message: `could not extract mesh stats for the massing info: ${(e as Error).message}`,
      });
    }
  }

  return out.sort(bySeverity);
}

const bySeverity = (a: StructureAudit, b: StructureAudit): number => {
  const rank: Record<LintSeverity, number> = { error: 0, warn: 1, info: 2 };
  return rank[a.severity] - rank[b.severity];
};
