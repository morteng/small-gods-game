/**
 * Agent authoring contract.
 *
 * `STORY_PACK_SCHEMA` is a JSON Schema for `StoryPack` — hand it to an agent as a
 * tool-input / structured-output schema so Fate can only ever EMIT well-formed IR.
 * `parsePack()` is the ingest gate: parse → structural check → `validatePack()`,
 * returning actionable errors (agents iterate on errors, so they must be precise).
 *
 * Two layers on purpose: the JSON Schema constrains *shape* at generation time;
 * `validatePack` enforces *semantics* the schema can't (goto targets resolve, the
 * no-key fallback law, the capability allowlist). An agent-authored pack must pass
 * both before it runs.
 */
import type { StoryPack } from './story-ir';
import { STORY_IR_VERSION } from './story-ir';
import { validatePack } from './validate';
import type { ValidateOptions } from './validate';

export interface ParseResult {
  pack: StoryPack | null;
  errors: string[];
}

/** Parse + structurally + semantically validate agent-authored pack JSON. */
export function parsePack(input: string | unknown, opts: ValidateOptions = {}): ParseResult {
  let obj: unknown = input;
  if (typeof input === 'string') {
    try { obj = JSON.parse(input); }
    catch (e) { return { pack: null, errors: [`invalid JSON: ${(e as Error).message}`] }; }
  }

  const shape = structuralErrors(obj);
  if (shape.length) return { pack: null, errors: shape };

  const pack = obj as StoryPack;
  const errors = validatePack(pack, opts);
  return { pack: errors.length ? null : pack, errors };
}

/** Cheap top-level shape checks that produce clearer messages than a deep validator. */
function structuralErrors(obj: unknown): string[] {
  const errs: string[] = [];
  if (obj == null || typeof obj !== 'object') return ['pack must be an object'];
  const p = obj as Record<string, unknown>;
  if (typeof p.id !== 'string' || !p.id) errs.push('pack.id must be a non-empty string');
  if (typeof p.version !== 'number') errs.push('pack.version must be a number');
  if (!Array.isArray(p.storylets)) errs.push('pack.storylets must be an array');
  else p.storylets.forEach((s, i) => {
    if (s == null || typeof s !== 'object') errs.push(`storylets[${i}] must be an object`);
    else {
      const st = s as Record<string, unknown>;
      if (typeof st.id !== 'string' || !st.id) errs.push(`storylets[${i}].id must be a non-empty string`);
      if (!Array.isArray(st.body)) errs.push(`storylets[${i}].body must be an array`);
    }
  });
  return errs;
}

/** JSON Schema (draft-07) for an agent's StoryPack tool input / structured output. */
export const STORY_PACK_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'small-gods/story-pack',
  title: 'StoryPack',
  description:
    'A self-contained authored-narrative pack. Plays deterministically with no AI; ' +
    'Fate may draw from and enrich it when present. Every AI-optional text slot MUST ' +
    'carry a deterministic fallback.',
  type: 'object',
  required: ['id', 'version', 'storylets'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', minLength: 1 },
    title: { type: 'string' },
    version: { const: STORY_IR_VERSION },
    state: { $ref: '#/$defs/fields' },
    storylets: { type: 'array', minItems: 1, items: { $ref: '#/$defs/storylet' } },
  },
  $defs: {
    value: { type: ['string', 'number', 'boolean', 'null'] },
    fields: { type: 'object', additionalProperties: { $ref: '#/$defs/value' } },

    storylet: {
      type: 'object',
      required: ['id', 'body'],
      additionalProperties: false,
      properties: {
        id: { type: 'string', minLength: 1 },
        title: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        when: { type: 'array', items: { $ref: '#/$defs/expr' }, description: 'All must be truthy to be eligible.' },
        priority: { type: 'number' },
        once: { type: 'boolean' },
        state: { $ref: '#/$defs/fields' },
        body: { type: 'array', items: { $ref: '#/$defs/node' } },
      },
    },

    textSlot: {
      description: 'A string (may contain $path), a seeded pick, or an AI-optional fallback+enrich.',
      oneOf: [
        { type: 'string' },
        { type: 'object', required: ['pick'], additionalProperties: false,
          properties: { pick: { type: 'array', minItems: 1, items: { type: 'string' } } } },
        { type: 'object', required: ['fallback', 'enrich'], additionalProperties: false,
          properties: {
            fallback: { type: 'string', minLength: 1, description: 'REQUIRED — renders with no AI.' },
            enrich: {
              type: 'object', required: ['slotId'], additionalProperties: false,
              properties: {
                slotId: { type: 'string', minLength: 1 },
                prompt: { type: 'string' },
                exemplars: { type: 'array', items: { type: 'string' } },
              },
            },
          } },
      ],
    },

    expr: {
      description: 'A literal value or a small expression over scope fields + chance.',
      oneOf: [
        { $ref: '#/$defs/value' },
        { type: 'object', required: ['var'], additionalProperties: false, properties: { var: { type: 'string' } } },
        { type: 'object', required: ['not'], additionalProperties: false, properties: { not: { $ref: '#/$defs/expr' } } },
        { type: 'object', required: ['chance'], additionalProperties: false, properties: { chance: { type: 'number', minimum: 1 } } },
        { type: 'object', required: ['op', 'l', 'r'], additionalProperties: false,
          properties: {
            op: { enum: ['==', '!=', '<', '<=', '>', '>=', '&&', '||', '+', '-', '*'] },
            l: { $ref: '#/$defs/expr' }, r: { $ref: '#/$defs/expr' },
          } },
      ],
    },

    effect: {
      type: 'object', required: ['verb'], additionalProperties: false,
      properties: {
        verb: { type: 'string', description: 'Must be a registered bus capability.' },
        args: { type: 'object', description: 'npc/settlement → target; rest → params/payload.' },
      },
    },

    node: {
      oneOf: [
        { type: 'object', required: ['t', 'text'], additionalProperties: false,
          properties: { t: { const: 'say' }, who: { type: ['string', 'null'] }, text: { $ref: '#/$defs/textSlot' }, tags: { type: 'array', items: { type: 'string' } } } },
        { type: 'object', required: ['t', 'options'], additionalProperties: false,
          properties: { t: { const: 'choice' }, options: { type: 'array', minItems: 1, items: { $ref: '#/$defs/choiceOption' } } } },
        { type: 'object', required: ['t', 'branches'], additionalProperties: false,
          properties: { t: { const: 'if' }, branches: { type: 'array', minItems: 1, items: { $ref: '#/$defs/ifBranch' } } } },
        { type: 'object', required: ['t', 'target', 'op', 'value'], additionalProperties: false,
          properties: { t: { const: 'set' }, target: { type: 'string' }, op: { enum: ['=', '+=', '-='] }, value: { $ref: '#/$defs/expr' } } },
        { type: 'object', required: ['t', 'effect'], additionalProperties: false,
          properties: { t: { const: 'do' }, effect: { $ref: '#/$defs/effect' } } },
        { type: 'object', required: ['t', 'storylet'], additionalProperties: false,
          properties: { t: { const: 'goto' }, storylet: { type: 'string' } } },
        { type: 'object', required: ['t'], additionalProperties: false, properties: { t: { const: 'end' } } },
      ],
    },

    choiceOption: {
      type: 'object', required: ['text', 'body'], additionalProperties: false,
      properties: { text: { $ref: '#/$defs/textSlot' }, when: { $ref: '#/$defs/expr' }, body: { type: 'array', items: { $ref: '#/$defs/node' } } },
    },
    ifBranch: {
      type: 'object', required: ['body'], additionalProperties: false,
      properties: { when: { $ref: '#/$defs/expr' }, body: { type: 'array', items: { $ref: '#/$defs/node' } } },
    },
  },
} as const;
