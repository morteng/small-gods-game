/**
 * OpenRouter Model Presets
 *
 * Popular models available through OpenRouter.
 * See https://openrouter.ai/models for the full list.
 */

export interface OpenRouterModelPreset {
  id: string;
  name: string;
  description: string;
  contextLength: number;
  pricing: {
    prompt: number; // USD per 1K tokens
    completion: number; // USD per 1K tokens
  };
  flags: string[]; // e.g., 'tool-calling', 'vision', 'reasoning'
}

export const OPENROUTER_MODELS: OpenRouterModelPreset[] = [
  // ─── Free / Very Cheap ───────────────────────────────────
  {
    id: 'google/gemini-flash-1.5',
    name: 'Gemini Flash 1.5',
    description: 'Fast, cheap, good for NPC dialogue',
    contextLength: 1000000,
    pricing: { prompt: 0, completion: 0 },
    flags: ['tool-calling', 'vision'],
  },
  {
    id: 'meta-llama/llama-3.2-1b-instruct:free',
    name: 'Llama 3.2 1B (Free)',
    description: 'Tiny, fast, free',
    contextLength: 8192,
    pricing: { prompt: 0, completion: 0 },
    flags: [],
  },
  {
    id: 'microsoft/phi-3-medium-128k-instruct:free',
    name: 'Phi-3 Medium (Free)',
    description: 'Good balance of speed and quality',
    contextLength: 128000,
    pricing: { prompt: 0, completion: 0 },
    flags: [],
  },

  // ─── Cheap Workhorses ────────────────────────────────────
  {
    id: 'openai/gpt-3.5-turbo',
    name: 'GPT-3.5 Turbo',
    description: 'Reliable, cheap, fast',
    contextLength: 16385,
    pricing: { prompt: 0.0005, completion: 0.0015 },
    flags: ['tool-calling'],
  },
  {
    id: 'anthropic/claude-3-haiku',
    name: 'Claude 3 Haiku',
    description: 'Fast, good for NPC backfill',
    contextLength: 200000,
    pricing: { prompt: 0.00025, completion: 0.00125 },
    flags: ['tool-calling', 'vision'],
  },
  {
    id: 'deepseek/deepseek-chat',
    name: 'DeepSeek V3',
    description: 'Great price/performance',
    contextLength: 65536,
    pricing: { prompt: 0.00014, completion: 0.00028 },
    flags: ['tool-calling'],
  },
  {
    id: 'google/gemini-pro-1.5',
    name: 'Gemini Pro 1.5',
    description: 'Large context, good for complex prompts',
    contextLength: 2000000,
    pricing: { prompt: 0.00125, completion: 0.00375 },
    flags: ['tool-calling', 'vision'],
  },

  // ─── Quality / Reasoning ─────────────────────────────────
  {
    id: 'deepseek/deepseek-r1',
    name: 'DeepSeek R1',
    description: 'Reasoning model - slower but thinks step-by-step',
    contextLength: 65536,
    pricing: { prompt: 0.00055, completion: 0.00219 },
    flags: ['tool-calling', 'reasoning'],
  },
  {
    id: 'anthropic/claude-3-sonnet',
    name: 'Claude 3 Sonnet',
    description: 'Balanced quality and speed',
    contextLength: 200000,
    pricing: { prompt: 0.003, completion: 0.015 },
    flags: ['tool-calling', 'vision'],
  },
  {
    id: 'openai/gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: 'Good balance for game NPCs',
    contextLength: 128000,
    pricing: { prompt: 0.00015, completion: 0.0006 },
    flags: ['tool-calling', 'vision'],
  },

  // ─── Premium ─────────────────────────────────────────────
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    description: 'Best for DM agent (Tier 2)',
    contextLength: 128000,
    pricing: { prompt: 0.005, completion: 0.015 },
    flags: ['tool-calling', 'vision'],
  },
  {
    id: 'anthropic/claude-3-opus',
    name: 'Claude 3 Opus',
    description: 'Highest quality, creative',
    contextLength: 200000,
    pricing: { prompt: 0.015, completion: 0.075 },
    flags: ['tool-calling', 'vision'],
  },
];

/**
 * Get a short pricing display string.
 */
export function formatPricing(model: OpenRouterModelPreset): string {
  if (model.pricing.prompt === 0 && model.pricing.completion === 0) {
    return 'Free';
  }
  return `$${model.pricing.prompt.toFixed(4)}/$${model.pricing.completion.toFixed(4)} per 1K`;
}

/**
 * Get models filtered by flag.
 */
export function getModelsByFlag(flag: string): OpenRouterModelPreset[] {
  return OPENROUTER_MODELS.filter(m => m.flags.includes(flag));
}

/**
 * Get a model by ID.
 */
export function getModelById(id: string): OpenRouterModelPreset | undefined {
  return OPENROUTER_MODELS.find(m => m.id === id);
}
