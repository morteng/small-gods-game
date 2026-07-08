// scripts/tti-generate.ts
// The ONE text-to-image (TTI) call path + key resolution, factored out of tti-probe.ts so the
// dev-server reflib-sink plugin can drive a reference regen without importing the probe's heavy
// blueprint/compose deps. tti-probe.ts and bridge-preview.ts re-export these for back-compat.
import { readFileSync, existsSync } from 'node:fs';
import { defaultModalitiesFor, BUILDING_IMAGE_MODEL } from '../src/llm/openrouter-image-client';

/** Reference-library root (relative to repo root). */
export const REF = 'reference-library/tti';

// Default TTI model = the img2img model (cheap FLUX Klein) unless TTI_MODEL overrides. The studio
// regen picks its own model (default FLUX.2 Pro) per call; this default only drives the CLI probe.
export const TTI_MODEL = process.env.TTI_MODEL ?? BUILDING_IMAGE_MODEL;

/** OPENROUTER_API_KEY from the env, else parsed out of a gitignored .env (never logged). */
export function apiKey(): string | undefined {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  if (existsSync('.env')) {
    const m = /^OPENROUTER_API_KEY=(.+)$/m.exec(readFileSync('.env', 'utf8'));
    if (m) return m[1].trim();
  }
  return undefined;
}

/** Direct text-only OpenRouter image call (no init image) — the img2img client always attaches an
 *  image part, so TTI needs its own tiny request. Returns the PNG bytes + the billed cost. */
export async function generateTti(apiKey: string, prompt: string, model: string): Promise<{ buf: Buffer; cost: number }> {
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'http://localhost:3000', 'X-Title': 'Small Gods TTI Probe',
    },
    body: JSON.stringify({
      model, modalities: defaultModalitiesFor(model),
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const json = await resp.json() as {
    choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[];
    usage?: { cost?: number }; error?: { message?: string };
  };
  if (json.error) throw new Error(json.error.message ?? JSON.stringify(json.error));
  const uri = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!uri) throw new Error('no image in response (model returned text only)');
  const m = /^data:image\/\w+;base64,(.+)$/.exec(uri);
  if (!m) throw new Error('malformed data-URI in response');
  return { buf: Buffer.from(m[1], 'base64'), cost: json.usage?.cost ?? 0 };
}
