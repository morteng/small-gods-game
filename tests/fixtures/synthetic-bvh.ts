/**
 * SYNTHETIC BVH fixtures — hand-authored, not capture data.
 *
 * Real CMU files are vendored for the importer script and for eyeballing in the
 * studio, but they are the wrong thing to unit-test against: 120 fps × hundreds
 * of frames of noisy human motion pins nothing you can read, and a golden hash
 * over it tells you a number changed, not which convention broke. These three
 * clips are small enough to reason about in closed form, so every assertion in
 * `bvh-import.test.ts` states a CONVENTION (this rotation, in this direction,
 * lands as this sign on this chip) instead of a snapshot.
 *
 * The skeleton uses CMU/cgspeed joint NAMES for every joint a bone map names,
 * and omits the structural carriers (LHipJoint, LowerBack, Spine1,
 * LeftShoulder…) — a bone only ever needs its two endpoints, so `HUMANOID_BVH_MAP`
 * maps this skeleton unchanged. It faces -Z with +Y up, so the actor's left is
 * at -X (the same handedness the real corpus uses).
 *
 * Rotation channel order is deliberately NOT uniform: `Head` declares ZYX while
 * everything else declares ZXY, so the parser is forced to honour the per-joint
 * declaration instead of assuming the corpus's habit.
 */

/** Channel table, in hierarchy order — must mirror `SYNTHETIC_HIERARCHY`. */
export const SYNTHETIC_JOINT_CHANNELS: readonly (readonly [string, readonly string[]])[] = [
  ['Hips', ['Xposition', 'Yposition', 'Zposition', 'Zrotation', 'Yrotation', 'Xrotation']],
  ['LeftUpLeg', ['Zrotation', 'Xrotation', 'Yrotation']],
  ['LeftLeg', ['Zrotation', 'Xrotation', 'Yrotation']],
  ['LeftFoot', ['Zrotation', 'Xrotation', 'Yrotation']],
  ['RightUpLeg', ['Zrotation', 'Xrotation', 'Yrotation']],
  ['RightLeg', ['Zrotation', 'Xrotation', 'Yrotation']],
  ['RightFoot', ['Zrotation', 'Xrotation', 'Yrotation']],
  ['Neck', ['Zrotation', 'Xrotation', 'Yrotation']],
  ['Head', ['Zrotation', 'Yrotation', 'Xrotation']],
  ['LeftArm', ['Zrotation', 'Xrotation', 'Yrotation']],
  ['LeftForeArm', ['Zrotation', 'Xrotation', 'Yrotation']],
  ['LeftHand', ['Zrotation', 'Xrotation', 'Yrotation']],
  ['RightArm', ['Zrotation', 'Xrotation', 'Yrotation']],
  ['RightForeArm', ['Zrotation', 'Xrotation', 'Yrotation']],
  ['RightHand', ['Zrotation', 'Xrotation', 'Yrotation']],
];

/**
 * Proportions: hips at the origin, feet 41 below, head top 33 above → a 74-unit
 * figure, and each leg is exactly 36 units hip-to-ankle (18 + 18) so a thigh
 * swing of θ puts the ankle 36·sinθ forward. That closed form is what lets the
 * walk fixture below hold its stance foot still by construction.
 */
const SYNTHETIC_HIERARCHY = `HIERARCHY
ROOT Hips
{
  OFFSET 0.0 0.0 0.0
  CHANNELS 6 Xposition Yposition Zposition Zrotation Yrotation Xrotation
  JOINT LeftUpLeg
  {
    OFFSET -8.0 -2.0 0.0
    CHANNELS 3 Zrotation Xrotation Yrotation
    JOINT LeftLeg
    {
      OFFSET 0.0 -18.0 0.0
      CHANNELS 3 Zrotation Xrotation Yrotation
      JOINT LeftFoot
      {
        OFFSET 0.0 -18.0 0.0
        CHANNELS 3 Zrotation Xrotation Yrotation
        End Site
        {
          OFFSET 0.0 -3.0 5.0
        }
      }
    }
  }
  JOINT RightUpLeg
  {
    OFFSET 8.0 -2.0 0.0
    CHANNELS 3 Zrotation Xrotation Yrotation
    JOINT RightLeg
    {
      OFFSET 0.0 -18.0 0.0
      CHANNELS 3 Zrotation Xrotation Yrotation
      JOINT RightFoot
      {
        OFFSET 0.0 -18.0 0.0
        CHANNELS 3 Zrotation Xrotation Yrotation
        End Site
        {
          OFFSET 0.0 -3.0 5.0
        }
      }
    }
  }
  JOINT Neck
  {
    OFFSET 0.0 22.0 0.0
    CHANNELS 3 Zrotation Xrotation Yrotation
    JOINT Head
    {
      OFFSET 0.0 5.0 0.0
      CHANNELS 3 Zrotation Yrotation Xrotation
      End Site
      {
        OFFSET 0.0 6.0 0.0
      }
    }
    JOINT LeftArm
    {
      OFFSET -7.0 -3.0 0.0
      CHANNELS 3 Zrotation Xrotation Yrotation
      JOINT LeftForeArm
      {
        OFFSET 0.0 -13.0 0.0
        CHANNELS 3 Zrotation Xrotation Yrotation
        JOINT LeftHand
        {
          OFFSET 0.0 -11.0 0.0
          CHANNELS 3 Zrotation Xrotation Yrotation
          End Site
          {
            OFFSET 0.0 -4.0 0.0
          }
        }
      }
    }
    JOINT RightArm
    {
      OFFSET 7.0 -3.0 0.0
      CHANNELS 3 Zrotation Xrotation Yrotation
      JOINT RightForeArm
      {
        OFFSET 0.0 -13.0 0.0
        CHANNELS 3 Zrotation Xrotation Yrotation
        JOINT RightHand
        {
          OFFSET 0.0 -11.0 0.0
          CHANNELS 3 Zrotation Xrotation Yrotation
          End Site
          {
            OFFSET 0.0 -4.0 0.0
          }
        }
      }
    }
  }
}
`;

/**
 * One motion row from named channel overrides — 48 numbers of which all but a
 * handful are zero, so writing them out longhand would hide the two that
 * matter. Keys are `Joint.Channel`; a key that matches nothing throws, so a
 * typo in a fixture fails loudly instead of silently animating nothing.
 */
function motionRow(over: Record<string, number> = {}): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const [joint, channels] of SYNTHETIC_JOINT_CHANNELS) {
    for (const ch of channels) {
      const key = `${joint}.${ch}`;
      if (key in over) seen.add(key);
      out.push(String(over[key] ?? 0));
    }
  }
  for (const key of Object.keys(over)) {
    if (!seen.has(key)) throw new Error(`synthetic BVH: no channel "${key}"`);
  }
  return out.join(' ');
}

const bvh = (rows: readonly Record<string, number>[]): string =>
  `${SYNTHETIC_HIERARCHY}MOTION\nFrames: ${rows.length}\nFrame Time: .0333333\n${rows
    .map((r) => motionRow(r))
    .join('\n')}\n`;

/**
 * Two-bone arm raise, 5 frames, feet still.
 *
 * The actor's LEFT arm abducts 0 → -90° about Z (which swings it out to -X,
 * the actor's own left) while the elbow bends a further -30°. Everything stays
 * in the XY plane, so the frontal projection is exact and the expected rig
 * angles are known in closed form: -90° on the upper-arm chip and -30° on the
 * forearm chip once the parent's rotation is subtracted.
 *
 * It doubles as the out-of-plane pin: a sideways raise is INVISIBLE in the
 * sagittal (west) view, so the west import must produce no arm rotation at all.
 */
export const SYNTHETIC_ARM_RAISE_BVH = bvh([
  {},
  { 'LeftArm.Zrotation': -22.5 },
  { 'LeftArm.Zrotation': -45, 'LeftForeArm.Zrotation': -10 },
  { 'LeftArm.Zrotation': -67.5, 'LeftForeArm.Zrotation': -20 },
  { 'LeftArm.Zrotation': -90, 'LeftForeArm.Zrotation': -30 },
]);

/**
 * Cyclic leg swing in place, 5 frames: thighs scissor ±20° about X and the
 * fifth frame comes back to 2° rather than exactly 0 — a trimmed capture never
 * lands back on its own first frame, and that near-miss is what loop closure
 * exists to absorb.
 *
 * Both feet swing, so neither is stance: the import must NOT plant a foot here
 * (the same reason `CLIP_WEST_ARTICULATION_TEST` deliberately plants nothing).
 */
export const SYNTHETIC_LEG_SWING_BVH = bvh([
  {},
  { 'LeftUpLeg.Xrotation': 20, 'RightUpLeg.Xrotation': -20 },
  {},
  { 'LeftUpLeg.Xrotation': -20, 'RightUpLeg.Xrotation': 20 },
  { 'LeftUpLeg.Xrotation': 2, 'RightUpLeg.Xrotation': -2 },
]);

/**
 * Walk with real travel, 5 frames — the root-motion fixture.
 *
 * The LEFT leg is stance throughout: its thigh rotates 15° → -15° about X while
 * the hips advance by exactly 36·sin(θ) along +Z and drop by 36·(1-cos θ), so
 * the left ankle stays pinned in world space on BOTH axes — a real capture's
 * stance foot does the same, because an actor does not slide, and the pelvis
 * rises and falls over the planted leg. The right leg takes the opposite swing
 * and is clearly airborne.
 *
 * The importer's job here is subtler than "remove the travel": the capture's
 * ankle is already still, but the RIG's sole is not, because a 5px LPC shin
 * cannot cover a 12px projected one. Root-motion compensation is what makes
 * the rig's own sole hold.
 */
export const SYNTHETIC_WALK_BVH = bvh([
  { 'LeftUpLeg.Xrotation': 15, 'RightUpLeg.Xrotation': -15, 'Hips.Zposition': 9.3175, 'Hips.Yposition': -1.2265 },
  { 'LeftUpLeg.Xrotation': 7.5, 'RightUpLeg.Xrotation': -7.5, 'Hips.Zposition': 4.6989, 'Hips.Yposition': -0.3081 },
  { 'LeftUpLeg.Xrotation': 0, 'RightUpLeg.Xrotation': 0, 'Hips.Zposition': 0, 'Hips.Yposition': 0 },
  { 'LeftUpLeg.Xrotation': -7.5, 'RightUpLeg.Xrotation': 7.5, 'Hips.Zposition': -4.6989, 'Hips.Yposition': -0.3081 },
  { 'LeftUpLeg.Xrotation': -15, 'RightUpLeg.Xrotation': 15, 'Hips.Zposition': -9.3175, 'Hips.Yposition': -1.2265 },
]);
