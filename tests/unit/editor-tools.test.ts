import { describe, it, expect } from 'vitest';
import { EDITOR_TOOLS, editorToolList } from '@/llm/editor-tools';
import { listCapabilities } from '@/sim/command/registry';

describe('editor tools', () => {
  it('exposes exactly one tool per editor-tier registry verb (no drift)', () => {
    const editorVerbs = listCapabilities().filter(c => c.tier === 'editor').map(c => c.verb).sort();
    const toolNames = EDITOR_TOOLS.map(t => t.name).sort();
    expect(toolNames).toEqual(editorVerbs);
  });

  it('every tool has a description and an object-typed JSON-schema parameters', () => {
    for (const t of EDITOR_TOOLS) {
      expect(t.description.length).toBeGreaterThan(0);
      expect((t.parameters as { type?: string }).type).toBe('object');
      expect(t.parameters).toHaveProperty('properties');
    }
  });

  it('editorToolList returns the tool array', () => {
    expect(editorToolList()).toBe(EDITOR_TOOLS);
  });

  it('author_spawn_npc requires a role and supports belief overrides', () => {
    const spawn = EDITOR_TOOLS.find(t => t.name === 'author_spawn_npc')!;
    const props = (spawn.parameters as { properties: Record<string, unknown>; required?: string[] });
    expect(props.required).toContain('role');
    expect(props.properties).toHaveProperty('faith');
    expect(props.properties).toHaveProperty('near');
  });
});
