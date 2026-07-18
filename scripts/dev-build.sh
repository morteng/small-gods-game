#!/usr/bin/env bash
# dev-build.sh — cut a multi-platform DEV build (Linux + Windows + macOS) and,
# optionally, publish it as a GitHub pre-release to the PRIVATE artifacts repo
# `morteng/small-gods-releases` (never the source repo). Modeled on
# scripts/release-desktop.sh.
#
# Split of labour (same as CI): Linux + Windows are built on the shared `ci-eph`
# Hetzner box (nothing heavy runs locally); macOS is built HERE (Monterey, unsigned
# — Electron ≤42.x). The GitHub publish token (your local `gh` auth) NEVER touches
# the box. The update-feed READ token (SG_RELEASES_READ_PAT, fine-grained, Contents:
# Read on the releases repo only) is injected into the box container transiently
# (--env, 0600, deleted after the run) so electron/after-pack.cjs can bake it into
# the shipped app; a build with no token still succeeds (updater is simply skipped).
#
# Publishing is GATED behind --publish. By DEFAULT this only builds and PRINTS the
# exact `gh release create` command it would run — you cut the tag + publish yourself.
#
# Prereqs:
#   - Clean tree, on a branch.
#   - `gh` logged in (gh auth status) for --publish.
#   - `hcloud` context + ~/.ssh/hetzner_ed25519 (same as CI) for the box builds.
#   - SG_RELEASES_READ_PAT in .env once the PAT exists (optional; warns if missing).
#
# Usage:
#   ./scripts/dev-build.sh                 # build all platforms; print the publish cmd
#   ./scripts/dev-build.sh --publish       # cut a dev tag (release:dev) + publish to releases repo
#   ./scripts/dev-build.sh --skip-win      # skip a platform (also --skip-linux / --skip-mac)
#   ./scripts/dev-build.sh --draft         # (with --publish) publish as a draft
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RELEASES_REPO="morteng/small-gods-releases"
WIN_IMAGE="electronuserland/builder:22-wine"

PUBLISH=0
DRAFT=""
SKIP_LINUX=0
SKIP_WIN=0
SKIP_MAC=0
for arg in "$@"; do
  case "$arg" in
    --publish)    PUBLISH=1 ;;
    --draft)      DRAFT=1 ;; # with --publish, publish the pre-release as a draft
    --skip-linux) SKIP_LINUX=1 ;;
    --skip-win)   SKIP_WIN=1 ;;
    --skip-mac)   SKIP_MAC=1 ;;
    -h|--help)    sed -n '24,28p' "$0"; exit 0 ;;
    *) echo "unknown arg: $arg (see --help)" >&2; exit 2 ;;
  esac
done

log()  { echo "▶ $*"; }
ok()   { echo "✓ $*"; }
warn() { echo "⚠ $*" >&2; }
fail() { echo "✗ $*" >&2; exit 1; }

# ── Preflight ────────────────────────────────────────────────────────────────
git diff-index --quiet HEAD -- 2>/dev/null || fail "Working tree is dirty — commit/stash before a dev build."
BRANCH="$(git symbolic-ref --quiet --short HEAD || true)"
[ -n "$BRANCH" ] || fail "Detached HEAD — check out a branch first."
ok "Clean tree on branch: $BRANCH"

# Read the feed READ token from .env (never printed). Missing is a WARN, not fatal:
# builds still work, they just ship without a self-update token.
READ_PAT=""
if [ -f .env ]; then
  READ_PAT="$(grep -E '^SG_RELEASES_READ_PAT=' .env | head -1 | cut -d= -f2- | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//' || true)"
fi
if [ -z "$READ_PAT" ]; then
  warn "SG_RELEASES_READ_PAT not in .env — desktop builds will ship WITHOUT a self-update token (updater skipped). Add it once the PAT exists."
else
  ok "SG_RELEASES_READ_PAT present — will bake the update token into the builds."
fi

# ── Optionally cut the dev tag FIRST so artifacts carry the dev version ───────
# release:dev bumps package.json to X.Y.Z-dev.N + tags it LOCALLY (no push). Doing
# it before the builds means small-gods-<version>-* artifacts match the tag we
# publish under. Build-only runs leave the version untouched.
if [ "$PUBLISH" = 1 ]; then
  log "Cutting dev version + tag (npm run release:dev)..."
  npm run release:dev
fi

VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}"
SHA="$(git rev-parse --short HEAD)"
log "Dev build: $TAG  (sha $SHA)"

# ── Token env-file for the box (injected + deleted by ci-on-server) ──────────
TOK_ENV=""
if [ -n "$READ_PAT" ]; then
  TOK_ENV="$(mktemp -t sg-releases-pat.XXXXXX)"
  # shellcheck disable=SC2064
  trap "rm -f '$TOK_ENV'" EXIT
  printf 'SG_RELEASES_READ_PAT=%s\n' "$READ_PAT" > "$TOK_ENV"
  chmod 600 "$TOK_ENV"
fi
BOX_ENV_ARG=()
[ -n "$TOK_ENV" ] && BOX_ENV_ARG=(--env="$TOK_ENV")

# ── Build: Linux AppImage (box) ──────────────────────────────────────────────
if [ "$SKIP_LINUX" = 0 ]; then
  log "Building Linux AppImage on ci-eph..."
  ./scripts/ci-on-server.sh --run="npm run dist:linux" --out=release "${BOX_ENV_ARG[@]}"
else
  warn "--skip-linux"
fi

# ── Build: Windows NSIS (box, wine image) ────────────────────────────────────
if [ "$SKIP_WIN" = 0 ]; then
  log "Building Windows NSIS installer on ci-eph (wine image)..."
  ./scripts/ci-on-server.sh --run="npm run dist:win" --out=release --image="$WIN_IMAGE" "${BOX_ENV_ARG[@]}"
else
  warn "--skip-win"
fi

# ── Build: macOS dmg+zip (local, unsigned) ───────────────────────────────────
if [ "$SKIP_MAC" = 0 ]; then
  log "Building macOS dmg+zip locally (unsigned)..."
  # VITE_GIT_SHA feeds the in-app build stamp; SG_RELEASES_READ_PAT is exported for
  # parity though after-pack.cjs skips baking on darwin (mac never self-updates).
  VITE_GIT_SHA="$SHA" SG_RELEASES_READ_PAT="$READ_PAT" npm run dist:mac
else
  warn "--skip-mac"
fi

# ── Collect artifacts ────────────────────────────────────────────────────────
shopt -s nullglob
ARTIFACTS=(release/*.AppImage release/*.exe release/*.dmg release/*.zip release/latest*.yml release/*.blockmap)
shopt -u nullglob
if [ "${#ARTIFACTS[@]}" -eq 0 ]; then
  fail "No artifacts in release/ — did the builds run? (all platforms skipped?)"
fi
ok "Artifacts:"
printf '   %s\n' "${ARTIFACTS[@]}"

# ── Publish (gated) ──────────────────────────────────────────────────────────
NOTES="Dev pre-release ${TAG} (${SHA}). Unsigned desktop builds for invited testers — Linux self-updates (AppImage), Windows self-updates (NSIS), macOS is manual (unsigned)."
if [ "$PUBLISH" = 1 ]; then
  log "Publishing pre-release $TAG to $RELEASES_REPO..."
  if gh release view "$TAG" --repo "$RELEASES_REPO" >/dev/null 2>&1; then
    gh release upload "$TAG" "${ARTIFACTS[@]}" --repo "$RELEASES_REPO" --clobber
  else
    gh release create "$TAG" "${ARTIFACTS[@]}" \
      --repo "$RELEASES_REPO" --prerelease --title "$TAG" --notes "$NOTES" ${DRAFT:+--draft}
  fi
  ok "Published: $(gh release view "$TAG" --repo "$RELEASES_REPO" --json url -q .url 2>/dev/null || echo "$TAG")"
else
  echo ""
  echo "── DRY RUN (no --publish) ─────────────────────────────────────────────"
  echo "Built artifacts above. To cut the dev tag AND publish them, re-run with:"
  echo ""
  echo "    ./scripts/dev-build.sh --publish"
  echo ""
  echo "That runs 'npm run release:dev' (bump + tag locally), rebuilds at the dev"
  echo "version, then publishes to $RELEASES_REPO. The equivalent manual publish is:"
  echo ""
  echo "    gh release create $TAG \\"
  printf '        %s \\\n' "${ARTIFACTS[@]}"
  echo "        --repo $RELEASES_REPO --prerelease --title \"$TAG\" --notes \"…\""
  echo "───────────────────────────────────────────────────────────────────────"
fi
