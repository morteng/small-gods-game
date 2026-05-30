import type { Camera, NpcSimState, NpcInstance, Entity } from '@/core/types';
import type { World } from '@/world/world';
import { worldToScreen } from '@/render/camera';
import { TILE_SIZE } from '@/core/constants';
import { forEachNpc, npcProps } from '@/world/npc-helpers';
import { getBuildingTemplate } from '@/map/building-templates';

export interface DebugOverlayOptions {
  showBeliefHeatmap: boolean;
  showNeeds: boolean;
  showMood: boolean;
  showSocialConnections: boolean;
  beliefThreshold: number;  // Only show beliefs above this threshold
  selectedSpiritId: string | null;
}

export const DEFAULT_DEBUG_OVERLAY_OPTIONS: DebugOverlayOptions = {
  showBeliefHeatmap: false,
  showNeeds: false,
  showMood: false,
  showSocialConnections: false,
  beliefThreshold: 0.3,
  selectedSpiritId: null,
};

/**
 * Draw belief heatmap overlay on the map.
 * Colors tiles based on belief strength for a specific spirit.
 */
export function drawBeliefHeatmap(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  world: World,
  options: DebugOverlayOptions,
): void {
  if (!options.showBeliefHeatmap) return;

  const tileScreenSize = TILE_SIZE * camera.zoom;

  ctx.save();
  ctx.globalAlpha = 0.35;

  forEachNpc(world, (entity) => {
    const props = npcProps(entity);
    const tileX = Math.floor(entity.x);
    const tileY = Math.floor(entity.y);

    // Get belief for selected spirit or max belief
    let beliefValue = 0;
    let spiritId = options.selectedSpiritId;

    if (spiritId && props.beliefs[spiritId]) {
      beliefValue = props.beliefs[spiritId].faith;
    } else {
      // Find max belief
      for (const [sid, belief] of Object.entries(props.beliefs)) {
        if (belief.faith > beliefValue) {
          beliefValue = belief.faith;
          spiritId = sid;
        }
      }
    }

    if (beliefValue < options.beliefThreshold) return;

    const { sx, sy } = worldToScreen(camera, tileX, tileY, TILE_SIZE);

    // Color based on belief strength: red (low) -> yellow (mid) -> green (high)
    const color = beliefToColor(beliefValue);
    ctx.fillStyle = color;
    ctx.fillRect(sx, sy, tileScreenSize, tileScreenSize);

    // Draw spirit identifier if multiple spirits
    if (beliefValue > 0.5) {
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.max(8, 10 * camera.zoom)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = spiritId ? spiritId.slice(0, 3) : '';
      ctx.fillText(label, sx + tileScreenSize / 2, sy + tileScreenSize / 2);
    }
  });

  ctx.restore();
}

/**
 * Draw NPC needs as small indicator bars above NPCs.
 */
export function drawNeedsOverlay(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  world: World,
  _npcs: NpcInstance[],
  options: DebugOverlayOptions,
): void {
  if (!options.showNeeds) return;

  const tileScreenSize = TILE_SIZE * camera.zoom;
  const barWidth = tileScreenSize * 0.6;
  const barHeight = Math.max(2, 3 * camera.zoom);
  const barGap = 1 * camera.zoom;

  ctx.save();

  forEachNpc(world, (entity) => {
    const props = npcProps(entity);
    const tileX = Math.floor(entity.x);
    const tileY = Math.floor(entity.y);
    const { sx, sy } = worldToScreen(camera, tileX, tileY, TILE_SIZE);

    const needs = props.needs;
    const needsList = [
      { name: 'S', value: needs.safety, color: '#4a9eff' },
      { name: 'P', value: needs.prosperity, color: '#4aff9e' },
      { name: 'C', value: needs.community, color: '#ff4a9e' },
      { name: 'M', value: needs.meaning, color: '#ff9e4a' },
    ];

    const totalHeight = needsList.length * (barHeight + barGap);
    let barY = sy - totalHeight - 4 * camera.zoom;
    const barX = sx + (tileScreenSize - barWidth) / 2;

    for (const need of needsList) {
      // Background
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(barX, barY, barWidth, barHeight);

      // Filled portion
      ctx.fillStyle = need.color;
      ctx.fillRect(barX, barY, barWidth * need.value, barHeight);

      // Label
      if (camera.zoom >= 1.5) {
        ctx.fillStyle = '#fff';
        ctx.font = `${Math.max(6, 8 * camera.zoom)}px monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(need.name, barX - 10 * camera.zoom, barY);
      }

      barY += barHeight + barGap;
    }
  });

  ctx.restore();
}

/**
 * Draw mood indicator as a colored aura around NPCs.
 */
export function drawMoodOverlay(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  world: World,
  _npcs: NpcInstance[],
  options: DebugOverlayOptions,
): void {
  if (!options.showMood) return;

  const tileScreenSize = TILE_SIZE * camera.zoom;

  ctx.save();

  forEachNpc(world, (entity) => {
    const props = npcProps(entity);
    const tileX = Math.floor(entity.x);
    const tileY = Math.floor(entity.y);
    const { sx, sy } = worldToScreen(camera, tileX, tileY, TILE_SIZE);

    const mood = props.mood;
    const color = moodToColor(mood);
    const auraRadius = (tileScreenSize / 2) * (0.5 + mood * 0.5);

    // Draw aura
    ctx.beginPath();
    ctx.arc(
      sx + tileScreenSize / 2,
      sy + tileScreenSize / 2,
      auraRadius,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.3;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1.5 * camera.zoom;
    ctx.stroke();

    // Mood label
    if (camera.zoom >= 1.5) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.max(8, 10 * camera.zoom)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const moodLabel = mood >= 0.7 ? '': mood >= 0.4 ? '' : '';
      if (moodLabel) {
        ctx.fillText(moodLabel, sx + tileScreenSize / 2, sy - 2 * camera.zoom);
      }
    }
  });

  ctx.restore();
}

/**
 * Draw social connections between NPCs.
 */
export function drawSocialConnections(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  world: World,
  _npcs: NpcInstance[],
  options: DebugOverlayOptions,
): void {
  if (!options.showSocialConnections) return;

  const tileScreenSize = TILE_SIZE * camera.zoom;

  ctx.save();
  ctx.globalAlpha = 0.4;

  const drawnPairs = new Set<string>();

  forEachNpc(world, (entity) => {
    const props = npcProps(entity);
    const tileX1 = Math.floor(entity.x);
    const tileY1 = Math.floor(entity.y);
    const { sx: sx1, sy: sy1 } = worldToScreen(camera, tileX1, tileY1, TILE_SIZE);

    for (const rel of props.relationships) {
      // Avoid drawing connections twice
      const pairKey = [entity.id, rel.npcId].sort().join('-');
      if (drawnPairs.has(pairKey)) continue;
      drawnPairs.add(pairKey);

      // Find the other entity
      const otherEntity = world.query({}).find(e => e.id === rel.npcId);
      if (!otherEntity) continue;

      const tileX2 = Math.floor(otherEntity.x);
      const tileY2 = Math.floor(otherEntity.y);
      const { sx: sx2, sy: sy2 } = worldToScreen(camera, tileX2, tileY2, TILE_SIZE);

      // Line style based on trust level
      const trust = rel.trust;
      ctx.strokeStyle = trust > 0.7 ? '#4aff4a' : trust > 0.4 ? '#ffff4a' : '#ff4a4a';
      ctx.lineWidth = (0.5 + trust * 2) * camera.zoom;

      // Dashed for low trust
      if (trust < 0.5) {
        ctx.setLineDash([3 * camera.zoom, 3 * camera.zoom]);
      } else {
        ctx.setLineDash([]);
      }

      ctx.beginPath();
      ctx.moveTo(sx1 + tileScreenSize / 2, sy1 + tileScreenSize / 2);
      ctx.lineTo(sx2 + tileScreenSize / 2, sy2 + tileScreenSize / 2);
      ctx.stroke();

      // Draw relationship type label if zoomed in
      if (camera.zoom >= 2) {
        const midX = (sx1 + sx2) / 2 + tileScreenSize / 2;
        const midY = (sy1 + sy2) / 2 + tileScreenSize / 2;
        ctx.fillStyle = '#fff';
        ctx.font = `${Math.max(7, 9 * camera.zoom)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(rel.type.slice(0, 2), midX, midY);
      }
    }
  });

  ctx.restore();
}

// ─── Helper Functions ─────────────────────────────────────────────

function beliefToColor(faith: number): string {
  // Red -> Yellow -> Green gradient
  if (faith < 0.5) {
    const t = faith / 0.5;
    const r = 255;
    const g = Math.floor(255 * t);
    const b = 0;
    return `rgb(${r},${g},${b})`;
  } else {
    const t = (faith - 0.5) / 0.5;
    const r = Math.floor(255 * (1 - t));
    const g = 255;
    const b = 0;
    return `rgb(${r},${g},${b})`;
  }
}

function moodToColor(mood: number): string {
  // Red (low) -> Orange -> Yellow (high)
  if (mood < 0.3) return 'rgba(255, 50, 50, 0.5)';      // Red
  if (mood < 0.6) return 'rgba(255, 150, 50, 0.5)';     // Orange
  return 'rgba(255, 255, 50, 0.5)';                      // Yellow
}

/**
 * Main function to draw all debug overlays.
 */
export function drawDebugOverlays(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  world: World,
  npcs: NpcInstance[],
  options: DebugOverlayOptions,
): void {
  drawBeliefHeatmap(ctx, camera, world, options);
  drawSocialConnections(ctx, camera, world, npcs, options);
  drawNeedsOverlay(ctx, camera, world, npcs, options);
  drawMoodOverlay(ctx, camera, world, npcs, options);
}
