/**
 * mind-prompt-builder.ts — builds the structured (tool-calling) prompt for
 * "Mind mode": generating one page of a mortal's mind as an infinite,
 * hyperlinked wiki.
 *
 * The capable tier calls emit_mind_page exactly once per page. The tool returns
 * { prose, links } where entity links must reference an id from the provided
 * candidate list (validated/degraded by mind-link-resolver), and concept links
 * are purely psychological nodes. The breadcrumb path is summarized to a bounded
 * tail so deep traversals stay cheap.
 */
import type { Entity, NpcProperties } from '@/core/types';
import type { LLMTool, LLMMessage } from '@/llm/llm-client';
import type { MindCandidate } from '@/llm/mind-link-resolver';

export interface MindPromptContext {
  npc: Entity;
  path: string[];
  candidates: MindCandidate[];
  depth: number;
}

export const MIND_PAGE_TOOL: LLMTool = {
  name: 'emit_mind_page',
  description: "Emit one page of a mortal's mind: short prose plus typed hyperlinks to drill deeper.",
  parameters: {
    type: 'object',
    properties: {
      prose: {
        type: 'string',
        description:
          "2-4 sentences of what occupies this node of the mortal's mind, in Pratchett-tinged prose. Respect known facts (name, role, real relationships, real recent events).",
      },
      links: {
        type: 'array',
        description: 'Hyperlinks the player can drill into.',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            kind: { type: 'string', enum: ['entity', 'concept'] },
            entityId: {
              type: 'string',
              description:
                'For kind=entity ONLY, the exact id from the provided candidate list. Omit for concept links.',
            },
          },
          required: ['label', 'kind'],
        },
      },
    },
    required: ['prose', 'links'],
  },
};

const MAX_PATH_SHOWN = 4;

export function buildMindPagePrompt(ctx: MindPromptContext): { messages: LLMMessage[]; tools: LLMTool[] } {
  const p = ctx.npc.properties as unknown as NpcProperties;
  const b = p.beliefs['player'] ?? { faith: 0, understanding: 0, devotion: 0 };

  const path =
    ctx.path.length > MAX_PATH_SHOWN
      ? [ctx.path[0], '…', ...ctx.path.slice(-(MAX_PATH_SHOWN - 1))]
      : ctx.path;

  const system = [
    "You generate one page of a mortal's mind as an infinite, hyperlinked wiki, for a god reading their thoughts.",
    "World: Terry Pratchett's Small Gods. Dreamlike but grounded in the mortal's real state.",
    'Call emit_mind_page exactly once. Entity links MUST use an id from the candidate list; for purely psychological nodes (fears, feelings, memories) use concept links with no id.',
  ].join(' ');

  const lines: string[] = [];
  lines.push(`Mortal: ${p.name}, a ${p.role}. Mood ${p.mood.toFixed(2)}; currently ${p.activity}.`);
  lines.push(`Faith in the reading god: ${b.faith.toFixed(2)} (understanding ${b.understanding.toFixed(2)}).`);
  lines.push(
    `Personality — assertiveness ${p.personality.assertiveness.toFixed(2)}, skepticism ${p.personality.skepticism.toFixed(2)}, piety ${p.personality.piety.toFixed(2)}, sociability ${p.personality.sociability.toFixed(2)}.`,
  );
  lines.push(`You are reading at this path through their mind: ${path.join(' ▸ ')}.`);
  if (ctx.depth === 0) lines.push('This is the SURFACE — the immediate, top-of-mind thoughts.');
  else lines.push(`This node is "${ctx.path[ctx.path.length - 1]}" — go deeper into exactly this facet.`);
  if (ctx.candidates.length) {
    lines.push('Real people/places you may link as entity links (use the exact id):');
    for (const c of ctx.candidates) lines.push(`  - ${c.label} [${c.kind}] id=${c.id}`);
  } else {
    lines.push('No real entities available to link here; use concept links only.');
  }
  lines.push('Emit the page now.');

  return {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: lines.join('\n') },
    ],
    tools: [MIND_PAGE_TOOL],
  };
}
