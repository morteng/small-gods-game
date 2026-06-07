/**
 * describeForHuman — renders an AssetBrief to readable lore for the inspector.
 *
 * This is the SAME content the PromptCompiler encodes (subject, materials,
 * roof, door face), which is the tri-alignment guarantee: description ↔ prompt
 * ↔ image cannot drift because all three derive from one brief. Pure/total.
 */
import type { AssetBrief, DoorFace } from './asset-brief';

// Screen-relative, matching the compiler's door phrasing (there's no world
// compass — a face is just a footprint edge, and in iso `s` is the front-left
// wall, `e` the front-right). Keeps description ↔ prompt aligned on the door.
const FACE_WORD: Record<DoorFace, string> = {
  n: 'rear-right', e: 'front-right', s: 'front-left', w: 'rear-left',
};

/** "a, b and c" */
function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function describeForHuman(brief: AssetBrief): string {
  const lead = brief.traits.length ? `${brief.traits.join(', ')} ` : '';
  let s = `A ${lead}${brief.subject}`;

  const wall = brief.materials.find((m) => m.part === 'walls');
  const roof = brief.materials.find((m) => m.part === 'roof');
  const ground = brief.materials.find((m) => m.part === 'ground');
  const mats: string[] = [];
  if (wall) mats.push(`${wall.material} walls`);
  if (roof) mats.push(`a ${roof.material} roof`);
  if (ground) mats.push(`${ground.material} ground`);
  if (mats.length) s += ` with ${joinList(mats)}`;

  if (brief.door) s += `; its door is on the ${FACE_WORD[brief.door.face]} wall`;
  return `${s}.`;
}
