/**
 * The `'mock'` provider, made real: a `SpriteBackend` that never touches a
 * network and never spends anything.
 *
 * It exists so the gates and pipelines above the seam can be tested for what
 * they do with a result — a drifted silhouette, a refusal, a retry — instead of
 * against a live model. Capabilities are overridable so a test can also ask
 * "what does the pipeline do when the backend cannot seed?" without needing a
 * real provider that cannot.
 */
import {
  acceptJob,
  type SpriteBackend,
  type SpriteBackendCapabilities,
  type SpriteJob,
  type SpriteResult,
} from './backend';

/** A mock can do everything, so a default job passes through untouched and a
 *  test that wants a LIMITED backend states which limit it is exercising. */
export const MOCK_CAPABILITIES: SpriteBackendCapabilities = {
  init: 'optional',
  seed: true,
  size: true,
  denoise: true,
  negative: true,
  abort: true,
};

export interface MockBackendConfig {
  /** Narrow the mock's powers to exercise a capability mismatch. */
  capabilities?: Partial<SpriteBackendCapabilities>;
  model?: string;
  costUsd?: number;
  /** What to answer with. Defaults to a deterministic stand-in blob derived
   *  from the job, so two identical jobs give identical bytes. */
  respond?: (job: SpriteJob) => Blob | Promise<Blob>;
}

/** Deterministic, decodable-by-nobody stand-in bytes. Callers that need real
 *  pixels supply `respond`. */
function defaultRespond(job: SpriteJob): Blob {
  const tag = JSON.stringify({
    p: job.prompt,
    w: job.width ?? null,
    h: job.height ?? null,
    s: job.seed ?? null,
    i: job.init ? job.init.pngDataUri.length : 0,
    d: job.init?.denoise01 ?? null,
  });
  return new Blob([tag], { type: 'image/png' });
}

export interface MockSpriteBackend extends SpriteBackend {
  /** Every job this backend was asked to run, in order. */
  readonly calls: readonly SpriteJob[];
}

export function createMockBackend(cfg: MockBackendConfig = {}): MockSpriteBackend {
  const provider = 'mock' as const;
  const capabilities: SpriteBackendCapabilities = { ...MOCK_CAPABILITIES, ...cfg.capabilities };
  const model = cfg.model ?? 'mock';
  const respond = cfg.respond ?? defaultRespond;
  const calls: SpriteJob[] = [];
  return {
    provider,
    model,
    capabilities,
    calls,
    async generate(job: SpriteJob): Promise<SpriteResult> {
      const ignored = acceptJob(provider, capabilities, job);
      calls.push(job);
      return {
        blob: await respond(job),
        provider,
        model,
        costUsd: cfg.costUsd ?? 0,
        ignored,
      };
    },
  };
}
