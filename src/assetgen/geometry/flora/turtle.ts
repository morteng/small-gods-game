// src/assetgen/geometry/flora/turtle.ts
// A 3D turtle (Prusinkiewicz "Algorithmic Beauty of Plants" command set) that
// interprets an L-system string into a flora SKELETON: tapered limb segments +
// leaf positions. Geometry-engine-free — produces plain data the tube mesher
// (mesh.ts) turns into facets. Deterministic given the supplied params/RNG.
//
// Commands:
//   F  forward, drawing a tapered limb; advance position, narrow the limb radius
//   f  forward without drawing (move only)
//   +/- yaw  (rotate heading about Up    by +/- angle)
//   &/^ pitch (rotate heading about Left by +/- angle: & pitches down, ^ up)
//   \// roll  (rotate frame   about Heading by +/- angle)
//   |  turn 180° (yaw by π)
//   [  push state (position, frame, radius, step)
//   ]  pop state — and drop a leaf at the branch tip
//   L  drop a leaf at the current position
// Frame: H=heading (grows along), L=left, U=up. Right-handed, kept orthonormal.
import type { Vec3 } from '@/assetgen/types';
import type { Rng } from '@/core/rng';
import { add, scale, rotateAbout, normalize, cross } from './vec3';

/** A tapered limb segment from `a` (radius `r0`) to `b` (radius `r1`). */
export interface Limb { a: Vec3; b: Vec3; r0: number; r1: number }
/** A foliage blob centred at `at` with radius `r`. */
export interface Leaf { at: Vec3; r: number }
export interface FloraSkeleton { limbs: Limb[]; leaves: Leaf[] }

export interface TurtleOpts {
  /** Branch turn angle in degrees (yaw/pitch/roll step). */
  angleDeg: number;
  /** Step length per `F`, in tile units. */
  step: number;
  /** Starting limb radius, in tile units. */
  radius: number;
  /** Radius multiplier applied after each drawn limb (taper). */
  taper: number;
  /** Step-length multiplier applied at each branch push (children shorter). */
  stepFalloff?: number;
  /** Leaf blob radius, in tile units (0 = no leaves). */
  leafR?: number;
  /** Small per-turn angle jitter (degrees) for organic variety; needs `rng`. */
  jitterDeg?: number;
  rng?: Rng;
}

interface State { p: Vec3; H: Vec3; L: Vec3; U: Vec3; r: number; step: number }

const DEG = Math.PI / 180;

/** Interpret an L-system `commands` string into a flora skeleton. */
export function runTurtle(commands: string, opts: TurtleOpts): FloraSkeleton {
  const { angleDeg, step, radius, taper } = opts;
  const stepFalloff = opts.stepFalloff ?? 0.85;
  const leafR = opts.leafR ?? 0;
  const jitter = opts.jitterDeg ?? 0;
  const rng = opts.rng;

  const limbs: Limb[] = [];
  const leaves: Leaf[] = [];
  const stack: State[] = [];
  let s: State = { p: [0, 0, 0], H: [0, 0, 1], L: [1, 0, 0], U: [0, 1, 0], r: radius, step };

  const ang = (): number => (angleDeg + (rng && jitter ? (rng.next() * 2 - 1) * jitter : 0)) * DEG;
  // Re-orthonormalise after rotating two of the three basis vectors.
  const fixFrame = (): void => { s.U = normalize(cross(s.H, s.L)); s.L = normalize(cross(s.U, s.H)); s.H = normalize(s.H); };

  for (const ch of commands) {
    switch (ch) {
      case 'F': {
        const a = s.p;
        const b = add(a, scale(s.H, s.step));
        const r1 = s.r * taper;
        limbs.push({ a, b, r0: s.r, r1 });
        s = { ...s, p: b, r: r1 };
        break;
      }
      case 'f': s = { ...s, p: add(s.p, scale(s.H, s.step)) }; break;
      case '+': { const k = s.U; s = { ...s, H: rotateAbout(s.H, k, ang()), L: rotateAbout(s.L, k, ang()) }; fixFrame(); break; }
      case '-': { const k = s.U; s = { ...s, H: rotateAbout(s.H, k, -ang()), L: rotateAbout(s.L, k, -ang()) }; fixFrame(); break; }
      case '&': { const k = s.L; s = { ...s, H: rotateAbout(s.H, k, ang()), U: rotateAbout(s.U, k, ang()) }; fixFrame(); break; }
      case '^': { const k = s.L; s = { ...s, H: rotateAbout(s.H, k, -ang()), U: rotateAbout(s.U, k, -ang()) }; fixFrame(); break; }
      case '\\': { const k = s.H; s = { ...s, L: rotateAbout(s.L, k, ang()), U: rotateAbout(s.U, k, ang()) }; fixFrame(); break; }
      case '/': { const k = s.H; s = { ...s, L: rotateAbout(s.L, k, -ang()), U: rotateAbout(s.U, k, -ang()) }; fixFrame(); break; }
      case '|': { const k = s.U; s = { ...s, H: rotateAbout(s.H, k, Math.PI), L: rotateAbout(s.L, k, Math.PI) }; fixFrame(); break; }
      case '[': stack.push({ ...s, step: s.step * stepFalloff }); break;
      case ']': {
        if (leafR > 0) leaves.push({ at: s.p, r: leafR });
        const popped = stack.pop();
        if (popped) s = popped;
        break;
      }
      case 'L': if (leafR > 0) leaves.push({ at: s.p, r: leafR }); break;
      default: break; // ignore non-turtle symbols (L-system intermediates)
    }
  }
  return { limbs, leaves };
}
