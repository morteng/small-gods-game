# Handoff: CI + geometry-seed perf on the 16-vCPU ci-eph box

**From:** Pikkolo session (2026-07-08). **For:** the small-gods coding agent.
**Why a handoff:** these changes belong in this repo with its own typecheck +
vitest run; the Pikkolo session shouldn't surgically edit small-gods code blind.

## Context

`scripts/ci-on-server.sh` sends all CI / build / asset jobs to the **shared
`ci-eph` Hetzner box**, which is now a dedicated **cx53 (16 vCPU / 32 GB)** —
but the knobs here are still tuned for the retired **shared 4-vCPU** box. On the
Hetzner graph the box sits at ~350 % CPU (≈3 of 16 cores) during a run because
the container is capped at 3 CPUs. Two independent things to fix, in priority
order.

---

## Part A — raise the container caps (do first; trivial, high value)

`scripts/ci-on-server.sh`. Docker `--cpus` is a **ceiling, not a reservation**,
so a value sized for the cx53 degrades safely to the box's own core count if the
ephemeral box falls back to cx43 (8 vCPU) / cx33 (4 vCPU). `-m` likewise only
matters if the workload actually reaches it; keep it within the cx43 (16 GB)
fallback and the workload (~2–4 GB) never will.

Changes:
- `WORKERS=3` → `WORKERS=8` (vitest `--maxWorkers`; multi-process = real parallelism)
- `CPUS=3` → `CPUS=11` (docker `--cpus` ceiling)
- both `-m 4g` sites (npm-ci run **and** the detached runner wrapper) → `-m 10g`
- update the two help-comment defaults (lines ~10–11: "default 3" → 8 / 11)
- the stale header comment "The box has 4 shared vCPUs and runs pikkolo
  production…" (lines ~26–30) is no longer true — CI runs on the dedicated
  ci-eph box, not the prod box. Reword to reflect the 16-vCPU dedicated box.

This directly speeds up **vitest** (`test` mode) and **`tsc + vite build`**
(`--build`), which parallelize across processes/threads.

**For reference**, the sibling Pikkolo repo shipped the equivalent change
(commit `ad9a00e`, "perf(ci): size CI containers for the dedicated 16-vCPU
ci-eph box"): ci-runner CPU 4→11, ci-db 3→4, xdist workers 8→10.

> ### ⚠️ Update 2026-07-08 — measured results from doing this on Pikkolo
>
> **The cap raise verifiably works, but "more cores = faster" is not automatic —
> measure, don't assume.** On Pikkolo's box after the bump:
> - Compute-heavy stages (deps install, lint, `tsc`/build, test *collection*)
>   **saturated all 11 cores** — the runner hit **1104% CPU**. So Part A is real
>   for those stages.
> - But the **test-execution phase plateaued at 100–240% CPU** on the 16-core
>   box, because Pikkolo's Python suite is **fixture/import-bound, not
>   CPU-bound** (measured: 79% of per-worker time is fixture setup, dominated by
>   per-worker module-import cost; DB work was <5%). Extra cores did little there.
>
> vitest uses **process-level** workers (not one shared JS thread like Python
> xdist over asyncio), so it *should* convert cores → speedup better than
> Pikkolo's suite did. But **verify it**: if small-gods' vitest phase is
> dominated by TS transform / module load rather than test bodies, raising
> `--maxWorkers` past the useful point just re-pays transform cost per worker
> (same failure mode Pikkolo hit at "10+ workers"). Sweep `WORKERS ∈ {6,8,10,12}`
> and keep the wall-time minimum rather than maxing it blindly.
>
> **How to confirm your `--cpus` actually took effect** (Pikkolo's did — this is
> how I checked):
> ```bash
> IP=$(hcloud server ip ci-eph)
> ssh -i ~/.ssh/hetzner_ed25519 root@$IP
>   docker ps --format '{{.Names}}' | grep runner            # find your runner
>   docker inspect -f '{{.HostConfig.NanoCpus}}' <runner>    # want 11000000000
>   docker stats --no-stream <runner>                        # want ~1100% mid-build
> ```
>
> **Shared-box safety is fine.** The box serialises project runners with `flock`
> — only ONE project's runner runs at a time (observed: smallgods-ci-runner
> started the instant Pikkolo's runner released). So sizing your runner at 11
> CPUs cannot collide with Pikkolo's 11 — they never run simultaneously. The
> only always-warm neighbours are lightweight support containers (redis/db/minio
> at <3% CPU). No need to under-size to "share."

---

## Part B — parallelize `scripts/seed-building-art.ts` (the real geometry win)

This is the batch img2img seeder. It's **network-bound** on the OpenRouter
img2img call (`generateBuildingImage`), so overlapping calls with bounded
concurrency is a genuine multi-x wall-time win (especially `--matrix`). The
current `main()` runs jobs in a strict sequential `for (const job of jobs)` loop.

**⚠️ Do NOT `Promise.all` it naively.** The current loop has correctness
properties that must survive:

1. **Incremental crash-safe manifest write** — `writeFile(MANIFEST, …)` after
   every job. Concurrent full-file rewrites will interleave and corrupt the
   JSON. → serialize writes behind a promise chain (at most one in flight, each
   a complete in-memory snapshot).
2. **Fatal abort** — on `BuildingImageError.fatal` (spend limit / bad key) the
   batch must stop scheduling new jobs (every later call would fail too).
   → an `aborted` flag the worker loop checks before pulling the next job;
   in-flight jobs drain.
3. **Per-job success tracking** — today it infers "did this job seed?" from
   `Object.keys(manifest.entries).length > had`, which is racy under
   concurrency. → have `seed`/`seedVariant`/`seedResolved` return
   `{ cost: number; seeded: boolean }` instead of `number`, and tally from that.

Suggested shape (worker-pool + write-chain):

```ts
const CONCURRENCY = Math.max(1, Number(process.env.SEED_CONCURRENCY) || 4); // conservative default; spend scales with this
let writeChain: Promise<void> = Promise.resolve();
const persist = () => (writeChain = writeChain.then(() =>
  writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')));

let cursor = 0, total = 0;
let aborted: BuildingImageError | null = null, stoppedAt: string | null = null;
const failed: string[] = [];
async function worker() {
  while (cursor < jobs.length && !aborted) {
    const job = jobs[cursor++];
    try {
      const { cost, seeded } = await job.run();   // run(): Promise<SeedResult>
      total += cost;
      if (plan) continue;
      if (seeded) await persist(); else failed.push(job.label);
    } catch (err) {
      if (err instanceof BuildingImageError && err.fatal) { aborted = err; stoppedAt = job.label; return; }
      throw err;
    }
  }
}
await Promise.all(Array.from({ length: plan ? 1 : Math.min(CONCURRENCY, jobs.length) }, worker));
await writeChain; // flush the last queued write
```

Notes:
- Keep `--plan` serial (concurrency 1) for readable, ordered dry-run output.
- **Cost sensitivity (important — Morten is strict about paid-API spend).**
  Concurrency multiplies the *spend rate*, not the total: N concurrent img2img
  calls burn the same budget N× faster. Default to a **conservative `4`** (not 6),
  env-tunable via `SEED_CONCURRENCY`, and make sure the existing
  `BuildingImageError.fatal` spend-limit abort still fires promptly under
  concurrency (it's the hard stop). If OpenRouter 429s, lower the dial. Do NOT
  raise the default without a per-run cost ceiling.
- **Never wire this paid seeder into a default/everyday CI path.** It stays a
  deliberate, manually-invoked script. (Lesson from the sibling repo this session:
  Pikkolo had real-LLM eval bundled into its `--full` CI gate — it billed money on
  every run, was network-bound, and flaked on provider drift. We removed it and
  made LLM stages strictly opt-in. Apply the same rule here: paid/LLM steps are
  opt-in, never in the default gate.)
- Per-file PNG writes already use unique names (`safeName(key)`), so those don't
  race — only the single shared `manifest.json` write needs the chain.

**Validate:** `--plan` dry-run (no API/spend) to confirm the runner + tally
still work, then `npm run test` + `tsc` for the return-type refactor.

---

## What NOT to do — the preview scripts won't benefit from naive concurrency

`scripts/building-preview.ts` and `scripts/assetgen-preview.ts` are **pure local
render** — `composeStructure(toGeometry(rb))`, which is **Manifold WASM CSG on a
single JS thread** (it already `Promise.all`s parts *within* one building).
Wrapping their outer preset loops in `Promise.all` gives **no real speedup** —
Node runs one JS thread and the WASM ops are synchronous. Making those actually
use cores needs **`worker_threads`** (one worker per preset), a much bigger
change. Leave them sequential unless you specifically want the worker-pool
rewrite — flag it back to Morten as its own task.

---

> **ARCHIVED 2026-07-13 — fully actioned.** Part A (container sizing) shipped 2026-07-08;
> Part B (seeder worker pool) turned out to be ALREADY SHIPPED on main in `75443fc` and
> adapted by the Qwen/Replicate adoption (`4e48973`) — re-verified property-by-property
> (serialized manifest write-chain, fatal abort drains in-flight, per-job SeedOutcome
> tally) with a token-stripped `--plan` dry run (zero network, zero spend).
