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
import type { UiSpec, UiSpecBlock, CloudToken } from '@/story/uispec';
import { validateUiSpec } from '@/story/uispec';
import type { InspectorView } from '@/game/game-query';

const BELIEF_LABELS = new Set(['Faith', 'Understanding', 'Devotion']);

/** The four needs, whose LOUDNESS (1 - satisfaction) is what preoccupies a soul —
 *  a starving want is a loud thought, a met one barely registers. */
const NEED_LABELS = new Set(['Safety', 'Prosperity', 'Community', 'Meaning']);

/** Below this loudness a need is basically met — leave it out of the cloud so the
 *  gestalt shows what actually weighs on them, not four faint always-there words. */
const NEED_FLOOR = 0.15;

/**
 * Turn an npc `InspectorView` into the weighted words of its mind (B — the
 * gestalt "second face" of PROBE MIND). Every token is a real sim number:
 *   • needs → loudness = 1 - satisfaction (only the ones that actually grind);
 *   • domains → what they believe YOU command, sized by conviction;
 *   • memories → what they remember of you, sized by salience;
 *   • relationships → who they trust, sized by trust.
 * Pure + deterministic; the renderer lays them out (see mind-cloud-layout).
 */
export function buildMindCloudTokens(view: InspectorView): CloudToken[] {
  const tokens: CloudToken[] = [];

  for (const b of view.state) {
    if (!NEED_LABELS.has(b.label)) continue;
    const loud = 1 - b.value;
    if (loud > NEED_FLOOR) tokens.push({ text: b.label.toUpperCase(), weight: loud, tone: 'need' });
  }
  for (const d of view.domains) {
    if (d.value > 0) tokens.push({ text: d.label.toUpperCase(), weight: d.value, tone: 'divine' });
  }
  for (const m of view.memories ?? []) {
    tokens.push({ text: m.summary.toUpperCase(), weight: m.salience, tone: 'memory' });
  }
  for (const r of view.relationships ?? []) {
    tokens.push({ text: r.name.toUpperCase(), weight: r.trust, tone: 'person' });
  }

  // Loudest first, capped — the validator enforces the hard cap too, but sorting
  // here means the cap keeps the MOST salient words, not an arbitrary slice.
  return tokens
    .sort((a, b) => b.weight - a.weight || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0))
    .slice(0, 16);
}

/**
 * Build the mind card from an npc `InspectorView`. `prose` (when present) is the
 * LLM-warmed read that replaces the deterministic thought as the opening line.
 * Returns null for a non-npc view.
 *
 * This is the GESTALT face of PROBE MIND: the soul's own thought, then its
 * preoccupations as one weighted cloud (size = the sim's real numbers). The exact
 * scalars — Faith/Understanding/Devotion, per-domain conviction, the full memory
 * ring — live numerically in the inspector panel beside it; the card doesn't
 * repeat them, it shows the shape. When the cloud has no words (a blank soul with
 * no needs, beliefs, memories or ties), fall back to the old belief-bar readout so
 * the card is never empty.
 */
export function buildMindCard(view: InspectorView, prose?: string): UiSpec | null {
  if (view.kind !== 'npc') return null;
  const body: UiSpecBlock[] = [];

  const opening = (prose && prose.trim()) || view.thought;
  if (opening) body.push({ kind: 'paragraph', text: opening });

  const tokens = buildMindCloudTokens(view);
  if (tokens.length > 0) {
    body.push({ kind: 'wordCloud', tokens });
  } else {
    // Degenerate soul — no cloud to show; keep the card useful with the belief bars.
    for (const b of view.state) {
      if (BELIEF_LABELS.has(b.label)) body.push({ kind: 'beliefBar', label: b.label, value: b.value });
    }
  }

  return validateUiSpec({ title: view.title, body, choices: [] });
}
