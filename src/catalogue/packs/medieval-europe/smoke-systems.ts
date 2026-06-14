/**
 * medieval-europe pack — SMOKE SYSTEMS (the headline historical model).
 *
 * A hearth makes smoke; the smoke must escape; period + wealth decide HOW. The
 * real chain is: open smoke-hole → louver → smoke-hood → (late + elite only) wall
 * fireplace + chimney. **Early-medieval commoners have NO chimney** — that is an
 * upgrade that arrives late and rich (Conisbrough keep 1185; common in houses only
 * 16–17c). Each entry names the egress `fixtureType` that satisfies 'smoke-egress'.
 *
 * Array order = advancement (least → most evolved); the Slice-1 derivation picks
 * the most-advanced entry whose `(eras, wealth)` admits the build context.
 */
import type { Era, FactEntry, SmokeSystemFields } from '@/catalogue/types';

const s = (
  id: string,
  egressFixture: string,
  eras: Era[],
  l0: string,
  l1: string[],
  wealth?: string[],
): FactEntry<SmokeSystemFields> => ({
  id,
  kind: 'smokeSystem',
  pack: 'medieval-europe',
  lod: { l0, l1 },
  fields: wealth ? { egressFixture, eras, wealth } : { egressFixture, eras },
  visibility: 'geometry',
});

export const MEDIEVAL_SMOKE_SYSTEMS: FactEntry<SmokeSystemFields>[] = [
  s(
    'open-smoke-hole',
    'smoke-hole',
    ['primordial', 'ancient', 'classical', 'medieval'],
    'a bare hole in the roof apex — the oldest egress',
    ['gap in the ridge', 'smoke-blackened thatch', 'open to weather'],
  ),
  s(
    'louvered',
    'louver',
    ['medieval'],
    'a slatted ridge louver over the open hearth — the commoner default',
    ['raised ridge turret', 'angled slats', 'no chimney'],
  ),
  s(
    'smoke-hood',
    'smoke-hood',
    ['medieval'],
    'a timber-and-daub hood gathering smoke to a wall vent — the transition',
    ['canted hood', 'plastered breast', 'against a gable wall'],
    ['modest', 'comfortable', 'rich', 'opulent'],
  ),
  s(
    'wall-chimney',
    'wall-chimney',
    ['medieval', 'current'],
    'a masonry fireplace and flue — late, and at first only for the elite',
    ['stone chimney-breast', 'projecting stack', 'mantel'],
    ['rich', 'opulent'],
  ),
];
