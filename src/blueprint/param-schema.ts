// src/blueprint/param-schema.ts
// A field-level contract per registry entry: validates authored params AND
// auto-documents the knob for agents (the registry IS the capability catalogue).
export type ParamSpec =
  | { kind: 'number'; min?: number; max?: number; default: number; doc?: string }
  | { kind: 'enum'; values: readonly string[]; default: string; doc?: string }
  | { kind: 'bool'; default: boolean; doc?: string }
  | { kind: 'string'; default?: string; doc?: string }
  | { kind: 'any'; default?: unknown; doc?: string };

export type ParamSchema = Record<string, ParamSpec>;

const clamp = (v: number, lo: number | undefined, hi: number | undefined): number => {
  if (lo !== undefined && v < lo) return lo;
  if (hi !== undefined && v > hi) return hi;
  return v;
};

/** Validate `params` against `schema`, returning a fully-defaulted object. Throws on
 *  unknown keys, wrong types, or out-of-enum values; clamps numbers into range. */
export function validateParams(
  schema: ParamSchema, params: Record<string, unknown> = {},
): Record<string, unknown> {
  for (const key of Object.keys(params)) {
    if (!(key in schema)) throw new Error(`unknown param "${key}" (valid: ${Object.keys(schema).join(', ')})`);
  }
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(schema)) {
    const raw = params[key];
    if (raw === undefined) { out[key] = spec.default; continue; }
    switch (spec.kind) {
      case 'number': {
        if (typeof raw !== 'number' || Number.isNaN(raw)) throw new Error(`param "${key}" must be a number`);
        out[key] = clamp(raw, spec.min, spec.max); break;
      }
      case 'enum': {
        if (!spec.values.includes(raw as string)) throw new Error(`param "${key}" must be one of ${spec.values.join('|')}, got "${String(raw)}"`);
        out[key] = raw; break;
      }
      case 'bool': {
        if (typeof raw !== 'boolean') throw new Error(`param "${key}" must be a boolean`);
        out[key] = raw; break;
      }
      case 'string': {
        if (typeof raw !== 'string') throw new Error(`param "${key}" must be a string`);
        out[key] = raw; break;
      }
      case 'any': {
        out[key] = raw; break;
      }
    }
  }
  return out;
}
