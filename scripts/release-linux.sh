#!/usr/bin/env bash
# release-linux.sh — THE release process. One command: version → tag → push →
# build the Linux AppImage on `ci-eph` → publish a public GitHub Release with
# player-facing install instructions.
#
# This is what `npm run release:linux` runs. It exists so cutting a release is one
# decision ("ship it?") instead of four commands you can get out of order — the
# classic failure being a pushed tag with no binary attached to it.
#
# What it does NOT do: run anything on GitHub Actions. The AppImage is built on the
# shared ephemeral Hetzner box and published from HERE with your local `gh` auth, so
# the publish token never leaves this machine (see docs/RELEASING.md).
#
# Prereqs (all checked up front, with a fix for each):
#   - clean tree, on `main`, in sync with origin
#   - `gh` logged in with repo scope        (gh auth login)
#   - hcloud + ~/.ssh/hetzner_ed25519       (same as CI)
#
# Usage:
#   npm run release:linux                    # bump from commit history, then ship
#   npm run release:linux -- --dry-run       # show the plan + the version it would cut
#   npm run release:linux -- --as=0.2.0      # force a version
#   npm run release:linux -- --first-release # tag the CURRENT version (no bump)
#   npm run release:linux -- --draft         # publish as a draft (nobody sees it yet)
#   npm run release:linux -- --yes           # skip the confirmation prompt
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

AS=""
FIRST=0
DRY=0
YES=0
DRAFT=""
for arg in "$@"; do
  case "$arg" in
    --as=*)          AS="${arg#*=}" ;;
    --first-release) FIRST=1 ;;
    --dry-run)       DRY=1 ;;
    --yes|-y)        YES=1 ;;
    --draft)         DRAFT="--draft" ;;
    -h|--help)       sed -n '19,26p' "$0"; exit 0 ;;
    *) echo "unknown arg: $arg (see --help)" >&2; exit 2 ;;
  esac
done

log()  { echo "▶ $*"; }
ok()   { echo "✓ $*"; }
warn() { echo "⚠ $*" >&2; }
fail() { echo "✗ $*" >&2; exit 1; }

# ── Preflight ────────────────────────────────────────────────────────────────
# Every check names its own fix — a release you can't finish is worse than one you
# never started, and the expensive step (a box build) comes last.
log "Preflight..."

git diff-index --quiet HEAD -- 2>/dev/null \
  || fail "Working tree is dirty. Commit or stash first:  git status"

BRANCH="$(git symbolic-ref --quiet --short HEAD || true)"
[ "$BRANCH" = "main" ] \
  || fail "On branch '${BRANCH:-detached HEAD}' — releases are cut from main:  git checkout main"

git fetch --quiet origin main
BEHIND="$(git rev-list --count HEAD..origin/main)"
AHEAD="$(git rev-list --count origin/main..HEAD)"
[ "$BEHIND" = "0" ] \
  || fail "main is $BEHIND commit(s) behind origin. Update first:  git pull --ff-only"
[ "$AHEAD" = "0" ] && ok "In sync with origin/main" \
  || log "$AHEAD unpushed commit(s) — they go out with this release"

gh auth status >/dev/null 2>&1 \
  || fail "GitHub CLI not logged in. Fix:  gh auth login"

command -v hcloud >/dev/null 2>&1 \
  || fail "hcloud CLI not found — it builds the AppImage on ci-eph. Fix:  brew install hcloud"
[ -f "$HOME/.ssh/hetzner_ed25519" ] \
  || fail "Missing ~/.ssh/hetzner_ed25519 (the CI box key). Same key CI uses."

ok "Preflight passed"

# ── Work out the version we're about to cut ──────────────────────────────────
CURRENT="$(node -p "require('./package.json').version")"
BUMP_ARGS=()
[ -n "$AS" ]     && BUMP_ARGS+=(--release-as "$AS")
[ "$FIRST" = 1 ] && BUMP_ARGS+=(--first-release)

# commit-and-tag-version --dry-run tells us the next version without touching
# anything; parse it so the confirmation prompt shows a real number, not a guess.
DRY_OUT="$(npx commit-and-tag-version --dry-run "${BUMP_ARGS[@]}" 2>&1 || true)"
NEXT="$(printf '%s\n' "$DRY_OUT" | sed -n 's/.*bumping version in package.json from .* to \([0-9][^ ]*\).*/\1/p' | head -1)"
[ -n "$NEXT" ] || NEXT="$CURRENT"
TAG="v${NEXT}"

echo ""
echo "─────────────────────────────────────────────────────────────────────"
echo "  Release plan"
echo "─────────────────────────────────────────────────────────────────────"
echo "  version   $CURRENT  →  $NEXT      (tag $TAG)"
echo "  1. bump package.json + CHANGELOG.md, commit, tag   (local)"
echo "  2. git push --follow-tags origin main              (also redeploys the web build)"
echo "  3. build small-gods-${NEXT}-x64.AppImage on ci-eph (~minutes, costs box time)"
echo "  4. publish a public GitHub Release${DRAFT:+ (DRAFT)} with install instructions"
echo "─────────────────────────────────────────────────────────────────────"
echo ""

if [ "$DRY" = 1 ]; then
  # Only the action lines — the full dry-run body is the entire CHANGELOG diff,
  # which buries the plan above under hundreds of commit bullets.
  echo "  Version tooling would:"
  printf '%s\n' "$DRY_OUT" | grep -E '^(✔|ℹ|✖)' | sed 's/^/    /' || true
  echo ""
  ok "--dry-run: nothing changed. Re-run without --dry-run to ship."
  exit 0
fi

if [ "$YES" = 0 ]; then
  if [ -t 0 ]; then
    read -r -p "Cut and publish $TAG? [y/N] " REPLY
    case "$REPLY" in [yY]|[yY][eE][sS]) ;; *) fail "Aborted — nothing changed." ;; esac
  else
    fail "Not a terminal and no --yes — refusing to publish unattended."
  fi
fi

# ── 1. Bump + tag (local) ────────────────────────────────────────────────────
log "Cutting $TAG (version bump + CHANGELOG + tag)..."
npx commit-and-tag-version "${BUMP_ARGS[@]}"
ok "Tagged $TAG locally"

# ── 2. Push commit + tag ─────────────────────────────────────────────────────
log "Pushing main + tag to origin (this also redeploys the web build via Pages)..."
git push --follow-tags origin main
ok "Pushed"

# ── 3+4. Build on the box, publish from here ─────────────────────────────────
# Past this point the tag is public, so a failure is recoverable by re-running the
# build+publish step alone — say so rather than leaving a tag with no binary.
log "Building + publishing the Linux AppImage..."
if ! ./scripts/release-desktop.sh --tag="$TAG" $DRAFT; then
  echo "" >&2
  fail "Build/publish failed — but $TAG is already pushed.
  Fix the cause and re-run JUST this step (no re-tagging):
      ./scripts/release-desktop.sh --tag=$TAG"
fi

URL="$(gh release view "$TAG" --json url -q .url 2>/dev/null || echo '')"
echo ""
ok "Released $TAG"
[ -n "$URL" ] && echo "  $URL"
echo ""
echo "  Players download one file, chmod +x it, and run it — the release page"
echo "  spells that out, including the FUSE 2 fix and the browser alternative."
