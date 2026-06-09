import { describe, it, expect, vi } from 'vitest';
import { createSettingsPanel } from '@/ui/settings-unified';

describe('liveBuildingArt toggle', () => {
  it('renders ON by default and fires onGameSettingChange', () => {
    const onGameSettingChange = vi.fn();
    const host = document.createElement('div');
    createSettingsPanel(host, { onGameSettingChange });
    const row = [...host.querySelectorAll('label')].find(l => /generate building art/i.test(l.textContent || ''));
    expect(row).toBeTruthy();
    const cb = row!.querySelector('input[type=checkbox]') as HTMLInputElement;
    expect(cb.checked).toBe(true);
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
    expect(onGameSettingChange).toHaveBeenCalledWith('liveBuildingArt', false);
  });
});
