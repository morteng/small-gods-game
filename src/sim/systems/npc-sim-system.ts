import type { System, SystemContext } from '@/core/scheduler';
import { tickNpcEntity } from '@/sim/npc-sim';
import { forEachNpc, npcProps } from '@/world/npc-helpers';

const BELIEF_HIGH = 0.6;
const BELIEF_LOW = 0.3;
const MOOD_HIGH = 0.7;
const MOOD_LOW = 0.3;

type Side = 'high' | 'mid' | 'low';

function beliefSide(faith: number): Side {
  if (faith >= BELIEF_HIGH) return 'high';
  if (faith <= BELIEF_LOW) return 'low';
  return 'mid';
}
function moodSide(mood: number): Side {
  if (mood >= MOOD_HIGH) return 'high';
  if (mood <= MOOD_LOW) return 'low';
  return 'mid';
}

export class NpcSimSystem implements System {
  readonly name = 'npc_sim';
  readonly tickHz = 1;
  // Track last side per (npcId, spiritId) and (npcId) for moods
  private beliefSides = new Map<string, Side>();   // key = `${npcId}:${spiritId}`
  private moodSides = new Map<string, Side>();     // key = npcId

  tick(ctx: SystemContext): void {
    forEachNpc(ctx.world, (e) => {
      const props = npcProps(e);

      // Capture belief and mood sides BEFORE ticking so that manual pre-tick
      // mutations (e.g. in tests) are also detected as crossings.
      // First encounter defaults to 'mid' so any extreme value triggers a crossing.
      const preBeliefSides: Record<string, Side> = {};
      for (const sid of Object.keys(props.beliefs)) {
        const key = `${e.id}:${sid}`;
        preBeliefSides[key] = this.beliefSides.get(key) ?? 'mid';
      }
      const preMoodSide: Side = this.moodSides.get(e.id) ?? 'mid';

      tickNpcEntity(e);

      for (const [sid, b] of Object.entries(props.beliefs)) {
        const key = `${e.id}:${sid}`;
        const prev = preBeliefSides[key];
        const cur = beliefSide(b.faith);
        if (prev !== cur && cur !== 'mid') {
          ctx.log.append({ type: 'belief_cross', npcId: e.id, spiritId: sid, kind: cur, faith: b.faith });
        }
        this.beliefSides.set(key, cur);
      }

      const mc = moodSide(props.mood);
      if (preMoodSide !== mc && mc !== 'mid') {
        ctx.log.append({ type: 'mood_cross', npcId: e.id, kind: mc, mood: props.mood });
      }
      this.moodSides.set(e.id, mc);
    });
  }
}
