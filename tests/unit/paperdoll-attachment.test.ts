import { describe, expect, it } from 'vitest';
import { applyAffine, chipWorldTransforms, type AnimTemplate, type ChipPose } from '@/render/paperdoll/rig';
import { affineRotationDeg, resolveAttachments, type Attachment } from '@/render/paperdoll/attachment';

const T: AnimTemplate = {
  name: 'attach-test',
  cell: 8,
  chips: [
    { name: 'root', rect: { x: 0, y: 0, w: 8, h: 8 }, pivot: [4, 4], parent: -1, z: 0 },
    { name: 'arm', rect: { x: 2, y: 4, w: 2, h: 2 }, pivot: [3, 4], parent: 0, z: 1 },
  ],
};

const restPose: ChipPose[] = [
  { deg: 0, dx: 0, dy: 0 },
  { deg: 0, dx: 0, dy: 0 },
];

describe('resolveAttachments', () => {
  it('identity pose: pin point resolves at its rest position, deg 0', () => {
    const attachments: Attachment[] = [{ chip: 'arm', at: [4, 4] }];
    const [res] = resolveAttachments(T, restPose, attachments);
    expect(res).not.toBeNull();
    expect(res!.x).toBeCloseTo(4);
    expect(res!.y).toBeCloseTo(4);
    expect(res!.deg).toBeCloseTo(0);
  });

  it('chip rotated 90° about its pivot moves the pin point and orientation to match', () => {
    const poses: ChipPose[] = [{ deg: 0, dx: 0, dy: 0 }, { deg: 90, dx: 0, dy: 0 }];
    const attachments: Attachment[] = [{ chip: 'arm', at: [4, 4] }];
    const [res] = resolveAttachments(T, poses, attachments);
    // Hand-computed rotation of (4,4) about pivot (3,4) by 90° cw, y-down:
    // new_x = px + dx*cos - dy*sin, new_y = py + dx*sin + dy*cos, dx=1, dy=0.
    const rad = (90 * Math.PI) / 180;
    const expX = 3 + 1 * Math.cos(rad) - 0 * Math.sin(rad);
    const expY = 4 + 1 * Math.sin(rad) + 0 * Math.cos(rad);
    expect(res!.x).toBeCloseTo(expX);
    expect(res!.y).toBeCloseTo(expY);
    expect(res!.deg).toBeCloseTo(90);
  });

  it('parent rotation composes: matches chipWorldTransforms + applyAffine directly', () => {
    const poses: ChipPose[] = [{ deg: 30, dx: 0, dy: 0 }, { deg: 60, dx: 0, dy: 0 }];
    const attachments: Attachment[] = [{ chip: 'arm', at: [4, 4] }];
    const [res] = resolveAttachments(T, poses, attachments);
    const world = chipWorldTransforms(T, poses);
    const [ex, ey] = applyAffine(world[1], 4, 4);
    const edeg = affineRotationDeg(world[1]);
    expect(res!.x).toBeCloseTo(ex);
    expect(res!.y).toBeCloseTo(ey);
    expect(res!.deg).toBeCloseTo(edeg);
  });

  it('keepUpright ignores the chip rotation for orientation but still moves position', () => {
    const poses: ChipPose[] = [{ deg: 30, dx: 0, dy: 0 }, { deg: 60, dx: 0, dy: 0 }];
    const attachments: Attachment[] = [{ chip: 'arm', at: [4, 4], keepUpright: true }];
    const [res] = resolveAttachments(T, poses, attachments);
    const world = chipWorldTransforms(T, poses);
    const [ex, ey] = applyAffine(world[1], 4, 4);
    expect(res!.x).toBeCloseTo(ex);
    expect(res!.y).toBeCloseTo(ey);
    expect(res!.deg).toBeCloseTo(0);
  });

  it('extra deg adds on top of the chip rotation', () => {
    const poses: ChipPose[] = [{ deg: 0, dx: 0, dy: 0 }, { deg: 90, dx: 0, dy: 0 }];
    const attachments: Attachment[] = [{ chip: 'arm', at: [4, 4], deg: 15 }];
    const [res] = resolveAttachments(T, poses, attachments);
    expect(res!.deg).toBeCloseTo(105);
  });

  it('unknown chip resolves to null while the rest of the list still resolves', () => {
    const poses: ChipPose[] = [{ deg: 0, dx: 0, dy: 0 }, { deg: 45, dx: 0, dy: 0 }];
    const attachments: Attachment[] = [
      { chip: 'ghost', at: [0, 0] },
      { chip: 'arm', at: [4, 4] },
    ];
    const results = resolveAttachments(T, poses, attachments);
    expect(results[0]).toBeNull();
    expect(results[1]).not.toBeNull();
    expect(results[1]!.deg).toBeCloseTo(45);
  });

  it('a precomputed world gives identical results to letting the resolver compute it', () => {
    const poses: ChipPose[] = [{ deg: 20, dx: 1, dy: -1 }, { deg: 40, dx: 0, dy: 2 }];
    const attachments: Attachment[] = [
      { chip: 'arm', at: [4, 4] },
      { chip: 'root', at: [0, 0], deg: 5 },
      { chip: 'ghost', at: [1, 1] },
    ];
    const world = chipWorldTransforms(T, poses);
    const withWorld = resolveAttachments(T, poses, attachments, world);
    const withoutWorld = resolveAttachments(T, poses, attachments);
    expect(withWorld).toEqual(withoutWorld);
  });
});
