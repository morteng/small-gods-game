import { describe, expect, it } from 'vitest';
import { clipChipNames, clipsFor, importedMetaFor, RIGS, rigById } from '@/render/paperdoll/rig-catalog';
import { IMPORTED_CLIPS, IMPORTED_CLIP_META } from '@/render/paperdoll/clips';
import { HUMANOID_CLIPS, LPC_HUMANOID_SOUTH } from '@/render/paperdoll/lpc-humanoid';
import { LPC_HUMANOID_NORTH } from '@/render/paperdoll/lpc-humanoid-north';
import { LPC_HUMANOID_WEST } from '@/render/paperdoll/lpc-humanoid-west';
import { LPC_DIR_OFFSET } from '@/core/npc-animation';

const humanoid = rigById('humanoid')!;
const facingsOf = (id: string) => rigById(id)!.facings;

describe('RIGS — identity', () => {
  it('has unique rig ids and unique facing ids within each rig', () => {
    expect(new Set(RIGS.map((r) => r.id)).size).toBe(RIGS.length);
    for (const rig of RIGS) {
      expect(rig.facings.length).toBeGreaterThan(0);
      expect(new Set(rig.facings.map((f) => f.id)).size).toBe(rig.facings.length);
      // Clip names are what the studio's picker shows; two entries sharing one
      // would be indistinguishable in the menu.
      for (const f of rig.facings) {
        expect(new Set(f.clips.map((c) => c.name)).size).toBe(f.clips.length);
      }
    }
  });

  it('quadrupeds carry a one-entry facing list rather than a special case', () => {
    for (const id of ['sheep', 'goat']) {
      expect(facingsOf(id)).toHaveLength(1);
      expect(facingsOf(id)[0].id).toBe('left');
      expect(facingsOf(id)[0].sheetRow).toBeUndefined();
    }
  });
});

describe('RIGS — every offered clip is actually playable on its facing', () => {
  // THE invariant. `sampleClip` looks tracks up by chip name and silently skips
  // what it cannot find, so a clip offered to the wrong template does not error
  // — it just stands there. Only this check catches that.
  it.each(RIGS.flatMap((rig) => rig.facings.map((f) => [rig.id, f.id, rig, f] as const)))(
    '%s/%s names only chips the template owns',
    (_rigId, _facingId, _rig, f) => {
      const owned = new Set(f.template.chips.map((c) => c.name));
      expect(f.clips.length).toBeGreaterThan(0);
      for (const clip of f.clips) {
        for (const name of clipChipNames(clip)) {
          expect({ clip: clip.name, chip: name, owned: owned.has(name) })
            .toEqual({ clip: clip.name, chip: name, owned: true });
        }
      }
    },
  );

  it('filters rather than assumes — a foreign clip is dropped, not offered', () => {
    // West's profile vocabulary cannot play a south arm sweep, and the filter
    // is what says so; nothing about the bake would have complained.
    const swept = HUMANOID_CLIPS.find((c) => c.name === 'pray-raise')!;
    expect(clipsFor(LPC_HUMANOID_SOUTH, [swept])).toEqual([swept]);
    expect(clipsFor(LPC_HUMANOID_WEST, [swept])).toEqual([]);
  });
});

describe('the humanoid facings', () => {
  it('offers every imported clip on all three facings', () => {
    const imported = Object.keys(IMPORTED_CLIPS);
    expect(imported).toHaveLength(4); // walk, walk-brisk, wave, march
    expect(humanoid.facings.map((f) => f.id)).toEqual(['down', 'up', 'left']);
    for (const f of humanoid.facings) {
      const names = f.clips.map((c) => c.name);
      for (const name of imported) expect(names).toContain(name);
      // The clip objects offered are that facing's OWN authored variants, not
      // south's reused — a facing showing another's tracks would look like a
      // projection bug rather than a lookup one.
      for (const name of imported) {
        expect(f.clips).toContain(IMPORTED_CLIPS[name][f.id]);
      }
    }
  });

  it('carries south-authored clips onto north, because north shares the vocabulary', () => {
    const south = humanoid.facings.find((f) => f.id === 'down')!;
    const north = humanoid.facings.find((f) => f.id === 'up')!;
    expect(north.template).toBe(LPC_HUMANOID_NORTH);
    // Same chip names by design (`lpc-humanoid-north.ts`), so every hand-authored
    // clip PLAYS from behind. Whether it READS right is the bench's question.
    for (const c of HUMANOID_CLIPS) {
      expect(south.clips).toContain(c);
      expect(north.clips).toContain(c);
    }
  });

  it('takes its sheet rows from LPC_DIR_OFFSET, not a second copy of the order', () => {
    for (const f of humanoid.facings) expect(f.sheetRow).toBe(LPC_DIR_OFFSET[f.id]);
    expect(humanoid.facings.map((f) => f.sheetRow)).toEqual([2, 0, 1]);
  });

  it('keeps stamps on south only — the donors are south-row crops', () => {
    expect(humanoid.facings.map((f) => f.stamps)).toEqual([true, false, false]);
  });
});

describe('importedMetaFor', () => {
  it('answers for a clip that IS the import, and stays silent for a namesake', () => {
    const south = humanoid.facings[0];
    const walk = IMPORTED_CLIPS.walk.down;
    expect(importedMetaFor(south, walk)?.source).toBe(IMPORTED_CLIP_META.walk.source);

    // The sheep hand-authors its own `walk`. Keyed by name, it would be
    // reported as a CMU capture with a stride and a ground speed it has never
    // had — so the lookup keys on identity.
    const sheep = rigById('sheep')!.facings[0];
    const sheepWalk = sheep.clips.find((c) => c.name === 'walk')!;
    expect(sheepWalk).not.toBe(walk);
    expect(importedMetaFor(sheep, sheepWalk)).toBeUndefined();
  });

  it('does not answer for another facing\'s variant of the same clip', () => {
    const south = humanoid.facings[0];
    expect(importedMetaFor(south, IMPORTED_CLIPS.walk.left)).toBeUndefined();
  });

  it('stays silent for the hand-authored humanoid clips', () => {
    const south = humanoid.facings[0];
    for (const c of HUMANOID_CLIPS) expect(importedMetaFor(south, c)).toBeUndefined();
  });
});
