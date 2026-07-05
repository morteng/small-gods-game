#!/usr/bin/env bash
# release-desktop.sh — cut a Linux desktop release WITHOUT GitHub Actions.
#
# Builds the Electron AppImage on the shared `ci-eph` Hetzner box (infra Phase 1,
# Option A: nothing heavy runs locally or on the 8 GB prod box), then publishes
# the artifacts to the GitHub Release from THIS Mac via `gh`. The publish token
# (your local `gh` auth) NEVER touches the shared box — the box only ever sees
# source + the public npm registry, and electron-builder runs with
# `--publish never`.
#
# Prereqs:
#   - The version tag already exists (cut it with `npm run release` first, per
#     docs/RELEASING.md). This script does NOT bump/tag — it only builds+publishes.
#   - `gh` logged in with `repo` scope (gh auth status).
#   - `hcloud` context `navomat` + ~/.ssh/hetzner_ed25519 (same as CI).
#
# Flow:
#   1. Resolve tag: --tag vX.Y.Z, else `v<package.json version>`.
#   2. Build on ci-eph:  ci-on-server.sh --run="npm run dist:linux" --out=release
#      → ./release/*.AppImage + ./release/latest-linux.yml land back on the Mac.
#   3. Create-or-update the GitHub Release for the tag and upload those two files
#      (electron-updater reads latest-linux.yml off the Release to self-update).
#
# Usage:
#   ./scripts/release-desktop.sh                 # tag = v<package.json version>
#   ./scripts/release-desktop.sh --tag=v0.2.0    # explicit tag
#   ./scripts/release-desktop.sh --draft         # publish as a draft release
#   ./scripts/release-desktop.sh --skip-build    # reuse an existing ./release/ (re-publish)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TAG=""
DRAFT=""
SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --tag=*)     TAG="${arg#*=}" ;;
    --draft)     DRAFT="--draft" ;;
    --skip-build) SKIP_BUILD=1 ;;
    -h|--help)   sed -n '24,30p' "$0"; exit 0 ;;
    *) echo "unknown arg: $arg (see --help)" >&2; exit 2 ;;
  esac
done

# ── Resolve tag ──────────────────────────────────────────────────────────────
if [ -z "$TAG" ]; then
  VERSION="$(node -p "require('./package.json').version")"
  TAG="v${VERSION}"
fi
echo "▶ Releasing desktop AppImage for tag: $TAG"

# The tag must exist locally (cut via `npm run release`) so the Release attaches
# to a real commit. Bail early with a clear message rather than a confusing gh error.
if ! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "✗ Tag $TAG does not exist. Cut it first:  npm run release  (see docs/RELEASING.md)" >&2
  exit 1
fi

# ── Build on ci-eph ──────────────────────────────────────────────────────────
if [ "$SKIP_BUILD" = 1 ]; then
  echo "▶ --skip-build: reusing existing ./release/"
else
  echo "▶ Building AppImage on ci-eph (electron-builder --publish never — no token on the box)..."
  ./scripts/ci-on-server.sh --run="npm run dist:linux" --out=release
fi

APPIMAGE="$(ls release/*.AppImage 2>/dev/null | head -1 || true)"
FEED="release/latest-linux.yml"
if [ -z "$APPIMAGE" ] || [ ! -f "$FEED" ]; then
  echo "✗ Expected release/*.AppImage and $FEED after the build — not found." >&2
  echo "  (Did the ci-eph build succeed and fetch back? Check its output above.)" >&2
  exit 1
fi
echo "✓ Artifacts: $APPIMAGE + $FEED"

# ── Publish from the Mac via gh (token stays local) ──────────────────────────
# electron-updater reads latest-linux.yml off the *latest* Release, so both files
# must live on the same Release. Create it if absent, else clobber the assets.
if gh release view "$TAG" >/dev/null 2>&1; then
  echo "▶ Release $TAG exists — uploading (clobber) artifacts..."
  gh release upload "$TAG" "$APPIMAGE" "$FEED" --clobber
else
  echo "▶ Creating Release $TAG and uploading artifacts..."
  gh release create "$TAG" "$APPIMAGE" "$FEED" \
    --title "$TAG" --generate-notes $DRAFT
fi

echo "✓ Desktop release published: $(gh release view "$TAG" --json url -q .url 2>/dev/null || echo "$TAG")"
