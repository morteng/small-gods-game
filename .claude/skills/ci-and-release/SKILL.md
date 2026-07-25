---
name: ci-and-release
description: Run tests or heavy asset jobs on the ephemeral Hetzner box, and cut a web or Linux-desktop release. Apply when running CI, generating assets off-machine, or publishing a build.
---

# CI, Build & Release

Nothing heavy runs on a paid GitHub runner or locally. Tests, big asset jobs, and the
desktop build all run on a **shared ephemeral Hetzner box `ci-eph`** (infra Phase 1,
Option A — the box is created on demand, all projects queue on it via a flock, and a
Mac-side launchd reaper destroys it when idle > 15 min so the hourly bill stops). No
Hetzner API token ever lives on the box; secrets are injected `--env-file` 0600 and
deleted the instant the run ends.

## Server CI

```bash
# Runs vitest in a node:22 container on ci-eph (node_modules persist, keyed on
# the package-lock hash; the runner is DETACHED so a dropped SSH keeps streaming):
./scripts/ci-on-server.sh                 # full vitest suite
./scripts/ci-on-server.sh --files="tests/unit/foo.test.ts"
./scripts/ci-on-server.sh --build         # tsc + vite build instead of tests
./scripts/ci-on-server.sh --clean         # remove the remote CI dir + exit
```

**GOTCHAs:**
- **Grep for `✓ Server CI passed` before pushing.** Never chain `; git push`.
- **Commit first** — the script archives `git archive HEAD`, so uncommitted work is invisible to it.
- Killing `ci-on-server.sh` leaves a **DETACHED runner** — `docker rm` it before re-running.

## Heavy asset / geometry generation

Too big for a 2-core Actions runner. `--out` tars the output dir back to the Mac (the
box gets reaped, so results MUST come home); `--env` injects keys (FAL_KEY, REPLICATE_*)
for the AI map/paint jobs:

```bash
./scripts/ci-on-server.sh --run="npx tsx scripts/barrier-world-preview.ts" --out=.dev-grabs
./scripts/ci-on-server.sh --run="node scripts/generate-painted-map.js …" --env=.env.assets
```

`scripts/_hcloud_ephemeral.sh` is the shared lifecycle lib — a **verbatim copy of the
canonical one in `pikkolo-cms-mvp/scripts/`** (both repos share the SAME `ci-eph` box +
queue lock `/tmp/hetzner-ci.lock`); keep the two in sync when the lifecycle changes.

## Two delivery surfaces

See [docs/RELEASING.md](../../../docs/RELEASING.md).

- **Web** — GitHub Pages, auto-deploys on every push to `main` via `.github/workflows/deploy.yml`.
  This is the **only** GitHub Actions we use (free for a public repo, zero-ops). Do NOT
  move it onto the box. `VITE_BASE=/small-gods-game/` for the Pages build.
- **Linux desktop** — Electron AppImage (bundles Chromium+Dawn → guaranteed WebGPU). Cut a
  release with `npm run release` (bumps + tags locally), `git push --follow-tags`, then
  **`./scripts/release-desktop.sh`**: it builds the AppImage on `ci-eph`
  (`--run="npm run dist:linux"`, `electron-builder --publish never` → no token on the box),
  fetches `release/*.AppImage` + `latest-linux.yml` back, and publishes to the GitHub
  Release from the Mac via `gh` (publish token stays local). Zero Actions minutes.
  `release.yml` is now a **manual `workflow_dispatch` break-glass only** — NOT tag-triggered,
  so a tag push never double-publishes alongside the local build.
