import type { System, SystemContext } from '@/core/scheduler';
import type { SerializableSystem } from '@/core/system-state';
import { tickNpcEntity } from '@/sim/npc-sim';
import { forEachNpc, npcProps, rememberEvent } from '@/world/npc-helpers';

/** Rebuild a Map from a serialized entries array, tolerating undefined / old
 *  saves / foreign shapes (→ empty map). Values are passed through untouched so
 *  the dump stays shape-tolerant if the side representation evolves. */
function mapFromEntries<V>(raw: unknown): Map<string, V> {
  const out = new Map<string, V>();
  if (!Array.isArray(raw)) return out;
  for (const entry of raw) {
    if (Array.isArray(entry) && typeof entry[0] === 'string') {
      out.set(entry[0], entry[1] as V);
    }
  }
  return out;
}

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

export class NpcSimSystem implements System, SerializableSystem {
  readonly name = 'npc_sim';
  readonly tickHz = 1;
  // Track last side per (npcId, spiritId) and (npcId) for moods
  private beliefSides = new Map<string, Side>();   // key = `${npcId}:${spiritId}`
  private moodSides = new Map<string, Side>();     // key = npcId

  /** WP-D scrub-ghost pattern: edge-detection sides are sim truth (they decide
   *  whether a belief_cross/mood_cross fires) — serialize them so a restore
   *  neither re-fires edges from before the snapshot nor suppresses edges that
   *  fired only in a discarded future. Values are dumped as-is (shape-tolerant:
   *  whatever the side maps hold rides through the snapshot untouched). */
  serialize(): unknown {
    return { beliefSides: [...this.beliefSides], moodSides: [...this.moodSides] };
  }

  hydrate(state: unknown): void {
    const s = state as { beliefSides?: unknown; moodSides?: unknown } | undefined;
    this.beliefSides = mapFromEntries<Side>(s?.beliefSides);
    this.moodSides = mapFromEntries<Side>(s?.moodSides);
  }

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
          const appended = ctx.log.append({ type: 'belief_cross', npcId: e.id, spiritId: sid, kind: cur, faith: b.faith });
          // Their own faith turning is a memory they carry (WP-C).
          rememberEvent(props, appended.id);
        }
        this.beliefSides.set(key, cur);
      }

      const mc = moodSide(props.mood);
      if (preMoodSide !== mc && mc !== 'mid') {
        const appended = ctx.log.append({ type: 'mood_cross', npcId: e.id, kind: mc, mood: props.mood });
        rememberEvent(props, appended.id);
      }
      this.moodSides.set(e.id, mc);
    });
  }
}
