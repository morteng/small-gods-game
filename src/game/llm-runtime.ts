// LLM client wiring for the Game coordinator: the two client tiers (chat +
// capable) built from a provider config, and the paid image-generation options
// the generated-art sources share. Construction lives here so game.ts only
// owns the live fields; applyLlmConfig rebuilds through the same helpers.
import { LLMClient } from '@/llm/llm-client';
import {
  createProvider, loadProviderConfig, openrouterImageBaseUrl,
  replicateImageBaseUrl, replicateDeliveryBaseUrl, type ProviderConfig,
} from '@/llm/provider-factory';
import { generateBuildingImageAuto, BUILDING_IMAGE_MODEL } from '@/llm/building-image';
import type { CostTracker } from '@/llm/cost-tracker';

export const SESSION_CAP_USD = 2; // per-session live building-art spend cap

/** The chat-tier client for a config (cost-tracked). Throws on a bad config —
 *  callers decide the fallback (boot degrades to mock; applyLlmConfig keeps the
 *  previous client). */
export function buildChatClient(config: ProviderConfig, costTracker: CostTracker): LLMClient {
  return new LLMClient(createProvider(config), (r) => costTracker.record(r));
}

/** The Tier-2 "capable" client, or null when no capable model is configured. */
export function buildCapableClient(config: ProviderConfig, costTracker: CostTracker): LLMClient | null {
  return config.openrouterModelCapable
    ? new LLMClient(createProvider({
        ...config,
        openrouterModel: config.openrouterModelCapable,
        openrouterCostQualityTradeoff: config.openrouterCostQualityTradeoffCapable,
      }), (r) => costTracker.record(r))
    : null;
}

/** Boot both tiers from the stored provider config. A bad stored chat config
 *  falls back to mock. The capable (Tier-2) client is built at boot too —
 *  otherwise a returning, already-onboarded user whose stored config has a
 *  capable model boots with llmClientCapable === null and the Create panel
 *  stays dead until they re-save LLM settings. (applyLlmConfig rebuilds both
 *  on live config change.) */
export function bootLlmClients(costTracker: CostTracker): {
  config: ProviderConfig; client: LLMClient; capable: LLMClient | null;
} {
  const config = loadProviderConfig();
  let provider;
  try {
    provider = createProvider(config);
  } catch (err) {
    console.warn('[llm] stored provider config invalid, falling back to mock:', err);
    provider = createProvider({ type: 'mock' });
  }
  const client = new LLMClient(provider, (r) => costTracker.record(r));
  let capable: LLMClient | null = null;
  try {
    capable = buildCapableClient(config, costTracker);
  } catch (err) {
    console.warn('[llm] capable client not built at boot:', err);
  }
  return { config, client, capable };
}

/** The `enabled/canSpend/model/generate` head shared by both paid generated-art
 *  sources (building + flora): the session spend cap and the cost-tracked
 *  image call, wired once for both providers. */
export function paidArtGenOptions(deps: { enabled: () => boolean; costTracker: CostTracker }): {
  enabled: () => boolean;
  canSpend: () => boolean;
  model: () => string;
  generate: (initImageDataUri: string, prompt: string) => Promise<Blob>;
} {
  return {
    enabled: deps.enabled,
    canSpend: () => deps.costTracker.snapshot().sessionUsd < SESSION_CAP_USD,
    model: () => BUILDING_IMAGE_MODEL,
    generate: async (initImageDataUri, prompt) => {
      const cfg = loadProviderConfig();
      // Auto dispatch: qwen/* → Replicate (dev proxy injects the token; prod has
      // neither proxy nor key → typed error → grey-massing fallback), everything
      // else → OpenRouter. Both providers wired once here.
      const res = await generateBuildingImageAuto(
        { openrouter: { apiKey: cfg.openrouterApiKey ?? '', baseUrl: openrouterImageBaseUrl(),
            siteName: cfg.openrouterSiteName },
          replicate: { baseUrl: replicateImageBaseUrl(), deliveryBaseUrl: replicateDeliveryBaseUrl() } },
        { initImageDataUri, prompt, model: BUILDING_IMAGE_MODEL },
      );
      deps.costTracker.record({ cost: res.costUsd, cacheStatus: 'MISS' });
      return res.blob;
    },
  };
}
