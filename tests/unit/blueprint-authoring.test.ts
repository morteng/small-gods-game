// tests/unit/blueprint-authoring.test.ts
import { describe, it, expect } from 'vitest';
import { authorBlueprint } from '@/blueprint/authoring';
import { BLUEPRINT_VERSION, type Blueprint } from '@/blueprint/types';

describe('authorBlueprint (the shared gate)', () => {
  it('a known preset resolves and is committable (ok)', () => {
    const r = authorBlueprint({ preset: 'cottage' });
    expect(r.ok).toBe(true);
    expect(r.rb).toBeDefined();
    expect(r.rb!.preset).toBe('cottage');
  });

  it('descriptors ride through into the resolved blueprint', () => {
    const r = authorBlueprint({ preset: 'cottage', descriptors: { wealth: 'opulent', quality: 'ornate' } });
    expect(r.ok).toBe(true);
    expect(r.rb!.descriptors).toMatchObject({ wealth: 'opulent', quality: 'ornate' });
  });

  it('a hand-authored blueprint is resolved + linted', () => {
    const manor: Blueprint = {
      version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 4, h: 4 },
      materials: { walls: 'stone', roof: 'tile' },
      parts: { body: { type: 'body', size: { w: 4, h: 4 }, params: { plan: 'rect', levels: 2, roof: 'hip' },
        features: { door: { type: 'door', face: 'south', params: { main: true } } } } },
    };
    const r = authorBlueprint({ blueprint: manor });
    expect(r.ok).toBe(true);
    expect(r.rb!.parts[0].type).toBe('body');
  });

  it('rejects (ok=false) an unknown preset without throwing', () => {
    const r = authorBlueprint({ preset: 'does-not-exist' });
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/unknown preset/);
  });

  it('rejects (ok=false) a blueprint that fails to resolve', () => {
    const broken: Blueprint = {
      version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 2, h: 2 },
      materials: { walls: 'stone', roof: 'tile' },
      parts: { x: { type: 'no-such-part-type' } },
    };
    const r = authorBlueprint({ blueprint: broken });
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/resolve failed/);
  });

  it('requires exactly one of preset/blueprint', () => {
    const r = authorBlueprint({});
    expect(r.ok).toBe(false);
  });
});
