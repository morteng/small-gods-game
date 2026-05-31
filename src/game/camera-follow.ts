import type { GameState } from '@/core/state';
import type { Viewport } from './viewport';
import { getNpc } from '@/world/npc-helpers';
import { TILE_SIZE } from '@/core/constants';

/** Smoothly track the followed NPC. Mutates state.camera; clears followNpc if the npc vanished. */
export function applyFollowCamera(state: GameState, viewport: Viewport): void {
  if (!state.followNpc || !state.selectedNpcId || !state.world) return;
  const e = getNpc(state.world, state.selectedNpcId);
  if (!e) { state.followNpc = false; return; }
  const cam = state.camera;
  const viewW = viewport.width / cam.zoom;
  const viewH = viewport.height / cam.zoom;
  const targetX = (e.x + 0.5) * TILE_SIZE - viewW / 2;
  const targetY = (e.y + 0.5) * TILE_SIZE - viewH / 2;
  cam.x += (targetX - cam.x) * 0.15;
  cam.y += (targetY - cam.y) * 0.15;
}
