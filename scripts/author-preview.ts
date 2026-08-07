// scripts/author-preview.ts
// Ad-hoc authoring preview loop (Phase B0 of the LLM-authorable modeling epic).
// Feed an arbitrary AuthorInput-shaped spec (a preset name, a hand-authored Blueprint, or
// patches/descriptors over either) and get back: the SAME gate the game uses (authorBlueprint —
// resolve → validate → lint), a deterministic browserless composeStructure render, PNG(s) in
// .dev-grabs/, and a machine-readable diagnostics block on stdout. An LLM (dev harness, MCP,
// or in-game Fate author) iterates `spec.json → run → PNG + JSON → revise` with no browser,
// no world, no renderer — and a broken spec fails the gate with actionable lint, not a crash.
//
// Run:
//   npx tsx scripts/author-preview.ts spec.json                      # gate + render + text stats
//   npx tsx scripts/author-preview.ts spec.json --map normal         # dump normal instead of grey
//   npx tsx scripts/author-preview.ts spec.json --montage            # also write the multi-yaw montage
//   npx tsx scripts/author-preview.ts spec.json --json               # machine-parseable JSON only
//   npx tsx scripts/author-preview.ts --catalogue                    # print the authorable catalogue
//
// Exit codes: 0 = authored + composed cleanly; 1 = blueprint gate rejected the spec (lint /
// resolve failures printable and actionable); 2 = bad invocation / unreadable or malformed
// spec JSON. Deterministic: same spec ⇒ byte-identical PNG and identical JSON.
//
// The diagnostics "per-material coverage" is a deterministic census of OPAQUE pixels in the
// rendered grey (albedo) map classified by nearest MATERIAL_RGB reference — an honest view of
// the authored massing (mostly stone, some timber, etc.), not the flat PBR material buffer
// (which carries depth/AO/roughness/metallic, not a material id). API/branded surfaces and
// tinting shift albedo, so treat it as a rough census, exact pixel counts per run.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { composeStructure, type StructureResult } from '../src/assetgen/compose';
import { toGeometry } from '../src/blueprint/compile/to-geometry';
import { authorBlueprint, type AuthorInput } from '../src/blueprint/authoring';
import { summarizeLint, type BlueprintLint } from '../src/blueprint/lint';
import { auditStructure, type StructureAudit } from '../src/blueprint/audit-structure';
import { formatCatalogue } from '../src/blueprint/describe-registry';
import { ensureBuildingTypesRegistered } from '../src/blueprint/register-buildings';
import { renderBlueprintMontage } from '../src/assetgen/blueprint-montage';
import { MATERIAL_RGB, type Mat } from '../src/assetgen/types';
import type { ResolvedBlueprint } from '../src/blueprint/types';

const OUT = '.dev-grabs';
const MAPS = { grey: 'grey', albedo: 'grey', normal: 'normal', material: 'material' } as const;
type MapKind = keyof typeof MAPS;

/** Authorable-material reference RGBs, indexed for nearest-match classification. */
const MATERIAL_REFS = Object.entries(MATERIAL_RGB) as [Mat, [number, number, number]][];

function toPng(buf: Uint8ClampedArray, size: number): Buffer {
  const png = new PNG({ width: size, height: size });
  png.data = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  return PNG.sync.write(png);
}

function toPngWH(buf: Uint8ClampedArray, width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  png.data = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  return PNG.sync.write(png);
}

function pick(r: StructureResult, map: MapKind): Uint8ClampedArray {
  return map === 'normal' ? r.normal : map === 'material' ? r.material : r.grey;
}

/** Nearest reference material for an opaque albedo pixel (deterministic). */
function nearestMat(r: number, g: number, b: number): Mat {
  let best: Mat = 'stone';
  let bestD = Infinity;
  for (const [m, [mr, mg, mb]] of MATERIAL_REFS) {
    const d = (r - mr) ** 2 + (g - mg) ** 2 + (b - mb) ** 2;
    if (d < bestD) { bestD = d; best = m; }
  }
  return best;
}

/** Machine-readable diagnostics for a composed StructureResult. Pure + deterministic. */
export interface AuthorPreviewStats {
  size: number;
  bbox: { x: number; y: number; w: number; h: number };
  depthRange?: { lo: number; hi: number };
  /** Opaque pixel count / total canvas pixels (rough massing density). */
  opaqueFraction: number;
  /** Opaque pixel count per nearest-reference material (rough census, see header). */
  materials: Record<string, number>;
  anchors: {
    doors: number;
    vents: number;
    wallEnds?: number;
    gates?: number;
    tags: { kind: string; x: number; y: number; z: number; accepts?: string[] }[];
  };
  labels: { id: string; x: number; y: number }[];
}

export function buildStats(r: StructureResult): AuthorPreviewStats {
  const n = r.size * r.size;
  let opaque = 0;
  const materials: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    if (r.grey[i * 4 + 3] !== 255) continue;
    opaque++;
    const m = nearestMat(r.grey[i * 4], r.grey[i * 4 + 1], r.grey[i * 4 + 2]);
    materials[m] = (materials[m] ?? 0) + 1;
  }
  const tags = (r.anchors.tags ?? []).map((a) => ({
    kind: a.kind, x: a.x, y: a.y, z: a.z, ...(a.accepts ? { accepts: a.accepts } : {}),
  }));
  return {
    size: r.size,
    bbox: { x: r.bbox.x, y: r.bbox.y, w: r.bbox.w, h: r.bbox.h },
    ...(r.meta?.depthRange ? { depthRange: r.meta.depthRange } : {}),
    opaqueFraction: +(opaque / (n || 1)).toFixed(4),
    materials,
    anchors: {
      doors: r.anchors.doors.length,
      vents: r.anchors.vents.length,
      ...(r.anchors.wallEnds ? { wallEnds: r.anchors.wallEnds.length } : {}),
      ...(r.anchors.gates ? { gates: r.anchors.gates.length } : {}),
      tags,
    },
    labels: (r.labels ?? []).map((l) => ({ id: l.id, x: l.x, y: l.y })),
  };
}

/** The shared author→gate→render result. Pure of filesystem; buffers returned for tests. */
export interface AuthorPreviewResult {
  ok: boolean;
  summary: string;
  lints: BlueprintLint[];
  /** Structure-stage audits (Phase B1), present when the spec composed. Mirrors BlueprintLint. */
  audits?: StructureAudit[];
  /** The single merged, severity-ordered report (blueprint lint + structure audit) that
   *  `ok` / `summary` now reflect. Present on every (ok or rejected) result. */
  merged?: Array<BlueprintLint | StructureAudit>;
  stats?: AuthorPreviewStats;
  /** Rendered grey (albedo) PNG bytes — deterministic for a given spec. */
  greyPng?: Buffer;
  /** The composed StructureResult (any of grey/normal/material/emissive retrievable). */
  composed?: StructureResult;
  rb?: ResolvedBlueprint;
}

/** Part types that signal a span-construction (a crossing an author should validate against
 *  terrain). Note this deliberately EXCLUDES the defensive `barrier` wall class — a wall is
 *  not a span. */
const SPAN_PART_TYPES = new Set(['deck', 'arch_span', 'abutment', 'pier', 'railing']);

/** Emit a single 'info' advisory when the resolved blueprint contains span-construction parts,
 *  pointing the author at the terrain-aware span check. INFO only — never flips `ok`. */
function buildSpanAdvisories(rb: ResolvedBlueprint): StructureAudit[] {
  const present = (rb.parts ?? []).filter((p) => SPAN_PART_TYPES.has(p.type));
  if (present.length === 0) return [];
  const kinds = [...new Set(present.map((p) => p.type))].sort();
  return [{
    severity: 'info' as const,
    code: 'span-validate',
    message: `contains span-construction part(s): ${kinds.join('/')} — validate clear span vs its class envelope against real terrain with: npx tsx scripts/measure-structure-fit.ts <spec.json> x y`,
  }];
}

export async function authorPreview(input: AuthorInput): Promise<AuthorPreviewResult> {
  const gate = authorBlueprint(input);
  const base: AuthorPreviewResult = { ok: gate.ok, summary: gate.summary, lints: gate.lints, merged: gate.lints };
  if (!gate.ok || !gate.rb) return base;
  const spec = toGeometry(gate.rb);
  const r = await composeStructure(spec, undefined, { ...(spec.yaw ? { yaw: spec.yaw } : {}) });
  // Structure-stage audit (B1): structure ERRORS fail the preview exactly like lint errors,
  // so the merged summary + `ok` reflect BOTH stages — an agent branches on the same ok flag.
  const audits = [...(await auditStructure(spec, gate.rb, r)), ...buildSpanAdvisories(gate.rb)];
  const rank: Record<string, number> = { error: 0, warn: 1, info: 2 };
  const merged = [...gate.lints, ...audits].sort((a, b) => rank[a.severity] - rank[b.severity]);
  const ok = audits.every((a) => a.severity !== 'error');
  return {
    ok,
    summary: summarizeLint(merged),
    lints: gate.lints,
    audits,
    merged,
    stats: buildStats(r),
    greyPng: toPng(r.grey, r.size),
    composed: r,
    rb: gate.rb,
  };
}

/** Print a merged (blueprint lint + structure audit) report, severity-tagged. */
function printAudits(items: Array<BlueprintLint | StructureAudit>): void {
  for (const l of items) {
    const tag = l.severity === 'error' ? 'ERR ' : l.severity === 'warn' ? 'warn' : 'note';
    const where = [l.part, l.feature].filter(Boolean).join('/');
    console.log(`    [${tag}] ${l.code}${where ? ` (${where})` : ''}: ${l.message}`);
  }
}

function formatStats(s: AuthorPreviewStats): string {
  const lines: string[] = [];
  lines.push(`size: ${s.size}px  bbox: [${s.bbox.x},${s.bbox.y} ${s.bbox.w}x${s.bbox.h}]  opaque: ${(s.opaqueFraction * 100).toFixed(1)}%`);
  if (s.depthRange) lines.push(`depthRange: [${s.depthRange.lo.toFixed(3)}, ${s.depthRange.hi.toFixed(3)}]`);
  const mats = Object.entries(s.materials).sort((a, b) => b[1] - a[1]);
  if (mats.length) lines.push(`materials: ${mats.map(([m, c]) => `${m}=${c}`).join('  ')}`);
  const a = s.anchors;
  const tagStr = a.tags.length ? ` tags[${a.tags.map((t) => `${t.kind}@${t.x.toFixed(2)},${t.y.toFixed(2)} z${t.z}`).join(' ')}]` : '';
  lines.push(`anchors: doors=${a.doors} vents=${a.vents}${a.wallEnds != null ? ` wallEnds=${a.wallEnds}` : ''}${a.gates != null ? ` gates=${a.gates}` : ''}${tagStr}`);
  if (s.labels.length) lines.push(`labels: ${s.labels.map((l) => `${l.id}@${l.x.toFixed(2)},${l.y.toFixed(2)}`).join('  ')}`);
  return lines.join('\n');
}

/** CLI entry — returns the process exit code (exported for deterministic unit-testing). */
export async function runAuthorPreview(argv: string[]): Promise<number> {
  if (argv.includes('--catalogue') || argv.includes('--catalog')) {
    ensureBuildingTypesRegistered();
    console.log(formatCatalogue());
    return 0;
  }
  const specPath = argv.find((a) => !a.startsWith('--'));
  if (!specPath) {
    console.error('usage: author-preview.ts <spec.json> [--map grey|normal|material|albedo] [--montage] [--json] [--catalogue]');
    return 2;
  }
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const json = flags.has('--json');
  const wantMontage = flags.has('--montage');
  // --map <kind> (task-spec) or the legacy bare --normal/--material/--albedo flags.
  const mapIdx = argv.indexOf('--map');
  let map: MapKind = 'grey';
  if (mapIdx >= 0) {
    const val = argv[mapIdx + 1];
    if (val && MAPS[val as MapKind]) {
      map = val as MapKind;
    } else {
      console.error(`author-preview: unknown --map value '${val ?? ''}' (expected grey|normal|material|albedo)`);
      return 2;
    }
  } else {
    map = (['albedo', 'normal', 'material'] as const).find((m) => flags.has(`--${m}`)) ?? 'grey';
  }

  let input: AuthorInput;
  try {
    input = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(specPath, 'utf8'))) as AuthorInput;
  } catch (e) {
    console.error(`author-preview: cannot read/parse spec JSON '${specPath}': ${(e as Error).message}`);
    return 2;
  }

  const res = await authorPreview(input);
  if (!res.ok || !res.stats) {
    // Gate rejection (blueprint OR structure) — actionable report, non-zero exit for a loop.
    console.error(`author-preview: rejected — ${res.summary}`);
    printAudits(res.merged ?? res.lints);
    return 1;
  }

  const base = specPath.replace(/\.json$/i, '').split('/').pop() ?? 'spec';
  mkdirSync(OUT, { recursive: true });
  if (!json && res.merged && res.merged.length) {
    console.log(`merged audit: ${res.summary}`);
    printAudits(res.merged);
  }
  if (res.composed) writeFileSync(join(OUT, `${base}-${map}.png`), toPng(pick(res.composed, map), res.composed.size));
  if (wantMontage && res.rb) {
    const m = await renderBlueprintMontage(res.rb);
    writeFileSync(join(OUT, `${base}-views.png`), toPngWH(m.rgba, m.width, m.height));
    if (!json) console.log(`montage → .dev-grabs/${base}-views.png (${m.width}×${m.height}, ${m.yaws.length} yaws)`);
  }

  if (json) {
    console.log(JSON.stringify({
      ok: true, summary: res.summary,
      lint: summarizeLint(res.lints), audits: res.audits ?? [],
      ...res.stats,
    }, null, 2));
  } else {
    console.log(`ok: ${res.summary}`);
    console.log(formatStats(res.stats));
    console.log(`render → .dev-grabs/${base}-${map}.png`);
  }
  return 0;
}

if (import.meta.url === new URL(process.argv[1] ?? '', 'file:').href) {
  runAuthorPreview(process.argv.slice(2)).then((code) => process.exit(code));
}
