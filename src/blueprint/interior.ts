// Interior epic I-3: project a resolved building's connectome ROOMS into a compact,
// geometry-ready interior plan — the partition walls + funnel floor the cutaway view
// renders. Pure + content-free: it reads only the latent connectome (zones/portals the
// fold already attached), so a building with no connectome (e.g. one rehydrated from an
// autosave, where the non-enumerable graph was JSON-stripped) yields `undefined` and the
// cutaway degrades to the plain open shell (I-2). See docs/.../building-interiors-render-spec.
import type { ResolvedBlueprint } from './types';

export interface InteriorPlan {
  /** Partition-wall positions as fractions (0,1) along the building's LONG axis, in
   *  entrance→deep order — a thin cross-wall divides one room from the next. */
  partitions: number[];
  /** Floor z-drop (tiles, downward) per room SEGMENT — length === partitions.length + 1.
   *  A worship procession sinks toward the sanctum (the funnel, Law 2); else all zero. */
  floorDrop: number[];
  /** Per-partition permeability (length === partitions.length): the threshold INTO the
   *  sanctum of a worship procession is a pierced/latticed SCREEN (a rood screen — Law 4,
   *  Controlled Contact), not a solid wall. Every other partition is solid (false). */
  screens: boolean[];
}

// Zones that flank or precede the main spine rather than sit on it — excluded from the
// linear room sequence so a nave|chancel reads cleanly instead of being chopped by aisles.
const OFF_SPINE = new Set(['aisle', 'ambulatory', 'porch', 'narthex', 'undercroft', 'crypt']);
// The deep sacred room a procession descends toward.
const SANCTUM = new Set(['chancel', 'sanctum', 'apse', 'choir', 'presbytery', 'cella']);
/** Max floor descent (tiles) at the deepest point of a worship procession. */
const FUNNEL_DROP = 0.5;

export function interiorPlan(rb: ResolvedBlueprint): InteriorPlan | undefined {
  const con = rb.connectome;
  if (!con?.zones?.length) return undefined;
  // Ground-floor rooms on the main spine, in the connectome's entrance→deep order.
  const spine = con.zones.filter(
    (z) => (z.level ?? 0) === 0 && !OFF_SPINE.has(z.type) && z.fn !== 'circulation',
  );
  if (spine.length < 2) return undefined; // single room ⇒ no partitions; cutaway stays an open shell

  const bayOf = (b?: number) => Math.max(1, b ?? 1);
  const totalBays = spine.reduce((s, z) => s + bayOf(z.bays), 0);
  const partitions: number[] = [];
  let acc = 0;
  for (let i = 0; i < spine.length - 1; i++) {
    acc += bayOf(spine[i].bays);
    partitions.push(Number((acc / totalBays).toFixed(4)));
  }

  // Funnel (Law 2): a worship procession (≥2 worship rooms, or any sanctum-type room)
  // sinks monotonically toward the altar end. Other programmes keep a level floor.
  const worship =
    spine.filter((z) => z.fn === 'worship').length >= 2 || spine.some((z) => SANCTUM.has(z.type));
  const last = spine.length - 1;
  const floorDrop = spine.map((_, i) => (worship ? Number(((FUNNEL_DROP * i) / last).toFixed(3)) : 0));

  // Law 4 (Controlled Contact): in a worship procession the partition that crosses INTO a
  // sanctum room (nave→chancel) is the rood screen — a permeable lattice the laity see
  // through but cannot pass. Partition i sits after spine[i], so it screens spine[i+1].
  const screens = partitions.map((_, i) => worship && SANCTUM.has(spine[i + 1].type));

  return { partitions, floorDrop, screens };
}
