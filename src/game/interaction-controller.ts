import type { GameState } from '@/core/state';
import type { OverlayDispatcher } from '@/ui/overlay-dispatcher';
import type { InteractionState } from './interaction-state';
import type { DevModeController } from './dev-mode-controller';
import type { DecorationPlacementModalHandle } from '@/ui/decoration-placement-modal';
import type { DecorationImageCache } from '@/render/decoration-image-cache';
import { saveDecorations } from '@/services/decoration-store';

export interface InteractionControllerDeps {
  state: GameState;
  dispatcher: OverlayDispatcher;
  interaction: InteractionState;
  dev: DevModeController;
  placementModal: DecorationPlacementModalHandle;
  decorationImages: DecorationImageCache;
}

export class InteractionController {
  constructor(private deps: InteractionControllerDeps) {}

  onCanvasClick(sx: number, sy: number): boolean {
    this.deps.interaction.poiOverlay = null;
    return this.deps.dispatcher.tryDispatch(sx, sy, this.deps.interaction.overlayHitAreas);
  }

  onTileClick(x: number, y: number): void {
    if (!this.deps.state.map || !this.deps.state.world) return;
    // Clear POI overlay on any left-click
    this.deps.interaction.poiOverlay = null;

    const clicked = this.deps.state.world.query({ kind: 'npc' })
      .find(e => Math.floor(e.x) === x && Math.floor(e.y) === y);
    if (clicked) {
      this.deps.state.selectedNpcId = this.deps.state.selectedNpcId === clicked.id ? null : clicked.id;
      if (this.deps.state.pinnedNpcId && this.deps.state.pinnedNpcId !== this.deps.state.selectedNpcId) {
        this.deps.state.pinnedNpcId = null;
      }
    } else if (!this.deps.state.pinnedNpcId) {
      this.deps.state.selectedNpcId = null;
    }
  }

  async onTileRightClick(tileX: number, tileY: number): Promise<void> {
    const map = this.deps.state.map;
    if (!map) return;
    if (tileX < 0 || tileY < 0 || tileX >= map.width || tileY >= map.height) return;
    const tile = map.tiles[tileY]?.[tileX];
    if (!tile || !tile.walkable) return;

    // Check if this tile belongs to a POI
    let poiId: string | undefined;
    if (this.deps.state.worldSeed) {
      for (const poi of this.deps.state.worldSeed.pois) {
        if (poi.position && poi.position.x === tileX && poi.position.y === tileY) {
          poiId = poi.id;
          break;
        }
      }
    }

    if (poiId) {
      // Show POI overlay for Omen/Miracle
      this.deps.interaction.poiOverlay = { poiId, tileX, tileY };
      return;
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
