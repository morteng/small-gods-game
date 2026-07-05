// src/blueprint/describe-registry.ts
// Serialize the part/feature registries into a machine-readable capability catalogue —
// the answer to "what can an LLM author?". The registry paramSchema IS the contract
// (validateParams enforces it); this turns it into a flat, promptable description an
// authoring agent (dev, MCP, or the in-game Fate author-building tool) reads to know the
// legal knobs, their ranges/enums, defaults, and — where populated — a `doc` line.
import { listPartTypes, listFeatureTypes } from './registry';
import type { ParamSchema, ParamSpec } from './param-schema';
import { isOpening } from './features/opening';

export interface ParamDoc {
  name: string;
  kind: ParamSpec['kind'];
  default?: unknown;
  doc?: string;
  range?: [number | undefined, number | undefined];
  values?: readonly string[];
}
export interface PartDoc { type: string; params: ParamDoc[] }
export interface FeatureDoc { type: string; opening: boolean; threshold?: boolean; params: ParamDoc[] }
export interface RegistryCatalogue { parts: PartDoc[]; features: FeatureDoc[] }

function docParams(schema: ParamSchema): ParamDoc[] {
  return Object.entries(schema).map(([name, spec]): ParamDoc => ({
    name,
    kind: spec.kind,
    default: 'default' in spec ? spec.default : undefined,
    ...(spec.doc ? { doc: spec.doc } : {}),
    ...(spec.kind === 'number' ? { range: [spec.min, spec.max] } : {}),
    ...(spec.kind === 'enum' ? { values: spec.values } : {}),
  }));
}

/** The full authorable-capability catalogue, derived live from the registries. */
export function describeRegistry(): RegistryCatalogue {
  return {
    parts: listPartTypes().map((pt): PartDoc => ({ type: pt.type, params: docParams(pt.paramSchema) })),
    features: listFeatureTypes().map((ft): FeatureDoc => ({
      type: ft.type, opening: isOpening(ft), ...(ft.threshold ? { threshold: true } : {}),
      params: docParams(ft.paramSchema),
    })),
  };
}

function fmtParam(p: ParamDoc): string {
  let dom = '';
  if (p.kind === 'number' && p.range) dom = ` [${p.range[0] ?? '-∞'}..${p.range[1] ?? '∞'}]`;
  else if (p.kind === 'enum' && p.values) dom = ` {${p.values.join('|')}}`;
  else if (p.kind === 'bool') dom = ' {true|false}';
  const def = p.default !== undefined ? ` = ${JSON.stringify(p.default)}` : '';
  return `    ${p.name}: ${p.kind}${dom}${def}${p.doc ? `  — ${p.doc}` : ''}`;
}

/** Human/LLM-readable text dump of the catalogue (CLI + skill reference). */
export function formatCatalogue(cat: RegistryCatalogue = describeRegistry()): string {
  const lines: string[] = ['PART TYPES', '========='];
  for (const pt of cat.parts) {
    lines.push(`  ${pt.type}`);
    for (const p of pt.params) lines.push(fmtParam(p));
  }
  lines.push('', 'FEATURE TYPES', '=============');
  for (const ft of cat.features) {
    const role = ft.opening ? (ft.threshold ? ' (opening, passable)' : ' (opening)') : '';
    lines.push(`  ${ft.type}${role}`);
    for (const p of ft.params) lines.push(fmtParam(p));
  }
  return lines.join('\n');
}
