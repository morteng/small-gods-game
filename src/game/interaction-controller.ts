import type { GameState } from '@/core/state';
import type { InteractionState } from './interaction-state';
import type { DevModeController } from './dev-mode-controller';
import { findBuildingAtTile } from '@/world/building-helpers';

export interface InteractionControllerDeps {
  state: GameState;
  interaction: InteractionState;
  dev: DevModeController;
}

export class InteractionController {
  constructor(private deps: InteractionControllerDeps) {}

  onTileClick(x: number, y: number): void {
    if (!this.deps.state.map || !this.deps.state.world) return;

    const clicked = this.deps.state.world.query({ kind: 'npc' })
      .find(e => Math.floor(e.x) === x && Math.floor(e.y) === y);
    if (clicked) {
      this.deps.state.selectedNpcId = this.deps.state.selectedNpcId === clicked.id ? null : clicked.id;
      this.deps.state.selectedBuildingId = null; // NPC / building / site selection are mutually exclusive
      this.deps.state.selectedCausalSiteId = null;
      if (this.deps.state.pinnedNpcId && this.deps.state.pinnedNpcId !== this.deps.state.selectedNpcId) {
        this.deps.state.pinnedNpcId = null;
      }
      return;
    }

    // No NPC here — try a building (its footprint covers this tile).
    const building = findBuildingAtTile(this.deps.state.world, x, y);
    if (building) {
      this.deps.state.selectedBuildingId =
        this.deps.state.selectedBuildingId === building.id ? null : building.id;
      if (this.deps.state.selectedBuildingId) {
        this.deps.state.selectedNpcId = null;
        this.deps.state.selectedCausalSiteId = null;
      }
      return;
    }

    // No building — try a causal site (W-I-d): an ephemeral place whose frozen
    // footprint covers this tile (a god-flooded plain → "The Drowned Reach").
    const siteId = this.deps.state.causalSites?.siteAt(x, y) ?? null;
    if (siteId) {
      this.deps.state.selectedCausalSiteId =
        this.deps.state.selectedCausalSiteId === siteId ? null : siteId;
      if (this.deps.state.selectedCausalSiteId) {
        this.deps.state.selectedNpcId = null;
        this.deps.state.selectedBuildingId = null;
      }
      return;
    }

    // Empty tile — clear all (unless an NPC is pinned).
    this.deps.state.selectedBuildingId = null;
    this.deps.state.selectedCausalSiteId = null;
    if (!this.deps.state.pinnedNpcId) this.deps.state.selectedNpcId = null;
  }

  /**
   * L4 (legacy chrome retirement): right-click used to open the DOM
   * decoration-placement modal (a library grid of thumbnails + a PixelLab
   * "generate new" prompt/tags form) — deleted with NO GPU replacement this
   * slice. It's a paid-generation creative tool, not a core god-game action;
   * its "generate from typed prompt" half doesn't fit today's fixed-choice
   * UiSpec card or any existing DOM island (a new async-status text-input
   * surface is a feature project, not a chrome reskin); and it already
   * mutated `GameState.generatedDecorations` directly rather than through the
   * command bus (decorations are cosmetic dressing, not sim truth), so there
   * is no command to re-point this at. Right-click is a no-op until a real
   * GPU decoration-placement surface is designed — consistent with the
   * settlement-POI right-click above, already a no-op in practice.
   */
  async onTileRightClick(_tileX: number, _tileY: number): Promise<void> {}

  async onRightClick(sx: number, sy: number): Promise<void> {
    await this.deps.dev.handleRightClick(sx, sy);
  }
}
