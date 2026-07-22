/**
 * mind-card.ts — the read-only "mind" card the PROBE MIND affordance opens.
 *
 * B (mind-reading): a declarative `UiSpec` built straight from an npc
 * `InspectorView` (plain sim data), so it stands on its own with NO LLM — the
 * soul's current thought (deterministic `describeThought`, already on the view),
 * the belief they hold in YOU, and what they remember of you. When a capable model
 * IS configured, the coordinator warms a richer read (`openMindPage`) and passes
 * its `prose` in to replace the opening line — the same Structure-vs-Prose split
 * every card in this codebase uses (the card is valid and useful either way).
 *
 * Pure + deterministic (no world/LLM deps) → trivially testable, like whisper-card.
 */
import type { UiSpec, UiSpecBlock } from '@/story/uispec';
import { validateUiSpec } from '@/story/uispec';
import type { InspectorView } from '@/game/game-query';

const BELIEF_LABELS = new Set(['Faith', 'Understanding', 'Devotion']);

/**
 * Build the mind card from an npc `InspectorView`. `prose` (when present) is the
 * LLM-warmed read that replaces the deterministic thought as the opening line.
 * Returns null for a non-npc view. Block order is chosen so the no-scroll budget
 * (6 blocks) keeps the thought, all three belief bars, and up to two memories.
 */
export function buildMindCard(view: InspectorView, prose?: string): UiSpec | null {
  if (view.kind !== 'npc') return null;
  const body: UiSpecBlock[] = [];

  const opening = (prose && prose.trim()) || view.thought;
  if (opening) body.push({ kind: 'paragraph', text: opening });

  // What they believe YOU are — the three belief axes lead (their state toward you).
  for (const b of view.state) {
    if (BELIEF_LABELS.has(b.label)) body.push({ kind: 'beliefBar', label: b.label, value: b.value });
  }

  // What they remember of you — a couple of the most salient interaction memories.
  for (const m of (view.memories ?? []).slice(0, 2)) body.push({ kind: 'omen', text: m.summary });

  return validateUiSpec({ title: view.title, body, choices: [] });
}
