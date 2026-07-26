/**
 * Divine Action Effects — visual feedback for whispers, omens, miracles, etc.
 * Renders animated effects on the canvas when divine actions are performed.
 */

import type { CanvasRenderingContext2D } from 'canvas';
import { worldToScreen } from '@/render/iso/iso-projection';
import { isoStageTransform } from '@/render/iso/entity-draw-list';

export interface Effect {
  type: 'whisper' | 'omen' | 'miracle' | 'curse' | 'dream' | 'smite' | 'storm';
  x: number;
  y: number;
  startTime: number;
  duration: number; // ms
  color: string;
  /** abilities-v1 A4/B5: the AREA an effect covers, in tiles — only `storm`
   *  reads this today (a big cast should look big). Undefined for point
   *  effects; `trigger()` fills it from an optional 4th arg, defaulting to
   *  `DEFAULT_STORM_RADIUS_TILES` so every pre-B1 call site (whisper/dream/…)
   *  keeps behaving exactly as before. */
  radiusTiles?: number;
}

const EFFECT_CONFIG: Record<string, { duration: number; color: string; particleCount: number }> = {
  whisper:  { duration: 800,  color: '#FFD54F', particleCount: 8  },
  omen:     { duration: 1500, color: '#9fd8ff', particleCount: 15 },
  miracle:  { duration: 2000, color: '#FF6B6B', particleCount: 25 },
  curse:    { duration: 1200, color: '#CE93D8', particleCount: 12 },
  dream:    { duration: 1000, color: '#B39DDB', particleCount: 10 },
  // the thunderbolt: a hot white-blue strike + a scatter of sparks at the impact.
  smite:    { duration: 900,  color: '#e8f4ff', particleCount: 18 },
  // abilities-v1 B5: a raincloud + downpour over the flooded disc — NOT a second
  // lightning bolt (smite already owns that shape). `particleCount: 0` because
  // `renderStorm` draws its own deterministic rain (see RAIN_DROPLETS below);
  // the generic radial particle burst below would read as sparks, wrong for rain.
  storm:    { duration: 2600, color: '#9fd8ff', particleCount: 0  },
};

/** `summon_storm`'s settlement-cast radius (mirrors `SUMMON_STORM_RADIUS`,
 *  `sim/divine-costs.ts`) — kept as a local literal rather than an import so
 *  this render-only module stays decoupled from the sim's cost tuning; a
 *  settlement storm has no `radius` on its event (only an area cast does), so
 *  this is what it falls back to. */
const DEFAULT_STORM_RADIUS_TILES = 6;

/** Fixed droplet layout for `renderStorm` — [angleFrac (0..1 of a full turn),
 *  radiusFrac (0..1 of the storm's radius), fallPhase (0..1, offsets each
 *  droplet's position in the fall loop)]. A hand-picked scatter, not a ring,
 *  so the rain doesn't read as a rotating spoke pattern; no `Math.random` on
 *  the render path (same discipline as `renderSmite`'s zigzag offsets). */
const RAIN_DROPLETS: ReadonlyArray<readonly [number, number, number]> = [
  [0.02, 0.30, 0.05], [0.11, 0.70, 0.55], [0.18, 0.45, 0.30], [0.27, 0.85, 0.80],
  [0.35, 0.20, 0.60], [0.44, 0.60, 0.10], [0.52, 0.90, 0.40], [0.59, 0.35, 0.90],
  [0.67, 0.55, 0.20], [0.75, 0.15, 0.70], [0.83, 0.75, 0.50], [0.91, 0.40, 0.00],
];

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
   * Trigger a divine effect at the given world coordinates. `radiusTiles`
   * (abilities-v1 B5) is only meaningful for `'storm'` — an area cast threads
   * its clamped radius through so the cloud/rain disc matches what actually
   * got flooded; every other effect ignores it. Omitted ⇒ `renderStorm` falls
   * back to `DEFAULT_STORM_RADIUS_TILES`, so pre-existing call sites
   * (whisper/dream/omen/miracle/smite) are unchanged.
   */
  trigger(type: Effect['type'], worldX: number, worldY: number, radiusTiles?: number): void {
    const config = EFFECT_CONFIG[type];
    if (!config) return;

    const effect: Effect = {
      type,
      x: worldX,
      y: worldY,
      startTime: performance.now(),
      duration: config.duration,
      color: config.color,
      radiusTiles,
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
   *
   * abilities-v1 A2 bugfix: this used to draw at the flat `effect.x * tileSize`
   * mapping with only `ctx.scale(camera.zoom)` applied — no camera translate at
   * all. The live camera pans in ISO-SCREEN space (CLAUDE.md's documented
   * gotcha), so that flat mapping landed every effect somewhere near the map
   * origin regardless of where the target actually was, and panning the camera
   * never moved it (there was no `camera.x/y` term anywhere in this branch —
   * `renderParticles` below applied camera.x/y as a flat offset too, a
   * DIFFERENT wrong space from the main shape, so a bolt and its own spark
   * burst didn't even agree with each other). Fixed by projecting the effect's
   * world anchor through the SAME `worldToScreen` + `isoStageTransform` idiom
   * `alert-pins.ts` uses for the WebGPU pin layer, then `ctx.translate`-ing to
   * that CSS-px point — every renderX below keeps drawing the exact shapes it
   * always drew, just around a local (0,0) origin instead of `(x*tileSize,
   * y*tileSize)`. Effect anchors here are entities' own continuous positions
   * (`Game.targetWorldPos`, no `+0.5`) — the same convention `npcItems` uses to
   * place the NPC sprite itself, so a smite lands exactly on the target.
   *
   * @param ctx - Canvas 2D context (the overlay — already dpr-scaled by
   *   `Game.resize`'s `ctx.setTransform(dpr,...)`, so everything here is CSS px)
   * @param camera - Camera state for coordinate transform
   * @param tileSize - Size of a tile in pixels (local shape scale, unchanged)
   */
  render(ctx: CanvasRenderingContext2D, camera: { x: number; y: number; zoom: number }, tileSize: number): void {
    const now = performance.now();
    const t = isoStageTransform(camera);

    for (const effect of this.effects) {
      const age = now - effect.startTime;
      const progress = age / effect.duration;

      const iso = worldToScreen(effect.x, effect.y, 0, 0, 0);
      const cx = iso.sx * t.scale + t.x;
      const cy = iso.sy * t.scale + t.y;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(camera.zoom, camera.zoom);

      switch (effect.type) {
        case 'whisper':
          this.renderWhisper(ctx, progress, tileSize, effect.color);
          break;
        case 'omen':
          this.renderOmen(ctx, progress, tileSize, effect.color);
          break;
        case 'miracle':
          this.renderMiracle(ctx, progress, tileSize, effect.color);
          break;
        case 'curse':
          this.renderCurse(ctx, progress, tileSize, effect.color);
          break;
        case 'dream':
          this.renderDream(ctx, progress, tileSize, effect.color);
          break;
        case 'smite':
          this.renderSmite(ctx, progress, tileSize, effect.color);
          break;
        case 'storm':
          this.renderStorm(ctx, progress, tileSize, effect.color, effect.radiusTiles ?? DEFAULT_STORM_RADIUS_TILES);
          break;
      }

      ctx.restore();
    }

    // Render particles — same projection fix (see above); particles keep
    // drifting in the same per-frame increments they always did (untouched —
    // this slice fixes WHERE they're drawn, not their motion), just projected
    // through the correct iso space each frame instead of a flat offset.
    this.renderParticles(ctx, camera, t);
  }

  private renderWhisper(
    ctx: CanvasRenderingContext2D,
    progress: number,
    tileSize: number,
    color: string,
  ): void {
    const alpha = 1 - progress;
    const radius = (4 + progress * 12) * (tileSize / 32);

    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha * 0.8;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Glow
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.6, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha * 0.3;
    ctx.fill();
  }

  private renderOmen(
    ctx: CanvasRenderingContext2D,
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

    const cx = 0;
    const cy = 0;

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

  /** The smite thunderbolt: a jagged bolt that strikes DOWN onto the tile, a white
   *  ground-flash at the moment of impact, then a fading scorch ring. Deterministic
   *  zigzag (fixed offsets) — no RNG on the render path. */
  private renderSmite(
    ctx: CanvasRenderingContext2D,
    progress: number,
    tileSize: number,
    color: string,
  ): void {
    const cx = 0;
    const cy = 0;

    // The bolt draws in the first third, then fades out over the rest.
    const boltAlpha = progress < 0.33 ? 1 : Math.max(0, 1 - (progress - 0.33) / 0.4);
    if (boltAlpha > 0) {
      const top = cy - tileSize * 6;
      // fixed lateral zigzag offsets (× tileSize) from the sky down to the tile
      const offsets = [0, 0.5, -0.35, 0.4, -0.25, 0.15, 0];
      const build = () => {
        ctx.beginPath();
        ctx.moveTo(cx + offsets[0] * tileSize, top);
        for (let i = 1; i < offsets.length; i++) {
          const t = i / (offsets.length - 1);
          ctx.lineTo(cx + offsets[i] * tileSize, top + (cy - top) * t);
        }
      };
      // wide soft glow, then the hot white core
      ctx.globalAlpha = boltAlpha * 0.5;
      ctx.strokeStyle = color;
      ctx.lineWidth = 6;
      ctx.lineJoin = 'round';
      build();
      ctx.stroke();
      ctx.globalAlpha = boltAlpha;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      build();
      ctx.stroke();
    }

    // impact flash: a bright disc that blooms then dies in the opening moment
    if (progress < 0.25) {
      const f = 1 - progress / 0.25;
      ctx.beginPath();
      ctx.arc(cx, cy, tileSize * (0.4 + (1 - f) * 1.2), 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = f * 0.7;
      ctx.fill();
    }

    // scorch ring expanding out as the effect settles
    const ringA = Math.max(0, 1 - progress);
    if (ringA > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, tileSize * (0.3 + progress * 1.1), 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.globalAlpha = ringA * 0.6;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** The `summon_storm` visual (abilities-v1 B5): a raincloud sitting over a
   *  wet-ground disc, downpour streaking between them — reads as WEATHER, not
   *  a second lightning bolt (smite already owns that shape). `radiusTiles`
   *  scales the cloud/disc/rain-spread together so a big area cast looks
   *  bigger than a settlement one, not just longer. Deterministic (fixed
   *  `RAIN_DROPLETS` table, no `Math.random`) — same discipline as `renderSmite`. */
  private renderStorm(
    ctx: CanvasRenderingContext2D,
    progress: number,
    tileSize: number,
    color: string,
    radiusTiles: number,
  ): void {
    const cx = 0, cy = 0;
    const R = tileSize * radiusTiles;
    // Local space: negative y is UP (toward the sky), positive y toward the
    // viewer/ground — the same convention `renderSmite`'s falling bolt uses.
    const cloudY = cy - tileSize * 3;

    // Wet-ground disc: fades in under the cloud and lingers a beat after the
    // rain stops (standing water doesn't vanish the instant the cloud does).
    const groundA = Math.min(1, progress * 2.5) * Math.max(0, 1 - Math.max(0, progress - 0.6) / 0.4);
    if (groundA > 0) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, R, R * 0.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = groundA * 0.25;
      ctx.fill();
    }

    // The cloud: a cluster of overlapping lobes, scaled to the same radius so
    // a wide area-cast reads as a correspondingly wide cloud. Builds in over
    // the opening beat, holds, then fades with the rain.
    const cloudA = Math.min(1, progress * 3) * Math.max(0, 1 - Math.max(0, progress - 0.65) / 0.35);
    if (cloudA > 0) {
      const lobes: ReadonlyArray<readonly [number, number, number]> = [
        [-0.55, 0.00, 0.55], [-0.15, -0.15, 0.70], [0.30, -0.05, 0.62],
        [0.68, 0.10, 0.48], [0.02, 0.15, 0.65],
      ];
      ctx.fillStyle = '#5b6b78';
      ctx.globalAlpha = cloudA * 0.85;
      for (const [dx, dy, s] of lobes) {
        ctx.beginPath();
        ctx.ellipse(
          cx + dx * R * 0.7, cloudY + dy * tileSize,
          R * s * 0.55 + tileSize * 0.3, tileSize * s * 0.9,
          0, 0, Math.PI * 2,
        );
        ctx.fill();
      }
    }

    // Downpour: RAIN_DROPLETS' fixed angle/radius scatter, each falling on its
    // own phase-shifted loop from the cloud's base toward the ground disc —
    // continuous-looking motion built from a static table, not per-frame RNG.
    const rainA = Math.min(1, progress * 3) * (1 - progress);
    if (rainA > 0) {
      const top = cloudY + tileSize * 0.8;
      ctx.strokeStyle = '#cfe8ff';
      ctx.lineWidth = Math.max(1, tileSize * 0.05);
      ctx.globalAlpha = rainA * 0.7;
      for (const [angleFrac, radiusFrac, fallPhase] of RAIN_DROPLETS) {
        const ang = angleFrac * Math.PI * 2;
        const dropX = cx + Math.cos(ang) * R * radiusFrac;
        const fall = (progress * 1.6 + fallPhase) % 1;
        const y0 = top + fall * (cy - top);
        const y1 = Math.min(y0 + tileSize * 0.4, cy);
        ctx.beginPath();
        ctx.moveTo(dropX, y0);
        ctx.lineTo(dropX, y1);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private renderMiracle(
    ctx: CanvasRenderingContext2D,
    progress: number,
    tileSize: number,
    color: string,
  ): void {
    const alpha = 1 - progress;
    const radius = progress * tileSize * 2;

    // Radial gradient
    const gradient = ctx.createRadialGradient(
      0, 0, 0,
      0, 0, radius,
    );
    gradient.addColorStop(0, color + '80');
    gradient.addColorStop(0.5, color + '40');
    gradient.addColorStop(1, color + '00');

    ctx.fillStyle = gradient;
    ctx.globalAlpha = alpha;
    ctx.fillRect(-radius, -radius, radius * 2, radius * 2);

    // Sparkle ring
    const ringRadius = tileSize * (0.3 + progress * 1.5);
    const sparkleCount = 8;
    for (let i = 0; i < sparkleCount; i++) {
      const angle = (Math.PI * 2 * i) / sparkleCount + progress * Math.PI;
      const sx = Math.cos(angle) * ringRadius;
      const sy = Math.sin(angle) * ringRadius;

      ctx.fillStyle = '#fff';
      ctx.globalAlpha = alpha * 0.8;
      ctx.beginPath();
      ctx.arc(sx, sy, 2 + Math.sin(progress * Math.PI * 4) * 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private renderCurse(
    ctx: CanvasRenderingContext2D,
    progress: number,
    tileSize: number,
    color: string,
  ): void {
    const alpha = 1 - progress;

    // Dark cloud
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha * 0.3;
    ctx.beginPath();
    ctx.arc(0, 0, tileSize * (0.5 + progress * 0.8), 0, Math.PI * 2);
    ctx.fill();

    // Swirl
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha * 0.6;
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      const r = tileSize * (0.3 + i * 0.2) * (1 + progress * 0.5);
      ctx.arc(0, 0, r, progress * Math.PI * 4, progress * Math.PI * 4 + Math.PI * 1.5);
      ctx.stroke();
    }
  }

  private renderDream(
    ctx: CanvasRenderingContext2D,
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
      ctx.fillText('Z', offsetX, offsetY);
    }
  }

  /** `t` = `isoStageTransform(camera)`, computed once in `render()` and shared
   *  across every particle — same iso projection as the main effect shapes
   *  (see `render()`'s doc comment); particle drift itself (`p.x`/`p.y`
   *  accumulation in `update()`) is untouched, only WHERE it's drawn changed. */
  private renderParticles(
    ctx: CanvasRenderingContext2D,
    camera: { x: number; y: number; zoom: number },
    t: { scale: number; x: number; y: number },
  ): void {
    for (const p of this.particles) {
      const alpha = p.life / p.maxLife;
      const iso = worldToScreen(p.x, p.y, 0, 0, 0);
      const px = iso.sx * t.scale + t.x;
      const py = iso.sy * t.scale + t.y;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(px, py, p.size * camera.zoom, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
