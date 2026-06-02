import { describe, it, expect, vi } from 'vitest';
import { renderFields, type PropertyField } from '@/dev/PropertyGrid';

describe('renderFields', () => {
  it('renders rows with dev classes and emits onChange for editable fields', () => {
    const host = document.createElement('div');
    const fields: PropertyField[] = [
      { key: 'name', label: 'Name', type: 'string' },
      { key: 'role', label: 'Role', type: 'enum', options: ['farmer', 'priest'] },
      { key: 'kind', label: 'Kind', type: 'string', readonly: true },
    ];
    const rec: Record<string, unknown> = { name: 'Ada', role: 'farmer', kind: 'npc' };
    const onChange = vi.fn();
    renderFields(host, fields, k => rec[k], onChange);

    expect(host.querySelectorAll('.sg-dev-row').length).toBe(3);
    const input = host.querySelector('.sg-dev-input') as HTMLInputElement;
    input.value = 'Bob';
    input.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith('name', 'Bob');

    const select = host.querySelector('.sg-dev-select') as HTMLSelectElement;
    expect(select.disabled).toBe(false);
  });
});
