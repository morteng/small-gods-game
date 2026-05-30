import type { DevModeState } from '@/core/types';

/**
 * Create a fresh DevModeState instance.
 */
export function createDevMode(): DevModeState {
  return {
    enabled: false,
    selected: null,
    clipboard: null,
    undoStack: [],
    redoStack: [],
    activeTool: 'select',
  };
}

/**
 * Toggle dev mode on/off.
 * Returns the new enabled state.
 */
export function toggleDevMode(state: DevModeState): boolean {
  state.enabled = !state.enabled;
  return state.enabled;
}
