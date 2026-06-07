/** Isolate which argument triggers Google's 400. Tries configs in order, prints status. */
import { request } from 'node:https';
const apiKey = process.env.OPENROUTER_API_KEY!;
const MODEL = 'google/gemini-3.1-flash-image-preview';

function post(payload: unknown): Promise<{ status: number; ok: boolean; note: string }> {
  const body = JSON.stringify(payload);
  return new Promise((resolve) => {
    const req = request('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      const ch: Buffer[] = [];
      res.on('data', (c) => ch.push(c));
      res.on('end', () => {
        const t = Buffer.concat(ch).toString('utf8');
        const status = res.statusCode ?? 0;
        let note = '';
        try {
          const j = JSON.parse(t);
          const hasImg = !!j?.choices?.[0]?.message?.images?.[0];
          note = status < 400 ? (hasImg ? 'IMAGE OK' : 'no image: ' + JSON.stringify(j).slice(0, 160)) : (j?.error?.message || t.slice(0, 160));
        } catch { note = t.slice(0, 160); }
        resolve({ status, ok: status < 400, note });
      });
    });
    req.on('error', (e) => resolve({ status: 0, ok: false, note: String(e) }));
    req.setTimeout(180_000, () => req.destroy(new Error('timeout')));
    req.write(body); req.end();
  });
}

const msg = [{ role: 'user', content: 'Pixel art isometric small medieval cottage, transparent background, game asset' }];
const cases: Array<[string, any]> = [
  ['bare+modalities', { model: MODEL, messages: msg, modalities: ['image', 'text'] }],
  ['no modalities', { model: MODEL, messages: msg }],
  ['ic aspect only', { model: MODEL, messages: msg, modalities: ['image', 'text'], image_config: { aspect_ratio: '1:1' } }],
  ['ic size 1K', { model: MODEL, messages: msg, modalities: ['image', 'text'], image_config: { image_size: '1K' } }],
  ['ic size 0.5K', { model: MODEL, messages: msg, modalities: ['image', 'text'], image_config: { image_size: '0.5K' } }],
];

for (const [label, payload] of cases) {
  const r = await post(payload);
  console.log(`${label.padEnd(18)} → ${r.status} ${r.ok ? '✓' : '✗'}  ${r.note}`);
}
