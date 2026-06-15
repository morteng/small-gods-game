/**
 * Divine Action Effects — visual feedback for whispers, omens, miracles, etc.
 * Renders animated effects on the canvas when divine actions are performed.
 */

import type { CanvasRenderingContext2D } from 'canvas';

export interface Effect {
  type: 'whisper' | 'omen' | 'miracle' | 'curse' | 'dream';
  x: number;
  y: number;
  startTime: number;
  duration: number; // ms
  color: string;
}

const EFFECT_CONFIG: Record<string, { duration: number; color: string; particleCount: number }> = {
  whisper:  { duration: 800,  color: '#FFD54F', particleCount: 8  },
  omen:     { duration: 1500, color: '#9fd8ff', particleCount: 15 },
  miracle:  { duration: 2000, color: '#FF6B6B', particleCount: 25 },
  curse:    { duration: 1200, color: '#CE93D8', particleCount: 12 },
  dream:    { duration: 1000, color: '#B39DDB', particleCount: 10 },
};

export class DivineEffects {
  private effects: Effect[] = [];
  private particles: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    size: number;
    color: string;
  }> = [];

  /**
   * Trigger a divine effect at the given world coordinates.
   */
  trigger(type: Effect['type'], worldX: number, worldY: number): void {
    const config = EFFECT_CONFIG[type];
    if (!config) return;

    const effect: Effect = {
      type,
      x: worldX,
      y: worldY,
      startTime: performance.now(),
      duration: config.duration,
      color: config.color,
    };

    this.effects.push(effect);

    // Spawn particles
    for (let i = 0; i < config.particleCount; i++) {
      const angle = (Math.PI * 2 * i) / config.particleCount;
      const speed = 0.5 + Math.random() * 1.5;
      this.particles.push({
        x: worldX,
        y: worldY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: config.duration,
        maxLife: config.duration,
        size: 2 + Math.random() * 4,
        color: config.color,
      });
    }
  }

  /**
   * Update effect animations. Call once per frame with delta time.
   */
  update(deltaMs: number): void {
    const now = performance.now();

    // Remove expired effects
    this.effects = this.effects.filter(e => now - e.startTime < e.duration);

    // Update particles
    for (const p of this.particles) {
      p.x += p.vx * (deltaMs / 16); // Normalize to ~60fps
      p.y += p.vy * (deltaMs / 16);
      p.life -= deltaMs;
    }

    // Remove dead particles
    this.particles = this.particles.filter(p => p.life > 0);
  }

  /** True while any effect or particle is still animating — lets a render-on-demand
   *  loop keep drawing frames during a paused world until the effect finishes. */
  isActive(): boolean {
    return this.effects.length > 0 || this.particles.length > 0;
  }

  /**
   * Render all active effects to the canvas.
   * @param ctx - Canvas 2D context
   * @param camera - Camera state for coordinate transform
   * @param tileSize - Size of a tile in pixels
   */
  render(ctx: CanvasRenderingContext2D, camera: { x: number; y: number; zoom: number }, tileSize: number): void {
    const now = performance.now();

    for (const effect of this.effects) {
      const age = now - effect.startTime;
      const progress = age / effect.duration;

      // World to screen coordinates
      const screenX = (effect.x * tileSize - camera.x) * camera.zoom;
      const screenY = (effect.y * tileSize - camera.y) * camera.zoom;

      ctx.save();
      ctx.scale(camera.zoom, camera.zoom);

      switch (effect.type) {
        case 'whisper':
          this.renderWhisper(ctx, effect.x, effect.y, progress, tileSize, effect.color);
          break;
        case 'omen':
          this.renderOmen(ctx, effect.x, effect.y, progress, tileSize, effect.color);
          break;
        case 'miracle':
          this.renderMiracle(ctx, effect.x, effect.y, progress, tileSize, effect.color);
          break;
        case 'curse':
          this.renderCurse(ctx, effect.x, effect.y, progress, tileSize, effect.color);
          break;
        case 'dream':
          this.renderDream(ctx, effect.x, effect.y, progress, tileSize, effect.color);
          break;
      }

      ctx.restore();
    }

    // Render particles
    this.renderParticles(ctx, camera, tileSize);
  }

  private renderWhisper(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    progress: number,
    tileSize: number,
    color: string,
  ): void {
    const alpha = 1 - progress;
    const radius = (4 + progress * 12) * (tileSize / 32);

    ctx.beginPath();
    ctx.arc(x * tileSize, y * tileSize, radius, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha * 0.8;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Glow
    ctx.beginPath();
    ctx.arc(x * tileSize, y * tileSize, radius * 0.6, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha * 0.3;
    ctx.fill();
  }

  private renderOmen(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    progress: number,
    tileSize: number,
    color: string,
  ): void {
    const alpha = 1 - progress;
    const size = tileSize * (0.5 + progress * 1.5);

    // Lightning bolt effect
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 2;

    const cx = x * tileSize;
    const cy = y * tileSize;

    ctx.beginPath();
    ctx.moveTo(cx - size * 0.3, cy - size * 0.5);
    ctx.lineTo(cx + size * 0.1, cy - size * 0.1);
    ctx.lineTo(cx - size * 0.1, cy + size * 0.1);
    ctx.lineTo(cx + size * 0.3, cy + size * 0.5);
    ctx.stroke();

    // Flash
    if (progress < 0.2) {
      ctx.fillStyle = '#fff';
      ctx.globalAlpha = (0.2 - progress) * 5 * 0.5;
      ctx.fillRect(cx - size, cy - size, size * 2, size * 2);
    }
  }

  private renderMiracle(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    progress: number,
    tileSize: number,
    color: string,
  ): void {
    const alpha = 1 - progress;
    const radius = progress * tileSize * 2;

    // Radial gradient
    const gradient = ctx.createRadialGradient(
      x * tileSize, y * tileSize, 0,
      x * tileSize, y * tileSize, radius,
    );
    gradient.addColorStop(0, color + '80');
    gradient.addColorStop(0.5, color + '40');
    gradient.addColorStop(1, color + '00');

    ctx.fillStyle = gradient;
    ctx.globalAlpha = alpha;
    ctx.fillRect(x * tileSize - radius, y * tileSize - radius, radius * 2, radius * 2);

    // Sparkle ring
    const ringRadius = tileSize * (0.3 + progress * 1.5);
    const sparkleCount = 8;
    for (let i = 0; i < sparkleCount; i++) {
      const angle = (Math.PI * 2 * i) / sparkleCount + progress * Math.PI;
      const sx = x * tileSize + Math.cos(angle) * ringRadius;
      const sy = y * tileSize + Math.sin(angle) * ringRadius;

      ctx.fillStyle = '#fff';
      ctx.globalAlpha = alpha * 0.8;
      ctx.beginPath();
      ctx.arc(sx, sy, 2 + Math.sin(progress * Math.PI * 4) * 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private renderCurse(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    progress: number,
    tileSize: number,
    color: string,
  ): void {
    const alpha = 1 - progress;

    // Dark cloud
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha * 0.3;
    ctx.beginPath();
    ctx.arc(x * tileSize, y * tileSize, tileSize * (0.5 + progress * 0.8), 0, Math.PI * 2);
    ctx.fill();

    // Swirl
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha * 0.6;
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      const r = tileSize * (0.3 + i * 0.2) * (1 + progress * 0.5);
      ctx.arc(x * tileSize, y * tileSize, r, progress * Math.PI * 4, progress * Math.PI * 4 + Math.PI * 1.5);
      ctx.stroke();
    }
  }

  private renderDream(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    progress: number,
    tileSize: number,
    color: string,
  ): void {
    const alpha = 1 - progress;

    // Zzz symbols floating up
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha * 0.8;
    ctx.font = `${tileSize * 0.5}px sans-serif`;
    ctx.textAlign = 'center';

    for (let i = 0; i < 3; i++) {
      const offsetY = i * tileSize * 0.4 - progress * tileSize * 2;
      const offsetX = Math.sin(progress * Math.PI * 2 + i) * tileSize * 0.3;
      ctx.globalAlpha = alpha * (1 - i * 0.3);
      ctx.fillText('Z', x * tileSize + offsetX, y * tileSize + offsetY);
    }
  }

  private renderParticles(
    ctx: CanvasRenderingContext2D,
    camera: { x: number; y: number; zoom: number },
    tileSize: number,
  ): void {
    for (const p of this.particles) {
      const alpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(
        (p.x * tileSize - camera.x) * camera.zoom,
        (p.y * tileSize - camera.y) * camera.zoom,
        p.size * camera.zoom,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
