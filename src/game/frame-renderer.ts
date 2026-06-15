import type { GameState } from '@/core/state';
import type { Viewport } from './viewport';
import type { RenderContextDeps } from './render-context';
import type { RenderFn } from '@/render/select-renderer';
import type { InteractionState } from './interaction-state';
import type { DivineActionsController } from './divine-actions-controller';
import type { DevModeController } from './dev-mode-controller';
import type { LlmBackfillService } from './llm-backfill';
import type { MinimapHandle } from '@/ui/minimap-panel';
import type { SpiritHudHandle } from '@/ui/spirit-hud';
import type { DivineEffects } from '@/render/divine-effects';
import { buildRenderContext } from './render-context';
import { getNpc, toRenderNpc, simStateFromEntity } from '@/world/npc-helpers';
import { drawNpcOverlay, drawPoiOverlay } from '@/render/sim-overlay';
import type { NpcAttentionPanelHandle } from '@/ui/npc-attention-panel';
import type { BuildingInfoPanelHandle } from '@/ui/building-info-panel';
import { findBuildingAtTile, buildingInfoOf } from '@/world/building-helpers';
import { formatNpcTooltip } from '@/ui/npc-tooltip';
import { formatDevTooltip } from '@/dev/tooltip';
import { drawPowerHud } from '@/render/hud';
import { formatDebugHud } from '@/ui/debug-hud';
import { POWER_REGEN_RATE, POWER_UNDERSTANDING_COEFF, POWER_DEVOTION_COEFF } from '@/sim/spirit-system';
import { countPlayerBelievers, countDurableBelievers } from '@/sim/believers';
import { TILE_SIZE } from '@/core/constants';
import type { NpcProperties } from '@/core/types';

export interface FrameRendererUi {
  minimap: MinimapHandle;
  spiritHud: SpiritHudHandle;
  divineEffects: DivineEffects;
  npcInfoPanel: HTMLDivElement;
  npcAttentionPanel: NpcAttentionPanelHandle;
  buildingInfoPanel: BuildingInfoPanelHandle;
  tooltip: HTMLDivElement;
  debugHud: HTMLDivElement;
}

export interface FrameRendererDeps {
  ctx: CanvasRenderingContext2D;
  state: GameState;
  ui: FrameRendererUi;
  divine: DivineActionsController;
  dev: DevModeController;
  llmBackfill: LlmBackfillService;
  interaction: InteractionState;
  getRenderDeps: () => RenderContextDeps;
  getViewport: () => Viewport;
  renderMap: () => RenderFn | null;
  isPaused: () => boolean;
}

export class FrameRenderer {
  private renderedNpcId: string | null = null;
  private renderedPinned = false;
  private renderedBuildingId: string | null = null;
  private lastInfoRefresh = 0;
  private fpsEma = 60;

  constructor(private deps: FrameRendererDeps) {}

  /** External hook so LlmBackfillService.onWriteback can force a panel refresh. */
  forceInfoRefresh(): void { this.lastInfoRefresh = 0; }

  render(deltaMs: number): void {
    if (!this.deps.state.map) return;
    if (deltaMs > 0) {
      const instantFps = 1000 / deltaMs;
      this.fpsEma = this.fpsEma * 0.9 + instantFps * 0.1;
    }
    const rc = buildRenderContext(this.deps.getRenderDeps());
    const renderMap = this.deps.renderMap();
    if (renderMap) renderMap(this.deps.ctx, rc);

    // Update and render divine effects
    if (this.deps.ui.divineEffects) {
      this.deps.ui.divineEffects.update(deltaMs);
      this.deps.ui.divineEffects.render(this.deps.ctx as any, this.deps.state.camera, TILE_SIZE);
    }

    // Update minimap when visible
    if (this.deps.ui.minimap && this.deps.ui.minimap.isVisible() && this.deps.state.map) {
      const npcs = this.deps.state.world?.query({ kind: 'npc' }).map(toRenderNpc) ?? [];
      this.deps.ui.minimap.update(
        this.deps.state.map,
        npcs,
        this.deps.state.camera,
        rc.canvasWidth,
        rc.canvasHeight,
      );
    }

    // Prayer 🙏 markers hidden for now (2026-06-06) — re-enable by uncommenting.
    // if (this.deps.state.world) {
    //   drawPrayerMarkers(this.deps.ctx, this.deps.state.world, this.deps.state.camera, this.renderMode);
    // }

    // Update Spirit HUD
    if (this.deps.ui.spiritHud && this.deps.ui.spiritHud.isVisible() && this.deps.state.world) {
      const player = this.deps.state.spirits.get('player')!;
      const rivals = Array.from(this.deps.state.spirits.entries())
        .filter(([id]) => id !== 'player')
        .map(([, spirit]) => spirit);

      let totalFollowers = 0;
      for (const npc of this.deps.state.world.query({ kind: 'npc' })) {
        const p = npc.properties as unknown as NpcProperties;
        if ((p.beliefs['player']?.faith ?? 0) > 0.3) totalFollowers++;
      }

      this.deps.ui.spiritHud.update(player, rivals as any[], totalFollowers);
      this.deps.ui.spiritHud.setBelieverStats(
        countPlayerBelievers(this.deps.state.world),
        countDurableBelievers(this.deps.state.world),
        4,
      );
    }

    // Draw debug overlays if dev mode is enabled (with the hovered target so the
    // dev outline layer can show a faint hover preview).
    const hoverHit = this.deps.dev.isEnabled() && this.deps.interaction.hoverScreen
      ? this.deps.dev.hitTest(this.deps.interaction.hoverScreen.x, this.deps.interaction.hoverScreen.y)
      : null;
    this.deps.dev.drawOverlays(this.deps.ctx, rc, hoverHit);

    // Gold flash when a divine action was just cast
    const flashAge = performance.now() - this.deps.divine.lastCastTime;
    if (flashAge < 300) {
      const alpha = 0.25 * (1 - flashAge / 300);
      this.deps.ctx.fillStyle = `rgba(255, 215, 0, ${alpha.toFixed(3)})`;
      this.deps.ctx.fillRect(0, 0, rc.canvasWidth, rc.canvasHeight);
    }

    if (this.deps.state.selectedNpcId && this.deps.state.world) {
      const entity = getNpc(this.deps.state.world, this.deps.state.selectedNpcId);
      if (entity) {
        const npc = toRenderNpc(entity);
        const sim = simStateFromEntity(entity);
        const player = this.deps.state.spirits.get('player')!;
        this.deps.interaction.overlayHitAreas = drawNpcOverlay(
          this.deps.ctx, npc, sim, this.deps.state.camera,
          rc.canvasWidth, rc.canvasHeight,
          player.power,
        );

        // POI overlay (right-click on POI)
        if (this.deps.interaction.poiOverlay && this.deps.state.world) {
          const { poiId, tileX, tileY } = this.deps.interaction.poiOverlay;
          const poiAreas = drawPoiOverlay(
            this.deps.ctx, poiId, tileX, tileY, this.deps.state.camera,
            rc.canvasWidth, rc.canvasHeight, player.power,
          );
          this.deps.interaction.overlayHitAreas = [...this.deps.interaction.overlayHitAreas, ...poiAreas];
        }

        const now = performance.now();
        const pinned = this.deps.state.pinnedNpcId === sim.npcId;
        const switched = this.renderedNpcId !== sim.npcId;
        const pinChanged = this.renderedPinned !== pinned;
        if (switched) {
          this.deps.ui.npcAttentionPanel.setNpc(sim.npcId);
        }
        if (switched || pinChanged || now - this.lastInfoRefresh > 500) {
          this.deps.ui.npcAttentionPanel.update(sim, {
            pinned,
            power: player.power,
            onTogglePin: () => {
              this.deps.state.pinnedNpcId = this.deps.state.pinnedNpcId === sim.npcId ? null : sim.npcId;
              this.lastInfoRefresh = 0;
            },
            onDream: () => { this.deps.divine.dream(entity); this.lastInfoRefresh = 0; },
            onAnswerPrayer: () => { this.deps.divine.answerPrayer(entity); this.lastInfoRefresh = 0; },
            onOmen: () => { this.deps.divine.omenForNpc(entity); },
            onMiracle: () => { this.deps.divine.miracleForNpc(entity); },
            onLlmBackfill: async () => { await this.deps.llmBackfill.trigger(entity); },
            portraitSheet: rc.npcSheets.get(sim.npcId) ?? null,
          });
          this.renderedNpcId = sim.npcId;
          this.renderedPinned = pinned;
          this.lastInfoRefresh = now;
        }
        this.deps.ui.npcInfoPanel.style.display = 'block';
      }
    } else {
      this.deps.interaction.overlayHitAreas = [];
      this.deps.ui.npcInfoPanel.style.display = 'none';
      this.renderedNpcId = null;
    }

    this.updateBuildingPanel(rc.resolveBuildingArt);

    const player = this.deps.state.spirits.get('player')!;
    // Per-second regen estimate for HUD — mirrors SpiritSystem formula exactly
    let totalContribution = 0;
    if (this.deps.state.world) {
      for (const e of this.deps.state.world.query({ kind: 'npc' })) {
        const p = e.properties as unknown as NpcProperties;
        const b = p.beliefs['player'];
        if (b) {
          totalContribution +=
            b.faith *
            (1 + POWER_UNDERSTANDING_COEFF * b.understanding) *
            (1 + POWER_DEVOTION_COEFF * b.devotion);
        }
      }
    }
    const regenPerSec = totalContribution * POWER_REGEN_RATE;
    drawPowerHud(this.deps.ctx, player.power, regenPerSec);

    this.updateTooltip();

    if (this.deps.state.debug) {
      this.deps.ui.debugHud.textContent = formatDebugHud({
        fps: this.fpsEma,
        mouseTile: this.deps.interaction.hoverTile,
        entityCount: this.deps.state.world?.query({}).length ?? 0,
        npcCount: this.deps.state.world?.query({ kind: 'npc' }).length ?? 0,
        paused: this.deps.isPaused(),
        zoom: this.deps.state.camera.zoom,
      });
    }
  }

  // Cached so the panel only re-renders when the selection or loaded sprite changes.
  private cachedBuildingInfo: ReturnType<typeof buildingInfoOf> = null;
  private renderedSpriteUrl: string | null | undefined = undefined; // undefined = unset (force first render)

  private updateBuildingPanel(resolveArt?: (e: import('@/core/types').Entity) => HTMLImageElement | null): void {
    const { state } = this.deps;
    const id = state.selectedBuildingId;
    const entity = id && state.world ? state.world.query({ tag: 'building' }).find((e) => e.id === id) ?? null : null;
    if (!entity) {
      this.deps.ui.buildingInfoPanel.hide();
      this.renderedBuildingId = null;
      return;
    }

    if (id !== this.renderedBuildingId) {
      this.cachedBuildingInfo = buildingInfoOf(entity);
      this.renderedSpriteUrl = undefined; // force a render this frame
      this.renderedBuildingId = id;
    }

    const info = this.cachedBuildingInfo;
    if (!info) { this.deps.ui.buildingInfoPanel.hide(); return; }
    const spriteUrl = resolveArt?.(entity)?.src ?? null;
    if (spriteUrl !== this.renderedSpriteUrl) {
      this.deps.ui.buildingInfoPanel.render({ info, spriteUrl });
      this.renderedSpriteUrl = spriteUrl;
    }
    this.deps.ui.buildingInfoPanel.show();
  }

  private updateTooltip(): void {
    if (!this.deps.interaction.hoverTile || !this.deps.interaction.hoverScreen || !this.deps.state.world) {
      this.deps.ui.tooltip.style.display = 'none';
      return;
    }

    // In dev mode: show tooltips for ALL objects (tiles, entities, NPCs, decorations)
    if (this.deps.dev.isEnabled()) {
      const hit = this.deps.dev.hitTest(this.deps.interaction.hoverScreen.x, this.deps.interaction.hoverScreen.y);
      if (hit.type === null) {
        this.deps.ui.tooltip.style.display = 'none';
        return;
      }
      this.deps.ui.tooltip.textContent = formatDevTooltip(hit);
      this.deps.ui.tooltip.style.left = `${this.deps.interaction.hoverScreen.x}px`;
      this.deps.ui.tooltip.style.top  = `${this.deps.interaction.hoverScreen.y}px`;
      this.deps.ui.tooltip.style.display = 'block';
      return;
    }

    // Normal mode: NPC tooltips take priority, then buildings.
    const { x, y } = this.deps.interaction.hoverTile;
    const hovered = this.deps.state.world.query({ kind: 'npc' })
      .find(e => Math.floor(e.x) === x && Math.floor(e.y) === y);
    if (hovered && hovered.id !== this.deps.state.selectedNpcId) {
      const p = hovered.properties as unknown as NpcProperties;
      this.showTooltip(formatNpcTooltip({ name: p.name, role: p.role, mood: p.mood }));
      return;
    }

    // No NPC — a building under the cursor (skip the one whose panel is open).
    const building = findBuildingAtTile(this.deps.state.world, x, y);
    if (building && building.id !== this.deps.state.selectedBuildingId) {
      const info = buildingInfoOf(building);
      if (info) {
        const door = info.facts.find((f) => f.label === 'Door')?.value ?? '';
        this.showTooltip(`${info.title} · ${info.footprint.w}×${info.footprint.h}${door ? ` · door ${door}` : ''}`);
        return;
      }
    }

    this.deps.ui.tooltip.style.display = 'none';
  }

  private showTooltip(text: string): void {
    this.deps.ui.tooltip.textContent = text;
    this.deps.ui.tooltip.style.left = `${this.deps.interaction.hoverScreen!.x}px`;
    this.deps.ui.tooltip.style.top = `${this.deps.interaction.hoverScreen!.y}px`;
    this.deps.ui.tooltip.style.display = 'block';
  }
}
