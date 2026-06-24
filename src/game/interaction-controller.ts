import type { GameState } from '@/core/state';
import type { InteractionState } from './interaction-state';
import type { DevModeController } from './dev-mode-controller';
import type { DecorationPlacementModalHandle } from '@/ui/decoration-placement-modal';
import type { DecorationImageCache } from '@/render/decoration-image-cache';
import { saveDecorations } from '@/services/decoration-store';
import { findBuildingAtTile } from '@/world/building-helpers';

export interface InteractionControllerDeps {
  state: GameState;
  interaction: InteractionState;
  dev: DevModeController;
  placementModal: DecorationPlacementModalHandle;
  decorationImages: DecorationImageCache;
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

  async onTileRightClick(tileX: number, tileY: number): Promise<void> {
    const map = this.deps.state.map;
    if (!map) return;
    if (tileX < 0 || tileY < 0 || tileX >= map.width || tileY >= map.height) return;
    const tile = map.tiles[tileY]?.[tileX];
    if (!tile || !tile.walkable) return;

    // Right-clicking a settlement POI is a no-op for now: settlement-scoped
    // divine actions (omen/miracle) move into the WebGPU divine panel. We still
    // swallow the click here so it doesn't open the decoration modal over a POI.
    if (this.deps.state.worldSeed) {
      for (const poi of this.deps.state.worldSeed.pois) {
        if (poi.position && poi.position.x === tileX && poi.position.y === tileY) return;
      }
    }

    const result = await this.deps.placementModal.open({ x: tileX, y: tileY });
    if (!result) return;
    const placement = { tileX, tileY, assetId: result.assetId };
    this.deps.state.generatedDecorations = [...this.deps.state.generatedDecorations, placement];
    if (this.deps.state.worldSeed) {
      saveDecorations(this.deps.state.worldSeed.name, this.deps.state.generatedDecorations);
    }
    void this.deps.decorationImages.load(result.assetId);
  }

  async onRightClick(sx: number, sy: number): Promise<void> {
    await this.deps.dev.handleRightClick(sx, sy);
  }
}
