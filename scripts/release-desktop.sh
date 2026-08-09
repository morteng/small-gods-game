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
# Most of the time you do NOT run this directly — `npm run release:linux`
# (scripts/release-linux.sh) is the one-command release process and calls this as its
# build+publish step. Run this alone to re-publish artifacts for a tag that exists.
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
  # ci-on-server.sh ships HEAD, not the tag — so if they've drifted, the binary we
  # are about to label "$TAG" is NOT the tagged code. Warn with both shas rather
  # than publish that silently.
  HEAD_SHA="$(git rev-parse --short HEAD)"
  TAG_SHA="$(git rev-parse --short "$TAG^{commit}")"
  if [ "$HEAD_SHA" != "$TAG_SHA" ]; then
    echo "⚠ HEAD ($HEAD_SHA) is not the tagged commit ($TAG_SHA) — the box builds HEAD." >&2
    echo "  The build is stamped $HEAD_SHA so it stays honest. Check out $TAG to build the tag exactly." >&2
  fi

  # The box builds from a `git archive` tar with no .git, so VITE_GIT_SHA must be
  # handed in or the in-app build stamp reads "unknown". It stamps what is ACTUALLY
  # built (HEAD). Injected 0600 and deleted by ci-on-server.sh when the run ends.
  BOX_ENV="$(mktemp -t sg-release-env.XXXXXX)"
  # shellcheck disable=SC2064
  trap "rm -f '$BOX_ENV'" EXIT
  printf 'VITE_GIT_SHA=%s\n' "$HEAD_SHA" > "$BOX_ENV"
  chmod 600 "$BOX_ENV"
  echo "▶ Building AppImage on ci-eph (electron-builder --publish never — no token on the box)..."
  ./scripts/ci-on-server.sh --run="npm run dist:linux" --out=release --env="$BOX_ENV"
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
  echo "  (existing release notes left untouched — edit them on GitHub if needed)"
  gh release upload "$TAG" "$APPIMAGE" "$FEED" --clobber
else
  echo "▶ Creating Release $TAG and uploading artifacts..."

  # Release notes = PLAIN-LANGUAGE install instructions first, auto-generated
  # changelog second. A player landing on this page should not have to know what an
  # AppImage is, and the two questions Linux users actually hit (chmod, FUSE 2) are
  # answered inline rather than in an issue thread.
  APPNAME="$(basename "$APPIMAGE")"
  NOTES_FILE="$(mktemp -t sg-release-notes.XXXXXX)"
  cat > "$NOTES_FILE" <<EOF
## Play on Linux

Download **\`${APPNAME}\`** below — one file, no installer, nothing to unpack.

\`\`\`bash
chmod +x ${APPNAME}     # make it runnable (once)
./${APPNAME}            # play
\`\`\`

Prefer clicking? Right-click the file → **Properties → Permissions → Allow executing
file as program**, then double-click it.

Requires a 64-bit (x86-64) Linux desktop, and a **working Vulkan driver** — the app
brings its own Chromium/WebGPU runtime, so your *browser* doesn't need WebGPU, but the
graphics driver underneath still does. Most desktop systems with Mesa or the proprietary
NVIDIA driver already have it (\`vulkaninfo --summary\` confirms; \`mesa-vulkan-drivers\`
installs it on Debian/Ubuntu).

### If it won't start

- **\`libfuse.so.2\` / "dlopen(): error loading libfuse.so.2"** — your distro ships
  FUSE 3 and AppImages want FUSE 2. Either run it without FUSE:
  \`./${APPNAME} --appimage-extract-and-run\`
  or install the compatibility package (Debian/Ubuntu: \`sudo apt install libfuse2\`,
  Fedora: \`sudo dnf install fuse-libs\`).
- **A dark window saying "WebGPU is required to render this game."** — the graphics
  driver can't provide WebGPU. On Linux that is nearly always a missing Vulkan driver;
  install it (Debian/Ubuntu: \`sudo apt install mesa-vulkan-drivers\`) and relaunch.
- **Nothing happens / blank window** — start it from a terminal so you can see the
  error, and please open an issue with that output.

### Updates

The app checks this page on launch and offers to install a newer version for you.

### Rather not download anything?

Play in the browser: <https://morteng.github.io/small-gods-game/>
(needs a WebGPU-capable browser — Chrome or Edge 113+).

---

EOF
  # Append GitHub's own commit-derived notes when available; a failure here (no
  # previous tag, API hiccup) must not sink the release — the instructions matter more.
  if gh api -X POST "repos/{owner}/{repo}/releases/generate-notes" -f tag_name="$TAG" -q .body \
       >> "$NOTES_FILE" 2>/dev/null; then
    echo "✓ Appended auto-generated changelog"
  else
    echo "⚠ Could not auto-generate the changelog — publishing with install notes only" >&2
  fi

  gh release create "$TAG" "$APPIMAGE" "$FEED" \
    --title "Small Gods $TAG" --notes-file "$NOTES_FILE" $DRAFT
  rm -f "$NOTES_FILE"
fi

echo "✓ Desktop release published: $(gh release view "$TAG" --json url -q .url 2>/dev/null || echo "$TAG")"
