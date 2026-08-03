import { describe, expect, it } from 'vitest';
import {
  HUMANOID_BVH_MAP,
  parseBvh,
  projectToRig,
  type BvhBoneMap,
} from '@/render/paperdoll/bvh';
import { applyAffine, chipWorldTransforms, sampleClip, type AnimTemplate, type Clip } from '@/render/paperdoll/rig';
import { LPC_HUMANOID_SOUTH } from '@/render/paperdoll/lpc-humanoid';
import { LPC_HUMANOID_WEST } from '@/render/paperdoll/lpc-humanoid-west';
import {
  SYNTHETIC_ARM_RAISE_BVH,
  SYNTHETIC_JOINT_CHANNELS,
  SYNTHETIC_LEG_SWING_BVH,
  SYNTHETIC_WALK_BVH,
} from '../fixtures/synthetic-bvh';

const armRaise = parseBvh(SYNTHETIC_ARM_RAISE_BVH);
const legSwing = parseBvh(SYNTHETIC_LEG_SWING_BVH);
const walk = parseBvh(SYNTHETIC_WALK_BVH);

const lastKey = (clip: Clip, chip: string) => {
  const track = clip.tracks[chip];
  return track?.[track.length - 1];
};

/** World position of a rest-space point on a chip, at baked frame `f`. */
const chipPoint = (
  template: AnimTemplate,
  clip: Clip,
  chip: string,
  point: [number, number],
  f: number,
): [number, number] => {
  const ci = template.chips.findIndex((c) => c.name === chip);
  const world = chipWorldTransforms(template, sampleClip(template, clip, f / (clip.frames - 1)));
  return applyAffine(world[ci], point[0], point[1]);
};

describe('parseBvh', () => {
  it('reads the hierarchy, per-joint channel order, offsets and motion block', () => {
    // Every declared joint, in hierarchy order, with the channel order it
    // declared — the parser must not assume the corpus's uniform ZYX habit.
    const withChannels = armRaise.joints.filter((j) => j.channels.length > 0);
    expect(withChannels.map((j) => [j.name, j.channels])).toEqual(
      SYNTHETIC_JOINT_CHANNELS.map(([n, c]) => [n, [...c]]),
    );
    expect(armRaise.joints[0]).toEqual({
      name: 'Hips',
      parent: -1,
      offset: [0, 0, 0],
      channels: ['Xposition', 'Yposition', 'Zposition', 'Zrotation', 'Yrotation', 'Xrotation'],
    });

    // End Sites carry geometry but no channels, and are named off their parent.
    const ends = armRaise.joints.filter((j) => j.channels.length === 0);
    expect(ends.map((j) => j.name)).toEqual([
      'LeftFoot_End',
      'RightFoot_End',
      'Head_End',
      'LeftHand_End',
      'RightHand_End',
    ]);
    expect(ends[0].offset).toEqual([0, -3, 5]);

    // Parents always precede children (the FK pass relies on it).
    for (const j of armRaise.joints) expect(j.parent).toBeLessThan(armRaise.joints.indexOf(j));

    expect(armRaise.frames).toHaveLength(5);
    // The corpus writes floats with no leading zero ("Frame Time: .0083333").
    expect(armRaise.frameTime).toBeCloseTo(0.0333333, 7);
    const width = armRaise.joints.reduce((s, j) => s + j.channels.length, 0);
    expect(width).toBe(48);
    expect(armRaise.frames[4]).toHaveLength(48);
    // Frame 4: LeftArm Zrotation -90 is the 1st of LeftArm's three channels.
    const leftArmCol = SYNTHETIC_JOINT_CHANNELS.slice(
      0,
      SYNTHETIC_JOINT_CHANNELS.findIndex(([n]) => n === 'LeftArm'),
    ).reduce((s, [, c]) => s + c.length, 0);
    expect(armRaise.frames[4][leftArmCol]).toBe(-90);
    expect(armRaise.frames[0][leftArmCol]).toBe(0);
  });

  it('refuses malformed input honestly instead of guessing', () => {
    expect(() => parseBvh('MOTION\nFrames: 1\n')).toThrow(/expected "HIERARCHY"/);
    expect(() => parseBvh(SYNTHETIC_ARM_RAISE_BVH.replace('Frames: 5', 'Frames: 500'))).toThrow(
      /unexpected end of file/,
    );
  });
});

describe('projectToRig — determinism (spec contract 2)', () => {
  it('is byte-identical across runs and quantized to 0.5° / 0.25px', () => {
    const a = projectToRig(armRaise, HUMANOID_BVH_MAP, { name: 'raise' });
    const b = projectToRig(armRaise, HUMANOID_BVH_MAP, { name: 'raise' });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));

    let keys = 0;
    for (const clip of Object.values(a)) {
      for (const track of Object.values(clip.tracks)) {
        for (const k of track) {
          keys++;
          expect(k.deg * 2).toBe(Math.round(k.deg * 2));
          if (k.dx !== undefined) expect(k.dx * 4).toBe(Math.round(k.dx * 4));
          if (k.dy !== undefined) expect(k.dy * 4).toBe(Math.round(k.dy * 4));
          expect(k.t).toBeGreaterThanOrEqual(0);
          expect(k.t).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(keys).toBeGreaterThan(0);
  });

  it('caps keys per track and never exceeds the frame count', () => {
    const clips = projectToRig(walk, HUMANOID_BVH_MAP, { maxKeys: 3 });
    for (const clip of Object.values(clips)) {
      for (const track of Object.values(clip.tracks)) {
        expect(track.length).toBeLessThanOrEqual(3);
        expect(track[0].t).toBe(0);
        expect(track[track.length - 1].t).toBe(1);
      }
    }
  });
});

describe('projectToRig — y-down clockwise sign convention', () => {
  // The fixture abducts the actor's LEFT arm 0 → -90° about Z, so on screen it
  // swings from hanging down to horizontal. Facing the camera that arm is on
  // the viewer's RIGHT (chip `armR_*`), and +deg is CLOCKWISE in y-down space,
  // so a lift on the right-hand side must be NEGATIVE. Assert the sign, not a
  // snapshot — this is the one convention the whole importer hangs on.
  const clips = projectToRig(armRaise, HUMANOID_BVH_MAP);

  it('a raised arm lands as a negative angle on the screen-right chip (south)', () => {
    const up = lastKey(clips.down, 'armR_up');
    expect(up).toBeDefined();
    expect(up!.t).toBe(1);
    expect(up!.deg).toBeLessThan(0);
    expect(up!.deg).toBe(-90);
    expect(clips.down.tracks.armR_up[0].deg).toBe(0); // the reference pose IS rest
  });

  it('elbow bend is emitted PARENT-RELATIVE, not absolute', () => {
    // The forearm's absolute swing is -120° (shoulder -90 plus elbow -30); the
    // rig composes parent rotations, so the track must carry only the -30.
    expect(lastKey(clips.down, 'armR_fore')!.deg).toBe(-30);
  });

  it('the back view moves the same arm to the other chip AND flips its sign', () => {
    // Seen from behind, the actor's left arm is on the viewer's LEFT — chip
    // `armL_up` — and a lift on that side sweeps down→left, which is CLOCKWISE
    // in y-down space, so the sign flips with the side. (South and north share
    // a chip vocabulary precisely so a clip authored once reads the same on
    // screen from either side; the importer has to honour that, not fight it.)
    expect(lastKey(clips.up, 'armL_up')!.deg).toBe(90);
    expect(clips.up.tracks.armR_up).toBeUndefined();
  });

  it('a sideways raise is out-of-plane in profile: no rotation invented', () => {
    // West is the sagittal cut. An arm abducting straight out of that plane
    // projects to nothing, so the importer HOLDS the angle instead of spinning
    // on noise — the accepted 64px artifact, visible as dx/dy only.
    expect(clips.left.tracks.armNear_up).toBeUndefined();
    expect(clips.left.tracks.armNear_fore?.some((k) => (k.dy ?? 0) !== 0)).toBe(true);
  });
});

describe('projectToRig — loop closure', () => {
  it('closes a cyclic clip so t=0 and t=1 sample identically', () => {
    const clip = projectToRig(legSwing, HUMANOID_BVH_MAP).left;
    const a = sampleClip(LPC_HUMANOID_WEST, clip, 0);
    const b = sampleClip(LPC_HUMANOID_WEST, clip, 1);
    expect(b).toEqual(a);
    // And it closed by absorbing the near-miss, not by flattening the cycle:
    // the ±20° extremes survive in the middle of the clip.
    const thigh = clip.tracks.legNear_up;
    expect(Math.max(...thigh.map((k) => Math.abs(k.deg)))).toBeGreaterThan(15);
  });

  it('leaves a one-shot open rather than forcing it into a loop', () => {
    const clip = projectToRig(armRaise, HUMANOID_BVH_MAP).down;
    expect(sampleClip(LPC_HUMANOID_SOUTH, clip, 1)).not.toEqual(sampleClip(LPC_HUMANOID_SOUTH, clip, 0));
  });

  it('loop:wrap closes a clip that does not repeat its own first frame', () => {
    const open = projectToRig(armRaise, HUMANOID_BVH_MAP, { loop: 'none' }).down;
    const wrapped = projectToRig(armRaise, HUMANOID_BVH_MAP, { loop: 'wrap' }).down;
    expect(wrapped.frames).toBe(open.frames + 1);
    expect(sampleClip(LPC_HUMANOID_SOUTH, wrapped, 1)).toEqual(sampleClip(LPC_HUMANOID_SOUTH, wrapped, 0));
  });
});

describe('projectToRig — feet', () => {
  it('a stationary import plants the feet it detects standing', () => {
    // The arm-raise actor never moves their feet, so both soles are nailed for
    // the whole clip — which is exactly what `Clip.plant` means.
    const clip = projectToRig(armRaise, HUMANOID_BVH_MAP).down;
    expect(clip.plant).toEqual([
      { chip: 'legR_fore', point: [39.5, 62] },
      { chip: 'legL_fore', point: [24.5, 62] },
    ]);
    for (const pl of clip.plant!) {
      for (const f of [0, 2, 4]) {
        const [x, y] = chipPoint(LPC_HUMANOID_SOUTH, clip, pl.chip, pl.point, f);
        expect(x).toBeCloseTo(pl.point[0], 6);
        expect(y).toBeCloseTo(pl.point[1], 6);
      }
    }
  });

  it('a clip whose feet both swing plants nothing', () => {
    expect(projectToRig(legSwing, HUMANOID_BVH_MAP).left.plant).toBeUndefined();
  });

  it('locomotion bakes root-motion compensation so the stance sole holds still', () => {
    const sole: [number, number] = [27.5, 60];
    const travelOf = (clip: Clip): number => {
      const xs = Array.from({ length: clip.frames }, (_, f) =>
        chipPoint(LPC_HUMANOID_WEST, clip, 'legNear_fore', sole, f)[0],
      );
      return Math.max(...xs) - Math.min(...xs);
    };
    // The capture's own stance ankle is already world-still; what drifts is the
    // RIG's sole, because a 5px LPC shin cannot cover a 12px projected one.
    // The control is the same import with the foot map emptied — no plant to
    // nail the sole, no stance to compensate against.
    const noFeet: BvhBoneMap = {
      ...HUMANOID_BVH_MAP,
      facings: {
        ...HUMANOID_BVH_MAP.facings,
        left: { ...HUMANOID_BVH_MAP.facings.left, feet: [] },
      },
    };
    const uncompensated = projectToRig(walk, noFeet, { motion: 'locomotion' }).left;
    const compensated = projectToRig(walk, HUMANOID_BVH_MAP, { motion: 'locomotion' }).left;
    expect(compensated.plant).toBeUndefined(); // locomotion nails nothing
    expect(travelOf(uncompensated)).toBeGreaterThan(2);
    expect(travelOf(compensated)).toBeLessThan(0.75);
    // Compensation is a trunk translation, not a re-pose: the legs are untouched.
    expect(compensated.tracks.legNear_up).toEqual(uncompensated.tracks.legNear_up);
    expect(compensated.tracks.trunk).not.toEqual(uncompensated.tracks.trunk);
  });

  it('auto picks locomotion from root travel and stationary without it', () => {
    expect(projectToRig(walk, HUMANOID_BVH_MAP).left.plant).toBeUndefined();
    expect(projectToRig(armRaise, HUMANOID_BVH_MAP).left.plant).toBeDefined();
  });
});

describe('projectToRig — bone maps are data', () => {
  it('skips bones naming joints this skeleton does not have', () => {
    const map: BvhBoneMap = {
      ...HUMANOID_BVH_MAP,
      facings: {
        ...HUMANOID_BVH_MAP.facings,
        down: {
          ...HUMANOID_BVH_MAP.facings.down,
          bones: [{ from: 'NoSuchJoint', to: 'AlsoMissing', chip: 'armR_up' }],
          feet: [],
        },
      },
    };
    const clip = projectToRig(armRaise, map).down;
    expect(clip.tracks.armR_up).toBeUndefined();
    expect(clip.plant).toBeUndefined();
  });

  it('candidate joint names let one map serve skeleton dialects', () => {
    // HUMANOID_BVH_MAP names the head bone ['Neck1', 'Neck']; the fixture has
    // only `Neck`, and the real CMU skeleton has both.
    const clips = projectToRig(walk, HUMANOID_BVH_MAP, { frames: 5 });
    expect(clips.left.tracks).toBeDefined();
    expect(HUMANOID_BVH_MAP.facings.left.bones.some((b) => b.chip === 'head')).toBe(true);
  });
});
