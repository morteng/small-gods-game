// src/studio/bird-field.ts
// The studio's BIRDS ambient effect — a few small birds that fly in from off-frame, alight on the
// building's baked PERCH mount-sockets (ridge crest, gable peaks, chimney tops — the `anchors.tags`
// sockets that `accepts` 'perch'), sit with idle micro-motions, occasionally relocate, and fly off.
// The little flock self-sustains on a wall-clock timer while the dial is on. Purely cosmetic, in the
// SmokeField mould: stepped by wall-clock so it animates off the sim tick, drawn in the same
// world-screen space as the overlays (so a perched bird tracks its socket under pan/zoom), and it
// leans on Math.random for jitter — the studio is a tiny live world, NOT the deterministic sim.
//
// Emergent interplay with the WIND dial: at 'gust' no bird stays — perched/arriving birds all flush
// to leaving and nothing lands until the wind drops; at 'breeze' they sit half as long (restless).
//
// Perch assignment is BY INDEX into the caller's per-frame point list, never a captured position:
// the sockets move under pan/zoom/re-roll, so an arriving/perched bird re-reads `points[perchIdx]`
// every frame. If the subject re-rolls to fewer anchors and a bird's index falls out of range, it
// gracefully departs from its last known spot rather than snapping.
//
// The pure/deterministic parts (arc interpolation, perch assignment, the flush transition) are
// exported so the lifecycle can be pinned without a canvas — Math.random lives only at the edges.
import type { Wind } from './ambient-dials';

export type BirdPhase = 'arriving' | 'perched' | 'leaving';

/** One bird, in the studio's world-screen (pre-camera-zoom) space — same units the perch anchors
 *  project into, so it tracks its socket under pan/zoom. `perchIdx` indexes the caller's live point
 *  list (−1 while leaving); `from`/`to` bound the current fly-in / fly-out arc. */
export interface Bird {
  phase: BirdPhase;
  x: number; y: number;
  fromX: number; fromY: number;
  toX: number; toY: number;
  perchIdx: number;
  t: number;            // arc progress 0..1 (arriving / leaving)
  dur: number;          // ms for the current arc
  lift: number;         // arc apex lift (px)
  sit: number;          // ms of perched time remaining
  hop: number;          // idle vertical hop offset (px)
  hopCd: number;        // ms until the next hop / twitch
  flap: number;         // accumulated ms — drives the wing flap + perched bob
  face: number;         // +1 / −1 facing (head + tail direction)
  seed: number;
}

export type PerchPoint = { x: number; y: number };

const MAX_BIRDS = 3;
const SPAWN_MIN = 3000, SPAWN_MAX = 8000;    // ms between spawn attempts while on + below max
const ARRIVE_MIN = 1000, ARRIVE_MAX = 2000;  // fly-in arc duration
const LEAVE_MIN = 900, LEAVE_MAX = 1600;     // fly-out arc duration
const SIT_MIN = 4000, SIT_MAX = 12000;       // perched dwell (halved at 'breeze')

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

/** Smoothstep easing — monotonic on [0,1], with easeInOut(0)=0 and easeInOut(1)=1. */
export function easeInOut(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/** A shallow eased arc between two world-screen points, lifted `lift` px at its apex. Endpoints are
 *  exact (t=0 → from, t=1 → to); the sinusoidal lift is zero at both ends so it never displaces them. */
export function arcPoint(
  fromX: number, fromY: number, toX: number, toY: number, lift: number, t: number,
): { x: number; y: number } {
  const e = easeInOut(t);
  return {
    x: fromX + (toX - fromX) * e,
    y: fromY + (toY - fromY) * e - Math.sin(Math.PI * e) * lift,
  };
}

/** Pick a free perch index in [0, count) not already claimed by a bird, or −1 if the roof is full.
 *  `used` may include −1 sentinels (leaving birds) — those free their socket. */
export function freePerchIndex(used: number[], count: number, rand: () => number): number {
  const taken = new Set(used.filter((i) => i >= 0));
  const free: number[] = [];
  for (let i = 0; i < count; i++) if (!taken.has(i)) free.push(i);
  if (!free.length) return -1;
  return free[Math.min(free.length - 1, (rand() * free.length) | 0)];
}

/** A random off-frame point relative to (x,y): up and out to one side, ~150–240px away — used both
 *  as an arriving bird's entry point and a leaving bird's exit. */
function offscreenFrom(x: number, y: number, rand: () => number): { x: number; y: number } {
  const ang = -Math.PI * (0.15 + rand() * 0.6);        // upper hemisphere, leaning up
  const dist = 150 + rand() * 90;
  const side = rand() < 0.5 ? -1 : 1;
  return { x: x + Math.cos(ang) * dist * side, y: y + Math.sin(ang) * dist };
}

/** Flush transition: send a bird off-frame from wherever it is RIGHT NOW (no teleport — the exit arc
 *  starts at its current position). Used for the gust flush and the dial-off drain. */
export function startLeaving(b: Bird, rand: () => number): void {
  const off = offscreenFrom(b.x, b.y, rand);
  b.fromX = b.x; b.fromY = b.y;
  b.toX = off.x; b.toY = off.y;
  b.face = off.x >= b.x ? 1 : -1;
  b.perchIdx = -1;
  b.t = 0;
  b.dur = LEAVE_MIN + rand() * (LEAVE_MAX - LEAVE_MIN);
  b.lift = 14 + rand() * 24;
  b.phase = 'leaving';
}

function makeArriving(target: PerchPoint, idx: number, rand: () => number): Bird {
  const s = offscreenFrom(target.x, target.y, rand);
  return {
    phase: 'arriving', x: s.x, y: s.y,
    fromX: s.x, fromY: s.y, toX: target.x, toY: target.y,
    perchIdx: idx, t: 0, dur: ARRIVE_MIN + rand() * (ARRIVE_MAX - ARRIVE_MIN),
    lift: 18 + rand() * 26, sit: 0,
    hop: 0, hopCd: 0, flap: rand() * 100, face: target.x >= s.x ? 1 : -1, seed: rand() * 1000,
  };
}

/** A tiny studio flock that lands on the subject's baked perch sockets. Cosmetic; stepped by
 *  wall-clock. Mirror of SmokeField: `step()` advances + spawns, `draw()` paints in world-screen. */
export class BirdField {
  private birds: Bird[] = [];
  private spawnCd = 0;   // 0 ⇒ eligible to spawn on the next on-frame
  constructor(private readonly rand: () => number = Math.random) {}

  /** Advance the flock. `points` are the live world-screen perch sockets (`accepts:'perch'`);
   *  `wind` drives the gust flush + breeze restlessness; `on` is the dial state — when false the
   *  flock DRAINS (everyone flips to leaving, no new spawns) rather than vanishing. */
  step(points: PerchPoint[], dtMs: number, wind: Wind, on = true): void {
    const dt = Math.min(50, Math.max(0, dtMs));
    const flush = wind === 'gust' || !on;   // gale, or dial turned off → clear the roof
    for (const b of this.birds) {
      if (b.phase !== 'leaving') {
        // Flush, or the subject re-rolled to fewer anchors and this bird's socket is gone.
        if (flush || b.perchIdx < 0 || b.perchIdx >= points.length) startLeaving(b, this.rand);
      }
      this.advance(b, points, dt, wind);
    }
    this.birds = this.birds.filter((b) => !(b.phase === 'leaving' && b.t >= 1));
    // Spawning: paused entirely while flushing; otherwise a new bird every SPAWN_MIN..MAX ms.
    if (flush) { this.spawnCd = SPAWN_MIN; return; }
    this.spawnCd -= dt;
    if (this.spawnCd <= 0) {
      this.spawnCd = SPAWN_MIN + this.rand() * (SPAWN_MAX - SPAWN_MIN);
      if (this.birds.length < MAX_BIRDS && points.length > 0) {
        const idx = freePerchIndex(this.birds.map((b) => b.perchIdx), points.length, this.rand);
        if (idx >= 0) this.birds.push(makeArriving(points[idx], idx, this.rand));
      }
    }
  }

  private advance(b: Bird, points: PerchPoint[], dt: number, wind: Wind): void {
    b.flap += dt;
    if (b.phase === 'perched') {
      const p = points[b.perchIdx];   // in-range here — out-of-range was flushed above
      b.hopCd -= dt;
      if (b.hopCd <= 0) { b.hop = b.hop > 0 ? 0 : -1; b.hopCd = 1500 + this.rand() * 2500; }
      b.x = p.x; b.y = p.y + b.hop;
      b.sit -= dt;
      if (b.sit <= 0) startLeaving(b, this.rand);
      return;
    }
    // arriving / leaving — glide along the arc.
    if (b.phase === 'arriving') { const p = points[b.perchIdx]; b.toX = p.x; b.toY = p.y; }
    b.t = Math.min(1, b.t + dt / b.dur);
    const pt = arcPoint(b.fromX, b.fromY, b.toX, b.toY, b.lift, b.t);
    b.x = pt.x; b.y = pt.y;
    if (b.phase === 'arriving' && b.t >= 1) {
      b.phase = 'perched';
      let dwell = SIT_MIN + this.rand() * (SIT_MAX - SIT_MIN);
      if (wind === 'breeze') dwell *= 0.5;   // restless in a breeze
      b.sit = dwell;
      b.hop = 0; b.hopCd = 800 + this.rand() * 2000;
    }
  }

  /** Draw the flock — call INSIDE the same camera transform the overlays use (world-screen space).
   *  Tiny dark silhouette: body ellipse + head dot; a 2-phase ~8Hz wing flap in flight, a subtle
   *  bob + tail tick when perched. No sprite assets — pure ctx paths. */
  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.birds.length) return;
    ctx.save();
    const ink = 'rgba(28,24,20,0.82)';
    for (const b of this.birds) {
      const flying = b.phase !== 'perched';
      const bob = flying ? 0 : Math.sin(b.flap * 0.004) * 0.4;
      const bx = b.x, by = b.y + bob;
      ctx.fillStyle = ink;
      ctx.beginPath(); ctx.ellipse(bx, by, 3.2, 2.0, 0, 0, Math.PI * 2); ctx.fill();   // body
      ctx.beginPath(); ctx.arc(bx + b.face * 2.6, by - 1.4, 1.3, 0, Math.PI * 2); ctx.fill();  // head
      ctx.strokeStyle = ink; ctx.lineWidth = 1.3;
      if (flying) {
        const wy = Math.sin(b.flap * 0.05) >= 0 ? -3.2 : 1.6;   // ~8Hz (period ≈125ms) up/down flap
        ctx.beginPath();
        ctx.moveTo(bx - 3.2, by); ctx.lineTo(bx - 5.6, by + wy);
        ctx.moveTo(bx + 3.2, by); ctx.lineTo(bx + 5.6, by + wy);
        ctx.stroke();
      } else {
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(bx - b.face * 3.0, by - 0.4); ctx.lineTo(bx - b.face * 5.0, by - 1.6);   // tail tick
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  clear(): void { this.birds.length = 0; this.spawnCd = 0; }
  get count(): number { return this.birds.length; }
  /** Read-only view of the flock (test inspection, like SmokeField.count). */
  get all(): ReadonlyArray<Readonly<Bird>> { return this.birds; }
}
