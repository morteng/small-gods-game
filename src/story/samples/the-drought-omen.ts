/**
 * Sample story pack — "The Drought Omen".
 *
 * The FIRST PROOF: a hand-authored pack (no AI involved) that exercises every IR
 * node — say / pick / AI-optional slot / if / guarded choice / set / do(effect) /
 * goto / end — plus preconditions, `chance`, and `$interpolation`. It plays fully
 * on the dumb director, proving the no-key path end to end. The Fate director can
 * later draw the same storylets from the reservoir and rewrite the `enrich` slots.
 *
 * Themed to Small Gods: a small god, a parched village, an elder's prayer, and the
 * belief that flows from how the god answers (effects route to bus verbs).
 */
import type { StoryPack } from '../story-ir';
import { STORY_IR_VERSION } from '../story-ir';

export const droughtOmenPack: StoryPack = {
  id: 'the-drought-omen',
  title: 'The Drought Omen',
  version: STORY_IR_VERSION,
  state: {
    'elder.name': 'Brother Nhumrod',
    'elder.faith': 2,
    drought: true,
    omenSent: false,
  },
  storylets: [
    {
      id: 'parched-prayer',
      title: "The elder's prayer",
      when: [{ var: 'drought' }, { op: '<', l: { var: 'elder.faith' }, r: 5 }],
      priority: 10,
      once: true,
      body: [
        {
          t: 'say',
          who: null,
          text: { pick: [
            'The wells are cracked mud. Heat shimmers over the dead barley.',
            'Three months without rain. The river is a thread of silver in a bed of bone.',
          ] },
        },
        {
          t: 'say',
          who: 'elder.name',
          tags: ['weary'],
          text: {
            fallback: 'If you are there at all, send me a sign. Any sign.',
            enrich: {
              slotId: 'parched-prayer/plea',
              prompt: "A doubting elder's half-hoped prayer in a drought; 1–2 sentences.",
              exemplars: ['If you are there at all, send me a sign. Any sign.'],
            },
          },
        },
        {
          t: 'choice',
          options: [
            {
              text: 'Send an omen — clouds gathering on the ridge',
              body: [
                { t: 'set', target: 'omenSent', op: '=', value: true },
                { t: 'do', effect: { verb: 'omen', args: { subject: 'elder', kind: 'clouds' } } },
                { t: 'goto', storylet: 'the-answer' },
              ],
            },
            {
              text: 'Whisper into his dream instead',
              when: { op: '>=', l: { var: 'elder.faith' }, r: 2 },
              body: [
                { t: 'do', effect: { verb: 'whisper', args: { subject: 'elder', tone: 'gentle' } } },
                { t: 'goto', storylet: 'the-answer' },
              ],
            },
            {
              text: 'Stay silent. Belief untested is belief unspent.',
              body: [
                { t: 'say', who: null, text: 'You hold your breath. The heat presses on.' },
                { t: 'end' },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'the-answer',
      title: 'The answer lands',
      body: [
        {
          t: 'if',
          branches: [
            {
              when: { var: 'omenSent' },
              body: [
                { t: 'say', who: null, text: 'A bruise of cloud crests the ridge. $elder.name stares, mouth open.' },
                { t: 'say', who: 'elder.name', tags: ['awed'], text: 'You... you heard me.' },
                { t: 'set', target: 'elder.faith', op: '+=', value: 2 },
              ],
            },
            {
              // else: the dream path
              body: [
                { t: 'say', who: null, text: '$elder.name wakes before dawn with a certainty he cannot name.' },
                { t: 'set', target: 'elder.faith', op: '+=', value: 1 },
              ],
            },
          ],
        },
        {
          t: 'if',
          branches: [
            {
              when: { chance: 2 },
              body: [{ t: 'say', who: null, text: 'He tells no one. Some signs are kept like coals.' }],
            },
            {
              body: [{ t: 'say', who: null, text: 'By noon the whole village has heard. Faith, it seems, is contagious.' }],
            },
          ],
        },
        { t: 'do', effect: { verb: 'grant_belief', args: { subject: 'elder', amount: 1 } } },
        { t: 'end' },
      ],
    },
  ],
};
