// img2img building-sprite generation via an OpenRouter image model. Mirrors the
// text OpenRouterProvider's request/header shape (see llm-client.ts), but sends
// an image_url init part + modalities:['image','text'] and parses the image out
// of choices[0].message.images. Never used in tests against the real API.

export const BUILDING_IMAGE_MODEL = 'google/gemini-2.5-flash-image';

export interface BuildingImageClientConfig {
  apiKey: string;
  baseUrl?: string;   // dev → '/api/llm/openrouter/api/v1'; prod → undefined (direct)
  siteUrl?: string;
  siteName?: string;
}

export interface GenerateBuildingImageOpts {
  initImageDataUri: string; // 'data:image/png;base64,...'
  prompt: string;
  signal?: AbortSignal;
}

export interface BuildingImageResult { blob: Blob; costUsd: number }

function dataUriToBlob(uri: string): Blob {
  const m = /^data:(image\/\w+);base64,(.+)$/.exec(uri);
  if (!m) throw new Error('building image: malformed data-URI in response');
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

export async function generateBuildingImage(
  cfg: BuildingImageClientConfig,
  opts: GenerateBuildingImageOpts,
): Promise<BuildingImageResult> {
  const url = `${cfg.baseUrl ?? 'https://openrouter.ai/api/v1'}/chat/completions`;
  const body = {
    model: BUILDING_IMAGE_MODEL,
    modalities: ['image', 'text'],
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: opts.prompt },
        { type: 'image_url', image_url: { url: opts.initImageDataUri } },
      ],
    }],
  };
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${cfg.apiKey}`,
    'HTTP-Referer': cfg.siteUrl ?? (typeof window !== 'undefined' ? window.location?.href : '') ?? 'http://localhost:3000',
    'X-Title': cfg.siteName ?? 'Small Gods Game',
  };

  const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: opts.signal });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`building image: HTTP ${resp.status} ${txt.slice(0, 200)}`);
  }
  const json = await resp.json() as {
    choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[];
    usage?: { cost?: number };
  };
  const imgUri = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!imgUri) throw new Error('building image: response contained no image');
  return { blob: dataUriToBlob(imgUri), costUsd: json.usage?.cost ?? 0 };
}
