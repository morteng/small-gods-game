// src/studio/ambient-dials.ts
// The studio's AMBIENT DIALS — a row of icon buttons pinned centre-top over the view that let you
// preview EMERGENT, environment-driven effects on the subject without wiring up a whole world. The
// studio is a tiny live world, so we lean into it: dial the temperature COLD and a hearth fire lights
// → smoke rises from the building's chimney vents (the geometry already bakes vent anchor points,
// `StructureResult.anchors.vents`); dial the wind and the plume leans + tears. Start small (temp +
// wind); the same pattern extends to rain-on-roof, lantern glow, signage sway, birds on landing
// spots, … each hung off a baked anchor.
//
// Dev-only (lives in the studio, which is tree-shaken from prod). Cosmetic — no sim, no seed; uses
// Math.random for puff jitter (studio UI, not the deterministic sim).
import { h } from './theme';

export type Temp = 'cold' | 'mild' | 'hot';
export type Wind = 'calm' | 'breeze' | 'gust';

export interface AmbientState { temp: Temp; wind: Wind }

/** A rising smoke puff, in the studio's world-screen (pre-camera-zoom) space — same units the vent
 *  anchors project into, so puffs track the chimney under pan/zoom. */
interface Puff { x: number; y: number; vx: number; vy: number; age: number; life: number; r0: number; seed: number }

const WIND_DRIFT: Record<Wind, number> = { calm: 0.08, breeze: 0.55, gust: 1.25 };   // px/frame-ish lateral bias
const WIND_TEAR: Record<Wind, number> = { calm: 0.35, breeze: 0.7, gust: 1.3 };      // turbulence / fade multiplier

/** Chimney-smoke particle field. Puffs are emitted from screen-space vent points, rise, drift with
 *  the wind, grow and fade. Purely cosmetic; stepped by wall-clock so it animates off the sim tick. */
class SmokeField {
  private puffs: Puff[] = [];
  private accum = 0;

  /** Advance + emit. `vents` are world-screen points (chimney tops); `rate` puffs/sec (0 = none). */
  step(vents: { x: number; y: number }[], dtMs: number, rate: number, wind: Wind): void {
    const dt = Math.min(50, Math.max(0, dtMs)) / 16.667;   // frames elapsed (clamped like the game loop)
    const drift = WIND_DRIFT[wind], tear = WIND_TEAR[wind];
    for (const p of this.puffs) {
      p.age += dt;
      p.x += (p.vx + drift + Math.sin((p.age + p.seed) * 0.18) * 0.25 * tear) * dt;
      p.y += p.vy * dt;                     // vy < 0 → rises
      p.vy *= 0.992;                        // ease the ascent
    }
    this.puffs = this.puffs.filter((p) => p.age < p.life);
    if (rate <= 0 || vents.length === 0) return;
    this.accum += (rate * dtMs) / 1000;
    while (this.accum >= 1) {
      this.accum -= 1;
      const v = vents[(Math.random() * vents.length) | 0];
      this.puffs.push({
        x: v.x + (Math.random() - 0.5) * 3, y: v.y + (Math.random() - 0.5) * 2,
        vx: (Math.random() - 0.5) * 0.35, vy: -(0.9 + Math.random() * 0.5),
        age: 0, life: 70 + Math.random() * 55 * (1 / tear), r0: 2.4 + Math.random() * 1.6, seed: Math.random() * 100,
      });
    }
  }

  /** Draw the puffs (call INSIDE the same camera transform the overlays use — world-screen space). */
  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.puffs.length) return;
    ctx.save();
    for (const p of this.puffs) {
      const t = p.age / p.life;                    // 0..1 lifetime
      const r = p.r0 * (1 + t * 3.2);              // grow as it rises
      const a = Math.max(0, 0.42 * (1 - t) * Math.min(1, t * 6));   // fade in fast, out slow
      const g = 205 - t * 55;                       // cool from light grey to darker
      ctx.fillStyle = `rgba(${g | 0},${(g + 4) | 0},${(g + 10) | 0},${a.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  clear(): void { this.puffs.length = 0; this.accum = 0; }
  get count(): number { return this.puffs.length; }
}

/** Puffs/sec the hearth emits at each temperature (cold demands a fire → smoke; hot has none yet). */
const SMOKE_RATE: Record<Temp, number> = { cold: 12, mild: 2.2, hot: 0 };

export interface AmbientDials {
  readonly state: AmbientState;
  /** Advance + emit smoke from the given world-screen vent points. */
  step(vents: { x: number; y: number }[], dtMs: number): void;
  /** Draw the smoke — call inside the camera transform (world-screen space). */
  draw(ctx: CanvasRenderingContext2D): void;
  /** True if any effect is currently active (lets the caller skip work when idle). */
  readonly active: boolean;
}

interface Dial<T extends string> { key: string; label: string; states: { v: T; icon: string; hint: string }[] }

const TEMP_DIAL: Dial<Temp> = {
  key: 'temp', label: 'Temperature',
  states: [
    { v: 'mild', icon: '🌤', hint: 'Mild — a low hearth' },
    { v: 'cold', icon: '❄️', hint: 'Cold — a hearth fire is lit → chimney smoke' },
    { v: 'hot', icon: '🔥', hint: 'Hot — no fire' },
  ],
};
const WIND_DIAL: Dial<Wind> = {
  key: 'wind', label: 'Wind',
  states: [
    { v: 'calm', icon: '🍃', hint: 'Light air — the plume rises nearly straight' },
    { v: 'breeze', icon: '💨', hint: 'Breeze — the plume leans downwind' },
    { v: 'gust', icon: '🌪️', hint: 'Gale — the plume tears sideways' },
  ],
};

/**
 * Mount the ambient dial bar (centre-top over the view) and return the live ambient controller.
 * Each dial is one icon button that cycles its states on click; the icon + tooltip reflect the state.
 */
export function buildAmbientDials(viewPane: HTMLElement): AmbientDials {
  const smoke = new SmokeField();
  const state: AmbientState = { temp: 'mild', wind: 'calm' };

  const bar = h('div', {
    style: 'position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:6;display:flex;gap:6px;'
      + 'padding:4px 6px;border-radius:10px;background:rgba(16,18,24,0.72);border:1px solid var(--line);'
      + 'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);box-shadow:0 2px 10px rgba(0,0,0,0.35)',
  });

  function mkDial<T extends string>(dial: Dial<T>, get: () => T, set: (v: T) => void): HTMLElement {
    const btn = h('button', { class: 'sg-btn', style: 'padding:2px 8px;font-size:15px;line-height:1.3;min-width:34px' }) as HTMLButtonElement;
    const render = (): void => {
      const i = dial.states.findIndex((s) => s.v === get());
      const st = dial.states[i < 0 ? 0 : i];
      btn.textContent = st.icon;
      btn.title = `${dial.label}: ${st.hint}  (click to cycle)`;
      // A hint stripe below the icon shows which of the N states is active.
      btn.style.boxShadow = get() === dial.states[0].v ? 'none' : 'inset 0 -3px 0 0 var(--accent)';
    };
    btn.addEventListener('click', () => {
      const i = dial.states.findIndex((s) => s.v === get());
      set(dial.states[(i + 1) % dial.states.length].v);
      render();
    });
    render();
    return btn;
  }

  bar.append(
    mkDial(TEMP_DIAL, () => state.temp, (v) => { state.temp = v; if (SMOKE_RATE[v] === 0) smoke.clear(); }),
    mkDial(WIND_DIAL, () => state.wind, (v) => { state.wind = v; }),
  );
  viewPane.appendChild(bar);

  return {
    state,
    step(vents, dtMs) { smoke.step(vents, dtMs, SMOKE_RATE[state.temp], state.wind); },
    draw(ctx) { smoke.draw(ctx); },
    get active() { return SMOKE_RATE[this.state.temp] > 0 || smoke.count > 0; },
  };
}
