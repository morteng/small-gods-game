/**
 * AI Map Generator Script
 *
 * Takes a segment color map and generates a painted version using various AI APIs.
 * Supports multiple providers with free tiers:
 * - Replicate (ControlNet)
 * - Fal.ai (ControlNet)
 * - Hugging Face Inference API
 * - Stability AI (if you have community license)
 */

// Provider configuration
interface ProviderConfig {
  name: string;
  apiKey: string;
  endpoint: string;
}

// Generation request
interface MapGenerationRequest {
  segmentMapBase64: string;  // PNG of segment color map
  skeletonMapBase64?: string; // Optional skeleton for depth
  width: number;
  height: number;
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  controlStrength?: number;
}

// Generation result
interface MapGenerationResult {
  success: boolean;
  imageBase64?: string;
  imageUrl?: string;
  error?: string;
  provider: string;
  generationTimeMs: number;
}

// =============================================================================
// REPLICATE PROVIDER
// =============================================================================

async function generateWithReplicate(
  request: MapGenerationRequest,
  apiKey: string
): Promise<MapGenerationResult> {
  const startTime = Date.now();

  try {
    // Replicate's ControlNet model for segmentation
    // https://replicate.com/jagilley/controlnet-seg
    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // ControlNet with segmentation conditioning
        version: 'jagilley/controlnet-seg:latest', // Update with actual version hash
        input: {
          image: `data:image/png;base64,${request.segmentMapBase64}`,
          prompt: request.prompt,
          negative_prompt: request.negativePrompt || 'blurry, low quality, distorted',
          num_inference_steps: 30,
          guidance_scale: 7.5,
          controlnet_conditioning_scale: request.controlStrength || 0.9,
          seed: request.seed || Math.floor(Math.random() * 1000000),
        },
      }),
    });

    const prediction = await response.json();

    // Poll for completion
    let result = prediction;
    while (result.status !== 'succeeded' && result.status !== 'failed') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const pollResponse = await fetch(result.urls.get, {
        headers: { 'Authorization': `Token ${apiKey}` },
      });
      result = await pollResponse.json();
    }

    if (result.status === 'succeeded') {
      return {
        success: true,
        imageUrl: result.output[0],
        provider: 'replicate',
        generationTimeMs: Date.now() - startTime,
      };
    } else {
      return {
        success: false,
        error: result.error || 'Generation failed',
        provider: 'replicate',
        generationTimeMs: Date.now() - startTime,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      provider: 'replicate',
      generationTimeMs: Date.now() - startTime,
    };
  }
}

// =============================================================================
// FAL.AI PROVIDER
// =============================================================================

async function generateWithFal(
  request: MapGenerationRequest,
  apiKey: string
): Promise<MapGenerationResult> {
  const startTime = Date.now();

  try {
    const response = await fetch('https://fal.run/fal-ai/controlnet-sdxl', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: request.prompt,
        negative_prompt: request.negativePrompt || 'blurry, low quality',
        control_image_url: `data:image/png;base64,${request.segmentMapBase64}`,
        controlnet_conditioning_scale: request.controlStrength || 0.85,
        guidance_scale: 7.5,
        num_inference_steps: 30,
        seed: request.seed,
        image_size: {
          width: request.width,
          height: request.height,
        },
      }),
    });

    const result = await response.json();

    if (result.images && result.images.length > 0) {
      return {
        success: true,
        imageUrl: result.images[0].url,
        provider: 'fal.ai',
        generationTimeMs: Date.now() - startTime,
      };
    } else {
      return {
        success: false,
        error: result.detail || 'No image generated',
        provider: 'fal.ai',
        generationTimeMs: Date.now() - startTime,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      provider: 'fal.ai',
      generationTimeMs: Date.now() - startTime,
    };
  }
}

// =============================================================================
// HUGGING FACE INFERENCE API
// =============================================================================

async function generateWithHuggingFace(
  request: MapGenerationRequest,
  apiKey: string
): Promise<MapGenerationResult> {
  const startTime = Date.now();

  try {
    // Using the ControlNet segmentation model
    const response = await fetch(
      'https://api-inference.huggingface.co/models/lllyasviel/sd-controlnet-seg',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: request.prompt,
          parameters: {
            negative_prompt: request.negativePrompt,
            num_inference_steps: 30,
            guidance_scale: 7.5,
          },
          // Note: HF Inference API has limited ControlNet support
          // May need to use Spaces API or Gradio client instead
        }),
      }
    );

    if (response.ok) {
      const blob = await response.blob();
      const buffer = await blob.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
      );

      return {
        success: true,
        imageBase64: base64,
        provider: 'huggingface',
        generationTimeMs: Date.now() - startTime,
      };
    } else {
      const error = await response.json();
      return {
        success: false,
        error: error.error || 'Generation failed',
        provider: 'huggingface',
        generationTimeMs: Date.now() - startTime,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      provider: 'huggingface',
      generationTimeMs: Date.now() - startTime,
    };
  }
}

// =============================================================================
// STABILITY AI PROVIDER
// =============================================================================

async function generateWithStability(
  request: MapGenerationRequest,
  apiKey: string
): Promise<MapGenerationResult> {
  const startTime = Date.now();

  try {
    // Stability AI's control API
    const formData = new FormData();
    formData.append('init_image', dataURItoBlob(`data:image/png;base64,${request.segmentMapBase64}`));
    formData.append('text_prompts[0][text]', request.prompt);
    formData.append('text_prompts[0][weight]', '1');
    if (request.negativePrompt) {
      formData.append('text_prompts[1][text]', request.negativePrompt);
      formData.append('text_prompts[1][weight]', '-1');
    }
    formData.append('cfg_scale', '7');
    formData.append('samples', '1');
    formData.append('steps', '30');
    if (request.seed) {
      formData.append('seed', request.seed.toString());
    }

    const response = await fetch(
      'https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/image-to-image',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
        },
        body: formData,
      }
    );

    const result = await response.json();

    if (result.artifacts && result.artifacts.length > 0) {
      return {
        success: true,
        imageBase64: result.artifacts[0].base64,
        provider: 'stability',
        generationTimeMs: Date.now() - startTime,
      };
    } else {
      return {
        success: false,
        error: result.message || 'No image generated',
        provider: 'stability',
        generationTimeMs: Date.now() - startTime,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      provider: 'stability',
      generationTimeMs: Date.now() - startTime,
    };
  }
}

// Helper to convert data URI to Blob
function dataURItoBlob(dataURI: string): Blob {
  const byteString = atob(dataURI.split(',')[1]);
  const mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mimeString });
}

// =============================================================================
// MAIN GENERATOR CLASS
// =============================================================================

type Provider = 'replicate' | 'fal' | 'huggingface' | 'stability';

export class AIMapGenerator {
  private providers: Map<Provider, string> = new Map();

  /**
   * Configure a provider with its API key
   */
  setProvider(provider: Provider, apiKey: string): void {
    this.providers.set(provider, apiKey);
  }

  /**
   * Get the default style prompt for fantasy isometric maps
   */
  static getDefaultPrompt(timeOfDay: 'dawn' | 'day' | 'dusk' | 'night' = 'day'): string {
    const timePrompts = {
      dawn: 'soft pink and orange sunrise lighting, morning mist, long shadows',
      day: 'bright daylight, clear sky, vibrant colors, sharp details',
      dusk: 'golden hour, purple and orange sunset, warm atmospheric lighting',
      night: 'moonlit scene, dark blue atmosphere, stars, warm torchlight from buildings',
    };

    return `Fantasy isometric world map, highly detailed painterly style,
      ${timePrompts[timeOfDay]},
      lush vegetation, crystal clear water, charming medieval village,
      cohesive art direction, professional game asset quality,
      consistent isometric perspective, rich textures,
      Studio Ghibli inspired, whimsical yet grounded`;
  }

  /**
   * Generate a painted map from a segment color map
   */
  async generate(
    request: MapGenerationRequest,
    preferredProvider?: Provider
  ): Promise<MapGenerationResult> {
    // Determine which provider to use
    const provider = preferredProvider || this.getFirstAvailableProvider();

    if (!provider) {
      return {
        success: false,
        error: 'No API providers configured. Call setProvider() first.',
        provider: 'none',
        generationTimeMs: 0,
      };
    }

    const apiKey = this.providers.get(provider);
    if (!apiKey) {
      return {
        success: false,
        error: `No API key configured for ${provider}`,
        provider,
        generationTimeMs: 0,
      };
    }

    // Add default prompt if not provided
    const fullRequest: MapGenerationRequest = {
      ...request,
      prompt: request.prompt || AIMapGenerator.getDefaultPrompt(),
      negativePrompt: request.negativePrompt ||
        'blurry, low quality, distorted, inconsistent style, modern elements, text, watermark',
    };

    // Call the appropriate provider
    switch (provider) {
      case 'replicate':
        return generateWithReplicate(fullRequest, apiKey);
      case 'fal':
        return generateWithFal(fullRequest, apiKey);
      case 'huggingface':
        return generateWithHuggingFace(fullRequest, apiKey);
      case 'stability':
        return generateWithStability(fullRequest, apiKey);
      default:
        return {
          success: false,
          error: `Unknown provider: ${provider}`,
          provider,
          generationTimeMs: 0,
        };
    }
  }

  private getFirstAvailableProvider(): Provider | null {
    for (const provider of ['fal', 'replicate', 'stability', 'huggingface'] as Provider[]) {
      if (this.providers.has(provider)) {
        return provider;
      }
    }
    return null;
  }
}

// =============================================================================
// EXAMPLE USAGE
// =============================================================================

/*
// Example: Generate a painted map

import { AIMapGenerator } from './ai-map-generator';

const generator = new AIMapGenerator();

// Configure with your API key (pick one)
generator.setProvider('fal', 'YOUR_FAL_API_KEY');
// generator.setProvider('replicate', 'YOUR_REPLICATE_API_KEY');
// generator.setProvider('huggingface', 'YOUR_HF_API_KEY');

// Your segment map as base64 PNG (from map-generator.html)
const segmentMapBase64 = '...';

const result = await generator.generate({
  segmentMapBase64,
  width: 512,
  height: 384,
  prompt: AIMapGenerator.getDefaultPrompt('dusk'),
  seed: 42,
  controlStrength: 0.85,
});

if (result.success) {
  console.log('Generated image:', result.imageUrl || result.imageBase64);
  console.log(`Generation took ${result.generationTimeMs}ms`);
} else {
  console.error('Generation failed:', result.error);
}
*/

// =============================================================================
// TILE COLOR REFERENCE (must match map-generator.html)
// =============================================================================

export const SEGMENT_COLORS = {
  deep_water:     '#0066CC',
  shallow_water:  '#4A90D9',
  grass:          '#7CCD7C',
  forest:         '#228B22',
  sand:           '#F4D03F',
  dirt_road:      '#8B7355',
  stone_road:     '#808080',
  building_wood:  '#DEB887',
  building_stone: '#A9A9A9',
} as const;

// Export for use in other modules
export type TileType = keyof typeof SEGMENT_COLORS;
