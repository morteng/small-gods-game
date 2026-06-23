# Releasing Small Gods

Two delivery surfaces, deliberately kept cheap on CI:

| Surface | What | How it ships |
| --- | --- | --- |
| **Web (dev build)** | The live WebGPU game | GitHub Pages, auto-deploys on every push to `main` (`deploy.yml`) — unchanged |
| **Linux desktop** | Electron AppImage bundling Chromium+Dawn → **guaranteed WebGPU** even for users whose browser/system lacks it | Built once per `v*` tag (`release.yml`), uploaded to a GitHub Release + itch.io |

> **Why Electron, not the `src-tauri/` scaffold?** Tauri uses the system webview
> (webkit2gtk on Linux), which doesn't ship WebGPU on stock distros — so it can't reach
> the exact audience this binary is for. Electron carries its own modern WebGPU runtime.
> The Tauri scaffold is parked (it *can* do WebGPU on Windows, where the webview is
> Chromium — a possible future target).

## Versioning

SemVer, driven from [Conventional Commits](https://www.conventionalcommits.org) — which
this repo already uses (`feat(...)`, `fix(...)`, `refactor(...)`). Version bumps and the
changelog happen **locally** (zero CI cost) via
[commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version).

This is the app version (`package.json`), separate from the content gates
`ART_RECIPE_VERSION` / `WORLD_CONTENT_VERSION`. Pre-1.0, so minor bumps may break.

## Cutting a release

```bash
# 1. From a clean main, decide the bump automatically from commit history:
npm run release                 # 0.1.0 → 0.2.0 (feat) / 0.1.1 (fix); writes CHANGELOG, tags vX.Y.Z
#   or force one:
npm run release -- --release-as 0.2.0
#   first ever tag (keep 0.1.0, just tag + changelog):
npm run release -- --first-release

# 2. Push the commit AND the tag. The tag is what triggers the build.
git push --follow-tags origin main
```

Pushing the `v*` tag fires `release.yml` on `ubuntu-latest`: it runs `npm run dist:linux`
(`tsc` → `vite build` with `VITE_BASE=/` → `electron-builder --linux AppImage`), attaches
`release/small-gods-<version>-x64.AppImage` **and `release/latest-linux.yml`** to a GitHub
Release, and — once itch is wired — pushes the AppImage to itch.io.

## Self-update (desktop)

The desktop app updates itself, no store required:

- **itch.io installs** are updated by the **itch desktop app** automatically (delta patches).
  Nothing in our code is involved.
- **Direct AppImage downloads** self-update via
  [`electron-updater`](https://www.electron.build/auto-update). On launch the packaged app
  reads `latest-linux.yml` off the **latest GitHub Release** (the feed baked in from
  `build.publish` in `package.json`), downloads a newer AppImage in the background, and
  prompts *"Update ready — Restart now / Later"*. The two mechanisms coexist; on an itch
  install the in-app updater simply finds nothing to do.

It only runs in a packaged AppImage (`app.isPackaged && $APPIMAGE`) — `electron:preview` and
the dev server skip it — and a dead/unreachable feed is logged, never fatal to launch.

> **This ties the update feed to *public* GitHub Releases.** electron-updater fetches the
> release asset anonymously, so the assets must be downloadable without auth. If you take the
> source repo private (below), move releases to a **public** repo and repoint `build.publish`
> `owner`/`repo` there — the split-repo path already covers this. itch-app users are
> unaffected either way.

## Local desktop testing (macOS dev box)

AppImages must be built on Linux, but you can run the Electron shell locally:

```bash
npm run dev            # terminal 1: Vite dev server on :3000
npm run electron:dev   # terminal 2: Electron window against the dev server (real WebGPU)

# or exercise the packaged path (custom app:// protocol over the prod build):
npm run electron:preview
```

## One-time itch.io setup

The workflow auto-skips itch until both of these exist; the GitHub Release still happens.

1. Create the game + a Linux channel on itch.io.
2. Repo **variable** `ITCH_TARGET` = `<itch-user>/<game>:linux`
   (`gh variable set ITCH_TARGET -b 'morteng/small-gods:linux'`).
3. Repo **secret** `BUTLER_API_KEY` from <https://itch.io/user/settings/api-keys>
   (`gh secret set BUTLER_API_KEY`).

## Source privacy (deferred decision)

Going private hides the TS source, git history, and `docs/` — not the running bundle (a
client-side game ships its logic to the browser regardless; prod source maps are already
off, `VITE_SOURCEMAP=1` to opt back in). When you choose a path:

- **GitHub Pro** (~$4/mo): repo private, Pages keeps serving — fewest moving parts.
- **Split repos**: private source + a public repo owning the Pages site (free).
- itch.io download stays public either way (it's external), so private source does **not**
  block desktop distribution.
