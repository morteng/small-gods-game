// tests/unit/blueprint-param-schema.test.ts
import { describe, it, expect } from 'vitest';
import { validateParams, type ParamSchema } from '@/blueprint/param-schema';

const schema: ParamSchema = {
  levels: { kind: 'number', min: 1, max: 8, default: 1 },
  roof: { kind: 'enum', values: ['gable', 'hip', 'flat'], default: 'gable' },
  grand: { kind: 'bool', default: false },
};

describe('validateParams', () => {
  it('fills defaults for unspecified params', () => {
    expect(validateParams(schema, {})).toEqual({ levels: 1, roof: 'gable', grand: false });
  });

  it('keeps valid provided values', () => {
    expect(validateParams(schema, { levels: 3, roof: 'hip' }))
      .toEqual({ levels: 3, roof: 'hip', grand: false });
  });

  it('clamps numbers outside the range', () => {
    expect(validateParams(schema, { levels: 99 }).levels).toBe(8);
    expect(validateParams(schema, { levels: 0 }).levels).toBe(1);
  });

  it('throws on an unknown enum value', () => {
    expect(() => validateParams(schema, { roof: 'banana' })).toThrow(/roof/);
  });

  it('throws on an unknown param key', () => {
    expect(() => validateParams(schema, { nope: 1 })).toThrow(/nope/);
  });

  it('kind:any accepts an object and falls back to its default when absent', () => {
    const anySchema = { data: { kind: 'any' as const, default: null } };
    const obj = { foo: 42 };
    expect(validateParams(anySchema, { data: obj }).data).toBe(obj);
    expect(validateParams(anySchema, {}).data).toBeNull();
  });
});
