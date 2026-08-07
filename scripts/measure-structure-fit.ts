// scripts/measure-structure-fit.ts
// Phase B3 measurement tool: given an AuthorInput spec + a map tile (x,y), report how that
// authored structure fits the GROUND it's placed on.
//   - Sampled against a deterministic generated world (identical seed ⇒ identical terrain),
//     using the world's terrain height in metres (`heightAt` with the full deformation store:
//     roads/rivers/settlement pads; falls back to the base seed field if the store is absent).
//   - Core fit metrics come from the PURE `measureStructureFit` core (scripts/lib) — per-cell
//     ground clearance (vs the placement-anchor grade), min/max/mean clearance, max slope.
//   - Mount sockets: reports each projected mount anchor's `z` (metres above the structure's
//     ground datum) alongside the terrain height at the footprint cell nearest its normalized
//     sprite position. NOTE the mapping approximation: anchor x/y are sprite-bbox-normalised
//     (0..1), so a `floor(nx*footprint.w), floor(ny*footprint.h)` offset is an approximation of
//     the socket's footprint position, not an exact placement.
//   - Occlusion: best-effort probe for adjacent/overlapping placed buildings near the
//     footprint via the world's clean `query({ tag:'building', region })` API. The light
//     world this script generates (terrain only, no settlement realisation) contains NO
//     realised building entities, so occlusion reports 0 here; it would only populate against
//     a seeded/settled world or snapshot. Do not mistake "0 neighbours" for "measurement is
//     wrong" — it means the sampled world has nothing realised near that tile.
//
// Run:
//   npx tsx scripts/measure-structure-fit.ts spec.json x y [--seed N] [--json]
//     spec.json           AuthorInput spec (preset name or Blueprint) — same loader as author-preview
//     x y                 target tile (integers)
//     --seed <N>          deterministic world seed (default 12345)
//     --json              machine-parseable JSON only
//   Exit codes: 0 = measured; 1 = spec rejected by the authoring gate (actionable report);
//   2 = usage/bad input. Deterministic for a fixed spec + seed.
import { readFileSync } from 'node:fs';
import { generateWithNoise } from '../src/map/map-generator';
import { planWorldLayout } from '../src/world/poi-layout';
import { heightMetresAt } from '../src/world/heightfield';
import { heightAt } from '../src/world/terrain-deformation';
import { getWorldDeformationStore } from '../src/world/road-deformation';
import type { World } from '../src/world/world';
import type { WorldSeed } from '../src/core/types';
import { authorPreview } from './author-preview';
import { measureStructureFit, type StructureFitReport } from './lib/measure-structure-fit';

const DEFAULT_SEED = 12345;

export interface OcclusionProbe {
  /** Buildings whose footprint overlaps the target footprint — a placement collision. */
  overlapping: string[];
  /** Buildings inside the probe margin but not overlapping (immediate neighbours). */
  adjacent: { id: string; dx: number; dy: number }[];
  note: string;
}

/** Probe for placed buildings near the footprint via the clean world.query tag index. */
function probeOcclusion(world: World, ox: number, oy: number, w: number, h: number, width: number, height: number, margin = 2): OcclusionProbe {
  const rx = Math.max(0, Math.min(width - 1, ox - margin));
  const ry = Math.max(0, Math.min(height - 1, oy - margin));
  const rw = Math.min(width - rx, w + margin * 2);
  const rh = Math.min(height - ry, h + margin * 2);
  const near = world.query({ tag: 'building', region: { x: rx, y: ry, w: rw, h: rh } });

  const overlapping: string[] = [];
  const adjacent: { id: string; dx: number; dy: number }[] = [];
  for (const e of near) {
    const fp = (e.properties as { footprint?: { w: number; h: number } } | undefined)?.footprint ?? { w: 1, h: 1 };
    const ex = Math.floor(e.x);
    const ey = Math.floor(e.y);
    const overlap =
      ox < ex + fp.w && ex < ox + w && oy < ey + fp.h && ey < oy + h;
    if (overlap) {
      overlapping.push(e.id);
    } else {
      const dx = Math.max(0, Math.max(ex - (ox + w - 1), ox - (ex + fp.w - 1)));
      const dy = Math.max(0, Math.max(ey - (oy + h - 1), oy - (ey + fp.h - 1)));
      adjacent.push({ id: e.id, dx, dy });
    }
  }
  // Sort deterministically for stable output.
  overlapping.sort();
  adjacent.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return {
    overlapping,
    adjacent,
    note: 'occlusion reflects BUILDING entities the sampled world has realised; the light terrain-only world here realises none (see header)',
  };
}

function formatText(place: { x: number; y: number }, r: StructureFitReport, anchors: Array<{ kind: string; z: number; nx: number; ny: number }>, occ: OcclusionProbe, terrain: (x: number, y: number) => number): string {
  const lines: string[] = [`measure @ (${place.x},${place.y})  footprint ${r.footprint.w}×${r.footprint.h}  reference ${r.referenceM.toFixed(3)}m`];
  lines.push(`clearance: min ${r.minClearanceM.toFixed(3)}m  max ${r.maxClearanceM.toFixed(3)}m  mean ${r.meanClearanceM.toFixed(3)}m  maxSlope ${r.maxSlopeMvTile.toFixed(3)} m/tile`);
  if (anchors.length) {
    lines.push(`sockets: ${anchors.map((a) => `${a.kind}=z${a.z.toFixed(2)}m@${terrain(Math.floor(r.origin.x + a.nx * r.footprint.w), Math.floor(r.origin.y + a.ny * r.footprint.h)).toFixed(2)}m-ground`).join('  ')}`);
  } else {
    lines.push('sockets: none');
  }
  lines.push(`occlusion: ${occ.overlapping.length} overlap${occ.overlapping.length ? ` (${occ.overlapping.join(',')})` : ''}, ${occ.adjacent.length} adjacent${occ.adjacent.length ? ` (${occ.adjacent.map((a) => a.id).join(',')})` : ''}`);
  return lines.join('\n');
}

export interface MeasureRun {
  ok: boolean;
  report?: StructureFitReport;
  place?: { x: number; y: number };
  anchors?: Array<{ kind: string; z: number; nx: number; ny: number }>;
  occlusion?: OcclusionProbe;
  note?: string;
}

export async function runMeasure(argv: string[]): Promise<number> {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const json = flags.has('--json');
  const positional = argv.filter((a) => !a.startsWith('--'));
  const specPath = positional[0];
  const x = Number(positional[1]);
  const y = Number(positional[2]);
  if (!specPath || !Number.isFinite(x) || !Number.isFinite(y)) {
    console.error('usage: measure-structure-fit.ts <spec.json> <x> <y> [--seed N] [--json]');
    return 2;
  }
  const seedIdx = argv.indexOf('--seed');
  const seed = seedIdx >= 0 && argv[seedIdx + 1] ? Number(argv[seedIdx + 1]) : DEFAULT_SEED;

  let input: unknown;
  try {
    input = JSON.parse(readFileSync(specPath, 'utf8'));
  } catch (e) {
    console.error(`measure-structure-fit: cannot read/parse spec '${specPath}': ${(e as Error).message}`);
    return 2;
  }

  // Reuse the B0 authoring gate + compose (same path the game uses) to resolve the spec.
  const res = await authorPreview(input as Parameters<typeof authorPreview>[0]);
  if (!res.ok || !res.rb || !res.composed) {
    console.error(`measure-structure-fit: spec rejected — ${res.summary}`);
    for (const l of res.merged ?? res.lints) {
      console.error(`  [${l.severity}] ${l.code}: ${l.message}`);
    }
    return 1;
  }
  const footprint = res.rb.footprint ?? { w: 1, h: 1 };

  // Deterministic world for terrain sampling.
  const ws = JSON.parse(readFileSync('public/data/worlds/default.json', 'utf8')) as WorldSeed;
  const layout = planWorldLayout(ws);
  const laidOut: WorldSeed = { ...ws, size: layout.size, pois: layout.pois, connections: layout.connections };
  const { map, world } = await generateWithNoise(laidOut.size.width, laidOut.size.height, seed, laidOut, {});

  let store: ReturnType<typeof getWorldDeformationStore> | null = null;
  try { store = getWorldDeformationStore(map); } catch { store = null; }
  const terrain = (tx: number, ty: number): number =>
    store ? heightAt(map, store, tx, ty) : heightMetresAt(map, tx, ty);

  const place = { x: Math.floor(x), y: Math.floor(y) };
  const report = measureStructureFit(place, footprint, terrain);

  const anchors = (res.composed.anchors.tags ?? []).map((a) => ({
    kind: a.kind, z: a.z, nx: a.x, ny: a.y,
  }));

  const occ = probeOcclusion(world, place.x, place.y, report.footprint.w, report.footprint.h, laidOut.size.width, laidOut.size.height);

  if (json) {
    console.log(JSON.stringify({ ok: true, seed, place: report.origin, ...reportToJson(report), sockets: anchors, occlusion: occ }, null, 2));
  } else {
    console.log(`seed ${seed}: ${formatText(place, report, anchors, occ, terrain)}`);
  }
  return 0;
}

function reportToJson(r: StructureFitReport): Record<string, unknown> {
  return {
    referenceM: r.referenceM,
    footprint: r.footprint,
    minClearanceM: r.minClearanceM,
    maxClearanceM: r.maxClearanceM,
    meanClearanceM: r.meanClearanceM,
    maxSlopeMvTile: r.maxSlopeMvTile,
    cells: r.cells,
  };
}

if (import.meta.url === new URL(process.argv[1] ?? '', 'file:').href) {
  runMeasure(process.argv.slice(2)).then((code) => process.exit(code));
}
