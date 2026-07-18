# Releasing Small Gods

Two delivery surfaces, deliberately kept cheap on CI:

| Surface | What | How it ships |
| --- | --- | --- |
| **Web (dev build)** | The live WebGPU game | GitHub Pages, auto-deploys on every push to `main` (`deploy.yml`) — unchanged |
| **Linux desktop** | Electron AppImage bundling Chromium+Dawn → **guaranteed WebGPU** even for users whose browser/system lacks it | Built on the shared `ci-eph` box, published from the Mac via `scripts/release-desktop.sh` (zero Actions minutes) — GitHub Release + itch.io |

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

# 2. Push the commit AND the tag.
git push --follow-tags origin main

# 3. Build the desktop AppImage on ci-eph and publish it from here (no Actions):
./scripts/release-desktop.sh    # tag = v<package.json version>; --tag=vX.Y.Z to override
```

`release-desktop.sh` builds the AppImage **on the shared `ci-eph` Hetzner box**
(`ci-on-server.sh --run="npm run dist:linux" --out=release`, `electron-builder
--publish never` → no token on the box), fetches `release/small-gods-<version>-x64.AppImage`
**and `release/latest-linux.yml`** back to the Mac, then creates/updates the GitHub
Release for the tag and uploads both with your local `gh` auth. Zero Actions minutes,
and the publish token never leaves your machine.

> **Why off Actions?** Same reason as CI (infra Phase 1, Option A): heavy builds run on
> the shared ephemeral box, not on paid runners. `git push --follow-tags` no longer
> triggers a build — the release is a deliberate, local `./scripts/release-desktop.sh` step.

### Break-glass: build on Actions instead

If the Mac or `ci-eph` is unavailable, `release.yml` is kept as a **manual** fallback:
open the repo's **Actions → Release (Linux desktop) → Run workflow**, enter the `v*` tag,
and it builds+publishes on `ubuntu-latest` exactly as `release-desktop.sh` would. It is
**not** tag-triggered, so it never double-publishes alongside the local path.

## Dev builds (multi-platform)

Beyond the Linux AppImage, dev builds are cut for macOS and Windows so invited
collaborators can test on their own machines. These ship as **GitHub pre-releases to a
SEPARATE private artifacts repo, [`morteng/small-gods-releases`](https://github.com/morteng/small-gods-releases)** —
never the source repo. Keeping releases in an artifacts-only repo means the read token
baked into the app (for the update feed, below) can never grant source access, which is
what lets the source repo go private later.

### One command: `scripts/dev-build.sh`

```bash
./scripts/dev-build.sh              # build Linux + Windows (box) + macOS (local); PRINT the publish cmd
./scripts/dev-build.sh --publish    # also cut a dev tag (release:dev) + publish to the releases repo
./scripts/dev-build.sh --skip-win   # skip a platform (--skip-linux / --skip-mac too)
./scripts/dev-build.sh --draft      # with --publish, publish as a draft
```

Publishing is **gated behind `--publish`** — the user confirms every publish. The default
run only builds and **prints the exact `gh release create` it would run**. With `--publish`
it runs `npm run release:dev` (bump to `X.Y.Z-dev.N` + tag **locally**, no push) *first* so
the `small-gods-<version>-*` artifacts match the tag, rebuilds at that version, then
publishes to `small-gods-releases` from the Mac with your local `gh` auth (the publish
token never touches the box).

Per platform:

- **macOS** — built **locally** on the Mac (`npm run dist:mac` → `release/small-gods-<version>-x64.dmg`
  + `.zip`). The build Mac is **macOS 12 Monterey**, which caps Electron at **42.x** (Electron
  44+ requires macOS 13) — do **not** bump `electron` past `42.x`. Builds are **unsigned**
  (ad-hoc signature, `identity: null`, no notarization — no Apple Developer cert), so Gatekeeper
  blocks a double-click on first launch. Testers must **right-click → Open** once, or clear the
  quarantine attribute: `xattr -dr com.apple.quarantine "/Applications/Small Gods.app"`.
- **Windows** — **cross-built on the `ci-eph` box** using the electron-builder wine image
  (`./scripts/ci-on-server.sh --run="npm run dist:win" --out=release --image=electronuserland/builder:22-wine`),
  producing `release/small-gods-<version>-setup.exe` (NSIS installer). The installer is
  **unsigned**, so Windows SmartScreen shows an **"unknown publisher"** warning — testers click
  **More info → Run anyway**.
- **Linux** — AppImage built on `ci-eph` (`npm run dist:linux`); one of the two
  self-updating targets (see below).

### The update-feed read token (SG_RELEASES_READ_PAT)

Because `small-gods-releases` is **private**, electron-updater can't read the feed
anonymously — the app needs a token. This is a **fine-grained, read-only PAT** the user
creates once (see the checklist at the bottom of this file) and stores in `.env` as
`SG_RELEASES_READ_PAT` (gitignored). `dev-build.sh` injects it into the box container
transiently (`ci-on-server.sh --env`, written `0600`, deleted right after the run), and
`electron/after-pack.cjs` bakes it into the shipped app at package time.

The token is **never** committed: the committed `electron/update-token.cjs` returns
`null`; `asarUnpack` keeps that file out of `app.asar`; and `after-pack.cjs` overwrites
only the *unpacked, shipped* copy (skipping darwin, which never self-updates). A build cut
with no token still succeeds — it simply ships without one and the updater stays silent.

## Self-update (desktop)

The desktop app updates itself from the private `small-gods-releases` feed, no store
required. Two targets self-update, one doesn't:

- **Linux AppImage** and **Windows NSIS** self-update via
  [`electron-updater`](https://www.electron.build/auto-update). On launch the packaged app
  reads `latest-linux.yml` / `latest.yml` off the **latest release in
  `small-gods-releases`** (authenticated with the baked read token), downloads the newer
  binary in the background, and prompts *"Update ready — Restart now / Later"*.
- **macOS** does **not** self-update — Squirrel.Mac needs a *signed* app and dev builds are
  unsigned, so `after-pack.cjs` skips baking the token on darwin and `main.cjs` skips the
  updater there. Mac testers update manually by downloading the new `.dmg`.

The gate decision is a pure, unit-tested function (`electron/update-gate.cjs`,
`tests/unit/update-gate.test.ts`); `main.cjs` wires the side effects. It runs **only** in a
packaged, self-updatable, **tokened** build:

- unpackaged (`electron:preview`, dev server) → skipped;
- darwin → skipped;
- Linux that isn't an AppImage → skipped;
- **no baked token** (a dev build cut before the PAT exists) → skipped *silently* — a private
  feed is unreadable anonymously, so we disable rather than emit 401s.

**Fail-soft is a hard requirement:** every bit of updater setup and every event is wrapped so
a missing/dead/unauthorized feed (offline, token revoked, repo empty, first release not cut
yet) logs **one** line and is **never** fatal, and **never** dialogs or nags the player.

## Creating the update-feed read PAT (one-time, user-only)

Only the account owner can mint this. It is a **fine-grained** PAT scoped to a single repo:

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens
   → Generate new token**.
2. **Resource owner:** `morteng`. **Repository access:** *Only select repositories* →
   **`small-gods-releases`** (NOT the source repo).
3. **Permissions → Repository permissions → Contents: Read-only**. Nothing else.
4. Set a sensible expiry; regenerate when it lapses.
5. Copy the token into `.env` (gitignored) as `SG_RELEASES_READ_PAT=<token>`.

That's all the app needs to read the private feed. `dev-build.sh` picks it up from `.env`
automatically. Until it exists, dev builds still build and publish — they just ship without
a self-update token (the updater stays silent), which is fine for early testing.

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

## Beta access (no key system to build)

A single-player, client-side game has nothing to validate a license against — its logic
ships to the browser regardless — so don't build activation keys. Use itch.io's built-in
gating instead:

- Set the itch project visibility to **Restricted** (or keep it a **Draft**), then generate
  **download keys** under the project's *Distribute* page and hand them to testers. Keys are
  revocable and gate the download itself.
- The public web build on GitHub Pages stays as the open demo; itch is the gated channel.

The desktop hardening that *is* worth it lives in `electron/main.cjs`: `contextIsolation` +
`nodeIntegration:false` + `sandbox:true`, a protocol handler contained to `dist/` (no path
traversal), and a `will-navigate` lock so the window only ever shows our own bundle. Linux
AppImage code-signing is deliberately skipped (few verify it; electron-updater already
SHA512-checks the feed), and a strict CSP is skipped because it fights the user-configurable
LLM endpoint.

## Source privacy (deferred decision)

Going private hides the TS source, git history, and `docs/` — not the running bundle (a
client-side game ships its logic to the browser regardless; prod source maps are already
off, `VITE_SOURCEMAP=1` to opt back in). When you choose a path:

- **GitHub Pro** (~$4/mo): repo private, Pages keeps serving — fewest moving parts.
- **Split repos**: private source + a public repo owning the Pages site (free).
- itch.io download stays public either way (it's external), so private source does **not**
  block desktop distribution.
