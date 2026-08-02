// src/assetgen/reference-subject.ts
// The REFERENCE SUBJECT registry — one vocabulary of things the reference loop can be pointed at.
//
// The loop (gather a TTI reference → compare it with our grey massing → fix the geometry) was
// wired straight to `synthesizeBlueprint(preset)`, so it only ever worked on BUILDINGS. Every
// other family of geometry we build — curtain walls, mural towers, gatehouses — had no way in,
// which is why tower defects were only ever found by eye. A subject is the small interface those
// tools actually need:
//
//   slug      → the reference-library folder + the vision-diff key
//   ttiPrompt → the geometry-true text-to-image prompt for this subject
//   massing   → a StructureSpec of OUR current geometry, to compose grey and diff against
//
// Crucially a subject may be an ASSEMBLY, not one object. The tower bugs were JOINT bugs — a drum
// against a curtain — and a reference of a tower alone can never show them. `barrier` subjects are
// therefore scenes: the joint composed as one sprite, exactly as the runtime chunks it.
import type { StructureSpec } from '@/assetgen/compose';
import type { BarrierRun } from '@/world/barrier';
import { towerSpec } from '@/assetgen/geometry/tower-spec';
import { mToTiles } from '@/render/scale-contract';

export type SubjectKind = 'building' | 'barrier';

export interface ReferenceSubject {
  slug: string;
  kind: SubjectKind;
  /** One-line human description — printed by `--list`. */
  summary: string;
  ttiPrompt(): string;
  massing(): Promise<StructureSpec>;
}

// ── barrier scenes ───────────────────────────────────────────────────────────
// Each is a short curtain run plus the tower(s) that meet it, composed as ONE spec so the
// reference and our massing show the same joint.

interface BarrierScene {
  slug: string;
  summary: string;
  prompt: string;
  build(): StructureSpec;
}

/** A crenellated stone curtain of the given path — the runtime's own linear builder. */
function curtain(path: [number, number][], centroid: [number, number], height = 3.5, thickness = 2): BarrierRun {
  return { kind: 'wall', path, material: 'stone', height, thickness, crenellated: true, centroid, gates: [] };
}

const SCENE_SUBJECT = 'A medieval stone town wall, grey ashlar masonry, isometric three-quarter view, '
  + 'plain neutral background, no people, no animals, no carts, no vegetation.';

const SCENES: BarrierScene[] = [
  {
    slug: 'wall-drum-corner',
    summary: 'a round drum tower at the angle where two curtain walls meet',
    prompt: `${SCENE_SUBJECT} A round drum tower stands at the angle where two straight curtain walls meet. `
      + 'The drum is markedly TALLER than it is wide and rises a full storey clear above the wall-walk of both '
      + 'walls, so it reads as a tower standing at the corner rather than a rounded thickening of the wall. Its '
      + 'foot is battered — flaring wider where it meets the ground. A corbelled ring overhangs just below the '
      + 'crown. The crown carries a crenellated parapet: a continuous low sill ring with evenly spaced merlon '
      + 'teeth standing on it. Each curtain wall carries its own crenellated parapet, which stops against the '
      + 'flank of the drum.',
    build(): StructureSpec {
      const run = curtain([[0, 0], [6, 0], [6, 6]], [4, 4]);
      const t = towerSpec({ curtainHeight: run.height, curtainThickness: run.thickness, material: 'stone', round: true, work: 'ashlar' }, 6, 0);
      return { parts: [{ prim: 'linear', run }, ...t.parts] };
    },
  },
  {
    slug: 'wall-drum-midrun',
    summary: 'a round drum tower projecting from a straight length of curtain',
    prompt: `${SCENE_SUBJECT} A round drum tower projects outward from the middle of a straight length of curtain `
      + 'wall. The drum is markedly taller than it is wide and rises a full storey clear above the wall-walk. Its '
      + 'foot is battered, a corbelled ring overhangs below the crown, and the crown carries a crenellated parapet '
      + 'of evenly spaced merlons on a continuous sill. The curtain runs past on both sides at a lower height.',
    build(): StructureSpec {
      const run = curtain([[0, 0], [10, 0]], [5, 4]);
      const t = towerSpec({ curtainHeight: run.height, curtainThickness: run.thickness, material: 'stone', round: true, work: 'ashlar' }, 5, -0.5);
      return { parts: [{ prim: 'linear', run }, ...t.parts] };
    },
  },
  {
    slug: 'wall-square-gate',
    summary: 'twin square gatehouse towers flanking an arched gateway',
    prompt: `${SCENE_SUBJECT} Two SQUARE gatehouse towers flank an arched gateway through the curtain wall. Each `
      + 'tower is taller than the wall and taller than it is wide. Each has a battered foot, a corbelled '
      + 'machicolation band below the crown, and a crenellated parapet on all four edges of its flat top: a '
      + 'continuous low sill with evenly spaced merlon teeth, and a SOLID SQUARE MERLON at each of the four '
      + 'corners so the battlement turns each corner cleanly. The teeth are spaced evenly along each edge with '
      + 'no bare stretch left at either end.',
    build(): StructureSpec {
      const run: BarrierRun = { ...curtain([[0, 0], [12, 0]], [6, 6]), gates: [{ t: 6, width: 2.5 }] };
      const opts = { curtainHeight: run.height, curtainThickness: run.thickness, material: 'stone' as const, tall: true, work: 'ashlar', inward: [0, 1] as [number, number] };
      // Seat each flanker clear of the passage, the same way the runtime does.
      const off = 2.5 / 2 + towerSpec(opts).side / 2 + mToTiles(0.6);
      return {
        parts: [{ prim: 'linear', run }, ...towerSpec(opts, 6 - off, 0).parts, ...towerSpec(opts, 6 + off, 0).parts],
      };
    },
  },
  {
    slug: 'tower-drum-alone',
    summary: 'a drum tower on its own — the proportion check, no wall to hide behind',
    prompt: `${SCENE_SUBJECT} A single round drum tower stands alone. It is markedly taller than it is wide — `
      + 'about twice its own diameter in height. Battered foot, plain cylindrical shaft, a corbelled ring below '
      + 'the crown, and a crenellated parapet of evenly spaced merlons standing on a continuous sill ring.',
    build(): StructureSpec {
      const t = towerSpec({ curtainHeight: 3.5, curtainThickness: 2, material: 'stone', round: true, work: 'ashlar' });
      return { parts: t.parts };
    },
  },
];

// ── registry ─────────────────────────────────────────────────────────────────

function toSubject(s: BarrierScene): ReferenceSubject {
  return {
    slug: s.slug,
    kind: 'barrier',
    summary: s.summary,
    ttiPrompt: () => s.prompt,
    massing: async () => s.build(),
  };
}

/** Every barrier scene, in listing order. */
export function barrierSubjects(): ReferenceSubject[] {
  return SCENES.map(toSubject);
}

/** A barrier scene by slug, or null. Building subjects stay with the scripts that already own the
 *  blueprint dependency graph, so this module keeps the heavy preset imports out. */
export function barrierSubject(slug: string): ReferenceSubject | null {
  const s = SCENES.find((x) => x.slug === slug);
  return s ? toSubject(s) : null;
}
