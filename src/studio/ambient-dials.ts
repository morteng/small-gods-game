// src/studio/ambient-dials.ts
// The studio's AMBIENT DIALS — a row of icon buttons pinned centre-top over the view that let you
// preview EMERGENT, environment-driven effects on the subject without wiring up a whole world. The
// studio is a tiny live world, so we lean into it: dial the temperature COLD and a hearth fire lights
// → smoke rises from the building's chimney vents (the geometry already bakes vent anchor points,
// `StructureResult.anchors.vents`); dial the wind and the plume leans + tears. Start small (temp +
// wind); the same pattern extends to rain-on-roof, lantern glow, signage sway, birds on landing
// spots, … each hung off a baked anchor.
//
// PER-VENT OVERRIDE (studio.ts): the temperature dial is only the GLOBAL default — a click on one
// chimney/vent in the studio can light or snuff THAT hearth independent of the dial. That override
// logic lives entirely in the caller (studio.ts merges dial-default ∪ per-vent overrides into the
// vent-point list it hands to `step()` each frame); `step()` below deliberately does NOT gate
// emission on `state.temp` — it emits at the "a hearth is lit" rate whenever the CALLER'S list is
// non-empty, so an override-lit vent smokes even while the dial reads mild/hot, and a snuffed one
// stays quiet even while the dial reads cold. This keeps SmokeField itself dial-agnostic.
//
// Dev-only (lives in the studio, which is tree-shaken from prod). Cosmetic — no sim, no seed; uses
// Math.random for puff jitter (studio UI, not the deterministic sim).
import { h } from './theme';

export type Temp = 'cold' | 'mild' | 'hot';
export type Wind = 'calm' | 'breeze' | 'gust';
export type Lanterns = 'unlit' | 'lit';
export type Birds = 'none' | 'birds';

export interface AmbientState { temp: Temp; wind: Wind; lanterns: Lanterns; birds: Birds }

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

/** Puffs/sec the hearth emits at each temperature. The DEFAULT (mild) is a NO-fire, no-smoke
 *  resting state — only ❄️ cold lights the hearth. (hot has no effect yet — a future heat shimmer.) */
const SMOKE_RATE: Record<Temp, number> = { cold: 12, mild: 0, hot: 0 };

export interface AmbientDials {
  readonly state: AmbientState;
  /** Advance + emit smoke from the given world-screen vent points. `vents` is the CALLER'S
   *  already-resolved lit set (dial default merged with any per-vent override) — emission rate
   *  follows "is this list non-empty", not `state.temp` directly, so a per-vent override can
   *  light/snuff a hearth independent of the global dial (see the file-header note). */
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
    { v: 'mild', icon: '🌤', hint: 'Mild — no fire (resting)' },
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
const LANTERN_DIAL: Dial<Lanterns> = {
  key: 'lanterns', label: 'Lanterns',
  states: [
    { v: 'unlit', icon: '🌑', hint: 'Unlit — lamp sockets bare' },
    { v: 'lit', icon: '🏮', hint: 'Lit — warm glow at the lamp mounts, blooms with the dark' },
  ],
};
// Lanterns + Birds are HANDS-OFF dials: they only own the on/off state (the accent-underline marks
// the non-default), while the effect fields themselves live in the studio (they need the per-frame
// lamp/perch mount-sockets from `tagScreenPoints`). At 'birds' a few settle on the roof perches and
// scatter in a gale (see BirdField); at 'lit' the lamp mounts glow with the dark (see LanternField).
const BIRD_DIAL: Dial<Birds> = {
  key: 'birds', label: 'Birds',
  states: [
    { v: 'none', icon: '🌳', hint: 'Still — no birds about' },
    { v: 'birds', icon: '🐦', hint: 'Birds — a few alight on the roof perches (they scatter in a gale)' },
  ],
};

/**
 * Mount the ambient dial bar (centre-top over the view) and return the live ambient controller.
 * Each dial is one icon button that cycles its states on click; the icon + tooltip reflect the state.
 */
export function buildAmbientDials(viewPane: HTMLElement): AmbientDials {
  const smoke = new SmokeField();
  const state: AmbientState = { temp: 'mild', wind: 'calm', lanterns: 'unlit', birds: 'none' };

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
    mkDial(LANTERN_DIAL, () => state.lanterns, (v) => { state.lanterns = v; }),
    // Birds: pure state toggle — the studio owns the BirdField and drains it when this flips to 'none'.
    mkDial(BIRD_DIAL, () => state.birds, (v) => { state.birds = v; }),
  );
  viewPane.appendChild(bar);

  return {
    state,
    step(vents, dtMs) {
      // Rate is driven by "did the caller hand us any lit vents", NOT by `state.temp` — the
      // dial's own on/off already shows up as an empty/non-empty `vents` array once the caller
      // (studio.ts) merges the dial default with per-vent overrides, so this stays correct for
      // BOTH the plain-dial case (unchanged behaviour) and the override case (dial mild/hot but
      // one vent force-lit, or dial cold but one vent force-snuffed).
      smoke.step(vents, dtMs, vents.length > 0 ? SMOKE_RATE.cold : 0, state.wind);
    },
    draw(ctx) { smoke.draw(ctx); },
    // Still dial-only: this is the "should the caller even bother computing a vents list and
    // calling step() at all" fast-path signal (dial cold, or smoke still fading out). A caller
    // with an ACTIVE per-vent override while the dial is mild/hot won't see `active` flip true
    // from this alone — studio.ts additionally checks its own lit-vent list before skipping.
    get active() { return SMOKE_RATE[this.state.temp] > 0 || smoke.count > 0; },
  };
}
