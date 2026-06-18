/**
 * editor-tools.ts — the editor (god-mode) verbs exposed as LLM tools.
 *
 * The capable tier (Create panel; later Fate) sends these to the model; the
 * model's tool calls become editor commands on the channel. Schemas are kept
 * here in the LLM layer (the sim registry stays LLM-free); a drift test ties
 * the set to the registry's editor-tier verbs so they can't diverge. Payload
 * shapes mirror the precondition/apply contracts in
 * src/sim/command/editor-verbs.ts.
 */
import type { LLMTool } from './llm-client';
import { CLIMATE_NAMES } from '@/terrain/climate';

const ROLES = ['priest', 'elder', 'farmer', 'merchant', 'soldier', 'noble', 'child', 'beggar'];
const ACTIVITIES = ['sleep', 'work', 'socialize', 'worship', 'idle', 'wander'];
const BELIEF = { type: 'number', minimum: 0, maximum: 1 } as const;
// The four NpcNeeds (each 0–1, higher = more satisfied); modifyApply applies any subset.
const NEEDS = {
  type: 'object',
  description: 'Partial needs override; any subset of the four needs.',
  properties: { safety: BELIEF, prosperity: BELIEF, community: BELIEF, meaning: BELIEF },
} as const;
const NEAR = {
  description: 'A settlement poiId (string) OR explicit {x,y} tile coordinates.',
  type: ['string', 'object'],
} as const;

export const EDITOR_TOOLS: LLMTool[] = [
  {
    name: 'author_spawn_npc',
    description: 'Spawn one or more NPCs near a settlement or coordinate. Use for "add N <role>s near <place>".',
    parameters: {
      type: 'object',
      properties: {
        role: { type: 'string', enum: ROLES, description: 'NPC role.' },
        count: { type: 'integer', minimum: 1, maximum: 20, description: 'How many to spawn (default 1).' },
        near: NEAR,
        name: { type: 'string', description: 'Optional name; random if omitted.' },
        faith: BELIEF, understanding: BELIEF, devotion: BELIEF,
      },
      required: ['role', 'near'],
    },
  },
  {
    name: 'author_remove_entity',
    description: 'Remove an entity by id, or all entities matching a {kind, role} filter. Use for "remove the beggars".',
    parameters: {
      type: 'object',
      properties: {
        entityId: { type: 'string', description: 'Exact entity id to remove.' },
        filter: {
          type: 'object',
          description: 'Remove all matches. Provide kind (e.g. "npc") and/or role.',
          properties: { kind: { type: 'string' }, role: { type: 'string', enum: ROLES } },
        },
      },
    },
  },
  {
    name: 'author_modify_npc',
    description: 'Change fields on an existing NPC (name, role, belief, mood, activity). Use for "make X a devout priest".',
    parameters: {
      type: 'object',
      properties: {
        entityId: { type: 'string', description: 'NPC entity id.' },
        set: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            role: { type: 'string', enum: ROLES },
            faith: BELIEF, understanding: BELIEF, devotion: BELIEF,
            mood: { type: 'number', minimum: 0, maximum: 1 },
            activity: { type: 'string', enum: ACTIVITIES },
            needs: NEEDS,
          },
        },
      },
      required: ['entityId', 'set'],
    },
  },
  {
    name: 'author_place_object',
    description: 'Place one or more world objects of a given entity-kind near a coordinate (e.g. a well, a tree).',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'Entity-kind id (e.g. "well", "oak_tree").' },
        x: { type: 'integer' }, y: { type: 'integer' },
        count: { type: 'integer', minimum: 1, maximum: 50 },
        scatterRadius: { type: 'integer', minimum: 1, maximum: 12 },
      },
      required: ['kind', 'x', 'y'],
    },
  },
  {
    name: 'author_move_entity',
    description: 'Move an entity to new tile coordinates (must be a realized, walkable tile).',
    parameters: {
      type: 'object',
      properties: {
        entityId: { type: 'string' },
        to: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, required: ['x', 'y'] },
      },
      required: ['entityId', 'to'],
    },
  },
  {
    name: 'author_set_climate',
    description:
      "Set the world's overall climate zone (the north-cold→south-warm temperature/moisture band). " +
      'Re-textures the whole world live: snow lines, mud, and aridity shift to match. Use for ' +
      '"make this an arctic world" / "warm it up to a mediterranean climate". For LOCAL cold/heat ' +
      '(a single ice field or volcano) place a glacier/mountain/volcano object instead — this verb is global.',
    parameters: {
      type: 'object',
      properties: {
        climate: {
          type: 'string', enum: [...CLIMATE_NAMES],
          description: 'Climate zone. european/temperate = default mild band; boreal/arctic = cold; mediterranean/tropical/arid = warm.',
        },
      },
      required: ['climate'],
    },
  },
];

export function editorToolList(): LLMTool[] {
  return EDITOR_TOOLS;
}
