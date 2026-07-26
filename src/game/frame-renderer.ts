import type { GameState } from '@/core/state';
import type { Viewport } from './viewport';
import type { RenderContextDeps } from './render-context';
import type { RenderFn } from '@/render/select-renderer';
import type { InteractionState } from './interaction-state';
import type { DivineActionsController } from './divine-actions-controller';
import type { DevModeController } from './dev-mode-controller';
import type { MinimapHandle } from '@/ui/minimap-panel';
import type { SpiritHudHandle } from '@/ui/spirit-hud';
import type { DivineEffects } from '@/render/divine-effects';
import { buildRenderContext } from './render-context';
import { formatDevTooltip } from '@/dev/tooltip';
import { drawPowerHud } from '@/render/hud';
import { fillTiles } from '@/render/selection-outline';
import { formatDebugHud } from '@/ui/debug-hud';
import { POWER_REGEN_RATE, POWER_UNDERSTANDING_COEFF, POWER_DEVOTION_COEFF } from '@/sim/spirit-system';
import { countPlayerBelievers, countDurableBelievers } from '@/sim/believers';
import { TILE_SIZE } from '@/core/constants';
import type { Entity, NpcProperties } from '@/core/types';

export interface FrameRendererUi {
  minimap: MinimapHandle;
  spiritHud: SpiritHudHandle;
  divineEffects: DivineEffects;
  tooltip: HTMLDivElement;
  debugHud: HTMLDivElement;
}

export interface FrameRendererDeps {
  ctx: CanvasRenderingContext2D;
  state: GameState;
  ui: FrameRendererUi;
  divine: DivineActionsController;
  dev: DevModeController;
  interaction: InteractionState;
  getRenderDeps: () => RenderContextDeps;
  getViewport: () => Viewport;
  renderMap: () => RenderFn | null;
  isPaused: () => boolean;
  /** When false (the default barebones game), the legacy Canvas2D power pill is
   *  suppressed; the WebGPU UI is the only surface. `?legacyui` flips it back on. */
  legacyChrome?: boolean;
}

export class FrameRenderer {
  private fpsEma = 60;

  constructor(private deps: FrameRendererDeps) {}

  render(deltaMs: number): void {
    if (!this.deps.state.map) return;
    if (deltaMs > 0) {
      const instantFps = 1000 / deltaMs;
      this.fpsEma = this.fpsEma * 0.9 + instantFps * 0.1;
    }
    // ONE NPC sweep per frame — the render context, minimap, spirit HUD, regen
    // estimate, tooltip and debug HUD below all reuse this list instead of each
    // issuing their own full `world.query({kind:'npc'})`.
    const npcEntities: readonly Entity[] = this.deps.state.world?.query({ kind: 'npc' }) ?? [];
    const rc = buildRenderContext({ ...this.deps.getRenderDeps(), npcEntities });
    const renderMap = this.deps.renderMap();
    if (renderMap) renderMap(this.deps.ctx, rc);

    // Update and render divine effects
    if (this.deps.ui.divineEffects) {
      this.deps.ui.divineEffects.update(deltaMs);
      this.deps.ui.divineEffects.render(this.deps.ctx as any, this.deps.state.camera, TILE_SIZE);
    }

    // Update minimap when visible
    if (this.deps.ui.minimap && this.deps.ui.minimap.isVisible() && this.deps.state.map) {
      // rc.npcs is the same per-frame NPC list already mapped through toRenderNpc.
      this.deps.ui.minimap.update(
        this.deps.state.map,
        rc.npcs,
        this.deps.state.camera,
        rc.canvasWidth,
        rc.canvasHeight,
      );
    }

    // Update Spirit HUD
    if (this.deps.ui.spiritHud && this.deps.ui.spiritHud.isVisible() && this.deps.state.world) {
      const player = this.deps.state.spirits.get('player')!;
      const rivals = Array.from(this.deps.state.spirits.entries())
        .filter(([id]) => id !== 'player')
        .map(([, spirit]) => spirit);

      let totalFollowers = 0;
      for (const npc of npcEntities) {
        const p = npc.properties as unknown as NpcProperties;
        if ((p.beliefs['player']?.faith ?? 0) > 0.3) totalFollowers++;
      }

      this.deps.ui.spiritHud.update(player, rivals as any[], totalFollowers);
      this.deps.ui.spiritHud.setBelieverStats(
        // P1 (two-tier population): believer readouts count both tiers.
        countPlayerBelievers(this.deps.state.world, this.deps.state.cohorts),
        countDurableBelievers(this.deps.state.world, this.deps.state.cohorts),
        4,
      );
    }

    // Draw debug overlays if dev mode is enabled (with the hovered target so the
    // dev outline layer can show a faint hover preview).
    const hoverHit = this.deps.dev.isEnabled() && this.deps.interaction.hoverScreen
      ? this.deps.dev.hitTest(this.deps.interaction.hoverScreen.x, this.deps.interaction.hoverScreen.y)
      : null;
    this.deps.dev.drawOverlays(this.deps.ctx, rc, hoverHit);

    // W-I-d: wash the selected causal site's irregular footprint on the map, so a
    // focused ephemeral place (a god-flooded plain) reads as a bounded site.
    const siteId = this.deps.state.selectedCausalSiteId;
    if (siteId && this.deps.state.map) {
      const site = this.deps.state.causalSites?.byId(siteId);
      if (site) {
        fillTiles(this.deps.ctx, site.cells, this.deps.state.map.width, this.deps.state.camera, '#4aa3d8', 0.32);
      }
    }

    // Gold flash when a divine action was just cast
    const flashAge = performance.now() - this.deps.divine.lastCastTime;
    if (flashAge < 300) {
      const alpha = 0.25 * (1 - flashAge / 300);
      this.deps.ctx.fillStyle = `rgba(255, 215, 0, ${alpha.toFixed(3)})`;
      this.deps.ctx.fillRect(0, 0, rc.canvasWidth, rc.canvasHeight);
    }

    // The WebGPU presence orb is the barebones power readout; the Canvas2D pill is
    // legacy chrome (only under ?legacyui) — so the per-NPC regen estimate that
    // feeds it (mirrors the SpiritSystem formula exactly) is only computed there.
    if (this.deps.legacyChrome) {
      const player = this.deps.state.spirits.get('player')!;
      let totalContribution = 0;
      for (const e of npcEntities) {
        const p = e.properties as unknown as NpcProperties;
        const b = p.beliefs['player'];
        if (b) {
          totalContribution +=
            b.faith *
            (1 + POWER_UNDERSTANDING_COEFF * b.understanding) *
            (1 + POWER_DEVOTION_COEFF * b.devotion);
        }
      }
      const regenPerSec = totalContribution * POWER_REGEN_RATE;
      drawPowerHud(this.deps.ctx, player.power, regenPerSec);
    }

    this.updateTooltip();

    if (this.deps.state.debug) {
      this.deps.ui.debugHud.textContent = formatDebugHud({
        fps: this.fpsEma,
        mouseTile: this.deps.interaction.hoverTile,
        entityCount: this.deps.state.world?.query({}).length ?? 0,
        npcCount: npcEntities.length,
        paused: this.deps.isPaused(),
        zoom: this.deps.state.camera.zoom,
      });
    }
  }

  /**
   * The DOM hover tooltip now serves ONLY the dev hit-test overlay (`?dev` —
   * `debugHud`'s own kind of DOM-stays-in-dev-mode surface); the ordinary
   * NPC/building identity tooltip is the GPU tooltip (L1 —
   * `Game.hoverTooltip()` / `UiRuntime.drawTooltip`), which tracks the cursor
   * every frame on its own and needs nothing from here.
   */
  private updateTooltip(): void {
    if (!this.deps.dev.isEnabled()) {
      this.deps.ui.tooltip.style.display = 'none';
      return;
    }
    if (!this.deps.interaction.hoverTile || !this.deps.interaction.hoverScreen || !this.deps.state.world) {
      this.deps.ui.tooltip.style.display = 'none';
      return;
    }
    const hit = this.deps.dev.hitTest(this.deps.interaction.hoverScreen.x, this.deps.interaction.hoverScreen.y);
    if (hit.type === null) {
      this.deps.ui.tooltip.style.display = 'none';
      return;
    }
    this.deps.ui.tooltip.textContent = formatDevTooltip(hit);
    this.deps.ui.tooltip.style.left = `${this.deps.interaction.hoverScreen.x}px`;
    this.deps.ui.tooltip.style.top  = `${this.deps.interaction.hoverScreen.y}px`;
    this.deps.ui.tooltip.style.display = 'block';
  }
}
