export interface NpcTooltipInfo {
  name: string;
  role: string;
  mood: number;
}

function moodLabel(mood: number): string {
  if (mood >= 0.75) return 'content';
  if (mood >= 0.40) return 'uneasy';
  return 'miserable';
}

export function formatNpcTooltip(info: NpcTooltipInfo): string {
  return `${info.name} · ${info.role} · ${moodLabel(info.mood)}`;
}
